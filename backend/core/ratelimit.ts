/**
 * IP 限流,纯内存,不持久化(见 02 文档 7.3)。按自然日重置。
 */

import { config } from '../config.js';

interface Bucket {
  date: string; // YYYY-MM-DD,本地日期
  count: number;
}

const buckets = new Map<string, Bucket>();

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 返回 true 表示允许通过,false 表示已超出当日额度 */
export function checkRateLimit(ip: string): boolean {
  const today = todayKey();
  const existing = buckets.get(ip);
  if (!existing || existing.date !== today) {
    buckets.set(ip, { date: today, count: 1 });
    return true;
  }
  if (existing.count >= config.rateLimit.perIpDaily) {
    return false;
  }
  existing.count += 1;
  return true;
}

export function _clearRateLimits(): void {
  buckets.clear();
}
