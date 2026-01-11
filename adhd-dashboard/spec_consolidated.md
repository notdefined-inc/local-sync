# LocalSync SDK + Protocol Spec (Consolidated v0.1.4)

Status: Draft  
Sources: `spec.md` (v0.1), `spec_1.1.md` (v0.1.1), `spec_1.2.md` (v0.1.2), architectural review addenda

This document consolidates the base spec and addenda into a single implementable reference.

---

## 0) Conventions

### 0.1 RFC-2119 Keywords
The keywords **MUST**, **SHOULD**, **MAY** are to be interpreted as described in RFC 2119.

### 0.2 Scope
LocalSync is a local-first replication SDK and protocol for:
- Personal, single-user multi-device sync (Option 1).
- Shared “spaces/workspaces” with cryptographic access control and validation-on-receive (Option 2).

LocalSync is designed so app developers do not need to run their own backend to get reliable sync.

### 0.3 Document Layout
- **Data plane**: large payload transfer (changesets, snapshots, blobs) via P2P/relay channels.
- **Control plane**: small coordination (presence, “who has changes?”, invites/envelopes, migrations, pointers) via Nostr.

---

## 1) Goals and Non‑Goals

### 1.1 Goals
1. **No required backend** for app developers:
   - Works from a static site.
   - Data persists locally (OPFS on web; native FS on desktop/mobile).
2. **Local-first UX**:
   - Reads/writes are always local; sync is opportunistic.
3. **Delta replication**:
   - Sync changesets, not full DB files on every sync.
4. **Bootstrap**:
   - New device hydrates from snapshot + follow-up deltas.
5. **First-class shared spaces**:
   - Spaces have membership + permissions + cryptographic access control.
6. **Pluggable transports and storage**:
   - WebRTC, relay/WebSocket, etc.
   - File/blob adapters: local-only, NIP-96, S3, Drive, etc.
7. **Security**:
   - Identity keys live locally in an encrypted vault.
   - Shared data protected via cryptographic access control.
   - Invalid/malicious writes do not propagate (validate on receive).

### 1.2 Non‑Goals (v0.x)
- Global public indexing (“Explore/Trending”).
- Guaranteed always-online availability without a seeding/backup provider.
- Preventing a user from tampering with their own local DB (impossible); we prevent *propagation* and protect *confidentiality*.

---

## 2) Core Concepts

### 2.1 Entities
- **Device**: a runtime instance (browser profile, desktop install, mobile app).
- **Identity**: public/private keypair used for signatures and secure key exchange.
- **Vault**: encrypted container holding identity private keys and sensitive secrets.
- **Replica**: a local database instance (per identity + per space).
- **Space**: logical shared dataset boundary with membership and permissions.
- **Collection**: table-like logical dataset (maps to SQLite tables).
- **Changeset / Changes batch**: compact representation of mutations since a checkpoint.
- **Snapshot**: full state checkpoint used for bootstrap.
- **Blob**: large binary objects (attachments, images, etc.).

### 2.2 Planes

#### Data plane (large payloads)
Moves changesets, snapshots, blobs:
- WebRTC transport (preferred).
- Relay transport fallback (WebSocket-based channel).
- Optional TURN and/or always-on seeding service (not required, but supported).

#### Control plane (Nostr)
Carries small, frequent coordination messages:
- peer discovery / presence
- “who has changes newer than checkpoint X?”
- invitations / membership envelopes
- schema & migration events
- pointers (URLs/hashes) to blobs/snapshots stored elsewhere

Control-plane messages SHOULD fit within relay constraints and MUST adapt to relay capabilities.

---

## 3) Storage Topology (Multi-Identity + Per-Space DBs)

LocalSync MUST support multiple identities on the same device without deleting data.

### 3.1 Web OPFS Layout (Reference)
The following layout is a reference for web (OPFS) implementations:

```
/<appId>/device/registry.sqlite
/<appId>/identities/<pubkey>/vault.enc
/<appId>/identities/<pubkey>/spaces/<spaceId>/db.sqlite
/<appId>/identities/<pubkey>/spaces/<spaceId>/blobs/<blobId>
```

Notes:
- Device registry is global per `appId`.
- Identity vault is per identity `pubkey`.
- Data is stored per `spaceId` under the identity.

### 3.1.1 StorageAdapter Interface
Implementations MUST provide a storage adapter for path resolution:

```ts
export interface StorageAdapter {
  ensureAppRoot(appId: string): Promise<void>;
  deviceRegistryPath(appId: string): Promise<string>;
  vaultPath(appId: string, pubkey: string): Promise<string>;
  spaceDbPath(appId: string, pubkey: string, spaceId: string): Promise<string>;
  spaceBlobsDir(appId: string, pubkey: string, spaceId: string): Promise<string>;
}
```

### 3.2 Device Registry (Local-only)

Purpose:
- list identities previously used on device
- enable fast account switching

Constraints:
- MUST NOT store plaintext private keys or space keys.
- MAY store encrypted vault blobs or references to `vault.enc`.

Recommended schema:
```
device_identities(
  pubkey PRIMARY KEY,
  display_name,
  avatar_url,
  last_login_at
)
```

### 3.3 Vault Store (Per identity)
`vault.enc` contains:
- identity private key material (NIP-49 compatible or equivalent)
- space key envelopes for all joined spaces
- device secrets (optional)
- user settings that must not be replicated (optional)

Vault MUST be encrypted with a password-derived key (KDF + AEAD).  
Decrypted keys MUST exist only in memory for the session.

