# Spec Addendum v0.1.1 — Control Plane, Push, Service Nodes

## A) Planes

### A.1 Data Plane
Moves large payloads (changesets, snapshots, blobs):
- WebRTC transport (preferred)
- Relay transport fallback (WebSocket-based Channel)
- Optional TURN/seeding service for reliability (not required, but supported)

### A.2 Control Plane (Nostr)
Carries small, frequent coordination messages:
- peer discovery / presence
- "have changes since checkpoint"
- invitations / membership envelopes
- schema & migration events
- pointers (URLs/hashes) to blobs/snapshots stored elsewhere

Control-plane messages SHOULD fit within relay constraints and MUST adapt to relay capabilities (see NIP-11 max_message_length).

## B) Relay Capability Discovery
When using any Nostr relay:
- client MUST fetch relay info doc and read `max_message_length` where available
- client MUST keep control-plane payloads under `max_message_length` minus framing overhead
- if relay does not publish limits, client MUST assume a conservative default (implementation-defined)

## C) Control Plane Message Types (Logical)

### C.1 PEER_ANNOUNCE
Announces device online & reachable endpoints:
- appId, spaceId, from(pubkey), deviceId
- supported transports: webrtc/relay
- optional webrtc offer metadata (small), otherwise exchanged later

### C.2 WANT_CHANGES
"I have checkpoint X. Who has anything newer?"
Payload:
- checkpoint
- preferred data-plane transport
- maxBatchBytes

### C.3 HAVE_CHANGES
"I can serve from checkpoint X to Y"
Payload:
- peerCheckpoint
- canServeSnapshot (bool)
- snapshotHash (optional)

### C.4 POINTER
A generic pointer record for big content:
- kind: "snapshot" | "blob"
- hash (sha256)
- locations[] (e.g., nip96 url, drive url, local-only)
- encryption: "none" | "space"

## D) Encryption

### D.1 Payload Encryption Format
Control-plane payloads MAY be encrypted using NIP-44 format.
Note: NIP-44 defines encryption format, not event kinds.

### D.2 Data Plane Encryption
All data-plane payloads MUST be encrypted for shared spaces:
- changesets and snapshots encrypted with spaceKey-derived keys
- blobs encrypted with spaceKey-derived keys unless explicitly public

## E) Push Gateway (Optional)
Problem: mobile OSes may not keep apps alive; P2P cannot wake devices reliably.
Solution: optional Push Gateway service:
- subscribes to control-plane notifications (encrypted pointers or tags)
- sends push to APNs/FCM/UnifiedPush to wake device
- payload MUST NOT contain sensitive data; only "wake" + pointer id

LocalSync MUST treat Push Gateway as an optional adapter; core replication must not depend on it.

## F) Service Nodes / Jobs (Optional Trusted Compute)

### F.1 Job Model
A Job is an encrypted request posted to the control plane.
- examples: "charge customer", "generate AI summary", "send email"
- secrets are held by the service node operator, not by clients

Job envelope:
- jobId, appId, spaceId, requesterPubKey, createdAt
- jobType
- encrypted payload
- signature

### F.2 Job Response
Service node replies with:
- jobId
- status: ok|error
- encrypted result
- signature

### F.3 Trust Model
- service nodes are opt-in by app developers/users
- clients MUST verify service node identity (pubkey allowlist, or signed attestation)

6) What you should ship as the “robust library” vs optional ecosystem

Core localsync (must-have)
	•	SQLite OPFS storage + engine interface
	•	changeset replication + checkpointing + snapshots
	•	shared spaces (space key, envelopes, validation-on-receive)
	•	transport abstraction + at least 1 reliable transport
	•	file abstraction + content-addressed blobs

Official adapters (separate packages)
	•	localsync/nostr-controlplane (presence/invites/pointers + NIP-11 aware)  ￼
	•	localsync/transport-webrtc (fast path; supports TURN config)  ￼
	•	localsync/transport-relay (fallback)
	•	localsync/blob-nip96 (NIP-96 upload/download)  ￼
	•	localsync/push-gateway (optional, reference server)
	•	localsync/service-node (optional, reference worker)
