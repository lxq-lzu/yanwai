/**
 * 评论区 DataSource(方向重构后使用)。是 community 方向源链的第二级(站内搜索之后)。
 *
 * 注:「读取本回答评论」的用户点击旁路(原 fetchAnswerComments + POST /api/v1/explain/:id/comments)
 * 已在「四按钮=控制生成」修正中删除——评论改为前端同源 DOM 抓取、作为 c 层资料随解析请求带后端。
 */

import type { DataSource, DirectionInput, RawMaterial } from '../../types.js';
import { config } from '../../config.js';
import { logger } from '../../core/logger.js';

interface ZhihuCommentItem {
  ID: string;
  Content: string;
  AuthorToken?: string;
  LikeCount?: number;
}

function mockComments(): ZhihuCommentItem[] {
  return [
    { ID: 'c1', Content: '（Mock 评论）确实是这个意思', LikeCount: 42 },
    { ID: 'c2', Content: '（Mock 评论）我倒觉得不完全是', LikeCount: 8 },
  ];
}

/**
 * 评论区 DataSource(方向重构后使用)。是 community 方向源链的第二级(站内搜索之后)。
 *
 * 语义:读取「当前回答」的评论区,回答 id 从 input.request.scope.id 取(仅 answer scope 有意义)。
 * 非 mock 模式下官方 API 无法跨账号读任意回答的评论(需前端同源抓取),这里返回 null
 * 触发降级到 llm——保留接口形状,等「用户主动点击→前端同源抓取→回传」的实现接入。
 */
export function createZhihuCommentDataSource(): DataSource {
  return {
    id: 'zhihu_comment',
    enabled: true,
    async retrieve(input: DirectionInput): Promise<RawMaterial | null> {
      const scope = input.request.scope;
      if (scope.kind !== 'answer') return null; // 评论只对 answer scope 有意义
      if (config.mock) return { sourceId: 'zhihu_comment', data: mockComments() };
      logger.warn('zhihu_comments_non_mock_not_implemented', { answerId: scope.id });
      return null;
    },
    timeoutMs: config.evidence.timeoutMs,
  };
}