### 3.4 Space Databases (Per identity, per space)
Each space is its own replication domain:
- independent checkpoints
- independent snapshots
- independent compaction policies
- independent membership and encryption keys (for shared spaces)

Personal spaces MAY omit crypto-RLS by default.  
Shared spaces MUST use spaceKey-based confidentiality and membership envelopes.

### 3.5 Login/Logout Semantics
Startup:
- open `registry.sqlite` only

`login(pubkey, password)`:
- unlock `vault.enc`
- open requested space DB(s)
- start sync pipelines for those spaces

Logout:
- close all opened space DB handles
- lock vault and wipe decrypted keys from memory
- keep local files intact

---

## 4) Architecture Modules

Suggested module layout:
- `core/`: DB engine wrapper, transactions, query helpers
- `storage/`: OPFS persistence + quota/persistence helpers
- `sync/`: protocol, peer manager, replication, bootstrap, chunking
- `auth/`: vault, identity, session unlock, key rotation hooks
- `crypto/`: signing, encryption, key envelopes, group keys
- `files/`: blob adapters + lazy fetch
- `rules/`: validation-on-receive + permission rules engine
- `ui/`: optional admin/dashboard components (later)

---

## 5) Engine Interface

LocalSync supports multiple engines as long as they implement this interface.

### 5.1 Required Types (Protocol-visible)
Checkpoint MUST be mergeable and support multi-writer replication.

```ts
export type Checkpoint = {
  vv: Record<string /*replicaId*/, number /*counter*/>;
};
```

LocalSync MUST treat checkpoints as opaque except for:
- merging (engine-provided or pure merge rules)
- comparison (“do I have everything you have?”) (engine-provided)

### 5.2 Engine API

> [!IMPORTANT]
> **5.1.1 replicaId Generation** — Each replica MUST have a unique, deterministic `replicaId`:
> ```ts
> replicaId = base64url(sha256(deviceId + ":" + identityPubKey + ":" + spaceId))
> ```
> - `replicaId` MUST be stable across app restarts on the same device/identity/space.
> - `replicaId` MUST NOT collide across different devices, identities, or spaces.
> - `replicaId` SHOULD be generated once and stored locally.


```ts
export interface Engine {
  open(params: EngineOpenParams): Promise<void>;
  close(): Promise<void>;

  exec(sql: string, params?: any[]): Promise<QueryResult>;
  run(sql: string, params?: any[]): Promise<void>;

  transaction<T>(fn: () => Promise<T>): Promise<T>;

  // reactive queries
  watch(
    query: string,
    params: any[] | undefined,
    cb: (rows: any[]) => void
  ): Unsubscribe;

  // replication primitives
  getCheckpoint(spaceId: string): Promise<Checkpoint>;
  getChanges(spaceId: string, since: Checkpoint, maxBytes?: number): Promise<ChangesBatch>;
  applyChanges(spaceId: string, changes: ChangesBatch): Promise<ApplyResult>;

  // snapshot primitives
  exportSnapshot(spaceId: string): Promise<Uint8Array>;
  importSnapshot(spaceId: string, snapshot: Uint8Array): Promise<void>;

  // optional: compaction / pruning
  compact(spaceId: string, policy?: CompactPolicy): Promise<CompactResult>;
}

// CompactPolicy definition
export interface CompactPolicy {
  /** Number of recent checkpoints to retain. Default: 100 */
  retainCheckpoints?: number;
  /** Prune changes older than this age in milliseconds */
  maxAgeMs?: number;
  /** Trigger compaction when change log exceeds this size in bytes */
  maxSizeBytes?: number;
  /** Strategy for pruning: 'aggressive' drops more history, 'conservative' retains more */
  strategy?: 'aggressive' | 'conservative' | 'balanced';
}

export interface CompactResult {
  prunedChanges: number;
  bytesReclaimed: number;
  newCheckpoint: Checkpoint;
  durationMs: number;
}
```

### 5.3 Watch Semantics
`watch()` MUST:
- fire immediately with current results
- fire after local commits
- fire after applying remote changesets

Consistency:
- watch callbacks see committed state only.
- ordering:
  - local commit watchers fire before network send
  - remote apply watchers fire after successful validation + apply

#### 5.3.1 Watch Options (Extended)
```ts
export interface WatchOptions {
  /** Debounce rapid changes; only fire callback after this many ms of quiet. Default: 0 (no debounce) */
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
```

Implementations SHOULD:
- Use `debounceMs` to prevent UI thrashing during bulk operations
- Support `limit` + `cursor` for large result sets to prevent memory exhaustion

### 5.4 Recommended Reference Engine (Web)
Reference implementation target:
- SQLite (WASM) persisted to OPFS
- merge-safe replication layer (e.g., CRDT SQLite / op-log with deterministic merge)

Note: the spec does not hard-code the engine; it only requires merge-safe changesets.

### 5.5 Storage: OPFS Persistence (Web)
Web storage requirements:
- MUST support random access reads/writes.
- MUST be crash-safe for commits (no torn writes after refresh/crash).
- MUST reopen existing DB on refresh.
- MUST attempt to request persistent storage:

```ts
await navigator.storage.persist?.();
```

See §3 for the reference OPFS layout.

#### 5.5.1 OPFS Fast Path vs Fallback (Web)
**Fast path** (requires COOP/COEP headers for best performance):
- OPFS + `FileSystemSyncAccessHandle` based VFS
- Use when `crossOriginIsolated === true`

**Fallback path** (GitHub Pages, static hosting without headers):
- OPFS async handles where possible
- Otherwise IDB-backed VFS

