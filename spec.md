# LocalSync SDK + Protocol Spec (v0.1)

Status: Draft  
Target: Option 1 (single-user, multi-device) + Option 2 (shared spaces like Slack/Trello) as first-class.

---

## 0) Goals and Non-Goals

### Goals
1. **True “no required backend”** for app developers:
   - Works from a static site (GitHub Pages/Vercel/Cloudflare Pages).
   - Data lives locally (SQLite in OPFS on web; native FS on desktop/mobile).
2. **Local-first UX**:
   - Reads/writes are always local; sync is opportunistic.
3. **Delta replication**:
   - Sync small changesets (KB/MB), not full DB (GB).
4. **Bootstrap**:
   - New device can hydrate via snapshot + follow-up deltas.
5. **First-class shared spaces**:
   - “Space”/“Workspace” concept with membership and permissions.
6. **Pluggable transports and storage**:
   - WebRTC, relay/WebSocket, etc.
   - File storage adapters: local-only, NIP-96, S3, Drive, etc.
7. **Security**:
   - Identity keys live locally in an encrypted vault.
   - Shared data protected via cryptographic access control.
   - Malicious writes do not propagate (validator on receive).

### Non-Goals (v0.x)
- No global “Explore/Trending” indexing.
- No guaranteed always-online availability without a seeding/backup provider.
- No “prevent user from tampering with their own local DB” (impossible); we prevent *propagation* and protect *confidentiality*.

---

## 1) Core Concepts

### 1.1 Entities
- **Device**: A runtime instance (browser profile, desktop install, mobile app).
- **Identity**: Public/private keypair used for signatures and secure key exchange.
- **Vault**: Encrypted container holding Identity private keys and app secrets.
- **Replica**: A local database instance (per app + per device).
- **Space**: A logical shared dataset boundary with membership (Option 2).
- **Collection**: A table-like logical dataset (maps to SQLite tables).
- **Changeset**: A compact representation of mutations since a checkpoint.
- **Snapshot**: A full state checkpoint used for bootstrap.
- **Blob**: Large binary objects (attachments, images, video segments).

### 1.2 Data Model Layers
LocalSync splits app data into:
1. **Core DB (SQLite)**: metadata + structured app data
2. **Replication Log (engine-specific)**: CRDT/mergeable operation log
3. **Blob Store**: large binaries (local and/or remote)

---

## 2) System Architecture

### 2.1 Modules
- `core/`  : DB engine wrapper, transactions, query helpers
- `storage/`: OPFS persistence + quota/persistence helpers
- `sync/`  : protocol, peer manager, replication, bootstrap, chunking
- `auth/`  : vault, identity, session unlock, key rotation hooks
- `crypto/`: signing, encryption, key envelopes, group keys
- `files/` : blob adapters + lazy fetch
- `rules/` : validation-on-receive + permission rules engine
- `ui/`    : optional admin dashboard components (later)

### 2.2 First-class Modes
- **Mode A (Option 1): Personal Replica Mesh**
  - One user’s devices replicate one or more personal spaces.
  - No “RLS”; confidentiality is optional (device-level).
- **Mode B (Option 2): Shared Spaces**
  - Members share a Space encrypted with a **Space Key**.
  - Membership controls access to decrypt + accept writes.

---

## 3) Database Engine Requirements

LocalSync supports multiple engines as long as they implement this interface.

