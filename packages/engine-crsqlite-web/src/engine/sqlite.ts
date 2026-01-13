/**
 * CR-SQLite WASM Engine Implementation (Web)
 * Uses wa-sqlite + CR-SQLite extension with OPFS/IDB VFS.
 */

import SQLiteAsyncESMFactory from '@vlcn.io/wa-sqlite/dist/crsqlite.mjs';
import crsqliteWasmUrl from '@vlcn.io/wa-sqlite/dist/crsqlite.wasm?url';
import { DB } from '@vlcn.io/crsqlite-wasm';
import * as SQLite from '@vlcn.io/wa-sqlite';
import type {
  Engine,
  EngineOpenParams,
  QueryResult,
  Checkpoint,
  ChangesBatch,
  ApplyResult,
  CompactPolicy,
  CompactResult,
  WatchOptions,
  Unsubscribe,
  StorageAdapter
} from '@localsync/core';
import { StorageError } from '@localsync/core';
import { debounce, generateReplicaId, mergeCheckpoints } from '@localsync/core/utils';

export type WebCRSQLiteEngineOptions = {
  locateWasm?: (file: string) => string;
  vfs?: 'opfs' | 'idb' | 'memory';
};

type SQLiteAPI = ReturnType<typeof SQLite.Factory>;

type WasmModule = {
  cwrap: (name: string, ret: string | null, args: string[]) => (...params: any[]) => any;
  _malloc: (size: number) => number;
  _free: (ptr: number) => void;
  HEAPU8: Uint8Array;
  HEAPU32: Uint32Array;
};

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

const registeredVfs = new Set<string>();
let wasmInitPromise: Promise<{ sqlite: SQLiteAPI; module: WasmModule }> | null = null;

function isNodeRuntime(): boolean {
  const proc = (globalThis as any)?.process;
  return Boolean(proc?.versions?.node);
}