Runtime selection:
```ts
if (crossOriginIsolated && typeof FileSystemSyncAccessHandle !== 'undefined') {
  // Use fast path
} else {
  // Use fallback path
}
```

### 5.6 Conflict Resolution

When two replicas edit the same row offline, a deterministic merge strategy is required.

#### 5.6.1 Default Strategy: Last-Write-Wins (LWW)
```ts
export interface RowVersion {
  replicaId: string;
  counter: number;
  timestamp: number; // logical or wall-clock
}

// Default: higher timestamp wins; ties broken by replicaId lexicographic order
function lwwResolve<T>(local: T & RowVersion, remote: T & RowVersion): T {
  if (remote.timestamp > local.timestamp) return remote;
  if (remote.timestamp < local.timestamp) return local;
  return remote.replicaId > local.replicaId ? remote : local;
}
```

#### 5.6.2 Merge Granularity
Implementations SHOULD support:
- **Row-level merge**: entire row replaced (simpler, default)
- **Field-level merge**: individual fields merged (richer, opt-in)

#### 5.6.3 Custom Conflict Resolvers
For domain-specific logic, engines SHOULD support custom resolvers:
```ts
export interface ConflictResolver<T> {
  resolve(local: T, remote: T, metadata: ConflictMeta): T | 'local' | 'remote';
}

export interface ConflictMeta {
  table: string;
  primaryKey: any;
  localVersion: RowVersion;
  remoteVersion: RowVersion;
}

// Registration
engine.registerConflictResolver('tasks', customTaskResolver);
```

#### 5.6.4 Conflict Audit Log
For auditability, implementations SHOULD optionally log conflicts:
```ts
_ls_conflicts(id, table, pk, localJson, remoteJson, resolvedJson, resolvedAt)
```

---

## 6) Vault, Identity, Sessions

### 6.1 Identity
Each identity has:
- `pubKey`: stable identifier
- `privKey`: stored only in the Vault (encrypted at rest)

Each device also has:
- `deviceId`: stable identifier per device installation/profile
- optionally a device keypair for device-to-device authentication

### 6.2 Vault Interface
```ts
export interface Vault {
  create(password: string): Promise<void>;
  unlock(password: string): Promise<UnlockedSession>;
  lock(): void;

  getPublicKey(): Promise<string>;

  // key envelopes for shared spaces
  encryptFor(pubKey: string, bytes: Uint8Array): Promise<Uint8Array>;
  decrypt(bytes: Uint8Array): Promise<Uint8Array>;

  sign(bytes: Uint8Array): Promise<Uint8Array>;
  verify(pubKey: string, bytes: Uint8Array, sig: Uint8Array): Promise<boolean>;
}
```

Session requirements:
- A session exists only in memory after `vault.unlock()`.
- All outbound sync messages MUST be signed (data plane + sensitive control plane).

### 6.3 Vault Encryption Format (NIP-49 Compatible)
Default vault format:
- Password-derived key via **scrypt** (N=2^20, r=8, p=1 recommended)
- AEAD encryption: **XChaCha20-Poly1305**
- Vault MUST support password rotation without changing pubkey

### 6.4 Cryptographic Primitives

#### 6.4.1 Identity Keys
- Keys: **secp256k1**
- Signatures: **BIP340 Schnorr** over canonical message bytes

#### 6.4.2 Data Plane Encryption (Shared Spaces)
All data plane payloads for shared spaces MUST be encrypted:

```ts
// Key derivation
encKey = HKDF-SHA256(spaceKey, salt=spaceId, info="localsync:data-plane:v1")

// AEAD
cipher = XChaCha20-Poly1305
nonce = random(24 bytes)

// Ciphertext format
output = nonce(24) || ciphertext || tag(16)
```

#### 6.4.3 Compression Order
**Critical**: compress → encrypt (not encrypt → compress)
- Prevents compression side-channel attacks on ciphertext
- Achieves better compression ratios on plaintext

#### 6.4.4 Control Plane Encryption
- Sensitive content SHOULD use **NIP-44** encryption
- Required for: invites/envelopes, WebRTC signaling, job payloads

---

## 7) Spaces (Shared Workspaces)

### 7.1 Space Metadata
Each space has:
- `spaceId` (uuid)
- `spaceType`: `"personal" | "shared"`
- `ownerPubKey`
- `spaceKey` (symmetric; only for shared; stored encrypted per member)
- `policy` (permissions + validation rules)
- `members` (pubkeys + roles)

### 7.2 Roles (Minimal)
- `owner`: rotate keys, change policy, manage membership
- `admin`: manage membership (optional), post schema updates (optional)
- `member`: normal read/write within rules
- `reader`: read-only (optional)

### 7.3 Membership & Key Distribution (Crypto-RLS baseline)
For a shared space:
- database content is encrypted-at-rest per-space
- rows and blobs are encrypted using `spaceKey` (or derived keys)
- membership grants access to `spaceKey`
- `spaceKey` MUST be encrypted to each member’s public key (envelope encryption)
- envelopes are stored as Membership Envelope records/events (control plane)

```ts
export type MemberRole = "owner" | "admin" | "member" | "reader";

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
```

### 7.4 Key Rotation
On removing a member:
- generate new `spaceKey'`
- re-encrypt to remaining members
- (optional) re-encrypt existing rows over time (“lazy rotation”)

---

## 8) Permission Model: Validation-on-Receive + Confidentiality

LocalSync enforces security at two layers.

### 8.1 Confidentiality (Who can read?)
- Personal spaces: optional encryption (device-level)
- Shared spaces: required space encryption (crypto-RLS baseline)

