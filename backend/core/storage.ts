/**
 * JSONL 追加日志 + 内存索引。见 02 文档第七节。
 *
 * 设计:
 * - JSONL 是持久化日志,内存 Map 是索引。启动时回放重建 Map,运行时查 Map、写 JSONL。
 * - 一次完整解析追加一行,不是每个流式 delta 追加一行。
 * - 回放时忽略解析失败的行(防止最后一行被崩溃截断导致整体失败)。
 * - 单一写流,不并发 appendFile;不逐行 fsync。
 * - 超过阈值就压实:同一 key 的多条旧记录只保留最新一条。
 *
 * 两条日志分开(见 02 文档 7.2):
 * - 运行时缓存:哈希键 + 解析结果,不含原文,线上常开
 * - 开发采集:原文 + 上下文 + 路由决策 + 输出,仅 DEV_CAPTURE=1 本机开
 */

import { appendFile, mkdir, readFile, rename, writeFile, stat } from 'node:fs/promises';
import { createWriteStream, type WriteStream } from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';
import { config } from '../config.js';

interface JsonlRecord<V> {
  key: string;
  value: V;
  ts: number;
  /** 软删除标记,压实时跳过 */
  deleted?: boolean;
}

/**
 * 一个 JSONL 追加日志 + 内存索引的通用容器。
 * V 是值类型,由调用方决定要不要含原文(缓存 vs 开发采集用不同的 V)。
 */
export class JsonlStore<V> {
  private index = new Map<string, JsonlRecord<V>>();
  private filePath: string;
  private writeStream: WriteStream | null = null;
  private ready: Promise<void>;
  /** memory 模式下不碰磁盘,只保留内存索引(见 B3:某些部署平台限「无数据库读写」) */
  private readonly memoryOnly: boolean;

  constructor(dir: string, filename: string) {
    this.filePath = path.join(dir, filename);
    this.memoryOnly = config.storage.mode === 'memory';
    this.ready = this.init(dir);
  }

  private async init(dir: string) {
    if (this.memoryOnly) {
      logger.info('jsonl_store_memory_mode', { file: this.filePath });
      return; // 不 mkdir、不回放、不开写流——纯内存索引
    }
    await mkdir(dir, { recursive: true });
    await this.replay();
    // 单一写流,避免并发 appendFile 导致行交织
    this.writeStream = createWriteStream(this.filePath, { flags: 'a' });
  }

  private async replay() {
    let raw = '';
    try {
      raw = await readFile(this.filePath, 'utf-8');
    } catch (err: any) {
      if (err?.code === 'ENOENT') return; // 首次运行,文件还不存在
      throw err;
    }
    const lines = raw.split('\n');
    let ok = 0;
    let bad = 0;
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const rec: JsonlRecord<V> = JSON.parse(line);
        if (rec.deleted) {
          this.index.delete(rec.key);
        } else {
          this.index.set(rec.key, rec);
        }
        ok++;
      } catch {
        // 回放时忽略解析失败的行(最后一行可能被崩溃截断),不让整体回放失败
        bad++;
      }
    }
    if (bad > 0) {
      logger.warn('jsonl_replay_skipped_bad_lines', { file: this.filePath, ok, bad });
    } else if (ok > 0) {
      logger.info('jsonl_replay_done', { file: this.filePath, entries: this.index.size });
    }
  }

  async whenReady(): Promise<void> {
    return this.ready;
  }

  get(key: string): V | undefined {
    return this.index.get(key)?.value;
  }

  has(key: string): boolean {
    return this.index.has(key);
  }

  size(): number {
    return this.index.size;
  }

  /** 清空:内存索引置空;jsonl 模式下压实成空文件(抹掉历史行),memory 模式下仅清索引。 */
  async clear(): Promise<void> {
    this.index.clear();
    if (!this.memoryOnly) await this.compact();
  }

  /** 写入内存 + 追加一行到 JSONL(memory 模式下跳过落盘),不 fsync,交给 OS 刷盘 */
  set(key: string, value: V): void {
    const rec: JsonlRecord<V> = { key, value, ts: Date.now() };
    this.index.set(key, rec);
    if (!this.memoryOnly) this.appendLine(rec);
  }

  delete(key: string): void {
    if (!this.index.has(key)) return;
    this.index.delete(key);
    if (!this.memoryOnly) {
      this.appendLine({ key, value: undefined as unknown as V, ts: Date.now(), deleted: true });
    }
  }

  private appendLine(rec: JsonlRecord<V>) {
    if (!this.writeStream) {
      // init 还没跑完写流就来了,极少发生(启动瞬间);退化为直接 append,不阻塞主流程
      appendFile(this.filePath, JSON.stringify(rec) + '\n').catch((err) =>
        logger.error('jsonl_append_failed', { file: this.filePath, err: String(err) })
      );
      return;
    }
    this.writeStream.write(JSON.stringify(rec) + '\n');
  }

  /** 压实:把当前内存索引整体重写为新文件,原子替换。启动时超过阈值调用一次。 */
  async compact(): Promise<void> {
    if (this.memoryOnly) return; // 没有磁盘文件,压实无意义
    const tmpPath = `${this.filePath}.compact.tmp`;
    const lines: string[] = [];
    for (const rec of this.index.values()) {
      lines.push(JSON.stringify(rec));
    }
    await writeFile(tmpPath, lines.join('\n') + (lines.length ? '\n' : ''));
    // 关掉旧写流再替换文件,避免 rename 时还有 pending 写入
    if (this.writeStream) {
      await new Promise<void>((resolve) => this.writeStream!.end(resolve));
    }
    await rename(tmpPath, this.filePath);
    this.writeStream = createWriteStream(this.filePath, { flags: 'a' });
    logger.info('jsonl_compacted', { file: this.filePath, entries: this.index.size });
  }

  async sizeOnDisk(): Promise<number> {
    try {
      const s = await stat(this.filePath);
      return s.size;
    } catch {
      return 0;
    }
  }

  entries(): IterableIterator<[string, V]> {
    return Array.from(this.index.entries())
      .map(([k, r]) => [k, r.value] as [string, V])
      [Symbol.iterator]();
  }
}
