import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getMetrics, _resetMetrics } from '../backend/core/metrics.js';

describe('Metrics', () => {
  beforeEach(() => {
    _resetMetrics();
  });

  test('incr accumulates per label and starts at zero for unknown labels', () => {
    const m = getMetrics();
    assert.equal(m.get('explain'), 0);

    m.incr('explain');
    m.incr('explain');
    m.incr('followup');
    assert.equal(m.get('explain'), 2);
    assert.equal(m.get('followup'), 1);
  });

  test('incr with n adds n to the label', () => {
    const m = getMetrics();
    m.incr('api:zhihu_search', 5);
    assert.equal(m.get('api:zhihu_search'), 5);
  });

  test('cache hit rate is null when no cache reads, then correct ratio', () => {
    const m = getMetrics();
    const empty = m.snapshot();
    assert.equal(empty.cache.hits, 0);
    assert.equal(empty.cache.hitRate, null);

    m.recordCacheMiss();
    m.recordCacheMiss();
    m.recordCacheHit();
    const snap = m.snapshot();
    assert.equal(snap.cache.hits, 1);
    assert.equal(snap.cache.misses, 2);
    assert.equal(snap.cache.hitRate, 1 / 3);
  });

  test('rateLimited counter is exposed in snapshot', () => {
    const m = getMetrics();
    m.recordRateLimit();
    m.recordRateLimit();
    assert.equal(m.snapshot().rateLimited, 2);
  });

  test('snapshot returns counters map and a startedAt timestamp', () => {
    const m = getMetrics();
    m.incr('explain');
    const snap = m.snapshot();
    assert.equal(snap.counters['explain'], 1);
    assert.ok(typeof snap.startedAt === 'number' && snap.startedAt > 0);
  });

  test('reset clears all counters and cache/ratelimit tallies', () => {
    const m = getMetrics();
    m.incr('explain');
    m.recordCacheHit();
    m.recordRateLimit();
    m.reset();
    assert.equal(m.get('explain'), 0);
    const snap = m.snapshot();
    assert.equal(snap.cache.hits, 0);
    assert.equal(snap.rateLimited, 0);
  });

  test('recordError keeps newest-first list with type and timestamp', () => {
    const m = getMetrics();
    m.recordError('explain_dispatch_failed', 'boom');
    m.recordError('oauth_callback_failed', 'bad code');
    const errs = m.recentErrors();
    assert.equal(errs.length, 2);
    // 新的在前
    assert.equal(errs[0].type, 'oauth_callback_failed');
    assert.equal(errs[1].type, 'explain_dispatch_failed');
    assert.equal(errs[1].message, 'boom');
    assert.ok(typeof errs[0].timestamp === 'number' && errs[0].timestamp > 0);
  });

  test('recordError caps the ring buffer at 50 entries', () => {
    const m = getMetrics();
    for (let i = 0; i < 60; i++) m.recordError('t' + i, 'm' + i);
    const errs = m.recentErrors();
    assert.equal(errs.length, 50);
    // 最老的前 10 条被挤出,最新的是 t59
    assert.equal(errs[0].type, 't59');
    assert.equal(errs[49].type, 't10');
  });

  test('reset clears recorded errors too', () => {
    const m = getMetrics();
    m.recordError('x', 'y');
    m.reset();
    assert.equal(m.recentErrors().length, 0);
  });
});
