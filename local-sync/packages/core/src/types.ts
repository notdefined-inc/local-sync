/**
 * LocalSync SDK Core Types
 * Based on spec_consolidated.md v0.1.4
 */

// ============================================================================
// §2 Core Concepts - Entities
// ============================================================================

/** Unique identifier for a device (browser profile, desktop install, mobile app) */
export type DeviceId = string & { readonly __brand: 'DeviceId' };

/** Unique identifier for an identity (public key) */
export type IdentityPubKey = string & { readonly __brand: 'IdentityPubKey' };

/** Unique identifier for a space */
export type SpaceId = string & { readonly __brand: 'SpaceId' };

/** Unique identifier for a replica (deterministic per device+identity+space) */
export type ReplicaId = string & { readonly __brand: 'ReplicaId' };

/** Unique identifier for a blob (content-addressed SHA-256 hash) */
export type BlobId = string & { readonly __brand: 'BlobId' };

// ============================================================================
// §5.1 Checkpoint (Protocol-visible)
// ============================================================================

/** 
 * Vector clock checkpoint for multi-writer replication
 * Maps replicaId to counter value
 */
export interface Checkpoint {
  vv: Record<string, number>; // replicaId -> counter
}

/** Batch of changes for delta sync */
export interface ChangesBatch {
  batchId: string;
  since: Checkpoint;
  to: Checkpoint;
  changes: Change[];
  bytes: number;
  hash: string;
  compressed?: boolean;
}

/** Individual change record (engine-specific rowData for crsql changes) */
export interface Change {
  replicaId: string;
  counter: number;
  timestamp: number;
  table: string;
  operation: 'insert' | 'update' | 'delete' | 'crsql';
  rowData: unknown;
}

/** Result of applying changes */
export interface ApplyResult {
  applied: number;
  skipped: number;
  conflicts: number;
  newCheckpoint: Checkpoint;
}

// ============================================================================
// §5.2 Engine Interface
// ============================================================================

export interface EngineOpenParams {
  appId: string;
  identityPubKey: string;
  spaceId: string;
  deviceId: string;
  dbPath: string;
  storage?: StorageAdapter;
}

export interface QueryResult {
  rows: unknown[];
  changes?: number;
}

export type Unsubscribe = () => void;

/** Compaction policy for pruning old changes */
export interface CompactPolicy {
  /** Number of recent checkpoints to retain. Default: 100 */
  retainCheckpoints?: number;
  /** Prune changes older than this age in milliseconds */
  maxAgeMs?: number;
  /** Trigger compaction when change log exceeds this size in bytes */
  maxSizeBytes?: number;
  /** Strategy for pruning */
  strategy?: 'aggressive' | 'conservative' | 'balanced';
}

export interface CompactResult {
  prunedChanges: number;
  bytesReclaimed: number;
  newCheckpoint: Checkpoint;
  durationMs: number;
}

/** Main database engine interface */
export interface Engine {
  open(params: EngineOpenParams): Promise<void>;
  close(): Promise<void>;

  exec(sql: string, params?: unknown[]): Promise<QueryResult>;
  run(sql: string, params?: unknown[]): Promise<void>;

  transaction<T>(fn: () => Promise<T>): Promise<T>;

  // Reactive queries
  watch(
    query: string,
    params: unknown[] | undefined,
    cb: (rows: unknown[]) => void,
    options?: WatchOptions
  ): Unsubscribe;

  // Replication primitives
  getCheckpoint(spaceId: string): Promise<Checkpoint>;
  getChanges(spaceId: string, since: Checkpoint, maxBytes?: number): Promise<ChangesBatch>;
  applyChanges(spaceId: string, changes: ChangesBatch): Promise<ApplyResult>;

  // Snapshot primitives
  exportSnapshot(spaceId: string): Promise<Uint8Array>;
  importSnapshot(spaceId: string, snapshot: Uint8Array): Promise<void>;

  // Optional: compaction / pruning
  compact(spaceId: string, policy?: CompactPolicy): Promise<CompactResult>;
}

