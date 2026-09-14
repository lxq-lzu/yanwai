/**
 * 分层 TTL 缓存,基于 JsonlStore。见 02 文档第六节。
 *
 * - 术语/潜台词类稳定,TTL 长;热点/社区类有时效性,TTL 短。
 * - 条目数上限 + 懒惰过期(取的时候查 createdAt,不用定时器扫全表,省一个后台任务)。
 */

import { JsonlStore } from './storage.js';
import { config } from '../config.js';
import type { CachedResult } from '../types.js';
import { logger } from './logger.js';

export class ResultCache {
  private store: JsonlStore<CachedResult>;
  private insertOrder: string[] = []; // 简单 FIFO 淘汰,不引入 lru-cache 依赖也够用

  constructor(dir: string, filename: string) {
    this.store = new JsonlStore<CachedResult>(dir, filename);
  }

  async whenReady() {
    await this.store.whenReady();
    // 首次加载时按插入顺序重建 FIFO 队列(用 ts 排序,近似即可)
    this.insertOrder = Array.from(this.store.entries())
      .sort((a, b) => a[1].createdAt - b[1].createdAt)
      .map(([k]) => k);
    const bytes = await this.store.sizeOnDisk();
    if (bytes > config.storage.compactThresholdBytes) {
      await this.store.compact();
    }
  }

  get(key: string): CachedResult | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    const ttl = hit.timeSensitive ? config.cache.ttlTimeSensitiveMs : config.cache.ttlStableMs;
    if (Date.now() - hit.createdAt > ttl) {
      this.store.delete(key);
      return undefined;
    }
    return hit;
  }

  set(key: string, value: CachedResult): void {
    if (!this.store.has(key)) {
      this.insertOrder.push(key);
      this.evictIfNeeded();
    }
    this.store.set(key, value);
  }

  private evictIfNeeded() {
    while (this.insertOrder.length > config.cache.maxEntries) {
      const oldest = this.insertOrder.shift();
      if (oldest) this.store.delete(oldest);
    }
  }

  size(): number {
    return this.store.size();
  }

  /** 导出所有缓存条目(key -> CachedResult),供管理后台「缓存查看」。 */
  entries(): IterableIterator<[string, CachedResult]> {
    return this.store.entries();
  }

  /** 清空缓存:索引 + FIFO 淘汰队列 + 底层 JSONL 文件。 */
  async clear(): Promise<void> {
    this.insertOrder = [];
    await this.store.clear();
  }
}

let instance: ResultCache | null = null;

export function getResultCache(): ResultCache {
  if (!instance) {
    instance = new ResultCache(config.storage.dir, config.storage.cacheLogFile);
  }
  return instance;
}

/** 开发采集日志:仅 DEV_CAPTURE=1 时写,含原文,只在本机。 */
export interface DevCaptureEntry {
  target: string;
  surroundings: unknown;
  scope: unknown;
  feedback: unknown;
  output: { lead: string; body: string };
  ts: number;
}

let devCaptureStore: JsonlStore<DevCaptureEntry> | null = null;

export function captureDevSample(entry: DevCaptureEntry): void {
  if (!config.devCapture) return;
  if (!devCaptureStore) {
    devCaptureStore = new JsonlStore<DevCaptureEntry>(config.storage.dir, config.storage.devCaptureLogFile);
  }
  const key = `${entry.ts}`;
  devCaptureStore.set(key, entry);
  logger.info('dev_capture_recorded', { key });
}

/** 管理后台「dev-capture 日志查看」:列出 key + 时间戳 + 选中文本(不含完整上下文,避免响应过重)。 */
export function listDevCapture(): Array<{ key: string; ts: number; target: string }> {
  if (!devCaptureStore) return [];
  return Array.from(devCaptureStore.entries()).map(([k, v]) => ({ key: k, ts: v.ts, target: v.target }));
}

export function getDevCaptureCount(): number {
  return devCaptureStore?.size() ?? 0;
}

/** 管理后台「dev-capture 日志删除」:清空全部。 */
export async function clearDevCapture(): Promise<void> {
  if (!devCaptureStore) return;
  await devCaptureStore.clear();
}
