/**
 * End-to-End Integration Tests for Phase 2A
 * Verifies complete workflow: persistence, reactive queries, snapshots
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalSync, createMemoryStorageAdapter, defaultVaultProvider } from '../index';
import type { LocalSyncClient } from '../index';
import { createWebEngineProvider } from '@localsync/engine-crsqlite-web';

describe('Phase 2A: End-to-End Integration', () => {
  let client: LocalSyncClient;
  let pubkey: string;
  const testPassword = 'test-password-123';
  const testAppId = `test-e2e-${Date.now()}`;

  beforeEach(async () => {
    client = await LocalSync.open({
      appId: testAppId,
      storage: createMemoryStorageAdapter(),
      vault: defaultVaultProvider,
      engine: createWebEngineProvider()
    });
    pubkey = await client.createIdentity(testPassword);
  });

  afterEach(async () => {
    if (client) {
      await client.logout();
    }
  });

  describe('Complete Workflow', () => {
    it('should handle full CRUD workflow with persistence', async () => {
      // 1. Login
      const session = await client.login(pubkey, testPassword);
      expect(session).toBeDefined();

      // 2. Create personal space
      const space = await session.spaces.createPersonal();
      expect(space).toBeDefined();

      // 3. Create schema
      await space.exec(`
        CREATE TABLE tasks (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          completed INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL
        )
      `);

      // 4. Insert data
      const taskId = crypto.randomUUID();
      await space.run(
        'INSERT INTO tasks (id, title, completed, created_at) VALUES (?, ?, ?, ?)',
        [taskId, 'Test Task', 0, Date.now()]
      );

      // 5. Query data
      const result = await space.exec('SELECT * FROM tasks WHERE id = ?', [taskId]);
      expect(result.rows).toHaveLength(1);
      expect((result.rows[0] as any).title).toBe('Test Task');

      // 6. Update data
      await space.run('UPDATE tasks SET completed = 1 WHERE id = ?', [taskId]);

      const updated = await space.exec('SELECT completed FROM tasks WHERE id = ?', [taskId]);
      expect((updated.rows[0] as any).completed).toBe(1);

      // 7. Delete data
      await space.run('DELETE FROM tasks WHERE id = ?', [taskId]);

      const deleted = await space.exec('SELECT * FROM tasks WHERE id = ?', [taskId]);
      expect(deleted.rows).toHaveLength(0);
    });

    it('should support reactive watch queries', async () => {
      const session = await client.login(pubkey, testPassword);
      const space = await session.spaces.createPersonal();

      await space.exec(`
        CREATE TABLE counters (
          id TEXT PRIMARY KEY,
          value INTEGER NOT NULL
        )
      `);

      const updates: any[][] = [];
      let callCount = 0;

      // Set up watch
      const unsubscribe = space.watch('SELECT * FROM counters ORDER BY id', [], (rows) => {
        callCount++;
        updates.push([...rows]);
      });

      // Wait for initial call
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(callCount).toBeGreaterThanOrEqual(1);
      expect(updates[0]).toHaveLength(0);

      // Insert first row
      await space.run('INSERT INTO counters VALUES (?, ?)', ['c1', 10]);
      await new Promise(resolve => setTimeout(resolve, 10));

      // Insert second row
      await space.run('INSERT INTO counters VALUES (?, ?)', ['c2', 20]);
      await new Promise(resolve => setTimeout(resolve, 10));

      // Update row
      await space.run('UPDATE counters SET value = 15 WHERE id = ?', ['c1']);
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(callCount).toBeGreaterThanOrEqual(4); // Initial + 3 changes
      expect(updates[updates.length - 1]).toHaveLength(2);
      
      unsubscribe();
    });

    it('should export and import snapshots', async () => {
      const session = await client.login(pubkey, testPassword);
      const space = await session.spaces.createPersonal();

      // Create data
      await space.exec(`
        CREATE TABLE notes (
          id TEXT PRIMARY KEY,
          content TEXT NOT NULL
        )
      `);

      await space.run('INSERT INTO notes VALUES (?, ?)', ['n1', 'First note']);
      await space.run('INSERT INTO notes VALUES (?, ?)', ['n2', 'Second note']);

      // Export snapshot
      const snapshot = await space.sync.exportSnapshot();
      expect(snapshot).toBeInstanceOf(Uint8Array);
      expect(snapshot.length).toBeGreaterThan(0);

      // Create new space and import
      const space2 = await session.spaces.createPersonal();
      await space2.sync.importSnapshot(snapshot);

      // Verify data
      const result = await space2.exec('SELECT * FROM notes ORDER BY id');
      expect(result.rows).toHaveLength(2);
      expect((result.rows[0] as any).content).toBe('First note');
      expect((result.rows[1] as any).content).toBe('Second note');
    });

    it('should handle transactions correctly', async () => {
      const session = await client.login(pubkey, testPassword);
      const space = await session.spaces.createPersonal();

      await space.exec(`
        CREATE TABLE accounts (
          id TEXT PRIMARY KEY,
          balance INTEGER NOT NULL
        )
      `);

      await space.run('INSERT INTO accounts VALUES (?, ?)', ['acc1', 100]);
      await space.run('INSERT INTO accounts VALUES (?, ?)', ['acc2', 50]);

      // Successful transaction
      const result1 = await (space as any).engine.transaction(async () => {
        await space.run('UPDATE accounts SET balance = balance - 30 WHERE id = ?', ['acc1']);
        await space.run('UPDATE accounts SET balance = balance + 30 WHERE id = ?', ['acc2']);
        return 'success';
      });

      expect(result1).toBe('success');

      const balances1 = await space.exec('SELECT * FROM accounts ORDER BY id');
      expect((balances1.rows[0] as any).balance).toBe(70);
      expect((balances1.rows[1] as any).balance).toBe(80);

      // Failed transaction (should rollback)
      try {
        await (space as any).engine.transaction(async () => {
          await space.run('UPDATE accounts SET balance = balance - 50 WHERE id = ?', ['acc1']);
          throw new Error('Transaction failed');
        });
      } catch (error) {
        // Expected
      }

      const balances2 = await space.exec('SELECT * FROM accounts ORDER BY id');
      expect((balances2.rows[0] as any).balance).toBe(70); // Unchanged
    });

    it('should track checkpoints and changes', async () => {
      const session = await client.login(pubkey, testPassword);
      const space = await session.spaces.createPersonal();

      await space.exec(`
        CREATE TABLE events (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL
        )
      `);

      // Get initial checkpoint
      const checkpoint1 = await (space as any).engine.getCheckpoint('test-space');
      expect(checkpoint1.vv).toBeDefined();

      // Make changes
      await space.run('INSERT INTO events VALUES (?, ?)', ['e1', 'Event 1']);
      await space.run('INSERT INTO events VALUES (?, ?)', ['e2', 'Event 2']);

      // Get new checkpoint
      const checkpoint2 = await (space as any).engine.getCheckpoint('test-space');
      
      // Checkpoint should have advanced
      const replicaIds = Object.keys(checkpoint2.vv);
      expect(replicaIds.length).toBeGreaterThan(0);

      // Get changes since first checkpoint
      const changes = await (space as any).engine.getChanges('test-space', checkpoint1);
      expect(changes).toBeDefined();
      expect(changes.batchId).toBeTruthy();
    });

    it('should handle multiple tables and complex queries', async () => {
      const session = await client.login(pubkey, testPassword);
      const space = await session.spaces.createPersonal();

      // Create multiple related tables
      await space.exec(`
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL
        )
      `);

      await space.exec(`
        CREATE TABLE posts (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          title TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `);

      // Insert data
      await space.run('INSERT INTO users VALUES (?, ?)', ['u1', 'Alice']);
      await space.run('INSERT INTO users VALUES (?, ?)', ['u2', 'Bob']);
      
      await space.run('INSERT INTO posts VALUES (?, ?, ?)', ['p1', 'u1', 'Alice Post 1']);
      await space.run('INSERT INTO posts VALUES (?, ?, ?)', ['p2', 'u1', 'Alice Post 2']);
      await space.run('INSERT INTO posts VALUES (?, ?, ?)', ['p3', 'u2', 'Bob Post 1']);

      // Complex JOIN query
      const result = await space.exec(`
        SELECT u.name, COUNT(p.id) as post_count
        FROM users u
        LEFT JOIN posts p ON u.id = p.user_id
        GROUP BY u.id, u.name
        ORDER BY u.name
      `);

      expect(result.rows).toHaveLength(2);
      expect((result.rows[0] as any).name).toBe('Alice');
      expect((result.rows[0] as any).post_count).toBe(2);
      expect((result.rows[1] as any).name).toBe('Bob');
      expect((result.rows[1] as any).post_count).toBe(1);
    });

    it('should verify built-in tables exist', async () => {
      const session = await client.login(pubkey, testPassword);
      const space = await session.spaces.createPersonal();

      const tables = [
        '_ls_spaces',
        '_ls_members',
        '_ls_keys',
        '_ls_migrations',
        '_ls_blobs',
        '_ls_outbound_queue',
        '_ls_conflicts'
      ];

      for (const table of tables) {
        const result = await space.exec(
          `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
          [table]
        );
        expect(result.rows).toHaveLength(1);
      }
    });

    it('should handle watch with options', async () => {
      const session = await client.login(pubkey, testPassword);
      const space = await session.spaces.createPersonal();

      await space.exec(`
        CREATE TABLE items (
          id INTEGER PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);

      // Insert test data BEFORE setting up watch
      for (let i = 1; i <= 10; i++) {
        await space.run('INSERT INTO items VALUES (?, ?)', [i, `Item ${i}`]);
      }

      // Test limit option - watch should fire immediately with limited results
      let callCount = 0;
      let receivedRows: any[] = [];
      
      const unsubscribe = space.watch('SELECT * FROM items', [], (rows) => {
        callCount++;
        receivedRows = rows;
      }, { limit: 5 });

      // Wait for initial watch to fire
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Should have been called once (initial fire only, no data changes after watch setup)
      expect(callCount).toBe(1);
      // Limit should restrict results to 5 rows
      expect(receivedRows.length).toBe(5);
      
      unsubscribe();
    });

    it('should handle concurrent writes', async () => {
      const session = await client.login(pubkey, testPassword);
      const space = await session.spaces.createPersonal();

      await space.exec(`
        CREATE TABLE logs (
          id TEXT PRIMARY KEY,
          message TEXT NOT NULL
        )
      `);

      // Concurrent inserts
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          space.run('INSERT INTO logs VALUES (?, ?)', [
            `log-${i}`,
            `Message ${i}`
          ])
        );
      }

      await Promise.all(promises);

      const result = await space.exec('SELECT COUNT(*) as count FROM logs');
      expect((result.rows[0] as any).count).toBe(10);
    });

    it('should handle empty result sets', async () => {
      const session = await client.login(pubkey, testPassword);
      const space = await session.spaces.createPersonal();

      await space.exec(`
        CREATE TABLE empty_table (
          id TEXT PRIMARY KEY
        )
      `);

      const result = await space.exec('SELECT * FROM empty_table');
      expect(result.rows).toHaveLength(0);
      expect(Array.isArray(result.rows)).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle SQL syntax errors', async () => {
      const session = await client.login(pubkey, testPassword);
      const space = await session.spaces.createPersonal();

      await expect(
        space.exec('INVALID SQL SYNTAX')
      ).rejects.toThrow();
    });

    it('should handle constraint violations', async () => {
      const session = await client.login(pubkey, testPassword);
      const space = await session.spaces.createPersonal();

      await space.exec(`
        CREATE TABLE unique_items (
          id TEXT PRIMARY KEY,
          value TEXT UNIQUE NOT NULL
        )
      `);

      await space.run('INSERT INTO unique_items VALUES (?, ?)', ['1', 'unique']);

      await expect(
        space.run('INSERT INTO unique_items VALUES (?, ?)', ['2', 'unique'])
      ).rejects.toThrow();
    });

    it('should handle missing tables', async () => {
      const session = await client.login(pubkey, testPassword);
      const space = await session.spaces.createPersonal();

      await expect(
        space.exec('SELECT * FROM nonexistent_table')
      ).rejects.toThrow();
    });
  });

  describe('Performance', () => {
    it('should handle bulk inserts efficiently', async () => {
      const session = await client.login(pubkey, testPassword);
      const space = await session.spaces.createPersonal();

      await space.exec(`
        CREATE TABLE bulk_data (
          id INTEGER PRIMARY KEY,
          data TEXT NOT NULL
        )
      `);

      const startTime = Date.now();
      
      // Insert 100 rows
      for (let i = 0; i < 100; i++) {
        await space.run('INSERT INTO bulk_data VALUES (?, ?)', [i, `Data ${i}`]);
      }

      const duration = Date.now() - startTime;
      
      // Should complete in reasonable time (< 1 second)
      expect(duration).toBeLessThan(1000);

      const result = await space.exec('SELECT COUNT(*) as count FROM bulk_data');
      expect((result.rows[0] as any).count).toBe(100);
    });
  });
});
