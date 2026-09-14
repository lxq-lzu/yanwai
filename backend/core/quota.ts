/**
 * zhihu_search 额度校准。见 02 文档 6.1:
 * "计数器不能只在内存里自己累加——进程重启就归零,会让预算保护静默失效。"
 *
 * 做法:启动时查一次 quota 拿真实 RemainingQuota,之后每隔几分钟重查一次做校准锚点
 * (查询本身不消耗额度),两次校准之间用本地计数递减。
 *
 * 这个模块不直接发 HTTP 请求给知乎——由 modules/evidence/zhihu-search.ts 注入一个
 * fetchRemaining 函数,方便测试用假实现替换,不必在单测里打真实网络请求。
 */

import { config } from '../config.js';
import { logger } from './logger.js';

export type QuotaFetcher = () => Promise<number | null>;

export class SearchQuotaTracker {
  private remaining: number;
  private lastCalibratedAt = 0;
  private fetcher: QuotaFetcher;
  private calibrating: Promise<void> | null = null;

  constructor(fetcher: QuotaFetcher, initialRemaining: number = config.searchQuota.dailyBudget) {
    this.fetcher = fetcher;
    this.remaining = initialRemaining;
  }

  /** 启动时调用一次;失败不阻塞,用配置里的预算值兜底 */
  async calibrate(): Promise<void> {
    if (this.calibrating) return this.calibrating;
    this.calibrating = this._doCalibrate();
    try {
      await this.calibrating;
    } finally {
      this.calibrating = null;
    }
  }

  private async _doCalibrate(): Promise<void> {
    try {
      const officialRemaining = await this.fetcher();
      if (officialRemaining === null) {
        logger.warn('quota_calibrate_unavailable');
        return;
      }
      // 官方剩余额度里,我们的可用预算 = min(官方剩余, 内部预算上限) - 已知已用
      // 简化:直接把内部预算钳制到 官方剩余 与 dailyBudget 的较小值
      this.remaining = Math.min(officialRemaining, config.searchQuota.dailyBudget);
      this.lastCalibratedAt = Date.now();
      logger.info('quota_calibrated', { remaining: this.remaining });
    } catch (err) {
      logger.warn('quota_calibrate_failed', { err: String(err) });
    }
  }

  /** 是否需要重新校准(距上次校准超过间隔) */
  needsRecalibration(): boolean {
    return Date.now() - this.lastCalibratedAt > config.searchQuota.calibrateIntervalMs;
  }

  /** 是否还有预算可用于下一次 zhihu_search 调用 */
  hasBudget(): boolean {
    return this.remaining > 0;
  }

  /** 调用成功后扣减本地计数 */
  consume(n = 1): void {
    this.remaining = Math.max(0, this.remaining - n);
  }

  getRemaining(): number {
    return this.remaining;
  }
}

let instance: SearchQuotaTracker | null = null;

export function getSearchQuotaTracker(fetcher?: QuotaFetcher): SearchQuotaTracker {
  if (!instance) {
    instance = new SearchQuotaTracker(fetcher ?? (async () => null));
  }
  return instance;
}

/** 测试用:重置单例 */
export function _resetSearchQuotaTracker(): void {
  instance = null;
}
