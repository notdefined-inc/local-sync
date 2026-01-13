/**
 * Unit tests for Node CR-SQLite Engine
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { SQLiteNodeEngine } from '../engine/sqlite';
import { createNodeStorageAdapter } from '../storage/node';

describe('Node CR-SQLite Engine', () => {
  let engine: SQLiteNodeEngine;
  let tmpDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'localsync-node-'));
    const storage = createNodeStorageAdapter({ baseDir: tmpDir });
    const appId = 'test-app';
    const identityPubKey = 'pubkey-123';
    const spaceId = 'space-456';
    const deviceId = 'device-789';

    dbPath = await storage.spaceDbPath(appId, identityPubKey, spaceId);
    engine = new SQLiteNodeEngine();

    await engine.open({
      appId,
      identityPubKey,
      spaceId,
      deviceId,
      dbPath,
      storage
    });
  });

  afterEach(async () => {
    await engine.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should execute basic SQL', async () => {
    await engine.run('CREATE TABLE test (id TEXT PRIMARY KEY, value TEXT)');
    await engine.run('INSERT INTO test (id, value) VALUES (?, ?)', ['1', 'hello']);

    const result = await engine.exec('SELECT * FROM test WHERE id = ?', ['1']);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ id: '1', value: 'hello' });
  });

  it('should export and import snapshots', async () => {
    await engine.run('CREATE TABLE snapshot_test (id TEXT PRIMARY KEY, value TEXT)');
    await engine.run('INSERT INTO snapshot_test (id, value) VALUES (?, ?)', ['1', 'data']);

    const snapshot = await engine.exportSnapshot('space-456');
    expect(snapshot).toBeInstanceOf(Uint8Array);
    expect(snapshot.length).toBeGreaterThan(0);

    await engine.close();
    const newEngine = new SQLiteNodeEngine();
    await newEngine.open({
      appId: 'test-app',
      identityPubKey: 'pubkey-123',
      spaceId: 'space-456',
      deviceId: 'device-789',
      dbPath,
      storage: createNodeStorageAdapter({ baseDir: tmpDir })
    });

    await newEngine.importSnapshot('space-456', snapshot);
    const result = await newEngine.exec('SELECT * FROM snapshot_test WHERE id = ?', ['1']);
    expect(result.rows).toHaveLength(1);

    await newEngine.close();
  });
});
