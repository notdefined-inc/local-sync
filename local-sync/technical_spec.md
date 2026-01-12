# LocalSync Technical Spec (v0.1.1 — CR-SQLite, Nostr Control Plane, WebRTC Data Plane)

Status: Draft  
Inputs: `spec_consolidated.md` (requirements + protocol shape)  
Scope: Web + Node/Electron. Mobile deferred.

This document is the implementation-oriented technical spec for building LocalSync as a TypeScript library + official adapters.

---

## 1) Decisions (Locked In)

### 1.1 Platforms
- **Web** (static hosting friendly): works with COOP/COEP when available, but MUST have functional fallbacks for GitHub Pages and similar hosts.
- **Node + Electron**: any environment that “uses Node”.
- **Mobile**: explicitly out-of-scope for v0.1.

### 1.2 Replication Engine
- Use **CR-SQLite** from day 1 as the merge layer.
- Node/Electron MUST use **native SQLite + CR-SQLite extension** (not remote libsql).
- Web uses **SQLite WASM with CR-SQLite built-in or loadable** (packaged by us).

### 1.3 Networking
- **Control plane**: Nostr (official adapter).
- **Data plane**: WebRTC data channels (official adapter).
- No required servers. Users can bring their own TURN; relay/WebSocket transports are optional ecosystem work.

---

## 2) Repository / Package Layout

Monorepo (workspaces). Proposed packages:

### 2.1 Core
- `packages/core`
  - Space/Identity APIs
  - Engine abstraction + adapters wiring
  - LSYNC/1 framing, signing, encryption, chunking
  - Rules/policy validation (Option 2 baseline)
  - Blob/files abstraction

### 2.2 Engines
- `packages/engine-crsqlite-web`
  - SQLite WASM build + CR-SQLite integration
  - OPFS persistence fast path; fallback VFS (IDB) when needed
  - Implements `Engine`

- `packages/engine-crsqlite-node`
  - Native SQLite driver wrapper
  - Loads CR-SQLite extension (bundled binaries or user-provided path)
  - Implements `Engine`

### 2.3 Networking
- `packages/control-nostr`
  - Presence, peer discovery, signaling, invites/envelopes, migrations, pointers
  - NIP-11 enforcement, NIP-44 encryption for sensitive payloads

- `packages/transport-webrtc`
  - WebRTC data channels using signaling from `control-nostr`
  - BYO TURN via `RTCIceServer[]` config

### 2.4 Optional / Later
- `packages/blob-nip96` (optional)
- `packages/transport-relay` (optional)
- `packages/push-gateway` (optional reference server)
- `packages/service-node` (optional reference worker)

### 2.5 Tooling
- Build: `tsup` (ESM + `.d.ts`)
- Test: `vitest`
- Lint/format: (pick later, optional)

---

## 3) Public API (TypeScript)

### 3.1 Top-level

```ts
export interface LocalSyncOpenParams {
  appId: string;
  storage: StorageAdapter;
  vault: VaultProvider;
  engine: EngineProvider;
  controlPlane?: ControlPlaneProvider;      // official: nostr
  transports?: TransportProvider[];         // official: webrtc
  blobStores?: BlobStoreProvider[];         // optional
}

export class LocalSyncClient {
  readonly appId: string;

  identities: {
    list(): Promise<DeviceIdentity[]>;
  };

  login(pubkey: string, password: string): Promise<LocalSyncSession>;
  logout(): Promise<void>;
}

export class LocalSyncSession {
  readonly pubkey: string;

  spaces: {
    list(): Promise<SpaceInfo[]>;
    open(spaceId: string): Promise<SpaceHandle>;
    createPersonal(params?: { name?: string }): Promise<SpaceHandle>;
    createShared(params: { name: string; policy?: SpacePolicy }): Promise<SpaceHandle>;
  };
}
```

### 3.2 Space Handle

