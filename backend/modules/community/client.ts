/**
 * 社区 API 签名调用封装。见 07 文档第二节/第四节。
 *
 * 响应统一 `{status, msg, data}`,status===0 成功,与内容 API 的 `{code:20000}` 体系不同,
 * 别混用错误判断。签名失败返回 HTTP 401。凭证只在后端流转,不进日志。
 */

import { config } from '../../config.js';
import { getMetrics } from '../../core/metrics.js';
import { buildCommunityHeaders } from './sign.js';

export interface CommunityResponse<T = unknown> {
  status: number;
  msg: string;
  data: T | null;
}

export interface CommunityCallOptions {
  method?: 'GET' | 'POST';
  query?: Record<string, string>;
  body?: unknown;
}

/** 未开启或凭证缺失时抛错,挡在发请求之前,防止误触发外发动作 */
export function assertCommunityReady(): void {
  if (!config.features.community) {
    throw new Error('community api disabled (config.features.community=false)');
  }
  if (!config.zhihu.communityAppKey || !config.zhihu.communityAppSecret) {
    throw new Error('community api credentials not configured');
  }
}

export async function communityCall<T = unknown>(
  path: string,
  opts: CommunityCallOptions = {}
): Promise<CommunityResponse<T>> {
  assertCommunityReady();

  getMetrics().incr('api:community');

  const url = new URL(path, config.zhihu.communityApiBase);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v);
  }

  const headers = buildCommunityHeaders(config.zhihu.communityAppKey, config.zhihu.communityAppSecret);
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401) {
    throw new Error('community api auth failed (401, key verification failed)');
  }
  if (!res.ok) {
    throw new Error(`community api ${path} http ${res.status}`);
  }
  return (await res.json()) as CommunityResponse<T>;
}
