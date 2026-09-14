/**
 * dispatcher 集成测试。用 config.mock=true 强制走 MockProvider,零网络请求
 * (见 02 文档「MOCK=1 能离线跑完整流程」——这是抽象是否真的解耦的证明)。
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.MOCK = '1';

const tmpDataDir = await mkdtemp(path.join(tmpdir(), 'yw-dispatch-'));
process.env.YW_DATA_DIR = tmpDataDir;

const { dispatchExplain } = await import('../backend/dispatcher.js');
const { _clearAllSessions, getSession } = await import('../backend/core/session.js');
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

async function collectEvents(req: ExplainRequest, seq = 1): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  await dispatchExplain(req, { seq, onEvent: (e) => events.push(e) });
  return events;
}

describe('dispatchExplain (MOCK mode)', () => {
  before(() => {
    _clearAllSessions();
  });

  test('full flow emits start -> lead_end -> directions -> body_end -> done in order', async () => {
    const events = await collectEvents(baseRequest());

    const types = events.map((e) => e.t);
    assert.equal(types[0], 'start');
    assert.ok(types.includes('lead_end'));
    assert.ok(types.includes('directions'));
    assert.ok(types.includes('body_end'));
    assert.equal(types[types.length - 1], 'done');

    // lead 在 directions 之前完成是关键的体感要求(一句话先到)
    assert.ok(types.indexOf('lead_end') < types.indexOf('directions'));
  });

  test('directions event carries all four directions with hasMaterial summary', async () => {
    const events = await collectEvents(baseRequest());
    const dir = events.find((e) => e.t === 'directions');
    assert.ok(dir && dir.t === 'directions');
    if (dir && dir.t === 'directions') {
      const ids = dir.items.map((i) => i.id);
      assert.deepEqual(ids, ['term', 'hotspot', 'subtext', 'community']);
      assert.ok(dir.items.every((i) => typeof i.hasMaterial === 'boolean'));
    }
  });

  test('start event carries requestId and matches given seq', async () => {
    const events = await collectEvents(baseRequest(), 42);
    const start = events[0];
    assert.equal(start!.t, 'start');
    if (start!.t === 'start') {
      assert.equal(start.seq, 42);
      assert.ok(start.requestId.length > 0);
    }
  });

  test('done event carries a sessionId that can be used for reangle', async () => {
    const events = await collectEvents(baseRequest());
    const done = events[events.length - 1];
    assert.equal(done!.t, 'done');
    assert.ok(done!.t === 'done' && done.sessionId);
    if (done!.t === 'done' && done.sessionId) {
      const session = getSession(done.sessionId);
      assert.ok(session);
      assert.equal(session.feedback.length, 4);
    }
  });

  test('second identical request hits cache and marks cached:true', async () => {
    const req = baseRequest({ target: { text: '一段用于缓存命中测试的独特文本内容' } });
    const first = await collectEvents(req, 1);
    const firstDone = first[first.length - 1];
    assert.equal(firstDone!.t, 'done');
    assert.equal(firstDone!.t === 'done' && firstDone.cached, false);

    const second = await collectEvents(req, 2);
    const secondDone = second[second.length - 1];
    assert.equal(secondDone!.t, 'done');
    assert.equal(secondDone!.t === 'done' && secondDone.cached, true);

    const secondStart = second[0];
    assert.equal(secondStart!.t, 'start');
    assert.equal(secondStart!.t === 'start' && secondStart.seq, 2);
  });

  test('reangle only re-runs synthesize, keeps feedback from original session, skips lead', async () => {
    const req = baseRequest({ target: { text: '一段用于换个角度测试的独特文本内容' } });
    const first = await collectEvents(req, 1);
    const done = first[first.length - 1];
    assert.equal(done!.t, 'done');
    const sessionId = done!.t === 'done' ? done.sessionId : undefined;
    assert.ok(sessionId);

    const reangleEvents: StreamEvent[] = [];
    await dispatchExplain(req, {
      seq: 2,
      onEvent: (e) => reangleEvents.push(e),
      reuseSessionId: sessionId,
      reangleOnly: true,
    });

    const types = reangleEvents.map((e) => e.t);
    assert.ok(!types.includes('lead_delta')); // 换角度不重出一句话
    assert.ok(types.includes('directions'));
    assert.ok(types.includes('body_end'));
    const reangleDone = reangleEvents[reangleEvents.length - 1];
    assert.ok(reangleDone!.t === 'done' && reangleDone.sessionId === sessionId);
  });

  test('reangle with an unknown sessionId falls back to full normal flow, does not throw', async () => {
    const req = baseRequest({ target: { text: '一段用于会话过期回退测试的独特文本' } });
    const events: StreamEvent[] = [];
    await dispatchExplain(req, {
      seq: 1,
      onEvent: (e) => events.push(e),
      reuseSessionId: 'does-not-exist',
      reangleOnly: true,
    });
    const types = events.map((e) => e.t);
    assert.ok(types.includes('lead_end')); // 退化为完整流程,重新出一句话
    assert.ok(types.includes('directions'));
  });

  test('comment scope with parent produces valid session for later comment-reading gate', async () => {
    const req = baseRequest({
      scope: { kind: 'comment', id: 'comment-1', quoted: false, parent: { kind: 'answer', id: 'answer-9' } },
      target: { text: '这是一条独特的评论测试文本内容用来验证comment作用域' },
    });
    const events = await collectEvents(req);
    const done = events[events.length - 1];
    assert.equal(done!.t, 'done');
  });
});
