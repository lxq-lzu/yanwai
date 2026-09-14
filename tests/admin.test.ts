import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { applyFeaturePatch, maskSecretTail, writeMutableConfig, readMutableConfig } from '../backend/admin/index.js';
import { config } from '../backend/config.js';

describe('applyFeaturePatch (模块开关)', () => {
  beforeEach(() => {
    // 恢复到 env 默认值,避免不同用例之间互相污染
    config.features.zhihuSearch = true;
    config.features.hotList = true;
    config.features.globalSearch = true;
    config.features.zhida = true;
    config.features.community = false;
    config.features.oauth = true;
  });

  test('toggles a single known feature and reflects the new value', () => {
    const res = applyFeaturePatch({ community: true });
    assert.equal(res.ok, true);
    assert.equal(res.changed?.community, true);
    assert.equal(res.features?.community, true);
    assert.equal(config.features.community, true);
  });

  test('toggles multiple features in one patch', () => {
    const res = applyFeaturePatch({ zhida: false, oauth: false });
    assert.equal(res.ok, true);
    assert.equal(config.features.zhida, false);
    assert.equal(config.features.oauth, false);
    // 未涉及的开关保持原值
    assert.equal(config.features.zhihuSearch, true);
  });

  test('rejects an unknown feature key without mutating', () => {
    const before = { ...config.features };
    const res = applyFeaturePatch({ notAFeature: true });
    assert.equal(res.ok, false);
    assert.match(res.error ?? '', /未知开关/);
    assert.deepEqual(config.features, before);
  });

  test('rejects a non-boolean value without mutating', () => {
    const before = { ...config.features };
    const res = applyFeaturePatch({ zhida: 'yes' });
    assert.equal(res.ok, false);
    assert.match(res.error ?? '', /必须是 boolean/);
    assert.deepEqual(config.features, before);
  });

  test('rejects a non-object body', () => {
    assert.equal(applyFeaturePatch(null).ok, false);
    assert.equal(applyFeaturePatch([]).ok, false);
    assert.equal(applyFeaturePatch('str').ok, false);
  });
});

describe('maskSecretTail (密钥脱敏)', () => {
  test('only reveals the last 4 chars, never the plaintext', () => {
    assert.equal(maskSecretTail('sk-abcdef1234567890'), '****7890');
    assert.equal(maskSecretTail('abcd'), '****');
    assert.equal(maskSecretTail(''), '(未配置)');
  });

  test('never contains the full secret', () => {
    const secret = 'super-secret-value-12345';
    const masked = maskSecretTail(secret);
    assert.equal(masked.includes(secret), false);
    assert.equal(masked, '****2345');
  });
});

describe('writeMutableConfig (可变配置)', () => {
  test('updates a numeric field and reflects in readMutableConfig', () => {
    const original = config.cache.ttlStableMs;
    const res = writeMutableConfig('cache.ttlStableMs', original + 1000);
    assert.equal(res.ok, true);
    assert.equal(config.cache.ttlStableMs, original + 1000);
    assert.equal(readMutableConfig()['cache.ttlStableMs'], original + 1000);
    // 还原,避免污染其他用例
    config.cache.ttlStableMs = original;
  });

  test('updates the model name string field', () => {
    const original = config.deepseek.model;
    const res = writeMutableConfig('deepseek.model', 'deepseek-new');
    assert.equal(res.ok, true);
    assert.equal(config.deepseek.model, 'deepseek-new');
    config.deepseek.model = original;
  });

  test('rejects non-positive number for numeric fields', () => {
    const res = writeMutableConfig('cache.ttlStableMs', -1);
    assert.equal(res.ok, false);
    assert.match(res.error ?? '', /正数/);
  });

  test('rejects empty string for model name', () => {
    const res = writeMutableConfig('deepseek.model', '   ');
    assert.equal(res.ok, false);
    assert.match(res.error ?? '', /非空字符串/);
  });
});