```ts
export interface SpaceHandle {
  readonly spaceId: string;
  readonly spaceType: "personal" | "shared";

  // SQL API
  exec(sql: string, params?: any[]): Promise<QueryResult>;
  run(sql: string, params?: any[]): Promise<void>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  watch(query: string, params: any[] | undefined, cb: (rows: any[]) => void): Unsubscribe;

  // membership
  invite?(params: { memberPubKey: string; role: MemberRole }): Promise<void>;

  // sync
  sync: {
    start(): Promise<void>;
    stop(): Promise<void>;
    once(): Promise<void>;
    exportSnapshot(): Promise<Uint8Array>;
    importSnapshot(bytes: Uint8Array): Promise<void>;
  };

  // files
  files: {
    put(blob: Uint8Array, meta: { mime: string }, opts?: PutOpts): Promise<BlobMeta>;
    get(blobId: string): Promise<Uint8Array>;
    has(blobId: string): Promise<boolean>;
  };
}
```

API notes:
- The SQL surface is per-space and routes through the current Engine instance for that space.
- Sync is per-space, because each space is an independent replication domain.

---

## 4) Storage Topology (Web + Node/Electron)

### 4.1 Path Model
The storage adapter is responsible for mapping `(appId, pubkey, spaceId)` to filesystem paths.

```ts
export interface StorageAdapter {
  // called once early
  ensureAppRoot(appId: string): Promise<void>;

  // device-wide per appId
  deviceRegistryPath(appId: string): Promise<string>;

  // per identity
  vaultPath(appId: string, pubkey: string): Promise<string>;

  // per identity + per space
  spaceDbPath(appId: string, pubkey: string, spaceId: string): Promise<string>;
  spaceBlobsDir(appId: string, pubkey: string, spaceId: string): Promise<string>;
}
```

### 4.2 Web (OPFS + fallback)
**Fast path** (requires COOP/COEP for best performance):
- OPFS + `FileSystemSyncAccessHandle` based VFS.

**Fallback path** (GitHub Pages, no headers, older browsers):
- OPFS async handles where possible, otherwise IDB-backed VFS.

Runtime selection:
- If `crossOriginIsolated` and OPFS sync access handles exist → use fast path.
- Else → use fallback path.

Persistent storage:
- SDK SHOULD call `await navigator.storage.persist?.()` and record outcome (non-fatal).

### 4.3 Node/Electron
Default storage roots:
- Node: user-provided base directory or `~/.localsync/<appId>/...`
- Electron: `app.getPath("userData")/localsync/<appId>/...`

These are implementation defaults; the StorageAdapter is the source of truth.

---

## 5) Device Registry + Multi-Identity

### 5.1 Registry DB
The device registry is **local-only** and MUST NOT contain plaintext private keys or space keys.

Schema (recommended):
```sql
CREATE TABLE IF NOT EXISTS device_identities (
  pubkey TEXT PRIMARY KEY,
  display_name TEXT,
  avatar_url TEXT,
  last_login_at INTEGER
);
```

### 5.2 Identity Switching
- Startup opens registry only.
- `login(pubkey, password)` unlocks that identity’s vault and then opens one or more space DBs.
- `logout()` closes all space DB handles, stops sync loops, and wipes decrypted keys from memory.

---

## 6) Vault (NIP-49 compatible, no keys on disk unencrypted)

### 6.1 Vault Contents
Vault stores:
- identity private key (secp256k1, BIP340 schnorr)
- per-space membership envelopes (encrypted space keys) for joined shared spaces
- optional device secrets (e.g., device signing key)
- optional local-only settings (non-replicated)

### 6.2 Vault Encryption Format
Default vault format SHOULD be NIP-49 compatible:
- password-derived key via scrypt (parameters to be chosen and versioned)
- AEAD encryption (xchacha20-poly1305)

Constraints:
- decrypted private keys MUST exist only in memory
- vault MUST support rotation (change password) without changing pubkey

### 6.3 Vault API (core)
Core depends only on this interface; storage format is an implementation detail.

```ts
export interface Vault {
  create(password: string): Promise<void>;
  unlock(password: string): Promise<UnlockedSession>;
  lock(): void;

  getPublicKey(): Promise<string>;

  encryptFor(pubKey: string, bytes: Uint8Array): Promise<Uint8Array>;
  decrypt(bytes: Uint8Array): Promise<Uint8Array>;

  sign(bytes: Uint8Array): Promise<Uint8Array>;
  verify(pubKey: string, bytes: Uint8Array, sig: Uint8Array): Promise<boolean>;
}
```

---

## 7) Cryptography

### 7.1 Identities and Signatures
- Identity keys are secp256k1.
- Signatures for LSYNC/1 messages use **BIP340 schnorr** over canonical message bytes.

