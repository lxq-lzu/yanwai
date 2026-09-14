/**
 * JsonlStore 在 YW_STORAGE=memory 下的降级行为(见 B3)。
 * 必须在独立文件里跑:config.ts 的 storage.mode 是读一次环境变量的模块级常量,
 * 和 storage.test.ts(默认 jsonl 模式)混在同一个 tsx --test 进程里会互相污染。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.YW_STORAGE = 'memory';

const { JsonlStore } = await import('../backend/core/storage.js');
const { config } = await import('../backend/config.js');

describe('JsonlStore (YW_STORAGE=memory)', () => {
  test('config.storage.mode reflects YW_STORAGE=memory', () => {
    assert.equal(config.storage.mode, 'memory');
  });

  test('set/get/has/size work purely in-memory, no directory created on disk', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'yw-storage-mem-'));
    try {
      // 用一个尚不存在的子目录:jsonl 模式下 mkdir 会创建它,memory 模式下不该创建
      const neverCreatedDir = path.join(dir, 'should-not-exist');
      const store = new JsonlStore<{ v: number }>(neverCreatedDir, 'test.jsonl');
      await store.whenReady();

      store.set('a', { v: 1 });
      store.set('b', { v: 2 });
      assert.deepEqual(store.get('a'), { v: 1 });
      assert.deepEqual(store.get('b'), { v: 2 });
      assert.equal(store.has('a'), true);
      assert.equal(store.size(), 2);

      store.delete('a');
      assert.equal(store.has('a'), false);
      assert.equal(store.size(), 1);

      // 关键断言:目录从未被创建,证明没有任何磁盘写入(AiWorks 限「无数据库读写」)
      await assert.rejects(readdir(neverCreatedDir));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('sizeOnDisk reports 0 and compact() is a no-op', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'yw-storage-mem-'));
    try {
      const store = new JsonlStore<{ v: number }>(dir, 'test.jsonl');
      await store.whenReady();
      store.set('a', { v: 1 });
      assert.equal(await store.sizeOnDisk(), 0);
      await store.compact(); // 不应抛错,也不应创建文件
      assert.deepEqual(store.get('a'), { v: 1 }); // 内存索引不受影响
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('a fresh instance does not replay anything from a previous instance (no persistence)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'yw-storage-mem-'));
    try {
      const store1 = new JsonlStore<{ v: number }>(dir, 'test.jsonl');
      await store1.whenReady();
      store1.set('a', { v: 1 });

      const store2 = new JsonlStore<{ v: number }>(dir, 'test.jsonl');
      await store2.whenReady();
      // memory 模式下没有落盘,第二个实例看不到第一个实例写的东西
      assert.equal(store2.has('a'), false);
      assert.equal(store2.size(), 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
