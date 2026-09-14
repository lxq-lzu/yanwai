/**
 * 社区 API HMAC-SHA256 签名单测。见 07 文档第二节签名算法。
 * 纯函数、零网络,用固定输入断言确定性结果。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { signCommunity, buildCommunityHeaders } from '../backend/modules/community/sign.js';

test('signCommunity 与手算 HMAC-SHA256 base64 一致', () => {
  const appKey = 'my-user-token';
  const appSecret = 'my-secret';
  const ts = '1742822400';
  const logId = 'request_123';

  const expected = createHmac('sha256', appSecret)
    .update(`app_key:${appKey}|ts:${ts}|logid:${logId}|extra_info:`)
    .digest('base64');

  assert.equal(signCommunity(appKey, appSecret, ts, logId), expected);
});

test('signCommunity 对相同输入产出相同结果(确定性)', () => {
  const a = signCommunity('k', 's', '1', 'l');
  const b = signCommunity('k', 's', '1', 'l');
  assert.equal(a, b);
});

test('buildCommunityHeaders 包含缺一不可的 5 个头', () => {
  const headers = buildCommunityHeaders('k', 's');
  assert.equal(headers['X-App-Key'], 'k');
  assert.ok(/^\d+$/.test(headers['X-Timestamp']!)); // 秒级时间戳
  assert.ok(headers['X-Log-Id']!.startsWith('request_'));
  assert.ok(headers['X-Sign']!.length > 0);
  assert.ok('X-Extra-Info' in headers);
});