export interface EngineCreateParams extends EngineOpenParams {}

export interface EngineProvider {
  createEngine(params: EngineCreateParams): Engine;
}

// ============================================================================
// §5.3.1 Watch Options (Extended)
// ============================================================================

export interface WatchOptions {
  /** Debounce rapid changes; only fire callback after this many ms of quiet. Default: 0 */
  debounceMs?: number;
  /** Maximum rows to return. For pagination, use with cursor. */
  limit?: number;
  /** Cursor for pagination (opaque string from previous result) */
  cursor?: string;
  /** If true, only fire on changes (skip initial result). Default: false */
  skipInitial?: boolean;
}

export interface WatchResult<T> {
  rows: T[];
  /** Cursor for next page, undefined if no more results */
  nextCursor?: string;
  /** Total count (if countable without full scan) */
  totalCount?: number;
}

// ============================================================================
// §5.6 Conflict Resolution
// ============================================================================

export interface RowVersion {
  replicaId: string;
  counter: number;
  timestamp: number; // logical or wall-clock
}

export interface ConflictMeta {
  table: string;
  primaryKey: unknown;
  localVersion: RowVersion;
  remoteVersion: RowVersion;
}

export interface ConflictResolver<T> {
  resolve(local: T, remote: T, metadata: ConflictMeta): T | 'local' | 'remote';
}

// ============================================================================
// §6.2 Vault Interface
// ============================================================================

export interface Vault {
  create(password: string): Promise<void>;
  unlock(password: string): Promise<UnlockedSession>;
  lock(): void;

  getPublicKey(): Promise<string>;

  // Key envelopes for shared spaces
  encryptFor(pubKey: string, bytes: Uint8Array): Promise<Uint8Array>;
  decrypt(bytes: Uint8Array): Promise<Uint8Array>;
  decryptFrom(senderPubKey: string, encrypted: Uint8Array): Promise<Uint8Array>;

  sign(bytes: Uint8Array): Promise<Uint8Array>;
  verify(pubKey: string, bytes: Uint8Array, sig: Uint8Array): Promise<boolean>;

  exportEncrypted(password: string): Promise<Uint8Array>;
}

export interface UnlockedSession {
  pubKey: string;
  // Session exists only in memory
}

export interface VaultProvider {
  create(password: string): Promise<Vault>;
  unlock(encryptedBytes: Uint8Array, password: string): Promise<Vault>;
}

// ============================================================================
// §7 Spaces (Shared Workspaces)
// ============================================================================

export type SpaceType = 'personal' | 'shared';
export type MemberRole = 'owner' | 'admin' | 'member' | 'reader';

export interface SpaceMetadata {
  spaceId: SpaceId;
  spaceType: SpaceType;
  ownerPubKey: string;
  spaceKey?: Uint8Array; // Only for shared spaces
  policy?: SpacePolicy;
  members: SpaceMember[];
}

export interface SpaceMember {
  pubKey: string;
  role: MemberRole;
  status: 'active' | 'removed';
  updatedAt: number;
}

export interface SpaceInviteEnvelope {
  spaceId: string;
  issuedAt: number;
  issuedBy: string; // pubKey
  memberPubKey: string;
  role: MemberRole;
  
  // spaceKey encrypted for memberPubKey
  encSpaceKey: Uint8Array;
  
  // signature by issuedBy
  sig: Uint8Array;
}

// ============================================================================
// §8 Permission Model
// ============================================================================

export interface SpacePolicy {
  roles: Record<MemberRole, RolePolicy>;
}

export interface RolePolicy {
  allow: PolicyRule[];
}

export interface PolicyRule {
  table: string;
  ops: ('insert' | 'update' | 'delete' | 'select')[];
  where?: string; // Policy where language expression
}

// ============================================================================
// §9 Replication Protocol (LSYNC/1)
// ============================================================================