### 8.2 Propagation Safety (Who can write?)
All incoming changesets MUST be:
1. signed by the sender identity
2. validated against the space policy before apply

If invalid, they MUST be dropped and MUST NOT be applied to local state.

Outgoing writes:
- library SHOULD block obvious invalid writes for UX
- library MUST NOT assume outgoing checks are security boundaries (user controls device)

### 8.3 Policy / Rules Engine (Option 2)

Policy is attached to a space and expresses:
- allowed tables/operations per role
- optional field constraints
- optional rate limits

Example:
```json
{
  "roles": {
    "member": {
      "allow": [
        { "table": "tasks", "ops": ["insert", "update", "delete"], "where": "assignee = @me" }
      ]
    },
    "reader": {
      "allow": [
        { "table": "*", "ops": ["select"] }
      ]
    }
  }
}
```

Enforcement:
- Outgoing writes SHOULD be checked client-side for UX.
- Incoming changesets MUST be validated before apply:
  - signature valid?
  - sender is a current member?
  - operation conforms to policy?
- If not valid: drop and optionally emit an audit event locally.

#### 8.3.1 Policy Where Language (v0.1)
The `where` clause supports a minimal expression language:

**Operators**:
- `col = @me` — column equals sender's pubkey
- `col = "literal"` — column equals literal string
- `col != value` — column not equals
- `AND` — conjunction
- Parentheses for grouping

**Built-in variables**:
- `@me` — sender's pubkey (substituted by engine)

**Examples**:
```
assignee = @me
status = "draft" AND author = @me
(visibility = "public") OR (author = @me)
```

---

## 9) Replication Protocol (LSYNC/1) — Data Plane

### 9.1 Message Framing
All data-plane messages are framed as:

```ts
export interface WireMessage<T> {
  v: "LSYNC/1";
  type: string;
  appId: string;
  spaceId: string;
  from: string;     // sender pubKey
  deviceId: string;
  ts: number;       // ms since epoch
  payload: T;
  sig: Uint8Array;  // signature over canonical bytes of header+payload
}
```

Canonicalization:
- A canonical encoding MUST be defined for signing/verifying.
- Recommendation (non-normative): deterministic CBOR encoding for the full header+payload.

### 9.2 Handshake
1) `HELLO`
```ts
export type Hello = {
  want: "delta" | "bootstrap";
  haveCheckpoint?: Checkpoint;
  supported: {
    maxChunkBytes: number;
    compression: ("none" | "zstd" | "gzip")[];
    encryption: ("none" | "space")[]; // "space" implies shared-space encryption
  };
};
```

2) `WELCOME`
```ts
export type Welcome = {
  peerCheckpoint?: Checkpoint;
  canServeSnapshot: boolean;
  snapshotHash?: string;
  snapshotBytes?: number;
  recommended: { mode: "delta" | "bootstrap" };
};
```

### 9.3 Delta Sync Flow
1. exchange checkpoints
2. compute missing ranges
3. transfer `CHANGES` in batches
4. ACK each batch

Messages:
- `REQUEST_CHANGES { since: Checkpoint, maxBytes }`
- `CHANGES { batchId, since, to, bytes, hash, compressed }`
- `ACK { batchId, applied: boolean, newCheckpoint }`

### 9.4 Bootstrap Sync Flow (Snapshot)
Use if:
- local DB missing/empty
- checkpoint divergence too large
- device explicitly requested bootstrap

Messages:
- `REQUEST_SNAPSHOT { wantHash?: string }`
- `SNAPSHOT_META { hash, bytes, chunkBytes }`
- `SNAPSHOT_CHUNK { idx, total, bytes, hash }`
- `SNAPSHOT_DONE { hash }`
- then switch to delta sync for catch-up

### 9.5 Chunking + Backpressure
Sender MUST:
- respect peer `maxChunkBytes`
- wait for ACK or use a window-based flow control

Receiver MUST:
- verify per-chunk hash
- support resume via `REQUEST_SNAPSHOT { wantHash }` or `REQUEST_CHANGES { since }`

### 9.6 Checkpoints
Checkpoint format is engine-specific but MUST be mergeable.

### 9.7 Data Plane Encryption (Shared spaces)
For shared spaces:
- changesets and snapshots transferred over the data plane MUST be encrypted with `spaceKey`-derived keys
- blobs MUST be encrypted unless explicitly public (see §13.4)

Transport encryption (e.g., WebRTC) does not remove the requirement for space-level encryption; the goal is end-to-end confidentiality across untrusted relays and peers.

### 9.8 Offline Queue (Write-Ahead Log)

Writes made while offline MUST be durably queued for later sync.

#### 9.8.1 Queue Requirements
- **Durability**: Queue MUST survive app crashes and restarts
- **Ordering**: Queue MUST preserve causal order (per-replica monotonic)
- **Idempotency**: Replaying queued writes MUST be safe (dedup by replicaId + counter)

#### 9.8.2 Queue Schema (Recommended)
```ts
_ls_outbound_queue(
  id PRIMARY KEY,
  replicaId,
  counter,
  spaceId,
  tableName,
  operation, // 'insert' | 'update' | 'delete'
  rowJson,
  createdAt,
  sentAt,    // NULL until sent
  ackedAt    // NULL until ACKed
)
```

#### 9.8.3 Queue Processing
```ts
export interface OfflineQueue {
  enqueue(change: LocalChange): Promise<void>;
  peek(limit?: number): Promise<QueuedChange[]>;
  markSent(ids: string[]): Promise<void>;
  markAcked(ids: string[]): Promise<void>;
  prune(): Promise<number>; // remove acked entries
}
```

