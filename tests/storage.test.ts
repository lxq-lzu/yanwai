import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JsonlStore } from '../backend/core/storage.js';

async function withTempDir(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'yw-storage-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('JsonlStore', () => {
  test('set/get round-trip and persists across instances (replay)', async () => {
    await withTempDir(async (dir) => {
      const store1 = new JsonlStore<{ v: number }>(dir, 'test.jsonl');
      await store1.whenReady();
      store1.set('a', { v: 1 });
      store1.set('b', { v: 2 });
      // 等写流 flush(node fs write 是异步的,但对同一文件描述符是顺序的,这里给一点时间)
      await new Promise((r) => setTimeout(r, 50));

      const store2 = new JsonlStore<{ v: number }>(dir, 'test.jsonl');
      await store2.whenReady();
      assert.deepEqual(store2.get('a'), { v: 1 });
      assert.deepEqual(store2.get('b'), { v: 2 });
      assert.equal(store2.size(), 2);
    });
  });

  test('later write for same key overrides earlier on replay', async () => {
    await withTempDir(async (dir) => {
      const store1 = new JsonlStore<{ v: number }>(dir, 'test.jsonl');
      await store1.whenReady();
      store1.set('a', { v: 1 });
      store1.set('a', { v: 2 });
      await new Promise((r) => setTimeout(r, 50));

      const store2 = new JsonlStore<{ v: number }>(dir, 'test.jsonl');
      await store2.whenReady();
      assert.deepEqual(store2.get('a'), { v: 2 });
      assert.equal(store2.size(), 1);
    });
  });

  test('delete is respected on replay', async () => {
    await withTempDir(async (dir) => {
      const store1 = new JsonlStore<{ v: number }>(dir, 'test.jsonl');
      await store1.whenReady();
      store1.set('a', { v: 1 });
      store1.delete('a');
      await new Promise((r) => setTimeout(r, 50));

      const store2 = new JsonlStore<{ v: number }>(dir, 'test.jsonl');
      await store2.whenReady();
      assert.equal(store2.has('a'), false);
      assert.equal(store2.size(), 0);
    });
  });

  test('replay ignores a corrupted trailing line instead of failing entirely', async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, 'test.jsonl');
      const { writeFile } = await import('node:fs/promises');
      const goodLine = JSON.stringify({ key: 'a', value: { v: 1 }, ts: Date.now() });
      // 模拟崩溃截断:最后一行是不完整 JSON
      await writeFile(filePath, `${goodLine}\n{"key":"b","value":{"v"`);

      const store = new JsonlStore<{ v: number }>(dir, 'test.jsonl');
      await store.whenReady();
      assert.deepEqual(store.get('a'), { v: 1 });
      assert.equal(store.has('b'), false);
      assert.equal(store.size(), 1);
    });
  });

  test('compact rewrites file keeping only latest per key', async () => {
    await withTempDir(async (dir) => {
      const store = new JsonlStore<{ v: number }>(dir, 'test.jsonl');
      await store.whenReady();
      store.set('a', { v: 1 });
      store.set('a', { v: 2 });
      store.set('b', { v: 3 });
      await new Promise((r) => setTimeout(r, 50));

      await store.compact();

      const store2 = new JsonlStore<{ v: number }>(dir, 'test.jsonl');
      await store2.whenReady();
      assert.deepEqual(store2.get('a'), { v: 2 });
      assert.deepEqual(store2.get('b'), { v: 3 });
      assert.equal(store2.size(), 2);
    });
  });

  test('clear empties index and persists an empty file across instances', async () => {
    await withTempDir(async (dir) => {
      const store = new JsonlStore<{ v: number }>(dir, 'test.jsonl');
      await store.whenReady();
      store.set('a', { v: 1 });
      store.set('b', { v: 2 });
      await new Promise((r) => setTimeout(r, 50));

      await store.clear();
      assert.equal(store.size(), 0);

      const store2 = new JsonlStore<{ v: number }>(dir, 'test.jsonl');
      await store2.whenReady();
      assert.equal(store2.size(), 0);
      assert.equal(store2.has('a'), false);
    });
  });
});