export interface WireMessage<T> {
  v: 'LSYNC/1';
  type: string;
  appId: string;
  spaceId: string;
  from: string;     // sender pubKey
  deviceId: string;
  ts: number;       // ms since epoch
  payload: T;
  sig: Uint8Array;  // signature over canonical bytes
}

export interface Hello {
  want: 'delta' | 'bootstrap';
  haveCheckpoint?: Checkpoint;
  supported: {
    maxChunkBytes: number;
    compression: ('none' | 'zstd' | 'gzip')[];
    encryption: ('none' | 'space')[];
  };
}

export interface Welcome {
  peerCheckpoint?: Checkpoint;
  canServeSnapshot: boolean;
  snapshotHash?: string;
  snapshotBytes?: number;
  recommended: { mode: 'delta' | 'bootstrap' };
}

// ============================================================================
// §9.8 Offline Queue
// ============================================================================

export interface LocalChange {
  replicaId: string;
  counter: number;
  spaceId: string;
  tableName: string;
  operation: 'insert' | 'update' | 'delete';
  rowJson: string;
  createdAt: number;
}

export interface QueuedChange extends LocalChange {
  id: string;
  sentAt?: number;
  ackedAt?: number;
}

export interface OfflineQueue {
  enqueue(change: LocalChange): Promise<void>;
  peek(limit?: number): Promise<QueuedChange[]>;
  markSent(ids: string[]): Promise<void>;
  markAcked(ids: string[]): Promise<void>;
  prune(): Promise<number>; // remove acked entries
}

// ============================================================================
// §9.9 Rate Limiting
// ============================================================================

export interface RateLimitConfig {
  maxMessagesPerSecond: number;  // default: 100
  maxBytesPerSecond: number;     // default: 1MB
  maxPendingChanges: number;     // default: 1000
  banDurationMs: number;         // default: 60000 (1 min)
}

// ============================================================================
// §10 Transport Adapters
// ============================================================================

export interface PeerInfo {
  peerId: string;
  pubKey: string;
  deviceId: string;
  endpoints: string[];
}

export interface Transport {
  start(): Promise<void>;
  stop(): Promise<void>;

  discoverPeers(spaceId: string): AsyncIterable<PeerInfo>;
  connect(peer: PeerInfo): Promise<Channel>;
}

export interface Channel {
  send(bytes: Uint8Array): Promise<void>;
  onMessage(cb: (bytes: Uint8Array) => void): Unsubscribe;
  close(): Promise<void>;
}

export interface ControlPlaneSignal {
  spaceId: string;
  from: string;
  to: string;
  payload: Uint8Array;
}

export interface ControlPlane {
  start(): Promise<void>;
  stop(): Promise<void>;

  announcePeer(spaceId: string, info: PeerInfo): Promise<void>;
  discoverPeers(spaceId: string): AsyncIterable<PeerInfo>;

  publishInvite(envelope: SpaceInviteEnvelope): Promise<void>;
  onInvite(cb: (envelope: SpaceInviteEnvelope) => void): Unsubscribe;

  sendSignal(signal: ControlPlaneSignal): Promise<void>;
  onSignal(cb: (signal: ControlPlaneSignal) => void): Unsubscribe;
}

export interface ControlPlaneProvider {
  createControlPlane(params: {
    appId: string;
    identityPubKey: string;
    deviceId: string;
    vault: Vault;
  }): ControlPlane;
}

export interface TransportProvider {
  name: string;
  createTransport(params: {
    appId: string;
    identityPubKey: string;
    deviceId: string;
    controlPlane?: ControlPlane;
    config?: Record<string, unknown>;
  }): Transport;
}

// ============================================================================
// §10.4 Retry Strategy + Circuit Breaker
// ============================================================================

export interface RetryConfig {
  maxRetries: number;          // default: 5
  initialDelayMs: number;      // default: 1000
  maxDelayMs: number;          // default: 30000
  backoffMultiplier: number;   // default: 2
  jitterFactor: number;        // default: 0.1 (10% random jitter)
}