#### 9.8.4 Queue Size Limits
- Implementations SHOULD warn when queue exceeds configurable threshold (e.g., 10MB)
- Implementations MAY pause local writes if queue is dangerously large

### 9.9 Rate Limiting + Abuse Prevention

To prevent abuse from malicious peers:

#### 9.9.1 Inbound Rate Limits
```ts
export interface RateLimitConfig {
  maxMessagesPerSecond: number;  // default: 100
  maxBytesPerSecond: number;     // default: 1MB
  maxPendingChanges: number;     // default: 1000
  banDurationMs: number;         // default: 60000 (1 min)
}
```

#### 9.9.2 Per-Peer Quotas
- Track bytes/messages received per peer per time window
- Temporarily ban peers exceeding limits
- Log abuse events for debugging

#### 9.9.3 Backpressure Signals
When overwhelmed, receiver SHOULD:
- Send `SLOW_DOWN { delayMs }` message
- Temporarily stop ACKing to signal sender to pause

---

## 10) Transport Adapters — Data Plane

LocalSync MUST not hard-code a single network.

### 10.1 Transport Interface
```ts
export interface Transport {
  start(): Promise<void>;
  stop(): Promise<void>;

  // peer discovery is transport-specific
  discoverPeers(spaceId: string): AsyncIterable<PeerInfo>;

  connect(peer: PeerInfo): Promise<Channel>;
}

export interface Channel {
  send(bytes: Uint8Array): Promise<void>;
  onMessage(cb: (bytes: Uint8Array) => void): Unsubscribe;
  close(): Promise<void>;
}
```

### 10.2 Reference Adapters (Ship as Packages)
- `transport-webrtc`: fast P2P datachannel
- `transport-relay`: websocket relay transport (reliable fallback)

Rule: the LSYNC/1 protocol is the same; only the `Channel` differs.

### 10.3 WebRTC Signaling Flow

WebRTC requires signaling to exchange SDP offers/answers and ICE candidates.

#### 10.3.1 Signaling via Nostr Control Plane
WebRTC signaling SHOULD use the Nostr control plane:

```ts
// Nostr event kinds for WebRTC signaling
30089: WEBRTC_OFFER   // SDP offer, p-tagged to recipient
30090: WEBRTC_ANSWER  // SDP answer, p-tagged to offerer
30091: WEBRTC_ICE     // ICE candidate, p-tagged to peer
```

#### 10.3.2 Signaling Message Format
```ts
export interface WebRTCSignal {
  type: 'offer' | 'answer' | 'ice';
  spaceId: string;           // which space this connection is for
  sessionId: string;         // unique per-connection attempt
  sdp?: string;              // for offer/answer
  candidate?: RTCIceCandidate; // for ice
}
```

#### 10.3.3 Connection Flow
1. Peer A posts `WEBRTC_OFFER` event, `p`-tagged to Peer B
2. Peer B subscribes to offers, receives and processes
3. Peer B posts `WEBRTC_ANSWER` event, `p`-tagged to Peer A
4. Both peers exchange `WEBRTC_ICE` candidates as discovered
5. Once connected, switch to data channel for LSYNC/1 protocol

#### 10.3.4 TURN Fallback
For restrictive NATs:
- Implementations SHOULD support configurable TURN servers
- TURN credentials MAY be distributed via control plane or app config

### 10.4 Retry Strategy + Circuit Breaker

All transport operations SHOULD implement retry with backoff:

```ts
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
```

Behavior:
- On transient failures (network timeout, connection reset): retry with exponential backoff
- On persistent failures: open circuit breaker, stop retrying
- On success after circuit open: close circuit, resume normal operation

---

## 11) Control Plane (Nostr)

Control plane carries small coordination messages and pointers.

### 11.1 Relay Capability Discovery (NIP-11)
When using any Nostr relay:
- client MUST fetch relay info doc and read `max_message_length` where available
- client MUST keep control-plane payloads under `max_message_length` minus framing overhead
- if relay does not publish limits, client MUST assume a conservative default (implementation-defined)

Recommendation (non-normative):
- default `max_message_length = 4096` bytes when unknown
- enforce limit against the *serialized event JSON* length

### 11.2 Logical Control Plane Message Types

#### PEER_ANNOUNCE
Announces device online + reachable endpoints:
- `appId`, `spaceId`, `from(pubkey)`, `deviceId`
- supported transports: webrtc/relay
- optional “small” webrtc offer metadata (or exchange later)

**Presence Timing**:
- Publishers SHOULD refresh every **30 seconds**
- Consumers SHOULD treat presence as stale after **2-3 refresh intervals** (60-90s)
- Implementations MAY use parameterized replaceable events to avoid relay growth

#### WANT_CHANGES
“I have checkpoint X. Who has anything newer?”
- `checkpoint`
- preferred data-plane transport
- `maxBatchBytes`

#### HAVE_CHANGES
“I can serve from checkpoint X to Y”
- `peerCheckpoint`
- `canServeSnapshot` (bool)
- `snapshotHash` (optional)

#### POINTER
A generic pointer record for big content:
- `kind: "snapshot" | "blob"`
- `hash (sha256)`
- `locations[]` (e.g., NIP-96 URL, Drive URL, etc.)
- `encryption: "none" | "space"`

#### INVITES / ENVELOPES (Shared spaces)
Membership envelopes and invitations are control-plane messages (see §7.3).

#### MIGRATIONS (Signed)
Schema/migration events are control-plane messages (see §12).

