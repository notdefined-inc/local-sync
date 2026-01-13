/**
 * CR-SQLite Engine Implementation (Node/Electron)
 * Uses better-sqlite3 + CR-SQLite loadable extension.
 */

import Database from 'better-sqlite3';
import { extensionPath as defaultExtensionPath } from '@vlcn.io/crsqlite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TextDecoder, TextEncoder } from 'node:util';
import type {
  ApplyResult,
  ChangesBatch,
  Checkpoint,
  CompactPolicy,
  CompactResult,
  Engine,
  EngineOpenParams,
  QueryResult,
  StorageAdapter,
  Unsubscribe,
  WatchOptions
} from '@localsync/core';
import { StorageError } from '@localsync/core';
import { debounce, generateReplicaId, mergeCheckpoints } from '@localsync/core/utils';

export type NodeCRSQLiteEngineOptions = {
  extensionPath?: string;
};

type BetterSqlite3Database = InstanceType<typeof Database>;

type CrSqlChangeRow = {
  table: string;
  pk: Uint8Array;
  cid: string;
  val: unknown;
  colVersion: number;
  dbVersion: number;
  siteId: Uint8Array;
  cl: number;
  seq: number;
};

const textDecoder = new TextDecoder();

function normalizeNumber(value: unknown): number {
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function estimateBytes(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}

function coerceBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }
  if (Array.isArray(value)) {
    return new Uint8Array(value);
  }
  if (value == null) {
    return new Uint8Array();
  }
  return new TextEncoder().encode(String(value));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function decodeSiteId(bytes: Uint8Array): string {
  const text = textDecoder.decode(bytes);
  if (/^[A-Za-z0-9_-]+$/.test(text)) {
    return text;
  }
  return toHex(bytes);
}

