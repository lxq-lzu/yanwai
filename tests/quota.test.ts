import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SearchQuotaTracker } from '../backend/core/quota.js';

describe('SearchQuotaTracker', () => {
  test('calibrate clamps to min(official remaining, internal budget)', async () => {
    const tracker = new SearchQuotaTracker(async () => 4800); // 官方剩 4800,大于内部预算 3500
    await tracker.calibrate();
    assert.equal(tracker.getRemaining(), 3500);
  });

  test('calibrate uses official remaining when it is below internal budget', async () => {
    const tracker = new SearchQuotaTracker(async () => 100);
    await tracker.calibrate();
    assert.equal(tracker.getRemaining(), 100);
  });

  test('calibrate failure (fetcher returns null) leaves previous remaining untouched', async () => {
    const tracker = new SearchQuotaTracker(async () => null, 999);
    await tracker.calibrate();
    assert.equal(tracker.getRemaining(), 999);
  });

  test('consume decrements and never goes below zero', async () => {
    const tracker = new SearchQuotaTracker(async () => 2);
    await tracker.calibrate();
    tracker.consume(1);
    assert.equal(tracker.getRemaining(), 1);
    tracker.consume(5);
    assert.equal(tracker.getRemaining(), 0);
    assert.equal(tracker.hasBudget(), false);
  });

  test('hasBudget reflects remaining > 0', async () => {
    const tracker = new SearchQuotaTracker(async () => 1);
    await tracker.calibrate();
    assert.equal(tracker.hasBudget(), true);
    tracker.consume(1);
    assert.equal(tracker.hasBudget(), false);
  });

  test('needsRecalibration is true before first calibration ever ran', () => {
    const tracker = new SearchQuotaTracker(async () => 100);
    assert.equal(tracker.needsRecalibration(), true);
  });

  test('needsRecalibration is false immediately after a successful calibration', async () => {
    const tracker = new SearchQuotaTracker(async () => 100);
    await tracker.calibrate();
    assert.equal(tracker.needsRecalibration(), false);
  });
});
