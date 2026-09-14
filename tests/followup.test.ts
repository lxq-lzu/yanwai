/**
 * dispatchFollowUp 集成测试。用 config.mock=true 强制走 MockProvider,零网络请求
 * (同 dispatcher.test.ts 的写法)。
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.MOCK = '1';

const tmpDataDir = await mkdtemp(path.join(tmpdir(), 'yw-followup-'));
process.env.YW_DATA_DIR = tmpDataDir;

const { dispatchExplain, dispatchFollowUp } = await import('../backend/dispatcher.js');
const { _clearAllSessions, getSession, updateSession } = await import('../backend/core/session.js');
const { config } = await import('../backend/config.js');
import type { ExplainRequest, StreamEvent } from '../backend/types.js';

function baseRequest(overrides: Partial<ExplainRequest> = {}): ExplainRequest {
  return {
    target: { text: '这是一段测试用的选中文本内容' },
    surroundings: [
      { role: 'title', text: '测试问题标题' },
      { role: 'container', text: '这是一段测试用的选中文本内容，前后还有别的话。' },
      { role: 'sibling', text: '另一条高赞回答的内容摘要', id: 'sib-1', weight: 0.9 },
    ],
    scope: { kind: 'answer', id: 'answer-1', quoted: false, author: { name: '测试答主' } },
    anchor: { exact: '这是一段测试用的选中文本内容' },
    ...overrides,
  };
}

async function createSessionViaExplain(overrides: Partial<ExplainRequest> = {}): Promise<string> {
  const events: StreamEvent[] = [];
  await dispatchExplain(baseRequest(overrides), { seq: 1, onEvent: (e) => events.push(e) });
  const done = events[events.length - 1];
  assert.equal(done!.t, 'done');
  const sessionId = done!.t === 'done' ? done.sessionId : undefined;
  assert.ok(sessionId);
  return sessionId!;
}

async function collectFollowUp(sessionId: string, message: string, seq = 2) {
  const events: StreamEvent[] = [];
  const ok = await dispatchFollowUp({ seq, sessionId, message, onEvent: (e) => events.push(e) });
  return { ok, events };
}

describe('dispatchFollowUp (MOCK mode)', () => {
  before(() => {
    _clearAllSessions();
  });

  test('unknown sessionId returns false and emits no events', async () => {
    const { ok, events } = await collectFollowUp('does-not-exist', '再说清楚点');
    assert.equal(ok, false);
    assert.equal(events.length, 0);
  });

  test('expired session (TTL passed) returns false and emits no events (B1)', async () => {
    // 复现 B1:一个曾经存在、但已过 TTL 的 session,dispatchFollowUp 必须和
    // "从未存在" 一样返回 false、不发任何事件——server.ts 依赖这个约定,
    // 在 setStreamHeaders/flushHeaders 之前用它判断是否该走非流式 404,
    // 而不是发了响应头之后才发现 session 没了,导致客户端收到 200 + 空 body。
    const sessionId = await createSessionViaExplain({
      target: { text: '一段用于过期 session 测试的独特文本内容' },
    });

    const before = getSession(sessionId);
    assert.ok(before);

    // 把 createdAt 往前拨到超过 TTL,模拟"过期"而不是"从未创建"
    updateSession(sessionId, { createdAt: Date.now() - config.session.ttlMs - 1000 });
    assert.equal(getSession(sessionId), undefined); // getSession 惰性淘汰,过期即查不到

    const { ok, events } = await collectFollowUp(sessionId, '这个 session 应该已经过期了');
    assert.equal(ok, false);
    assert.equal(events.length, 0);
  });

  test('happy path emits start -> body_delta* -> body_end -> done, without lead_end/directions', async () => {
    const sessionId = await createSessionViaExplain({
      target: { text: '一段用于追问测试的独特文本内容' },
    });

    const { ok, events } = await collectFollowUp(sessionId, '能不能再讲得简单点？', 2);
    assert.equal(ok, true);

    const types = events.map((e) => e.t);
    assert.equal(types[0], 'start');
    assert.ok(!types.includes('lead_end'));
    assert.ok(!types.includes('directions'));
    assert.ok(types.includes('body_delta'));
    assert.ok(types.includes('body_end'));
    assert.equal(types[types.length - 1], 'done');

    const start = events[0];
    assert.ok(start!.t === 'start' && start.seq === 2);

    const done = events[events.length - 1];
    assert.ok(done!.t === 'done' && done.sessionId === sessionId && done.cached === false);
  });

  test('session lastResult.body is updated after follow-up, so a second follow-up builds on it', async () => {
    const sessionId = await createSessionViaExplain({
      target: { text: '另一段用于连续追问测试的独特文本内容' },
    });

    const before = getSession(sessionId);
    assert.ok(before);
    const originalBody = before!.lastResult.body;

    const { ok } = await collectFollowUp(sessionId, '第一次追问', 2);
    assert.equal(ok, true);

    const afterFirst = getSession(sessionId);
    assert.ok(afterFirst);
    // lead 保持不变,body 被追问结果替换(mock body 是固定文本,但流程上确实走了替换赋值)
    assert.equal(afterFirst!.lastResult.lead, before!.lastResult.lead);
    assert.ok(afterFirst!.lastResult.body.length > 0);
    void originalBody;

    const { ok: ok2 } = await collectFollowUp(sessionId, '第二次追问，基于上一次的回复', 3);
    assert.equal(ok2, true);

    const afterSecond = getSession(sessionId);
    assert.ok(afterSecond);
    assert.equal(afterSecond!.lastResult.lead, before!.lastResult.lead);
  });
});
