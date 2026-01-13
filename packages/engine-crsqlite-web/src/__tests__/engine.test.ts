/**
 * Unit tests for SQLite Engine
 * Tests §5.2 Engine interface implementation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SQLiteEngine } from '../engine/sqlite';

describe('SQLite Engine', () => {
  let engine: SQLiteEngine;

  beforeEach(() => {
    engine = new SQLiteEngine();
  });

  describe('§5.2 Engine Lifecycle', () => {
    it('should open engine with params', async () => {
      await engine.open({
        appId: 'test-app',
        identityPubKey: 'pubkey-123',
        spaceId: 'space-456',
        deviceId: 'device-789',
        dbPath: '/test/db.sqlite'
      });

      expect(engine).toBeDefined();
    });

    it('should close engine', async () => {
      await engine.open({
        appId: 'test-app',
        identityPubKey: 'pubkey-123',
        spaceId: 'space-456',
        deviceId: 'device-789',
        dbPath: '/test/db.sqlite'
      });

      await expect(engine.close()).resolves.not.toThrow();
    });

    it('should not re-initialize if already open', async () => {
      await engine.open({
        appId: 'test-app',
        identityPubKey: 'pubkey-123',
        spaceId: 'space-456',
        deviceId: 'device-789',
        dbPath: '/test/db.sqlite'
      });

      // Second open should be a no-op
      await expect(engine.open({
        appId: 'test-app',
        identityPubKey: 'pubkey-123',
        spaceId: 'space-456',
        deviceId: 'device-789',
        dbPath: '/test/db.sqlite'
      })).resolves.not.toThrow();
    });
  });

  describe('§5.2 SQL Operations', () => {
    beforeEach(async () => {
      await engine.open({
        appId: 'test-app',
        identityPubKey: 'pubkey-123',
        spaceId: 'space-456',
        deviceId: 'device-789',
        dbPath: '/test/db.sqlite'
      });
    });

    it('should execute CREATE TABLE', async () => {
      await expect(
        engine.run('CREATE TABLE test (id TEXT PRIMARY KEY, value TEXT)')
      ).resolves.not.toThrow();
    });

    it('should execute INSERT', async () => {
      await engine.run('CREATE TABLE test (id TEXT PRIMARY KEY, value TEXT)');
      await expect(
        engine.run('INSERT INTO test (id, value) VALUES (?, ?)', ['1', 'hello'])
      ).resolves.not.toThrow();
    });

    it('should execute SELECT query', async () => {
      await engine.run('CREATE TABLE test (id TEXT PRIMARY KEY, value TEXT)');
      await engine.run('INSERT INTO test (id, value) VALUES (?, ?)', ['1', 'hello']);

      const result = await engine.exec('SELECT * FROM test WHERE id = ?', ['1']);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({ id: '1', value: 'hello' });
    });

    it('should handle idempotent operations', async () => {
      await engine.run('CREATE TABLE test (id TEXT PRIMARY KEY)');
      
      // Second CREATE should not throw (idempotent)
      await expect(
        engine.run('CREATE TABLE IF NOT EXISTS test (id TEXT PRIMARY KEY)')
      ).resolves.not.toThrow();
    });
  });

  describe('§5.2 Transactions', () => {
    beforeEach(async () => {
      await engine.open({
        appId: 'test-app',
        identityPubKey: 'pubkey-123',
        spaceId: 'space-456',
        deviceId: 'device-789',
        dbPath: '/test/db.sqlite'
      });
      await engine.run('CREATE TABLE test (id TEXT PRIMARY KEY, value TEXT)');
    });

    it('should execute transaction successfully', async () => {
      const result = await engine.transaction(async () => {
        await engine.run('INSERT INTO test (id, value) VALUES (?, ?)', ['1', 'a']);
        await engine.run('INSERT INTO test (id, value) VALUES (?, ?)', ['2', 'b']);
        return 'success';
      });

      expect(result).toBe('success');

      const rows = await engine.exec('SELECT * FROM test');
      expect(rows.rows).toHaveLength(2);
    });

    it('should rollback on error', async () => {
      await expect(
        engine.transaction(async () => {
          await engine.run('INSERT INTO test (id, value) VALUES (?, ?)', ['1', 'a']);
          throw new Error('Rollback test');
        })
      ).rejects.toThrow('Rollback test');

      const rows = await engine.exec('SELECT * FROM test');
      expect(rows.rows).toHaveLength(0);
    });
  });

  describe('§5.3 Reactive Watch', () => {
    beforeEach(async () => {
      await engine.open({
        appId: 'test-app',
        identityPubKey: 'pubkey-123',
        spaceId: 'space-456',
        deviceId: 'device-789',
        dbPath: '/test/db.sqlite'
      });
      await engine.run('CREATE TABLE test (id TEXT PRIMARY KEY, value TEXT)');
    });

    it('should fire watch callback on initial data', async () => {
      await new Promise<void>((resolve) => {
        engine.watch('SELECT * FROM test', [], (rows) => {
          expect(Array.isArray(rows)).toBe(true);
          resolve();
        });
      });
    });

    it('should fire watch callback on data change', async () => {
      let callCount = 0;

      engine.watch('SELECT * FROM test', [], (rows) => {
        callCount++;
      });

      await engine.run('INSERT INTO test (id, value) VALUES (?, ?)', ['1', 'test']);

      // Wait a bit for callback
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(callCount).toBeGreaterThan(1); // Initial + after insert
    });

    it('should unsubscribe from watch', async () => {
      let callCount = 0;

      const unsubscribe = engine.watch('SELECT * FROM test', [], () => {
        callCount++;
      });

      unsubscribe();

      await engine.run('INSERT INTO test (id, value) VALUES (?, ?)', ['1', 'test']);
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(callCount).toBe(1); // Only initial call
    });
  });

  describe('§23 Built-in Tables', () => {
    beforeEach(async () => {
      await engine.open({
        appId: 'test-app',
        identityPubKey: 'pubkey-123',
        spaceId: 'space-456',
        deviceId: 'device-789',
        dbPath: '/test/db.sqlite'
      });
    });

    it('should create _ls_spaces table', async () => {
      const result = await engine.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='_ls_spaces'"
      );
      expect(result.rows).toHaveLength(1);
    });

    it('should create _ls_members table', async () => {
      const result = await engine.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='_ls_members'"
      );
      expect(result.rows).toHaveLength(1);
    });

    it('should create _ls_outbound_queue table', async () => {
      const result = await engine.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='_ls_outbound_queue'"
      );
      expect(result.rows).toHaveLength(1);
    });
  });

  describe('§5.2 Snapshot Operations', () => {
    beforeEach(async () => {
      await engine.open({
        appId: 'test-app',
        identityPubKey: 'pubkey-123',
        spaceId: 'space-456',
        deviceId: 'device-789',
        dbPath: '/test/db.sqlite'
      });
      await engine.run('CREATE TABLE test (id TEXT PRIMARY KEY, value TEXT)');
      await engine.run('INSERT INTO test (id, value) VALUES (?, ?)', ['1', 'data']);
    });

    it('should export snapshot', async () => {
      const snapshot = await engine.exportSnapshot('space-456');

      expect(snapshot).toBeInstanceOf(Uint8Array);
      expect(snapshot.length).toBeGreaterThan(0);
    });

    it('should import snapshot', async () => {
      const snapshot = await engine.exportSnapshot('space-456');
      
      // Close and create new engine
      await engine.close();
      const newEngine = new SQLiteEngine();
      await newEngine.open({
        appId: 'test-app',
        identityPubKey: 'pubkey-123',
        spaceId: 'space-456',
        deviceId: 'device-789',
        dbPath: '/test/db.sqlite'
      });

      await newEngine.importSnapshot('space-456', snapshot);

      const result = await newEngine.exec('SELECT * FROM test');
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({ id: '1', value: 'data' });
    });
  });
});