### 11.3 Control Plane Encryption
- Control-plane payloads MAY be encrypted using NIP-44 format.
- Sensitive payloads (invites/envelopes, non-public pointers for shared spaces, job payloads/results) SHOULD be encrypted.

### 11.4 Control Plane ↔ Data Plane Relationship
- Control plane SHOULD be used to find peers and decide *whether* a data-plane session is needed.
- LSYNC/1 handshake runs over the data plane channel and is authoritative for transfer parameters.

Recommendation (non-normative):
- Treat WANT_CHANGES/HAVE_CHANGES as “preflight”; they can be coarse (no strict guarantees).
- Treat LSYNC/1 HELLO/WELCOME as the exact negotiation for the actual transfer.

### 11.5 Nostr Event Mapping (Recommended)

This section provides a concrete, interoperable mapping of logical control-plane messages to Nostr events.

#### 11.5.1 Tags (Indexing + Routing)
Control-plane events SHOULD include:
- `["t", "localsync"]` (protocol marker)
- `["t", "ls:" + appId]` (app marker)

To target a specific space without revealing the raw `spaceId` in tags, implementations SHOULD also include:
- `spaceTopic = base64url(sha256(appId + ":" + spaceId))`
- `["t", "ls-space:" + spaceTopic]`

Member-targeted messages (invites/envelopes) SHOULD include:
- `["p", memberPubKey]` (recipient routing/filtering)

#### 11.5.2 Kinds (Suggested Registry)
Implementations MAY use any kind scheme, but the following is a suggested registry:
- `30081` PEER_ANNOUNCE (parameterized replaceable)
- `30082` WANT_CHANGES (ephemeral or short-retention)
- `30083` HAVE_CHANGES (ephemeral or short-retention)
- `30084` POINTER (regular or parameterized replaceable by `hash`)
- `30085` INVITE / MEMBERSHIP_ENVELOPE (regular; `p`-tagged)
- `30086` MIGRATION_EVENT (regular; signed by app admin)
- `30087` JOB_REQUEST (regular; encrypted)
- `30088` JOB_RESPONSE (regular; encrypted)

Recommendation (non-normative):
- Use parameterized replaceable events (NIP-78; kinds `30000–39999` + `["d", ...]`) for presence-style state to avoid unbounded relay growth.

#### 11.5.3 Content Encoding
Control-plane content SHOULD be:
- plaintext JSON for non-sensitive messages, or
- NIP-44 ciphertext for sensitive messages (invites/envelopes, non-public pointers, jobs)

Events carrying ciphertext SHOULD still be signed at the Nostr event layer.

---

## 12) Schema & Migrations (App Admin)

### 12.1 Migration Source of Truth
Migrations are authored by app developer and shipped:
- either baked into the app build, or
- distributed as signed migration events by `appAdminPubKey`

### 12.2 Signed Migration Event
```ts
export interface MigrationEvent {
  appId: string;
  version: number;
  issuedAt: number;
  sql: string[];     // ordered statements
  hash: string;      // sha256 of canonical representation
  sig: Uint8Array;   // signed by appAdminPubKey
}
```

### 12.3 Migration Rules
- must be idempotent
- must be forward-only (no down migrations required)
- engine MUST store `applied_migrations(version, hash, ts)` locally

---

## 13) Blobs / Files (Attachments)

### 13.1 Blob Addressing
All blobs are content-addressed:
- `blobId = sha256(bytes)` (hex/base64)
- metadata stored in SQLite

```ts
export interface BlobMeta {
  blobId: string;
  bytes: number;
  mime: string;
  createdAt: number;
  locations: { type: string; url?: string }[];
  encrypted: boolean;
}
```

### 13.2 Blob Store Adapter
```ts
export interface BlobStore {
  put(blob: Uint8Array, meta: { mime: string }, opts?: PutOpts): Promise<BlobMeta>;
  get(blobId: string): Promise<Uint8Array>;
  has(blobId: string): Promise<boolean>;
  del?(blobId: string): Promise<void>;
}
```

### 13.3 Lazy Loading (Required)
- app data references `blobId`
- UI fetches blob on-demand
- `files.get(blobId)` triggers local lookup, then remote, then peer

### 13.4 Encryption
- Shared spaces: blobs MUST be encrypted with keys derived from `spaceKey` unless explicitly public.
- Personal spaces: optional encryption.

---

## 14) Public API (Developer Experience)

### 14.1 Top-level
```ts
import { LocalSync } from "localsync";

const client = await LocalSync.open({
  appId: "myapp",
  vault: { provider: "default" },
  engine: { provider: "sqlite-opfs" },
  transports: [
    { provider: "webrtc" },
    { provider: "relay" }
  ],
  blobStores: [
    { provider: "local" },
    { provider: "nip96", endpoint: "..." }
  ],
  controlPlane: { provider: "nostr" }
});
```

### 14.2 Identities + Login
Spaces are first-class so apps can scale from Notion to Slack-like spaces without changing mental model:
- `client.identities.list()`
- `client.login(pubkey, password)`
- `client.logout()`

### 14.3 Spaces
- `client.spaces.list()`
- `client.spaces.open(spaceId)`
- `client.spaces.createPersonal()`
- `client.spaces.createShared()`
- `space.invite({ memberPubKey, role })`

### 14.4 Collections / Queries
```ts
await space.exec(`CREATE TABLE IF NOT EXISTS tasks (...)`);
await space.run(`INSERT INTO tasks(id, title) VALUES(?, ?)`, [id, "Ship v1"]);

const unsub = space.watch(
  `SELECT * FROM tasks ORDER BY created_at DESC`,
  [],
  (rows) => render(rows)
);
```