### 7.2 Space Keys (Shared spaces)
- `spaceKey` is a random 32-byte symmetric key.
- `spaceKey` is distributed via envelope encryption (member pubkey).

### 7.3 Data Plane Encryption
For shared spaces, all data plane payloads MUST be encrypted with keys derived from `spaceKey`.

Recommended scheme:
- `encKey = HKDF-SHA256(spaceKey, salt = spaceId, info = "localsync:data-plane:v1")`
- AEAD: XChaCha20-Poly1305 with random 24-byte nonce
- ciphertext format:
  - `nonce(24) || ciphertext || tag`

Compression order:
- compress → encrypt (so ciphertext does not leak patterns via compression side-channels)

### 7.4 Control Plane Encryption (Nostr)
- Sensitive control-plane content SHOULD be encrypted using NIP-44.
- At minimum: invites/envelopes, non-public pointers, WebRTC signaling SDPs/candidates, and job payloads/results.

---

## 8) Spaces, Membership, and Policies

### 8.1 Space Types
- Personal: single identity’s devices; may omit encryption by default.
- Shared: must use space encryption and membership validation.

### 8.2 Membership Records
Shared spaces require:
- membership list (pubkey → role, status)
- membership envelopes (encSpaceKey per member)

These are sourced from the control plane and cached locally (in vault + optional DB tables).

### 8.3 Policy Engine (Validation-on-Receive)
Incoming changes MUST be validated before apply:
- message signature valid (LSYNC/1)
- sender is an active member (for shared spaces)
- operations allowed by policy for sender’s role

Policy shape (baseline):
```ts
export type Operation = "insert" | "update" | "delete" | "select";

export interface PolicyRule {
  table: string | "*";
  ops: Operation[];
  where?: string; // minimal expression language (see below)
}

export interface SpacePolicy {
  roles: Record<MemberRole, { allow: PolicyRule[] }>;
}
```

Where language (v0.1):
- simple comparisons and conjunctions:
  - `col = @me`
  - `col = "literal"`
  - `col != ...`
  - `AND`, parentheses
- The engine MUST substitute `@me` with sender pubkey.

Implementation note:
- For CR-SQLite changes, validation MUST be performed on a decoded operation representation (table, op type, pk, changed column names/values).

---

## 9) CR-SQLite Engine Integration (Core of v0.1)

This section defines how `Engine` is implemented using CR-SQLite.

### 9.1 Replicated Tables
App tables MUST be “CRRs” (conflict-free replicated relations) managed by CR-SQLite.

Initialization:
- the SDK SHOULD provide:
  - `space.replicateTable("tasks")` which calls the CR-SQLite helper to register/convert the table.
- migrations SHOULD use CR-SQLite-safe schema alteration helpers where required.

### 9.2 Checkpoints (Version Vectors)
Checkpoint is engine-specific but MUST be mergeable:

```ts
export type CrsqliteCheckpoint = {
  vv: Record<string /*siteId*/, number /*dbVersion*/>;
};
```

Definitions:
- `siteId` is the CR-SQLite replica/site identifier (stable per DB file).
- `dbVersion` is the latest integrated version for that site.

> [!IMPORTANT]
> **siteId Binding**: The CR-SQLite `siteId` MUST be deterministically derived from LocalSync's replicaId:
> ```ts
> // On first DB open, set siteId to match replicaId
> siteId = replicaId = base64url(sha256(deviceId + ":" + pubkey + ":" + spaceId)).slice(0, 16)
> ```
> This ensures checkpoint vector version (VV) entries are consistent across the protocol.

### 9.3 Changes Extraction
Engine MUST be able to return “changes since checkpoint”.

Normative behavior:
- `getChanges(spaceId, since, maxBytes)` returns a batch containing:
  - `from = since`
  - `to = currentCheckpoint()`
  - `bytes` = compact encoding of CR-SQLite change rows that satisfy:
    - for each `siteId`: `db_version > since.vv[siteId]` (or `> 0` if absent)
- `maxBytes` MUST be respected (truncate to a batch boundary).

Encoding:
- Use deterministic CBOR for change rows (engine-private schema versioned).
- The engine MUST include enough metadata to:
  - apply changes deterministically
  - support pre-apply validation (table + op + pk + columns)