function generateBatchId(): string {
  const cryptoRef = (globalThis as any)?.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoRef?.randomUUID) {
    return cryptoRef.randomUUID();
  }
  return `batch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function isTestEnvironment(): boolean {
  const proc = (globalThis as any)?.process;
  return Boolean(proc?.env?.VITEST || proc?.env?.NODE_ENV === 'test');
}

export class SQLiteNodeEngine implements Engine {
  private db: BetterSqlite3Database | null = null;
  private isInitialized = false;
  private listeners: Set<() => void> = new Set();
  private watchCallbacks: Map<string, Set<{ cb: (rows: unknown[]) => void; options?: WatchOptions }>> = new Map();

  private replicaId: string | null = null;
  private localSiteIdBytes: Uint8Array | null = null;
  private currentCheckpoint: Checkpoint = { vv: {} };
  private crsqliteEnabled = true;

  private dbPath: string | null = null;
  private storage: StorageAdapter | null = null;
  private appId = '';
  private identityPubKey = '';
  private spaceId = '';
  private deviceId = '';
  private openParams: EngineOpenParams | null = null;

  constructor(private options: NodeCRSQLiteEngineOptions = {}) {}

  async open(params: EngineOpenParams): Promise<void> {
    if (this.db) {
      return;
    }

    try {
      this.openParams = params;
      this.dbPath = params.dbPath;
      this.storage = params.storage ?? null;
      this.appId = params.appId;
      this.identityPubKey = params.identityPubKey;
      this.spaceId = params.spaceId;
      this.deviceId = params.deviceId;

      if (!this.dbPath) {
        throw new StorageError('ENGINE_INIT_FAILED', 'Missing dbPath', false);
      }

      await fs.mkdir(path.dirname(this.dbPath), { recursive: true });

      const db = new Database(this.dbPath);
      this.db = db;

      this.initializeSiteId();

      const extensionPath = this.options.extensionPath ?? defaultExtensionPath;
      try {
        db.loadExtension(extensionPath);
        this.crsqliteEnabled = true;
      } catch (error) {
        this.crsqliteEnabled = false;
        if (!isTestEnvironment()) {
          throw error;
        }
        console.warn('[Engine] CR-SQLite extension not available, running in sqlite-only mode.');
      }

      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');

      this.isInitialized = true;

      await this.initializeBuiltInTables();
      this.replicaId = this.replicaId ?? generateReplicaId(this.deviceId, this.identityPubKey, this.spaceId);
      this.currentCheckpoint = await this.getCheckpoint(this.spaceId);
    } catch (error) {
      await this.close();
      const message =
        error instanceof Error ? `Failed to initialize Node CR-SQLite engine: ${error.message}` : 'Failed to initialize Node CR-SQLite engine';
      throw new StorageError(
        'ENGINE_INIT_FAILED',
        message,
        false,
        { error }
      );
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.isInitialized = false;
    this.listeners.clear();
    this.watchCallbacks.clear();
  }

  async exec(sql: string, params: unknown[] = []): Promise<QueryResult> {
    this.ensureInitialized();

    try {
      const stmt = this.db!.prepare(sql);
      const rows = params.length ? stmt.all(...params) : stmt.all();
      return { rows };
    } catch (error) {
      throw new StorageError(
        'QUERY_FAILED',
        `Failed to execute query: ${sql}`,
        false,
        { sql, params, error }
      );
    }
  }

  async run(sql: string, params: unknown[] = []): Promise<void> {
    this.ensureInitialized();

    try {
      const stmt = this.db!.prepare(sql);
      if (params.length) {
        stmt.run(...params);
      } else {
        stmt.run();
      }
      this.notifyListeners();
    } catch (error) {
      const errorMsg = (error as Error).message;
      if (errorMsg.includes('duplicate column name') || errorMsg.includes('already exists')) {
        return;
      }

      throw new StorageError(
        'EXEC_FAILED',
        `Failed to execute statement: ${sql}`,
        false,
        { sql, params, error }
      );
    }
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    this.ensureInitialized();

    try {
      this.db!.exec('BEGIN TRANSACTION');
      const result = await fn();
      this.db!.exec('COMMIT');
      return result;
    } catch (error) {
      this.db!.exec('ROLLBACK');
      throw error;
    }
  }

  watch(
    query: string,
    params: unknown[] | undefined,
    cb: (rows: unknown[]) => void,
    options?: WatchOptions
  ): Unsubscribe {
    const key = `${query}:${JSON.stringify(params)}`;

    if (!this.watchCallbacks.has(key)) {
      this.watchCallbacks.set(key, new Set());
    }

    const actualCallback = options?.debounceMs ? debounce(cb, options.debounceMs) : cb;
    const callbackEntry = { cb: actualCallback, options };
    this.watchCallbacks.get(key)!.add(callbackEntry);

    if (!options?.skipInitial) {
      this.executeWatch(query, params, actualCallback, options);
    }

    const unsubscribe = this.subscribe(() => {
      this.watchCallbacks.get(key)?.forEach(entry => {
        this.executeWatch(query, params, entry.cb, entry.options);
      });
    });

    return () => {
      this.watchCallbacks.get(key)?.delete(callbackEntry);
      unsubscribe();
    };
  }

  async getCheckpoint(_spaceId: string): Promise<Checkpoint> {
    this.ensureInitialized();
    if (!this.crsqliteEnabled) {
      throw new StorageError(
        'CRSQLITE_UNAVAILABLE',
        'CR-SQLite extension is not loaded',
        false
      );
    }

    const rows = this.db!
      .prepare('SELECT site_id, MAX(db_version) as db_version FROM crsql_changes GROUP BY site_id')
      .all();

    const vv: Record<string, number> = {};
    for (const row of rows) {
      const siteIdBytes = coerceBytes((row as any).site_id);
      if (!siteIdBytes.length) continue;
      const replicaId = this.resolveReplicaId(siteIdBytes);
      const dbVersion = normalizeNumber((row as any).db_version);
      if (!dbVersion) continue;
      vv[replicaId] = dbVersion;
    }

    this.currentCheckpoint = { vv };
    return { ...this.currentCheckpoint };
  }

  async getChanges(_spaceId: string, since: Checkpoint, maxBytes?: number): Promise<ChangesBatch> {
    this.ensureInitialized();
    if (!this.crsqliteEnabled) {
      throw new StorageError(
        'CRSQLITE_UNAVAILABLE',
        'CR-SQLite extension is not loaded',
        false
      );
    }

    const rows = this.db!
      .prepare(
        'SELECT "table", "pk", "cid", "val", "col_version", "db_version", "site_id", "cl", "seq" FROM crsql_changes ORDER BY db_version ASC, seq ASC'
      )
      .all();

    const changes = [] as ChangesBatch['changes'];
    let totalBytes = 0;

    for (const row of rows) {
      const siteIdBytes = coerceBytes((row as any).site_id);
      const replicaId = this.resolveReplicaId(siteIdBytes);
      const dbVersion = normalizeNumber((row as any).db_version);
      const sinceVersion = since.vv[replicaId] || 0;

      if (dbVersion <= sinceVersion) {
        continue;
      }

      const crsqlRow: CrSqlChangeRow = {
        table: (row as any).table as string,
        pk: coerceBytes((row as any).pk),
        cid: (row as any).cid as string,
        val: (row as any).val,
        colVersion: normalizeNumber((row as any).col_version),
        dbVersion,
        siteId: siteIdBytes,
        cl: normalizeNumber((row as any).cl),
        seq: normalizeNumber((row as any).seq)
      };

      const change = {
        replicaId,
        counter: dbVersion,
        timestamp: dbVersion,
        table: crsqlRow.table,
        operation: 'crsql' as const,
        rowData: crsqlRow
      };

      const changeBytes = estimateBytes(change);
      if (maxBytes && totalBytes + changeBytes > maxBytes) {
        break;
      }
      totalBytes += changeBytes;
      changes.push(change);
    }

    const to = mergeCheckpoints(since, await this.getCheckpoint(this.spaceId));

    return {
      batchId: generateBatchId(),
      since,
      to,
      changes,
      bytes: totalBytes,
      hash: '',
      compressed: false
    };
  }

  async applyChanges(_spaceId: string, changes: ChangesBatch): Promise<ApplyResult> {
    this.ensureInitialized();
    if (!this.crsqliteEnabled) {
      throw new StorageError(
        'CRSQLITE_UNAVAILABLE',
        'CR-SQLite extension is not loaded',
        false
      );
    }

    let applied = 0;
    let skipped = 0;
    let conflicts = 0;

    const stmt = this.db!.prepare(
      'INSERT INTO crsql_changes ("table", "pk", "cid", "val", "col_version", "db_version", "site_id", "cl", "seq") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );

    this.db!.exec('BEGIN TRANSACTION');
    try {
      for (const change of changes.changes) {
        const row = change.rowData as CrSqlChangeRow | undefined;
        if (!row) {
          skipped++;
          continue;
        }

        const replicaId = change.replicaId;
        const haveCounter = this.currentCheckpoint.vv[replicaId] || 0;
        if (row.dbVersion <= haveCounter) {
          skipped++;
          continue;
        }

        try {
          stmt.run(
            row.table,
            row.pk,
            row.cid,
            row.val,
            row.colVersion,
            row.dbVersion,
            row.siteId,
            row.cl,
            row.seq
          );
          applied++;
        } catch {
          conflicts++;
        }
      }

      this.db!.exec('COMMIT');
    } catch (error) {
      this.db!.exec('ROLLBACK');
      throw error;
    }

    this.notifyListeners();
    const newCheckpoint = await this.getCheckpoint(this.spaceId);

    return {
      applied,
      skipped,
      conflicts,
      newCheckpoint
    };
  }

  async exportSnapshot(_spaceId: string): Promise<Uint8Array> {
    this.ensureInitialized();

    if (this.storage && this.dbPath && this.dbPath !== ':memory:') {
      return await this.storage.readFile(this.dbPath);
    }

    if (this.dbPath && this.dbPath !== ':memory:') {
      const bytes = await fs.readFile(this.dbPath);
      return new Uint8Array(bytes);
    }

    const tmpPath = path.join(os.tmpdir(), `localsync-snapshot-${Date.now()}.sqlite`);
    const escaped = tmpPath.replace(/'/g, "''");
    this.db!.exec(`VACUUM INTO '${escaped}'`);
    const snapshot = await fs.readFile(tmpPath);
    await fs.rm(tmpPath, { force: true });
    return new Uint8Array(snapshot);
  }

  async importSnapshot(_spaceId: string, snapshot: Uint8Array): Promise<void> {
    this.ensureInitialized();

    if (this.storage && this.dbPath && this.dbPath !== ':memory:') {
      await this.storage.writeFile(this.dbPath, snapshot);
      if (this.openParams) {
        await this.close();
        await this.open(this.openParams);
      }
      this.notifyListeners();
      return;
    }

    if (this.dbPath && this.dbPath !== ':memory:') {
      await fs.writeFile(this.dbPath, snapshot);
      if (this.openParams) {
        await this.close();
        await this.open(this.openParams);
      }
      this.notifyListeners();
      return;
    }

    throw new StorageError('SNAPSHOT_IMPORT_FAILED', 'In-memory import not supported', false);
  }

  async compact(_spaceId: string, _policy?: CompactPolicy): Promise<CompactResult> {
    const startTime = Date.now();

    return {
      prunedChanges: 0,
      bytesReclaimed: 0,
      newCheckpoint: { ...this.currentCheckpoint },
      durationMs: Date.now() - startTime
    };
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  private ensureInitialized(): void {
    if (!this.db || !this.isInitialized) {
      throw new StorageError('ENGINE_NOT_INITIALIZED', 'Engine not initialized', false);
    }
  }

  private subscribe(callback: () => void): Unsubscribe {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notifyListeners(): void {
    this.listeners.forEach(cb => cb());
  }

  private async executeWatch(
    query: string,
    params: unknown[] | undefined,
    cb: (rows: unknown[]) => void,
    options?: WatchOptions
  ): Promise<void> {
    try {
      const stmt = this.db!.prepare(query);
      const rows = params && params.length ? stmt.all(...params) : stmt.all();
      const limit = options?.limit;
      cb(limit ? rows.slice(0, limit) : rows);
    } catch (error) {
      console.error('[Engine] Watch query failed:', error);
    }
  }

  private resolveReplicaId(siteIdBytes: Uint8Array): string {
    if (this.localSiteIdBytes && this.replicaId && bytesEqual(siteIdBytes, this.localSiteIdBytes)) {
      return this.replicaId;
    }
    return decodeSiteId(siteIdBytes);
  }

  private initializeSiteId(): void {
    if (!this.db) return;

    const desiredReplicaId = generateReplicaId(
      this.deviceId,
      this.identityPubKey,
      this.spaceId
    );
    const desiredBytes = new TextEncoder().encode(desiredReplicaId);

    this.db.exec(
      `CREATE TABLE IF NOT EXISTS crsql_site_id (site_id BLOB NOT NULL, ordinal INTEGER PRIMARY KEY);
       CREATE UNIQUE INDEX IF NOT EXISTS crsql_site_id_site_id ON crsql_site_id (site_id);`
    );

    const existing = this.db.prepare('SELECT site_id FROM crsql_site_id WHERE ordinal = 0').get();
    if (existing && (existing as any).site_id) {
      const existingBytes = coerceBytes((existing as any).site_id);
      this.localSiteIdBytes = existingBytes;
      this.replicaId = decodeSiteId(existingBytes);
      if (!bytesEqual(existingBytes, desiredBytes)) {
        console.warn('[Engine] Existing site_id differs from deterministic replicaId; preserving existing value.');
      }
      return;
    }

    this.db.prepare('INSERT INTO crsql_site_id (site_id, ordinal) VALUES (?, 0)').run(desiredBytes);
    this.localSiteIdBytes = desiredBytes;
    this.replicaId = desiredReplicaId;
  }

  private async initializeBuiltInTables(): Promise<void> {
    const tables = [
      `CREATE TABLE IF NOT EXISTS _ls_spaces (
        spaceId TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        ownerPubKey TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        policyJson TEXT
      )`,

      `CREATE TABLE IF NOT EXISTS _ls_members (
        spaceId TEXT NOT NULL,
        memberPubKey TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        updatedAt INTEGER NOT NULL,
        PRIMARY KEY (spaceId, memberPubKey)
      )`,

      `CREATE TABLE IF NOT EXISTS _ls_keys (
        spaceId TEXT NOT NULL,
        memberPubKey TEXT NOT NULL,
        encSpaceKey BLOB NOT NULL,
        issuedAt INTEGER NOT NULL,
        issuedBy TEXT NOT NULL,
        sig BLOB NOT NULL,
        PRIMARY KEY (spaceId, memberPubKey)
      )`,

      `CREATE TABLE IF NOT EXISTS _ls_migrations (
        version INTEGER PRIMARY KEY,
        hash TEXT NOT NULL,
        appliedAt INTEGER NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS _ls_blobs (
        blobId TEXT PRIMARY KEY,
        bytes INTEGER NOT NULL,
        mime TEXT NOT NULL,
        encrypted INTEGER NOT NULL,
        locationsJson TEXT,
        createdAt INTEGER NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS _ls_outbound_queue (
        id TEXT PRIMARY KEY,
        replicaId TEXT NOT NULL,
        counter INTEGER NOT NULL,
        spaceId TEXT NOT NULL,
        tableName TEXT NOT NULL,
        operation TEXT NOT NULL,
        rowJson TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        sentAt INTEGER,
        ackedAt INTEGER
      )`,

      `CREATE TABLE IF NOT EXISTS _ls_conflicts (
        id TEXT PRIMARY KEY,
        tableName TEXT NOT NULL,
        pk TEXT NOT NULL,
        localJson TEXT NOT NULL,
        remoteJson TEXT NOT NULL,
        resolvedJson TEXT NOT NULL,
        resolvedAt INTEGER NOT NULL
      )`
    ];

    for (const sql of tables) {
      await this.run(sql);
    }
  }
}

export function createSQLiteEngine(options?: NodeCRSQLiteEngineOptions): Engine {
  return new SQLiteNodeEngine(options);
}