### 14.5 Sync Control
- `await space.sync.start()`
- `await space.sync.stop()`
- `await space.sync.once()`
- `await space.sync.exportSnapshot()`
- `await space.sync.importSnapshot(bytes)`

### 14.6 Files
```ts
const meta = await space.files.put(fileBytes, { mime: "image/jpeg" });
await space.run(`UPDATE notes SET cover_blob=? WHERE id=?`, [meta.blobId, noteId]);
const bytes = await space.files.get(meta.blobId);
```

### 14.7 Error Types

LocalSync defines a consistent error hierarchy for implementations:

```ts
// Base error class
export class LocalSyncError extends Error {
  readonly code: string;
  readonly recoverable: boolean;
  readonly context?: Record<string, unknown>;
}

// Authentication / Identity errors
export class AuthError extends LocalSyncError {
  // codes: 'VAULT_LOCKED', 'INVALID_PASSWORD', 'IDENTITY_NOT_FOUND'
}

// Validation errors (incoming changesets)
export class ValidationError extends LocalSyncError {
  // codes: 'INVALID_SIGNATURE', 'POLICY_VIOLATION', 'MEMBER_NOT_FOUND'
  readonly changeset?: ChangesBatch;
  readonly sender?: string;
}

// Sync / Replication errors
export class SyncError extends LocalSyncError {
  // codes: 'PEER_UNREACHABLE', 'HANDSHAKE_FAILED', 'CHECKPOINT_DIVERGED'
  readonly peerId?: string;
}

// Storage errors
export class StorageError extends LocalSyncError {
  // codes: 'QUOTA_EXCEEDED', 'OPFS_UNAVAILABLE', 'CORRUPTION_DETECTED'
}

// Conflict errors (when custom resolver needed)
export class ConflictError extends LocalSyncError {
  // codes: 'UNRESOLVED_CONFLICT'
  readonly local: unknown;
  readonly remote: unknown;
  readonly table: string;
}
```

#### 14.7.1 Error Handling Best Practices
- **Recoverable errors** (e.g., `PEER_UNREACHABLE`): Retry with backoff
- **Non-recoverable errors** (e.g., `CORRUPTION_DETECTED`): Notify user, require intervention
- **Validation errors**: Log for audit, do not propagate to user unless debugging

---

## 15) Availability Model (No required server)

### 15.1 “Nobody online” problem
If no peer is online and no snapshot exists remotely:
- a new device cannot bootstrap
- existing devices still work locally

### 15.2 Optional Services (Not required)
- seed/always-on peer that keeps encrypted snapshot + seeds deltas
- backup store adapters (Drive/iCloud/S3/NIP-96) for bootstrap reliability

LocalSync MUST treat these as optional plugins.

---

## 16) Push Gateway (Optional)

Problem: mobile OSes may not keep apps alive; P2P cannot wake devices reliably.

Solution: optional Push Gateway service:
- subscribes to control-plane notifications (encrypted pointers or tags)
- sends push to APNs/FCM/UnifiedPush to wake device
- payload MUST NOT contain sensitive data; only “wake” + pointer id

Core replication MUST NOT depend on push to function.

---

## 17) Service Nodes / Jobs (Optional Trusted Compute)

### 17.1 Job Model
A Job is an encrypted request posted to the control plane:
- examples: “charge customer”, “generate AI summary”, “send email”
- secrets are held by service node operator, not by clients

Job envelope:
- `jobId`, `appId`, `spaceId`, `requesterPubKey`, `createdAt`
- `jobType`
- encrypted payload
- signature

### 17.2 Job Response
Service node replies with:
- `jobId`
- `status: ok | error`
- encrypted result
- signature

### 17.3 Trust Model
- service nodes are opt-in by app developers/users
- clients MUST verify service node identity (pubkey allowlist or signed attestation)

---

## 18) Threat Model + Security Properties

### 18.1 Guarantees
- remote peers cannot forge writes (signature required)
- shared space confidentiality (without `spaceKey`, data is unreadable)
- unauthorized writes do not propagate (validator on receive)
- snapshot integrity (hash verification)

### 18.2 Non-guarantees
- users cannot be prevented from cheating local state
- users can read any unencrypted data they receive
- global moderation/spam protection for public spaces

### 18.3 Replay / Deduplication
Data plane messages are signed; receivers MUST implement deduplication:

**Dedup Key**: `(from, deviceId, batchId/nonce)`

Requirements:
- Receiver MUST track recently seen `(from, deviceId, batchId)` tuples
- Duplicate messages MUST be ignored (not re-applied)
- Engine-level dedup is still required for safety (CR-SQLite should be idempotent)

**Recommended Implementation**:
- Maintain sliding window of recent batch IDs per peer
- Window size: last 1000 batches or 1 hour (whichever is larger)

---

## 19) Testing & Conformance

### 19.1 Test Suites
1. replica convergence: N devices offline edits → converge after sync
2. bootstrap correctness: empty device → snapshot → delta catch-up
3. policy enforcement: invalid write → rejected on receive
4. key rotation: removed member cannot decrypt new writes after rotation
5. transport resilience: chunk drops + resume works
6. blob lazy loading: metadata sync without blob; blob fetched on demand
7. **conflict resolution**: concurrent edits to same row → deterministic merge (v0.1.3)
8. **offline queue durability**: writes during offline → survive crash → sync on reconnect (v0.1.3)
9. **rate limiting**: peer exceeding limits → temporarily banned → resumes after cooldown (v0.1.3)
10. **circuit breaker**: persistent failures → circuit opens → recovers after reset (v0.1.3)