### 9.4 Applying Changes
Engine MUST apply remote change rows in a single transaction:
- validate → apply → commit
- If validation fails, MUST NOT apply partial changes.

Apply strategy:
- insert remote change rows into CR-SQLite’s apply mechanism (extension-specific).
- compute new checkpoint and return in `ApplyResult`.

### 9.5 Snapshots
Snapshots are used for bootstrap:
- export: raw sqlite file bytes (or engine canonical bytes)
- import: replace DB state, then reopen for queries

For shared spaces:
- snapshots MUST be encrypted (see §7.3).

### 9.6 Watch Queries
The engine MUST implement reactive queries:
- In Node/Electron: via update hooks/polling or CR-SQLite change tracking.
- In Web: via the same mechanism; polling acceptable for v0.1 if hooks are not available.

Minimum correctness:
- watch fires immediately
- watch fires after local commit
- watch fires after remote apply

### 9.7 Watch Options (Extended)
For better UX, implementations SHOULD support extended watch options:

```ts
export interface WatchOptions {
  debounceMs?: number;   // batch rapid changes, default: 0
  limit?: number;        // pagination
  cursor?: string;       // pagination cursor
  skipInitial?: boolean; // skip first fire
}
```

---

## 9A) Offline Queue (Write-Ahead Log)

Writes made while offline MUST be durably queued:

### 9A.1 Queue Schema
```sql
CREATE TABLE IF NOT EXISTS _ls_outbound_queue (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  db_version INTEGER NOT NULL,
  space_id TEXT NOT NULL,
  operation TEXT NOT NULL, -- 'insert'|'update'|'delete'
  table_name TEXT NOT NULL,
  row_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  sent_at INTEGER,         -- NULL until transmitted
  acked_at INTEGER         -- NULL until ACKed
);
```

### 9A.2 Queue Processing
- On local write: enqueue change
- On sync start: replay unsent queue items
- On ACK: mark as acked
- Periodically: prune acked entries (>24h old)

### 9A.3 Queue Size Limits
- Warn if queue exceeds 10MB
- Consider pausing local writes if queue exceeds 50MB (configurable)

## 10) LSYNC/1 Data Plane (WebRTC)

### 10.1 Channel
WebRTC data channel provides an ordered, reliable byte stream for LSYNC/1 framing.

### 10.2 Framing
LSYNC/1 messages are binary:
- `header` (fixed fields) + `payload` (CBOR)
- signature over canonical bytes

Recommendation:
- deterministic CBOR encoding for `{v,type,appId,spaceId,from,deviceId,ts,payload}`
- `sig` is separate field appended to the frame

### 10.3 Handshake
Flow:
1) A → B: `HELLO`
2) B → A: `WELCOME`
3) choose `delta` or `bootstrap`

### 10.4 Delta Sync
1) requester sends `REQUEST_CHANGES { since, maxBytes }`
2) responder streams `CHANGES` messages until caught up
3) requester replies with `ACK` per batch

### 10.5 Snapshot Bootstrap
1) requester sends `REQUEST_SNAPSHOT`
2) responder sends `SNAPSHOT_META`
3) responder streams `SNAPSHOT_CHUNK` frames
4) requester verifies chunk hashes and final snapshot hash
5) requester sends `SNAPSHOT_DONE`
6) switch to delta sync for catch-up

### 10.6 Chunking + Backpressure
- receiver advertises `maxChunkBytes` in HELLO
- sender MUST keep message frames under that limit
- sender SHOULD use a sliding window (e.g., 4–16 in-flight) and adapt on RTT

### 10.7 Integrity
- Every batch/chunk MUST include sha256 hash (plaintext or ciphertext; choose and document).
- Snapshot hash verification is required before import.

---

## 11) Nostr Control Plane (Official Adapter)

### 11.1 Relay Limits (NIP-11)
Control plane implementation MUST:
- fetch relay info doc
- enforce `max_message_length` when published
- if absent, assume default `4096` bytes (serialized event JSON)

### 11.2 Space Topic Tagging (Privacy)
To avoid tagging raw spaceIds:
- `spaceTopic = base64url(sha256(appId + ":" + spaceId))`
- add tag: `["t", "ls-space:" + spaceTopic]`

All control plane events SHOULD also include:
- `["t", "localsync"]`
- `["t", "ls:" + appId]`

