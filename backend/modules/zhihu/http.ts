/**
 * 内容 API(开放平台 Access Secret,Bearer 鉴权)的 GET 封装。见 06 文档第一节凭证体系。
 *
 * 热榜 / 全网搜索 / 知乎搜索共用同一套头(Authorization: Bearer + X-Request-Timestamp),
 * 抽出来避免每个 Provider 复制粘贴一遍。凭证只在后端流转,不进日志(见 02 文档 11.2)。
 */

import { config } from '../../config.js';

/** 内容 API 的 Bearer GET。非 2xx 抛错,调用方自行降级为无证据。 */
export async function zhihuContentGet<T>(path: string, query?: Record<string, string>): Promise<T> {
  const url = new URL(path, config.zhihu.contentApiBase);
  if (query) {
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  }

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.zhihu.accessSecret}`,
      'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`zhihu content ${path} http ${res.status}`);
  return (await res.json()) as T;
}