### 19.2 Reference Simulators
- `sim/mesh-runner`: runs 10–100 simulated peers in Node/WebWorker to fuzz sync

---

## 20) Packaging Recommendations (What to ship)

### 20.1 Core `localsync` (Must-have)
- Engine interface + at least one web engine (`sqlite-opfs`)
- checkpointing + changeset replication + snapshot import/export
- Spaces (space key, envelopes) + validation-on-receive
- transport abstraction + at least one reliable transport
- blob abstraction + content-addressed files

### 20.2 Official Adapters (Separate packages)
- `localsync/nostr-controlplane` (presence/invites/pointers + NIP-11 aware)
- `localsync/transport-webrtc` (fast path; supports TURN config)
- `localsync/transport-relay` (fallback)
- `localsync/blob-nip96` (NIP-96 upload/download)
- `localsync/push-gateway` (optional, reference server)
- `localsync/service-node` (optional, reference worker)

---

## 21) Implementation Recommendations (Non-normative)

These are clarifications to reduce “spec gaps” during implementation:

1. **Control-plane sizing**: enforce payload size against the serialized Nostr event; assume `4096` bytes if relay provides no limit.
2. **Protocol layering**: use control plane to discover/coordinate; use LSYNC/1 over data plane for the actual transfer.
3. **Canonical bytes**: define deterministic signing bytes for LSYNC/1 (prefer deterministic CBOR).
4. **Namespacing**: avoid ambiguous “relay” (Nostr relay vs WebSocket relay transport) in APIs/docs by using `nostrRelay` vs `relayTransport`.
5. **Security baseline**: shared spaces MUST encrypt at rest with `spaceKey` and MUST validate-on-receive before apply.

---

## 22) Roadmap (Suggested)

### v0.1 (Notion/Obsidian baseline)
- SQLite OPFS engine + stable persistence
- changeset replication + checkpointing
- snapshot export/import
- relay transport (reliable)
- vault + identity + signing
- reactive watch

### v0.2 (Shared spaces)
- space encryption + membership envelopes
- validation-on-receive policy engine
- WebRTC transport + discovery adapter
- blob store + lazy loading

### v0.3 (Slack/Trello UX enablers)
- presence + typing indicators (ephemeral messages)
- space key rotation + lazy re-encryption
- better compaction + pruning policies
- admin migration feed + feature flags

---

## 23) Appendix: Minimal Built-in Tables (Recommended)

To power spaces/migrations/blobs without app code, engines SHOULD provide or reserve the following tables:
- `_ls_spaces(spaceId, type, ownerPubKey, createdAt, policyJson, …)`
- `_ls_members(spaceId, memberPubKey, role, status, updatedAt)`
- `_ls_keys(spaceId, memberPubKey, encSpaceKey, issuedAt, issuedBy, sig)`
- `_ls_migrations(version, hash, appliedAt)`
- `_ls_blobs(blobId, bytes, mime, encrypted, locationsJson, createdAt)`
- `_ls_outbound_queue(id, replicaId, counter, spaceId, tableName, operation, rowJson, createdAt, sentAt, ackedAt)` — Added in v0.1.3
- `_ls_conflicts(id, table, pk, localJson, remoteJson, resolvedJson, resolvedAt)` — Added in v0.1.3

---

## 24) Changelog

### v0.1.3 (Architectural Review Addenda)

> [!IMPORTANT]
> This version addresses critical technical gaps identified during senior architecture review.

### v0.1.4 (Technical Spec Cross-Reference)

#### Additions from `technical_spec.md` Review
- **§3.1.1 StorageAdapter Interface**: Added interface for cross-platform path resolution
- **§5.5.1 OPFS Fast/Fallback Path**: Added runtime selection for COOP/COEP vs static hosting
- **§6.3 Vault Encryption Format**: Added NIP-49 compatible format with scrypt + XChaCha20-Poly1305
- **§6.4 Cryptographic Primitives**: Added HKDF-SHA256 key derivation, compression order, NIP-44 requirements
- **§8.3.1 Policy Where Language**: Formalized minimal expression language for policy rules
- **§11.2 Presence Timing**: Added refresh intervals (30s) and stale detection (60-90s)
- **§18.3 Replay/Deduplication**: Added dedup requirements and recommended implementation

### v0.1.3 (Architectural Review Addenda)

#### Critical Additions
- **§5.1.1 replicaId Generation**: Defined deterministic `replicaId` generation strategy to prevent collisions
- **§5.6 Conflict Resolution**: Added complete conflict resolution framework including LWW strategy, custom resolvers, and audit logging
- **§9.8 Offline Queue (WAL)**: Defined durable offline write queue with schema and processing interface
- **§9.9 Rate Limiting**: Added abuse prevention with per-peer quotas and backpressure signals

#### Medium Additions
- **§5.1.2 Checkpoint Comparison**: Added efficiency guidelines for checkpoint operations
- **§5.2 CompactPolicy**: Defined `CompactPolicy` and `CompactResult` interfaces
- **§5.3.1 Watch Options**: Added debouncing, pagination, and cursor support for `watch()`
- **§10.3 WebRTC Signaling**: Complete WebRTC signaling flow via Nostr control plane
- **§10.4 Retry Strategy**: Added retry configuration and circuit breaker pattern
- **§14.7 Error Types**: Defined consistent error hierarchy for all operations

#### Minor Additions
- Updated `_ls_*` table list in Appendix with new tables
- Version bump to v0.1.3 with source attribution

### v0.1.2
- Initial consolidated specification
- Combined `spec.md`, `spec_1.1.md`, `spec_1.2.md`