function decodeDataUrl(dataUrl: string): Uint8Array | null {
  const match = dataUrl.match(/^data:.*?;base64,(.+)$/);
  if (!match) {
    return null;
  }
  const base64 = match[1];
  const BufferRef = (globalThis as any)?.Buffer as
    | { from: (input: string, encoding: string) => { toString?: () => string; length: number } & Uint8Array }
    | undefined;
  if (BufferRef) {
    return new Uint8Array(BufferRef.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function resolveNodeWasmBinary(url: string): Promise<Uint8Array | null> {
  if (!isNodeRuntime()) {
    return null;
  }

  if (url.startsWith('data:')) {
    return decodeDataUrl(url);
  }

  if (url.startsWith('http://') || url.startsWith('https://')) {
    return null;
  }

  let filePath = url;
  if (filePath.startsWith('file://')) {
    const { fileURLToPath } = await import('node:url');
    filePath = fileURLToPath(filePath);
  } else if (filePath.startsWith('/@fs/')) {
    filePath = filePath.slice(4);
  }

  try {
    const { readFile } = await import('node:fs/promises');
    const buffer = await readFile(filePath);
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

async function initCrsqlite(options?: WebCRSQLiteEngineOptions) {
  if (!wasmInitPromise) {
    wasmInitPromise = (async () => {
      const wasmBinary =
        options?.locateWasm ? null : await resolveNodeWasmBinary(crsqliteWasmUrl);
      const module = (await SQLiteAsyncESMFactory({
        locateFile(file: string) {
          if (options?.locateWasm) {
            return options.locateWasm(file);
          }
          return crsqliteWasmUrl || new URL('crsqlite.wasm', import.meta.url).href;
        },
        ...(wasmBinary ? { wasmBinary } : {})
      })) as WasmModule;
      const sqlite = SQLite.Factory(module);
      return { sqlite, module };
    })();
  }
  return wasmInitPromise;
}

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}

function coerceBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  if (Array.isArray(value)) return new Uint8Array(value);
  if (typeof value === 'string') return new TextEncoder().encode(value);
  return new Uint8Array();
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function decodeSiteId(bytes: Uint8Array): string {
  const text = new TextDecoder().decode(bytes);
  if (/^[A-Za-z0-9_-]+$/.test(text)) {
    return text;
  }
  return toHex(bytes);
}

function normalizeNumber(value: number | bigint): number {
  if (typeof value === 'bigint') {
    return Number(value);
  }
  return value;
}

function estimateBytes(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

/**
 * SQLite WASM Engine with CR-SQLite extension.
 */
export class SQLiteEngine implements Engine {
  private db: DB | null = null;
  private dbHandle: number | null = null;
  private sqlite: SQLiteAPI | null = null;
  private module: WasmModule | null = null;
  private isInitialized = false;
  private listeners: Set<() => void> = new Set();
  private watchCallbacks: Map<string, Set<{ cb: (rows: unknown[]) => void; options?: WatchOptions }>> = new Map();

  private replicaId: string | null = null;
  private localSiteIdBytes: Uint8Array | null = null;
  private currentCheckpoint: Checkpoint = { vv: {} };

  private dbPath: string | null = null;
  private storage: StorageAdapter | null = null;
  private appId = '';
  private identityPubKey = '';
  private spaceId = '';
  private deviceId = '';
  private openParams: EngineOpenParams | null = null;
  private siteIdOverrideAttempted = false;

  constructor(private options: WebCRSQLiteEngineOptions = {}) {}

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

      const { sqlite, module } = await initCrsqlite(this.options);
      this.sqlite = sqlite;
      this.module = module;

      const vfsName = await this.resolveVfs(sqlite);
      const filename = this.dbPath || ':memory:';
      const flags =
        SQLite.SQLITE_OPEN_CREATE |
        SQLite.SQLITE_OPEN_READWRITE |
        SQLite.SQLITE_OPEN_URI;

      const dbHandle = await sqlite.open_v2(filename, flags, vfsName);
      this.dbHandle = dbHandle;

      const db = new DB(sqlite, dbHandle, filename);
      await this.initializeDb(db);
      this.db = db;
      this.isInitialized = true;

      const reopened = await this.ensureDeterministicSiteId();
      if (reopened) {
        return;
      }

      await this.initializeBuiltInTables();
      this.replicaId = await this.fetchSiteId();
      this.currentCheckpoint = await this.getCheckpoint(this.spaceId);
    } catch (error) {
      await this.close();
      const message =
        error instanceof Error ? `Failed to initialize CR-SQLite engine: ${error.message}` : 'Failed to initialize CR-SQLite engine';
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
      await this.db.close();
      this.db = null;
    }
    this.dbHandle = null;
    this.isInitialized = false;
    this.listeners.clear();
    this.watchCallbacks.clear();
  }

  async exec(sql: string, params: unknown[] = []): Promise<QueryResult> {
    this.ensureInitialized();

    try {
      const rows = await this.db!.execO(sql, params as any[]);
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
      await this.db!.exec(sql, params as any[]);
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
      await this.run('BEGIN TRANSACTION');
      const result = await fn();
      await this.run('COMMIT');
      return result;
    } catch (error) {
      await this.run('ROLLBACK');
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

    const actualCallback = options?.debounceMs
      ? debounce(cb, options.debounceMs)
      : cb;

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

    const rows = await this.db!.execO<{ site_id: Uint8Array; db_version: number | bigint }>(
      'SELECT site_id as site_id, MAX(db_version) as db_version FROM crsql_changes GROUP BY site_id'
    );

    const vv: Record<string, number> = {};
    for (const row of rows) {
      if (!row.site_id || row.db_version == null) continue;
      const siteIdBytes = coerceBytes(row.site_id);
      if (!siteIdBytes.length) continue;
      const replicaId = this.resolveReplicaId(siteIdBytes);
      vv[replicaId] = normalizeNumber(row.db_version);
    }

    this.currentCheckpoint = { vv };
    return { ...this.currentCheckpoint };
  }

  async getChanges(_spaceId: string, since: Checkpoint, maxBytes?: number): Promise<ChangesBatch> {
    this.ensureInitialized();

    const rows = await this.db!.execO<any>(
      'SELECT "table", "pk", "cid", "val", "col_version", "db_version", "site_id", "cl", "seq" FROM crsql_changes ORDER BY db_version ASC, seq ASC'
    );

    const changes = [] as ChangesBatch['changes'];
    let totalBytes = 0;

    for (const row of rows) {
      const siteIdBytes = coerceBytes(row.site_id);
      const replicaId = this.resolveReplicaId(siteIdBytes);
      const dbVersion = normalizeNumber(row.db_version);
      const sinceVersion = since.vv[replicaId] || 0;

      if (dbVersion <= sinceVersion) {
        continue;
      }

      const crsqlRow: CrSqlChangeRow = {
        table: row.table as string,
        pk: row.pk as Uint8Array,
        cid: row.cid as string,
        val: row.val,
        colVersion: normalizeNumber(row.col_version),
        dbVersion,
        siteId: siteIdBytes,
        cl: normalizeNumber(row.cl),
        seq: normalizeNumber(row.seq)
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
      batchId: crypto.randomUUID(),
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

    let applied = 0;
    let skipped = 0;
    let conflicts = 0;

    await this.db!.tx(async (tx) => {
      const stmt = await tx.prepare(
        'INSERT INTO crsql_changes ("table", "pk", "cid", "val", "col_version", "db_version", "site_id", "cl", "seq") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );

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
          await stmt.run(
            tx,
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
        } catch (error) {
          conflicts++;
        }
      }

      await stmt.finalize(tx);
    });

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

    return this.serializeDatabase();
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

    this.deserializeDatabase(snapshot);
    this.notifyListeners();
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
      const rows = await this.db!.execO(query, (params ?? []) as any[]);
      const limit = options?.limit;
      cb(limit ? rows.slice(0, limit) : rows);
    } catch (error) {
      console.error('[Engine] Watch query failed:', error);
    }
  }

  private async resolveVfs(sqlite: SQLiteAPI): Promise<string> {
    const prefer = this.options.vfs;
    const hasOpfs =
      typeof navigator !== 'undefined' &&
      Boolean(navigator.storage?.getDirectory) &&
      typeof (globalThis as any).FileSystemSyncAccessHandle !== 'undefined' &&
      typeof crossOriginIsolated !== 'undefined' &&
      crossOriginIsolated;

    const hasIdb = typeof indexedDB !== 'undefined';

    if (prefer === 'opfs' || (!prefer && hasOpfs)) {
      if (!registeredVfs.has('opfs')) {
        const { OriginPrivateFileSystemVFS } = await import(
          '@vlcn.io/wa-sqlite/src/examples/OriginPrivateFileSystemVFS.js'
        );
        sqlite.vfs_register(new OriginPrivateFileSystemVFS());
        registeredVfs.add('opfs');
      }
      return 'opfs';
    }

    if (prefer === 'idb' || (!prefer && hasIdb)) {
      if (!registeredVfs.has('idb-batch-atomic')) {
        const { IDBBatchAtomicVFS } = await import(
          '@vlcn.io/wa-sqlite/src/examples/IDBBatchAtomicVFS.js'
        );
        sqlite.vfs_register(new IDBBatchAtomicVFS('idb-batch-atomic', { durability: 'relaxed' }));
        registeredVfs.add('idb-batch-atomic');
      }
      return 'idb-batch-atomic';
    }

    if (!registeredVfs.has('memory-async')) {
      const { MemoryAsyncVFS } = await import('@vlcn.io/wa-sqlite/src/examples/MemoryAsyncVFS.js');
      sqlite.vfs_register(new MemoryAsyncVFS());
      registeredVfs.add('memory-async');
    }
    return 'memory-async';
  }

  private async initializeDb(db: DB): Promise<void> {
    const stmt = await db.prepare(
      `SELECT tbl_name FROM tables_used(?) AS u
        JOIN sqlite_master ON sqlite_master.name = u.name
        WHERE u.schema = 'main'`
    );
    stmt.raw(true);
    (db as any)._setTablesUsedStmt(stmt);

    const siteRows = await db.execA('SELECT hex(crsql_site_id())');
    const siteId = siteRows[0]?.[0];
    if (typeof siteId === 'string') {
      (db as any)._setSiteid(siteId.toLowerCase());
    }
  }

  private resolveReplicaId(siteIdBytes: Uint8Array): string {
    if (this.localSiteIdBytes && this.replicaId && bytesEqual(siteIdBytes, this.localSiteIdBytes)) {
      return this.replicaId;
    }
    return decodeSiteId(siteIdBytes);
  }

  private async fetchSiteIdBytes(): Promise<Uint8Array> {
    const rows = await this.db!.execA('SELECT crsql_site_id()');
    const value = rows[0]?.[0];
    return coerceBytes(value);
  }

  private async fetchSiteId(): Promise<string> {
    const bytes = await this.fetchSiteIdBytes();
    if (!bytes.length) {
      return '';
    }
    if (!this.localSiteIdBytes) {
      this.localSiteIdBytes = bytes;
    }
    return this.resolveReplicaId(bytes);
  }

  private async isBlankDatabase(): Promise<boolean> {
    const rows = await this.db!.execA(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'crsql_%'"
    );
    return rows.length === 0;
  }

  private async ensureDeterministicSiteId(): Promise<boolean> {
    if (!this.db || !this.openParams) {
      return false;
    }

    const desiredReplicaId = generateReplicaId(
      this.deviceId,
      this.identityPubKey,
      this.spaceId
    );
    const desiredBytes = new TextEncoder().encode(desiredReplicaId);
    const currentBytes = await this.fetchSiteIdBytes();

    if (currentBytes.length && bytesEqual(currentBytes, desiredBytes)) {
      this.localSiteIdBytes = currentBytes;
      this.replicaId = desiredReplicaId;
      return false;
    }

    if (this.siteIdOverrideAttempted || !(await this.isBlankDatabase())) {
      if (currentBytes.length) {
        this.localSiteIdBytes = currentBytes;
        this.replicaId = decodeSiteId(currentBytes);
      }
      if (!this.siteIdOverrideAttempted && currentBytes.length) {
        console.warn('[Engine] Existing site_id differs from deterministic replicaId; preserving existing value.');
      }
      return false;
    }

    this.siteIdOverrideAttempted = true;
    await this.db.exec(
      `CREATE TABLE IF NOT EXISTS crsql_site_id (site_id BLOB NOT NULL, ordinal INTEGER PRIMARY KEY);
       CREATE UNIQUE INDEX IF NOT EXISTS crsql_site_id_site_id ON crsql_site_id (site_id);`
    );
    await this.db.exec(
      'INSERT OR REPLACE INTO crsql_site_id (site_id, ordinal) VALUES (?, 0)',
      [desiredBytes]
    );

    await this.close();
    await this.open(this.openParams);
    return true;
  }

  private serializeDatabase(): Uint8Array {
    if (!this.module || this.dbHandle == null) {
      throw new StorageError('SNAPSHOT_EXPORT_FAILED', 'WASM module unavailable', false);
    }

    const sizePtr = this.module._malloc(8);
    const serialize = this.module.cwrap('sqlite3_serialize', 'number', [
      'number',
      'string',
      'number',
      'number'
    ]);
    const free = this.module.cwrap('sqlite3_free', null, ['number']);

    const ptr = serialize(this.dbHandle, 'main', sizePtr, 0);
    const sizeLow = this.module.HEAPU32[sizePtr / 4];
    const sizeHigh = this.module.HEAPU32[sizePtr / 4 + 1];
    const size = sizeHigh * 2 ** 32 + sizeLow;

    const bytes = this.module.HEAPU8.slice(ptr, ptr + size);
    free(ptr);
    this.module._free(sizePtr);

    return bytes;
  }

  private deserializeDatabase(snapshot: Uint8Array): void {
    if (!this.module || this.dbHandle == null) {
      throw new StorageError('SNAPSHOT_IMPORT_FAILED', 'WASM module unavailable', false);
    }

    const SQLITE_DESERIALIZE_FREEONCLOSE = 1;
    const SQLITE_DESERIALIZE_RESIZEABLE = 2;

    const ptr = this.module._malloc(snapshot.length);
    this.module.HEAPU8.set(snapshot, ptr);

    const deserialize = this.module.cwrap('sqlite3_deserialize', 'number', [
      'number',
      'string',
      'number',
      'number',
      'number',
      'number'
    ]);

    const rc = deserialize(
      this.dbHandle,
      'main',
      ptr,
      snapshot.length,
      snapshot.length,
      SQLITE_DESERIALIZE_FREEONCLOSE | SQLITE_DESERIALIZE_RESIZEABLE
    );

    if (rc !== SQLite.SQLITE_OK) {
      throw new StorageError('SNAPSHOT_IMPORT_FAILED', 'Failed to deserialize snapshot', false, {
        code: rc
      });
    }
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

export function createSQLiteEngine(options?: WebCRSQLiteEngineOptions): Engine {
  return new SQLiteEngine(options);
}