### 11.3 Event Kinds (Suggested)
Suggested kind registry (parameterized replaceable where applicable):
- `30081` PEER_ANNOUNCE (replaceable, `d=peer:<spaceTopic>:<deviceId>`)
- `30082` WANT_CHANGES (ephemeral-ish, `d=want:<spaceTopic>:<reqId>`)
- `30083` HAVE_CHANGES (ephemeral-ish, `d=have:<spaceTopic>:<reqId>:<deviceId>`)
- `30089` RTC_SIGNAL (ephemeral-ish, `d=rtc:<spaceTopic>:<sessionId>`)
- `30085` INVITE / MEMBERSHIP_ENVELOPE (regular, `p=<memberPubKey>`)
- `30086` MIGRATION_EVENT (regular, signed by app admin)
- `30084` POINTER (regular or replaceable by `d=ptr:<spaceTopic>:<hash>`)

### 11.4 Presence (PEER_ANNOUNCE)
Content (plaintext JSON, or encrypted if desired):
```ts
type PeerAnnounce = {
  appId: string;
  spaceId: string;    // MAY be omitted if using spaceTopic only
  from: string;       // pubkey
  deviceId: string;
  ts: number;

  transports: {
    webrtc: {
      enabled: boolean;
    };
  };
};
```

Publishing strategy:
- refresh periodically (e.g., every 30s)
- consumers treat presence as stale after 2–3 refresh intervals

### 11.5 WebRTC Signaling (RTC_SIGNAL)
Signaling payload MUST be NIP-44 encrypted.

```ts
type RtcSignal =
  | { type: "offer"; sessionId: string; sdp: string }
  | { type: "answer"; sessionId: string; sdp: string }
  | { type: "ice"; sessionId: string; candidate: any };
```

Routing:
- MUST include `["p", recipientPubKey]` for direct delivery filters.
- MUST include `ls-space` topic tag so space-scoped listeners can ignore non-space traffic.

### 11.6 WANT_CHANGES / HAVE_CHANGES
These are hints to reduce unnecessary WebRTC sessions.

Payload SHOULD be small; it MAY include:
- a compact checkpoint digest
- a boolean “I likely have newer data” hint

The authoritative comparison occurs in the LSYNC/1 data-plane handshake.

### 11.7 Invites / Membership Envelopes
Invites MUST be NIP-44 encrypted to the recipient.

Envelope content:
```ts
type SpaceInviteEnvelope = {
  spaceId: string;
  issuedAt: number;
  issuedBy: string;
  memberPubKey: string;
  role: "owner" | "admin" | "member" | "reader";
  encSpaceKey: Uint8Array; // encrypted to memberPubKey
  policy?: SpacePolicy;
  sig: Uint8Array; // signature by issuedBy over canonical envelope bytes
};
```

Recipient behavior:
- verify `sig`
- store `encSpaceKey` in vault
- optionally write membership state into local DB tables

---

## 12) WebRTC Transport (Official)

### 12.1 BYO TURN
Transport MUST accept user-provided ICE servers:
```ts
export interface WebRtcTransportConfig {
  iceServers?: RTCIceServer[];
  iceTransportPolicy?: RTCIceTransportPolicy;
}
```

Default:
- STUN-only (public) MAY be used, but MUST be configurable and documented.

### 12.2 Connection Strategy
- direct connect using offers/answers over Nostr control plane
- restart ICE on disconnect where possible
- apply backoff to avoid relay spam (control plane)

---

## 13) Blobs / Files

### 13.1 Local Blob Store (v0.1 required)
- blobs are content-addressed: `blobId = sha256(bytes)`
- store at: `<space>/blobs/<blobId>`
- keep metadata in `_ls_blobs` table

### 13.2 Encryption
Shared spaces:
- blobs MUST be encrypted with `spaceKey`-derived keys (similar to §7.3) unless explicitly public.

### 13.3 Remote Locations (Optional)
- pointer records in control plane can advertise remote locations (NIP-96, S3, Drive).
- v0.1 may ship local-only and still conform, provided pointers are optional.

---

## 14) Migrations (CR-SQLite + App Admin)

### 14.1 Two migration layers
1) **LocalSync internal tables** (`_ls_*`) and CR-SQLite metadata.
2) **App schema** tables (developer-authored).

