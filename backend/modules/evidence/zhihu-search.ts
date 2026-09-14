/**
 * zhihu_search 资料源(DataSource)。见 02 文档第三节:
 * "查询词必须用实体,不用原始选中文本——长句搜出来是噪声,实体才有专门讨论。"
 *
 * 额度保护:
 * - 日预算收紧到 3500(见 config.searchQuota),留 1500 给评审窗口
 * - 通过 SearchQuotaTracker 判断是否还有预算,没有就返回 null 触发降级
 * - MOCK=1 时不发真实请求,返回固定假数据
 */

import type { DataSource, DirectionInput, RawMaterial } from '../../types.js';
import { config } from '../../config.js';
import { getSearchQuotaTracker } from '../../core/quota.js';
import { logger } from '../../core/logger.js';
import { getMetrics } from '../../core/metrics.js';

interface ZhihuSearchItem {
  Title: string;
  ContentText: string;
  Url: string;
  AuthorName: string;
  VoteUpCount: number;
  AuthorityLevel: string;
  RankingScore?: number;
  CommentInfoList?: Array<{ Content: string }>;
}

async function callZhihuSearchApi(query: string, accessSecret: string): Promise<ZhihuSearchItem[]> {
  const url = new URL('https://developer.zhihu.com/api/v1/content/zhihu_search');
  url.searchParams.set('Query', query);
  url.searchParams.set('Count', '10');

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessSecret}`,
      'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`zhihu_search http ${res.status}`);
  const data = (await res.json()) as { Code: number; Data?: { Items: ZhihuSearchItem[] } };
  if (data.Code !== 0) throw new Error(`zhihu_search business code ${data.Code}`);
  return data.Data?.Items ?? [];
}

function mockSearchResults(query: string): ZhihuSearchItem[] {
  return [
    {
      Title: `关于「${query}」的讨论`,
      ContentText: `（Mock）这是一条关于 ${query} 的高赞回答摘要，用于离线开发验证证据管道。`,
      Url: 'https://www.zhihu.com/answer/mock-1',
      AuthorName: 'Mock 答主',
      VoteUpCount: 880,
      AuthorityLevel: '2',
      RankingScore: 0.95,
      CommentInfoList: [{ Content: '（Mock 评论）说得对' }],
    },
  ];
}

/**
 * 站内搜索 DataSource(方向重构后使用)。返回原始 API JSON(RawMaterial.data),
 * 浓缩成 FeedbackPoint 交给方向层(D4)的 distill。null 触发降级到下一个源。
 *
 * 与旧 Provider 的差别:不按 route 判断调不调,而是挂在某方向的源链里被引用;
 * 查询词直接用选中文本(旧链路用 route.entities,已随路由删除而消失,D4 浓缩器可再提炼关键词)。
 */
export function createZhihuSearchDataSource(): DataSource {
  return {
    id: 'zhihu_search',
    enabled: config.features.zhihuSearch,
    async retrieve(input: DirectionInput): Promise<RawMaterial | null> {
      const query = input.text.slice(0, 20);
      if (config.mock) return { sourceId: 'zhihu_search', data: mockSearchResults(query) };
      // 额度保护:没有预算就返回 null,让方向降级到 llm(见 config.searchQuota)
      if (!getSearchQuotaTracker().hasBudget()) return null;
      if (!config.zhihu.accessSecret) {
        logger.warn('zhihu_search_no_secret');
        return null;
      }
      try {
        getMetrics().incr('api:zhihu_search');
        const items = await callZhihuSearchApi(query, config.zhihu.accessSecret);
        getSearchQuotaTracker().consume(1);
        return { sourceId: 'zhihu_search', data: items };
      } catch (err) {
        logger.warn('zhihu_search_failed', { err: String(err) });
        return null;
      }
    },
    timeoutMs: config.evidence.timeoutMs,
  };
}
