/**
 * 全网搜索资料源(DataSource)。见 http-api.md「全网搜索 API」+ 06 文档第二节。
 *
 * 与 zhihu_search 的区别:zhihu_search 只搜知乎站内,global_search 搜全网
 * (SearchDB=all,可带 host/publish_time Filter)。语义上更偏「热点事件的站外背景」,
 * 查询词用选中文本切片(旧链路用 route 抽实体,已随路由删除)。
 *
 * 日额度 5000,与 zhihu_search 同档,不需要像热榜那样强缓存;是 hotspot 方向源链的第二级(热榜之后)。
 */

import type { DataSource, DirectionInput, RawMaterial } from '../../types.js';
import { config } from '../../config.js';
import { logger } from '../../core/logger.js';
import { getMetrics } from '../../core/metrics.js';
import { zhihuContentGet } from '../zhihu/http.js';

interface GlobalSearchItem {
  Title: string;
  ContentText: string;
  Url: string;
  AuthorName: string;
  VoteUpCount: number;
  AuthorityLevel: string;
}

interface GlobalSearchResponse {
  Code: number;
  Data?: { HasMore: boolean; Items: GlobalSearchItem[] };
}

function mockGlobalSearch(query: string): GlobalSearchItem[] {
  return [
    {
      Title: `（Mock 全网）关于「${query}」的站外讨论`,
      ContentText: `（Mock）这是关于 ${query} 的全网搜索摘要，用于离线验证证据管道。`,
      Url: 'https://example.com/mock-global-1',
      AuthorName: 'Mock 站点作者',
      VoteUpCount: 120,
      AuthorityLevel: '2',
    },
  ];
}

/**
 * 全网搜索 DataSource(方向重构后使用)。搜全网(SearchDB=all),偏「热点事件的站外背景」,
 * 是 hotspot 方向源链的第二级(热榜之后)。返回原始 API JSON,null 触发降级到 llm。
 */
export function createGlobalSearchDataSource(): DataSource {
  return {
    id: 'zhihu_global',
    enabled: config.features.globalSearch,
    async retrieve(input: DirectionInput): Promise<RawMaterial | null> {
      const query = input.text.slice(0, 20);
      if (config.mock) return { sourceId: 'zhihu_global', data: mockGlobalSearch(query) };
      if (!config.zhihu.accessSecret) {
        logger.warn('global_search_no_secret');
        return null;
      }
      try {
        getMetrics().incr('api:global_search');
        const data = await zhihuContentGet<GlobalSearchResponse>('/api/v1/content/global_search', { Query: query, Count: '10' });
        if (data.Code !== 0) throw new Error(`global_search business code ${data.Code}`);
        return { sourceId: 'zhihu_global', data: data.Data?.Items ?? [] };
      } catch (err) {
        logger.warn('global_search_failed', { err: String(err) });
        return null;
      }
    },
    timeoutMs: config.evidence.timeoutMs,
  };
}
