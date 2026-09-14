/**
 * 统一调用计数(metrics 统计层)。见 STATUS 文档 T5「使用数据」。
 *
 * 背景:后端之前 quota / ratelimit / cache 各自为政,没有统一调用计数。
 * 这个模块把 explain/followup/reangle/各知乎 API 调用收拢到一个内存聚合器里,
 * 每类调用 +1 并打标签,供管理后台展示「使用数据」,并预留 snapshot 导出接口
 * (未来要持久化到 JSONL 或推送到监控平台,只需在 snapshot 上加序列化)。
 *
 * 设计:
 * - 纯内存聚合,进程重启归零。使用数据是「运维观察用」,不要求持久(见 02 文档 7.3)。
 * - 标签是开放字符串,不建封闭词表——新 API 接入不用回来改这里的枚举。
 * - 缓存命中率单列(命中/未命中各自计数,导出时算比率),避免在展示层反复算。
 */

export interface MetricsSnapshot {
  /** label -> 累计次数。label 约定:`explain` / `followup` / `reangle` / `zhida` 与
   *  `api:zhihu_search` / `api:hot_list` / `api:global_search` / `api:zhida` /
   *  `api:community` / `api:oauth`。 */
  counters: Record<string, number>;
  cache: {
    hits: number;
    misses: number;
    /** 命中率 0~1;无任何缓存读时返回 null(避免除以 0 的假 0%) */
    hitRate: number | null;
  };
  /** 限流触发次数(checkRateLimit 返回 false) */
  rateLimited: number;
  /** 进程启动时间戳,供展示「统计自何时起」 */
  startedAt: number;
}

/** 一条运行时错误记录。type 为 logger.error 的 msg 标签(如 explain_dispatch_failed)。 */
export interface ErrorRecord {
  type: string;
  message: string;
  /** 记录时刻,毫秒时间戳(epoch) */
  timestamp: number;
}

class Metrics {
  private counters = new Map<string, number>();
  private cacheHits = 0;
  private cacheMisses = 0;
  private rateLimited = 0;
  private errors: ErrorRecord[] = [];
  private readonly startedAt = Date.now();

  /** 错误环形缓冲上限:只保留最近 N 条,避免内存无限增长。 */
  static readonly MAX_ERRORS = 50;

  /** 某类调用 +1(或 +n)。label 见 MetricsSnapshot.counters 约定。 */
  incr(label: string, n = 1): void {
    this.counters.set(label, (this.counters.get(label) ?? 0) + n);
  }

  recordCacheHit(): void {
    this.cacheHits += 1;
  }

  recordCacheMiss(): void {
    this.cacheMisses += 1;
  }

  recordRateLimit(): void {
    this.rateLimited += 1;
  }

  /** 记录一条运行时错误,进环形缓冲。type 见 ErrorRecord.type(与 logger.error 的 msg 标签一致)。 */
  recordError(type: string, message: string): void {
    this.errors.push({ type, message, timestamp: Date.now() });
    if (this.errors.length > Metrics.MAX_ERRORS) {
      this.errors.splice(0, this.errors.length - Metrics.MAX_ERRORS);
    }
  }

  /** 最近 N 条错误(新的在前),最多 MAX_ERRORS 条。返回副本,外部改不动内部缓冲。 */
  recentErrors(): ErrorRecord[] {
    return [...this.errors].reverse();
  }

  get(label: string): number {
    return this.counters.get(label) ?? 0;
  }

  /** 导出接口:汇总当前所有计数。管理后台「使用数据」与未来持久化都从这里取。 */
  snapshot(): MetricsSnapshot {
    const total = this.cacheHits + this.cacheMisses;
    return {
      counters: Object.fromEntries(this.counters),
      cache: {
        hits: this.cacheHits,
        misses: this.cacheMisses,
        hitRate: total === 0 ? null : this.cacheHits / total,
      },
      rateLimited: this.rateLimited,
      startedAt: this.startedAt,
    };
  }

  /** 测试/管理后台「清零计数」用 */
  reset(): void {
    this.counters.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.rateLimited = 0;
    this.errors = [];
  }
}

let instance: Metrics | null = null;

export function getMetrics(): Metrics {
  if (!instance) instance = new Metrics();
  return instance;
}

/** 测试用:重置单例 */
export function _resetMetrics(): void {
  instance = null;
}
