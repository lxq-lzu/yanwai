/**
 * 资料源(DataSource)单测。MOCK=1 零网络,验证方向重构后的数据源
 * retrieve 返回原始 RawMaterial(带正确 sourceId)或 null 触发降级。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.MOCK = '1';

const { createHotListDataSource } = await import('../backend/modules/evidence/hot-list.js');
const { createGlobalSearchDataSource } = await import('../backend/modules/evidence/global-search.js');
const { createZhihuSearchDataSource } = await import('../backend/modules/evidence/zhihu-search.js');
const { createZhihuCommentDataSource } = await import('../backend/modules/evidence/zhihu-comments.js');
import type { DirectionInput, ExplainRequest } from '../backend/types.js';

function input(text: string, scopeKind: 'answer' | 'comment' | 'question' = 'answer'): DirectionInput {
  const scope: ExplainRequest['scope'] =
    scopeKind === 'comment'
      ? { kind: 'comment', id: 'c1', quoted: false, parent: { kind: 'answer', id: 'a1' } }
      : { kind: scopeKind, id: 'a1', quoted: false };
  const req: ExplainRequest = {
    target: { text },
    surroundings: [],
    scope,
    anchor: { exact: text },
  };
  return { text, request: req, budget: { remainingMs: 2500 } };
}

test('热榜 DataSource mock 返回 zhihu_hot 原始条目', async () => {
  const ds = createHotListDataSource();
  const material = await ds.retrieve(input('任意文本'));
  assert.ok(material);
  assert.equal(material!.sourceId, 'zhihu_hot');
  assert.ok(Array.isArray(material!.data) && (material!.data as unknown[]).length > 0);
});

test('全网搜索 DataSource mock 返回 zhihu_global 原始条目', async () => {
  const ds = createGlobalSearchDataSource();
  const material = await ds.retrieve(input('任意文本'));
  assert.ok(material);
  assert.equal(material!.sourceId, 'zhihu_global');
  assert.ok(Array.isArray(material!.data) && (material!.data as unknown[]).length > 0);
});

test('站内搜索 DataSource mock 返回 zhihu_search 原始条目', async () => {
  const ds = createZhihuSearchDataSource();
  const material = await ds.retrieve(input('任意文本'));
  assert.ok(material);
  assert.equal(material!.sourceId, 'zhihu_search');
  assert.ok(Array.isArray(material!.data) && (material!.data as unknown[]).length > 0);
});

test('评论区 DataSource 仅 answer 作用域返回料,非 answer 降级 null', async () => {
  const ds = createZhihuCommentDataSource();
  const material = await ds.retrieve(input('任意文本', 'answer'));
  assert.ok(material);
  assert.equal(material!.sourceId, 'zhihu_comment');
});

test('评论区 DataSource 非 answer 作用域返回 null 触发降级', async () => {
  const ds = createZhihuCommentDataSource();
  assert.equal(await ds.retrieve(input('任意文本', 'comment')), null);
});
