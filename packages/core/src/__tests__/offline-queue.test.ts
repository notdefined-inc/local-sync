/**
 * Offline queue tests
 * Tests §9.8 Offline Queue behavior
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryStorageAdapter, createOfflineQueue } from '../index';
import { createWebEngineProvider } from '@localsync/engine-crsqlite-web';
import type { Engine, LocalChange } from '../types';

describe('Offline Queue', () => {
  let engine: Engine;

  beforeEach(async () => {
    const storage = createMemoryStorageAdapter();
    const appId = 'test-app';
    const identityPubKey = 'pubkey-test';
    const spaceId = 'space-test';
    const deviceId = 'device-test';
    const dbPath = await storage.spaceDbPath(appId, identityPubKey, spaceId);

    engine = createWebEngineProvider().createEngine({
      appId,
      identityPubKey,
      spaceId,
      deviceId,
      dbPath,
      storage
    });
    await engine.open({
      appId,
      identityPubKey,
      spaceId,
      deviceId,
      dbPath,
      storage
    });
  });

  it('should enqueue and peek queued changes', async () => {
    const queue = createOfflineQueue(engine, { warnBytes: Number.POSITIVE_INFINITY });
    const change: LocalChange = {
      replicaId: 'replica-1',
      counter: 1,
      spaceId: 'space-test',
      tableName: 'notes',
      operation: 'insert',
      rowJson: JSON.stringify({ id: 'note-1', title: 'Hello' }),
      createdAt: Date.now()
    };

    await queue.enqueue(change);
    const pending = await queue.peek();

    expect(pending).toHaveLength(1);
    expect(pending[0].replicaId).toBe(change.replicaId);
    expect(pending[0].tableName).toBe(change.tableName);
  });

  it('should mark sent and acked items', async () => {
    const queue = createOfflineQueue(engine, { warnBytes: Number.POSITIVE_INFINITY });
    const change: LocalChange = {
      replicaId: 'replica-2',
      counter: 2,
      spaceId: 'space-test',
      tableName: 'notes',
      operation: 'update',
      rowJson: JSON.stringify({ id: 'note-2', title: 'Updated' }),
      createdAt: Date.now()
    };

    await queue.enqueue(change);
    let pending = await queue.peek();
    await queue.markSent([pending[0].id]);

    pending = await queue.peek();
    expect(pending[0].sentAt).toBeDefined();

    await queue.markAcked([pending[0].id]);
    const remaining = await queue.peek();
    expect(remaining).toHaveLength(0);
  });

  it('should prune acked entries older than cutoff', async () => {
    const queue = createOfflineQueue(engine, { warnBytes: Number.POSITIVE_INFINITY, pruneAfterMs: 0 });
    const change: LocalChange = {
      replicaId: 'replica-3',
      counter: 3,
      spaceId: 'space-test',
      tableName: 'notes',
      operation: 'delete',
      rowJson: JSON.stringify({ id: 'note-3' }),
      createdAt: Date.now()
    };

    await queue.enqueue(change);
    const pending = await queue.peek();
    await queue.markAcked([pending[0].id]);

    const pruned = await queue.prune();
    expect(pruned).toBe(1);
  });
});