### 14.2 Signed Migration Events (Optional)
- apps MAY distribute migrations via control plane
- migrations MUST be signed by `appAdminPubKey`
- engines store applied migrations in `_ls_migrations`

### 14.3 CR-SQLite-safe schema changes
Where CR-SQLite requires special handling, the engine MUST expose helpers to:
- add columns
- rebuild replication metadata if needed

---

## 15) Error Handling & Edge Cases

### 15.1 Offline / Nobody online
- device continues locally
- bootstrap requires at least one peer online (unless optional snapshot storage is configured)

### 15.2 Partial connectivity
- WebRTC might fail due to NAT; surface actionable error (recommend TURN)
- control plane must back off on repeated failures to publish signaling messages

### 15.3 Replay / Dedup
- data plane messages are signed; receiver MUST dedupe by `(from, deviceId, nonce/batchId)` to avoid re-applying.
- engine-level dedupe is still required (CR-SQLite should be idempotent for applied changesets).

### 15.4 Key rotation
- removing member rotates `spaceKey`
- new writes use new key immediately
- old data MAY be lazily re-encrypted (v0.2+)

### 15.5 Rate Limiting (Abuse Prevention)
Implementations MUST protect against malicious peers:

```ts
export interface RateLimitConfig {
  maxMessagesPerSecond: number;  // default: 100
  maxBytesPerSecond: number;     // default: 1MB
  maxPendingChanges: number;     // default: 1000
  banDurationMs: number;         // default: 60000
}
```

Behavior:
- Track bytes/messages per peer per time window
- Temporarily ban peers exceeding limits
- Send `SLOW_DOWN { delayMs }` backpressure signal when overwhelmed

### 15.6 Retry Strategy + Circuit Breaker
All transport and sync operations SHOULD implement retry with backoff:

```ts
export interface RetryConfig {
  maxRetries: number;          // default: 5
  initialDelayMs: number;      // default: 1000
  maxDelayMs: number;          // default: 30000
  backoffMultiplier: number;   // default: 2
  jitterFactor: number;        // default: 0.1
}

export interface CircuitBreakerConfig {
  failureThreshold: number;    // failures before opening
  resetTimeoutMs: number;      // time before retry
  halfOpenMaxAttempts: number; // attempts in half-open state
}
```

### 15.7 Error Types
LocalSync defines a consistent error hierarchy:

```ts
export class LocalSyncError extends Error {
  readonly code: string;
  readonly recoverable: boolean;
}

export class AuthError extends LocalSyncError {}
// codes: VAULT_LOCKED, INVALID_PASSWORD, IDENTITY_NOT_FOUND

export class ValidationError extends LocalSyncError {}
// codes: INVALID_SIGNATURE, POLICY_VIOLATION, MEMBER_NOT_FOUND

export class SyncError extends LocalSyncError {}
// codes: PEER_UNREACHABLE, HANDSHAKE_FAILED, CHECKPOINT_DIVERGED

export class StorageError extends LocalSyncError {}
// codes: QUOTA_EXCEEDED, OPFS_UNAVAILABLE, CORRUPTION_DETECTED
```

---

## 16) Testing Plan (v0.1)

### 16.1 Conformance suites
- replica convergence (2–5 peers)
- bootstrap correctness (snapshot + delta catch-up)
- policy enforcement (invalid write rejected)
- transport resilience (drop signaling messages; resume)
- blob lazy loading (metadata without blob; fetch on demand)

### 16.2 Test harness
- Node-based simulator for N peers (no UI)
- deterministic time + seeded RNG for reproducible fuzz runs

---

## 17) Open Items (Need concrete follow-up)

These should be resolved during implementation kickoff:
1. **CR-SQLite API exacts**: confirm the canonical “get changes since vv” query and “apply changes” mechanism and lock the engine-private CBOR schema version.
2. **Web SQLite+CR-SQLite packaging**: choose the exact SQLite WASM distribution strategy (single-thread fallback vs worker-thread build when COOP/COEP is present).
3. **Policy expression language**: finalize minimal grammar + evaluator (or restrict to pre-defined predicates for v0.1).
4. **Nostr kind scheme**: finalize event kinds + tags in a small public registry doc so other implementations can interop.
5. **TURN guidance**: publish a short “how to bring your own TURN” doc with example configs.

