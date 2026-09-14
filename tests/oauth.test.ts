/**
 * OAuth 单测。零网络,验证 state CSRF 防护 + 授权 URL 构造。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  createOAuthState,
  consumeOAuthState,
  buildAuthorizeUrl,
} = await import('../backend/modules/oauth.js');

test('state 生成后只能被一次性消费(防 CSRF 重放)', () => {
  const state = createOAuthState();
  assert.ok(state.length >= 32);
  assert.equal(consumeOAuthState(state), true); // 首次校验通过并消费
  assert.equal(consumeOAuthState(state), false); // 再次使用被拒绝(原子消费)
});

test('未知 state 校验失败', () => {
  assert.equal(consumeOAuthState('does-not-exist'), false);
});

test('授权 URL 带 response_type=code 与 state', () => {
  const state = createOAuthState();
  const url = buildAuthorizeUrl(state);
  const parsed = new URL(url);
  assert.equal(parsed.pathname, '/authorize');
  assert.equal(parsed.searchParams.get('response_type'), 'code');
  assert.equal(parsed.searchParams.get('state'), state);
  assert.ok(parsed.searchParams.has('app_id'));
  assert.ok(parsed.searchParams.has('redirect_uri'));
});
