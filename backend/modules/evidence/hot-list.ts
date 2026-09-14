/**
 * 知乎热榜资料源(DataSource)。见 06 文档第二节额度 + http-api.md「知乎热榜 API」。
 *
 * 关键约束:官方日额度仅 100 次(极低),必须在应用层缓存 ≥ 1 小时,否则公开流量
 * 几小时就能打穿额度。这里用模块级内存缓存 + 1 小时 TTL,进程重启即失效(可接受:
 * 热榜本身就是短时效内容,重启后重新拉一次即可)。
 *
 * 语义:热榜提供「当前站内热点背景」,是 hotspot 方向源链的第一级。
 */

import type { DataSource, DirectionInput, RawMaterial } from '../../types.js';
import { config } from '../../config.js';
import { logger } from '../../core/logger.js';
import { getMetrics } from '../../core/metrics.js';
import { zhihuContentGet } from '../zhihu/http.js';

interface HotListItem {
  Title: string;
  Url: string;
  ThumbnailUrl: string;
  Summary: string;
}

interface HotListResponse {
  Code: number;
  Data?: { Total: number; Items: HotListItem[] };
}

const HOT_LIST_TTL_MS = 60 * 60 * 1000; // 1 小时,见 06 文档「务必缓存至少 1 小时」

let cached: { at: number; items: HotListItem[] } | null = null;

function mockHotList(): HotListItem[] {
  return [
    { Title: '（Mock 热榜）DeepSeek V4 发布引热议', Url: 'https://www.zhihu.com/question/mock-1', ThumbnailUrl: '', Summary: '关于模型能力与成本的讨论' },
    { Title: '（Mock 热榜）MoE 架构到底省不省算力', Url: 'https://www.zhihu.com/question/mock-2', ThumbnailUrl: '', Summary: '技术派与成本派的交锋' },
  ];
}

async function fetchHotList(): Promise<HotListItem[]> {
  if (config.mock) return mockHotList();
  if (!config.zhihu.accessSecret) {
    logger.warn('hot_list_no_secret');
    return [];
  }
  getMetrics().incr('api:hot_list');
  const data = await zhihuContentGet<HotListResponse>('/api/v1/content/hot_list', { Limit: '30' });
  if (data.Code !== 0) throw new Error(`hot_list business code ${data.Code}`);
  return data.Data?.Items ?? [];
}

/**
 * 知乎热榜 DataSource(方向重构后使用)。热榜是「当前站内热点背景」,不针对具体文本,
 * 所以 retrieve 忽略 input 内容,返回整榜原始条目(带 1 小时内存缓存)。
 * 命中 hotspot 方向源链时被引用;null 触发降级到全网搜索再降级到 llm。
 */
export function createHotListDataSource(): DataSource {
  return {
    id: 'zhihu_hot',
    enabled: config.features.hotList,
    async retrieve(_input: DirectionInput): Promise<RawMaterial | null> {
      // 缓存命中且未过期直接复用(见 06 文档「务必缓存至少 1 小时」,日额度仅 100)
      if (cached && Date.now() - cached.at < HOT_LIST_TTL_MS) {
        return { sourceId: 'zhihu_hot', data: cached.items };
      }
      try {
        const items = await fetchHotList();
        cached = { at: Date.now(), items };
        return { sourceId: 'zhihu_hot', data: items };
      } catch (err) {
        logger.warn('hot_list_failed', { err: String(err) });
        return null;
      }
    },
    timeoutMs: config.evidence.timeoutMs,
  };
}