export interface CircuitBreakerConfig {
  failureThreshold: number;    // failures before opening circuit
  resetTimeoutMs: number;      // time before trying again
  halfOpenMaxAttempts: number; // attempts in half-open state
}

// ============================================================================
// §13 Blobs / Files
// ============================================================================

export interface BlobMeta {
  blobId: BlobId;
  bytes: number;
  mime: string;
  createdAt: number;
  locations: { type: string; url?: string }[];
  encrypted: boolean;
}

export interface PutOpts {
  encrypt?: boolean;
}

export interface BlobStore {
  put(blob: Uint8Array, meta: { mime: string }, opts?: PutOpts): Promise<BlobMeta>;
  get(blobId: BlobId): Promise<Uint8Array>;
  has(blobId: BlobId): Promise<boolean>;
  del?(blobId: BlobId): Promise<void>;
}

export interface BlobStoreProvider {
  name: string;
  createStore(params: {
    appId: string;
    identityPubKey: string;
    spaceId: string;
    storage: StorageAdapter;
    vault?: Vault;
    config?: Record<string, unknown>;
  }): BlobStore;
}

// ============================================================================
// §14.7 Error Types
// ============================================================================

export class LocalSyncError extends Error {
  readonly code: string;
  readonly recoverable: boolean;
  readonly context?: Record<string, unknown>;

  constructor(code: string, message: string, recoverable: boolean, context?: Record<string, unknown>) {
    super(message);
    this.name = 'LocalSyncError';
    this.code = code;
    this.recoverable = recoverable;
    this.context = context;
  }
}

export class AuthError extends LocalSyncError {
  constructor(code: string, message: string, context?: Record<string, unknown>) {
    super(code, message, false, context);
    this.name = 'AuthError';
  }
}

export class ValidationError extends LocalSyncError {
  readonly changeset?: ChangesBatch;
  readonly sender?: string;

  constructor(
    code: string,
    message: string,
    changeset?: ChangesBatch,
    sender?: string,
    context?: Record<string, unknown>
  ) {
    super(code, message, false, context);
    this.name = 'ValidationError';
    this.changeset = changeset;
    this.sender = sender;
  }
}

export class SyncError extends LocalSyncError {
  readonly peerId?: string;

  constructor(code: string, message: string, recoverable: boolean, peerId?: string, context?: Record<string, unknown>) {
    super(code, message, recoverable, context);
    this.name = 'SyncError';
    this.peerId = peerId;
  }
}

export class StorageError extends LocalSyncError {
  constructor(code: string, message: string, recoverable: boolean, context?: Record<string, unknown>) {
    super(code, message, recoverable, context);
    this.name = 'StorageError';
  }
}

export class ConflictError extends LocalSyncError {
  readonly local: unknown;
  readonly remote: unknown;
  readonly table: string;

  constructor(
    message: string,
    local: unknown,
    remote: unknown,
    table: string,
    context?: Record<string, unknown>
  ) {
    super('UNRESOLVED_CONFLICT', message, false, context);
    this.name = 'ConflictError';
    this.local = local;
    this.remote = remote;
    this.table = table;
  }
}

// ============================================================================
// §3.1.1 Storage Adapter Interface
// ============================================================================

export interface StorageAdapter {
  ensureAppRoot(appId: string): Promise<void>;
  deviceRegistryPath(appId: string): Promise<string>;
  vaultPath(appId: string, pubkey: string): Promise<string>;
  spaceDbPath(appId: string, identityPubKey: string, spaceId: string): Promise<string>;
  spaceBlobsDir(appId: string, pubkey: string, spaceId: string): Promise<string>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  deleteFile(path: string): Promise<void>;
  fileExists?(path: string): Promise<boolean>;
  
  // Vault storage methods
  readVault(appId: string, pubkey: string): Promise<Uint8Array>;
  writeVault(appId: string, pubkey: string, data: Uint8Array): Promise<void>;
  vaultExists(appId: string, pubkey: string): Promise<boolean>;
}