### 3.1 Engine Interface
```ts
export interface Engine {
  open(params: EngineOpenParams): Promise<void>;
  close(): Promise<void>;

  exec(sql: string, params?: any[]): Promise<QueryResult>;
  run(sql: string, params?: any[]): Promise<void>;

  transaction<T>(fn: () => Promise<T>): Promise<T>;

  // reactive queries
  watch(query: string, params: any[] | undefined, cb: (rows: any[]) => void): Unsubscribe;

  // replication primitives
  getCheckpoint(spaceId: string): Promise<Checkpoint>;     // version vector / clock
  getChanges(spaceId: string, since: Checkpoint, maxBytes?: number): Promise<ChangesBatch>;
  applyChanges(spaceId: string, changes: ChangesBatch): Promise<ApplyResult>;

  // snapshot primitives
  exportSnapshot(spaceId: string): Promise<Uint8Array>;     // sqlite file bytes (or canonical snapshot)
  importSnapshot(spaceId: string, snapshot: Uint8Array): Promise<void>;

  // optional: compaction / pruning
  compact(spaceId: string, policy?: CompactPolicy): Promise<CompactResult>;
}
3.2 Recommended Engine (Reference Implementation)
	•	SQLite (WASM) persisted to OPFS
	•	Mergeable replication layer (e.g., CRDT SQLite like cr-sqlite)
Note: spec does not hard-code the engine; it only requires merge-safe changesets.

⸻

4) Storage: OPFS Persistence (Web)

4.1 Storage Requirements
	•	Must support:
	•	random access reads/writes
	•	crash-safe commits
	•	reopen existing DB on refresh
	•	Must attempt to request persistent storage:

    await navigator.storage.persist?.();
    4.2 Storage Paths
	•	/{appId}/{spaceId}/db.sqlite
	•	/{appId}/{spaceId}/meta.json
	•	/{appId}/{spaceId}/blobs/…

⸻

5) Identity, Vault, Sessions

5.1 Identity
	•	Each user has an Identity keypair:
	•	pubKey: stable identifier
	•	privKey: stored only in Vault
	•	Each device has a deviceId and a deviceKeypair (optional, for device-to-device auth).

5.2 Vault

Vault is responsible for:
	•	encrypting and storing privKey + app secrets
	•	unlocking for an app session

Vault interface:
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
5.3 Sessions
	•	A session exists only in memory after vault.unlock().
	•	All outbound sync messages must be signed.

⸻

6) Spaces (Shared Workspaces)

6.1 Space Metadata

Each space has:
	•	spaceId (uuid)
	•	spaceType: "personal" | "shared"
	•	ownerPubKey
	•	spaceKey (symmetric, only for "shared"; stored encrypted per member)
	•	policy (permissions + validation rules)
	•	members (pubKeys + roles)

6.2 Roles (Minimal)
	•	owner: can rotate keys, change policy, manage membership
	•	admin: manage membership (optional), post schema updates (optional)
	•	member: normal read/write within rules
	•	reader: read-only (optional)

6.3 Membership & Key Distribution (Crypto-RLS baseline)
	•	For a shared space, the database content is encrypted-at-rest per-space:
	•	Space rows are encrypted using spaceKey (or table-level keys derived from it)
	•	Membership is granting access to spaceKey:
	•	spaceKey is encrypted to each member’s public key (envelope encryption)
	•	stored as a Membership Envelope record/event

Membership envelope structure:

type MemberRole = "owner" | "admin" | "member" | "reader";

interface SpaceInviteEnvelope {
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

6.4 Key Rotation
	•	On removing a member:
	•	generate new spaceKey'
	•	re-encrypt to remaining members
	•	(optional v1.5) re-encrypt existing rows over time (“lazy rotation”)

⸻

7) Permission Model: Validation-on-Receive + Confidentiality

LocalSync enforces security at two layers:

7.1 Confidentiality (Who can read?)
	•	Personal spaces: optional encryption (device-level)
	•	Shared spaces: required space encryption (crypto-RLS baseline)

7.2 Propagation Safety (Who can write?)

All changesets must be:
	1.	signed by the sender identity
	2.	validated against the space policy before being applied

If invalid, they are dropped.

⸻

8) Replication Protocol (LSYNC/1)

8.1 Message Types (logical)

All messages are framed as:

interface WireMessage<T> {
  v: "LSYNC/1";
  type: string;
  appId: string;
  spaceId: string;
  from: string;          // sender pubKey
  deviceId: string;
  ts: number;

  payload: T;

  // signature over canonical bytes of header+payload
  sig: Uint8Array;
}
8.2 Handshake
	1.	HELLO
    type Hello = {
  want: "delta" | "bootstrap";
  haveCheckpoint?: Checkpoint;
  supported: {
    maxChunkBytes: number;
    compression: ("none" | "zstd" | "gzip")[];
    encryption: ("none" | "space")[]; // space implies shared-space encryption enabled
  };
};
2.	WELCOME
type Welcome = {
  peerCheckpoint?: Checkpoint;
  canServeSnapshot: boolean;
  snapshotHash?: string;        // if available
  snapshotBytes?: number;
  recommended: {
    mode: "delta" | "bootstrap";
  };
};
8.3 Delta Sync Flow
	1.	Exchange checkpoints
	2.	Compute missing ranges
	3.	Transfer CHANGES in batches
	4.	Ack each batch

Messages:
	•	REQUEST_CHANGES { since: Checkpoint, maxBytes }
	•	CHANGES { batchId, since, to, bytes, hash, compressed }
	•	ACK { batchId, applied: boolean, newCheckpoint }

8.4 Bootstrap Sync Flow (Snapshot)

Used if:
	•	local db missing/empty
	•	checkpoint divergence too large
	•	device explicitly requested bootstrap

Messages:
	•	REQUEST_SNAPSHOT { wantHash?: string }
	•	SNAPSHOT_META { hash, bytes, chunkBytes }
	•	SNAPSHOT_CHUNK { idx, total, bytes, hash }
	•	SNAPSHOT_DONE { hash }
	•	then switch to delta sync (catch-up)

8.5 Chunking + Backpressure
	•	Sender must:
	•	respect peer maxChunkBytes
	•	wait for ACK or a window-based flow control
	•	Receiver must:
	•	verify per-chunk hash
	•	support resume via REQUEST_SNAPSHOT { wantHash } or REQUEST_CHANGES { since }

8.6 Checkpoints

Checkpoint must support multi-writer replication:
// version vector style
type Checkpoint = {
  // per replica/device clock; exact format is engine-specific but MUST be mergeable
  vv: Record<string /*replicaId*/, number /*counter*/>;
};
9) Transport Adapters

LocalSync must not hard-code a single network.

9.1 Transport Interface

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
9.2 Reference Adapters (ship as packages)
	•	transport-webrtc: fast P2P datachannel
	•	transport-relay: websocket relay transport (reliable fallback)
	•	transport-nostr-signal: discovery/signaling layer for WebRTC (optional)

Rule: the protocol is the same; only Channel differs.

⸻

10) Blobs / Files (Attachments)

10.1 Blob Addressing

All blobs are content-addressed:
	•	blobId = sha256(bytes) (hex/base64)
	•	metadata stored in SQLite

Blob record:

interface BlobMeta {
  blobId: string;
  bytes: number;
  mime: string;
  createdAt: number;
  // storage hints
  locations: { type: string; url?: string; }[];
  encrypted: boolean;
}

10.2 Blob Store Adapter
export interface BlobStore {
  put(blob: Uint8Array, meta: { mime: string }, opts?: PutOpts): Promise<BlobMeta>;
  get(blobId: string): Promise<Uint8Array>;
  has(blobId: string): Promise<boolean>;
  del?(blobId: string): Promise<void>;
}
10.3 Lazy Loading (Required)
	•	App data references blobId
	•	UI fetches blob on-demand:
	•	files.get(blobId) triggers local lookup, then remote, then peer

10.4 Encryption
	•	For shared spaces: blobs encrypted with keys derived from spaceKey unless configured public.
	•	For personal spaces: optional encryption.

⸻

11) Reactive Queries

11.1 Watch Semantics
	•	watch(query) must:
	•	fire immediately with current results
	•	fire on local commits
	•	fire after applying remote changesets

11.2 Consistency
	•	Watch callbacks see committed state only.
	•	Ordering:
	•	local commit watchers fire before network send
	•	remote apply watchers fire after successful validation + apply

⸻

12) Schema & Migrations (App Admin)

12.1 Migration Source of Truth
	•	Migrations are authored by app developer and shipped:
	•	either baked into the app build, or
	•	distributed as signed migration events by appAdminPubKey

12.2 Signed Migration Event
interface MigrationEvent {
  appId: string;
  version: number;
  issuedAt: number;
  sql: string[];            // ordered statements
  hash: string;             // sha256 of canonical representation
  sig: Uint8Array;          // signed by appAdminPubKey
}
12.3 Migration Rules
	•	Must be idempotent.
	•	Must be forward-only (no down migrations required).
	•	Engine must store applied_migrations(version, hash, ts) locally.

⸻

13) Policy / Rules Engine (Option 2)

13.1 Policy Format

Policy attached to space:
	•	allowed tables/operations per role
	•	optional field constraints
	•	optional rate limits

Example:

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
13.2 Enforcement
	•	Outgoing writes are not blocked (user owns device) but:
	•	library SHOULD block via client-side checks for UX
	•	Incoming changesets MUST be validated before apply:
	•	signature valid?
	•	sender is a current member?
	•	operation conforms to policy?

If not valid: drop and optionally emit an audit event locally.

⸻

14) Public API (Developer Experience)

14.1 Top-level
import { LocalSync } from "localsync";

const client = await LocalSync.open({
  appId: "myapp",
  vault: { provider: "default" },
  engine: { provider: "sqlite-opfs" },
  transports: [
    { provider: "webrtc" },
    { provider: "relay" } // optional fallback
  ],
  blobStores: [
    { provider: "local" },
    { provider: "nip96", endpoint: "..." } // optional
  ]
});
14.2 Spaces
// Option 1: personal
const space = await client.space.openOrCreatePersonal();

// Option 2: shared
const team = await client.space.createShared({ name: "Team A" });
await team.invite({ memberPubKey: "...", role: "member" });
14.3 Collections / Queries
await space.exec(`CREATE TABLE IF NOT EXISTS tasks (...)`);

await space.run(`INSERT INTO tasks(id, title) VALUES(?, ?)`, [id, "Ship v1"]);

const unsub = space.watch(
  `SELECT * FROM tasks ORDER BY created_at DESC`,
  [],
  (rows) => render(rows)
);

14.4 Sync Control
await space.sync.start();      // begin discovery + replication
await space.sync.stop();

await space.sync.once();       // manual sync pulse
await space.sync.exportSnapshot(); // returns bytes
await space.sync.importSnapshot(bytes);

14.5 Files
const meta = await space.files.put(fileBytes, { mime: "image/jpeg" });
await space.run(`UPDATE notes SET cover_blob=? WHERE id=?`, [meta.blobId, noteId]);

// Later
const bytes = await space.files.get(meta.blobId);
15) Availability Model (No required server)

15.1 “Nobody online” problem

If no peer is online and no snapshot exists remotely:
	•	a new device cannot bootstrap
	•	existing device still works locally

15.2 Optional Services (not required)
	•	Seed/Always-on peer (small paid service) that keeps encrypted snapshot + seeds deltas
	•	Backup store adapters (Drive/iCloud/S3/NIP-96) for bootstrap reliability

LocalSync must treat these as optional plugins.

⸻

16) Threat Model + Security Properties

16.1 What we guarantee
	•	Remote peers cannot forge writes (signature required)
	•	Shared space confidentiality (without spaceKey, data is unreadable)
	•	Unauthorized writes do not propagate (validator on receive)
	•	Snapshot integrity (hash verification)

16.2 What we do NOT guarantee
	•	A user cannot cheat their own local state
	•	A user can always read any unencrypted data they receive
	•	Global moderation / spam protection for public spaces (app-level)

⸻

17) Testing & Conformance

17.1 Test Suites
	1.	Replica convergence:
	•	N devices offline edits -> converge after sync
	2.	Bootstrap correctness:
	•	empty device -> snapshot -> delta catch-up
	3.	Policy enforcement:
	•	invalid write -> rejected on receive
	4.	Key rotation:
	•	removed member cannot decrypt new writes after rotation
	5.	Transport resilience:
	•	chunk drops + resume works
	6.	Blob lazy loading:
	•	metadata sync without blob; blob fetched on demand

17.2 Reference Simulators
	•	sim/mesh-runner: runs 10–100 simulated peers in Node/WebWorker to fuzz sync.

⸻
18) Roadmap (Suggested)

v0.1 (Notion/Obsidian baseline)
	•	SQLite OPFS engine + stable persistence
	•	Changeset replication + checkpointing
	•	Snapshot export/import
	•	Relay transport (reliable)
	•	Vault + identity + signing
	•	Reactive watch

v0.2 (Shared spaces)
	•	Space encryption + membership envelopes
	•	Validation-on-receive policy engine
	•	WebRTC transport + discovery adapter
	•	Blob store + lazy loading

v0.3 (Slack/Trello UX enablers)
	•	Presence + typing indicators (ephemeral messages)
	•	Space key rotation + lazy re-encryption
	•	Better compaction + pruning policies
	•	Admin migration feed + feature flags

⸻

Appendix A: Naming (Optional)
	•	localsync (engine/protocol)
	•	localsync/transport-webrtc
	•	localsync/transport-relay
	•	localsync/blob-nip96
	•	localsync/ui-admin

⸻

Appendix B: Minimal Built-in Tables (Recommended)

To power spaces/migrations/blobs without app code:
	•	_ls_spaces(spaceId, type, ownerPubKey, createdAt, policyJson, …)
	•	_ls_members(spaceId, memberPubKey, role, status, updatedAt)
	•	_ls_keys(spaceId, memberPubKey, encSpaceKey, issuedAt, issuedBy, sig)
	•	_ls_migrations(version, hash, appliedAt)
	•	_ls_blobs(blobId, bytes, mime, encrypted, locationsJson, createdAt)