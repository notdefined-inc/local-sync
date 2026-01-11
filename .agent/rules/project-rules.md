---
trigger: always_on
---

# LocalSync Project Rules & Guidelines

> [!IMPORTANT]
> **Primary Directive**: All code changes, architectural decisions, and feature implementations MUST explicitly reference and adhere to the following specifications:
> 1. `spec_consolidated.md` (Protocol Authority)
> 2. `technical_spec.md` (Implementation Authority)
> 3. `product_vision.md` (North Star)
>
> If you are unsure, **STOP** and read the relevant spec section.

---

## 1. Specifications First
- Before implementation, consult `spec_consolidated.md` for protocol rules and `technical_spec.md` for implementation details.
- **Conflict Resolution**: If code contradicts spec, spec wins. If spec is unimplementable, propose a Spec Update.
- **Traceability**: Complex logic MUST have comments referencing spec sections (e.g., `// See spec §9.8.2`).

## 2. Scalability Standards
LocalSync targets millions of users with zero backend dependency.

### 2.1 Architecture
- **Stateless**: No centralized server state. Relay servers must be dumb pipes.
- **Local-Foundational**: All data lives on the edge. Sync is a feature, not a dependency.
- **Offline-First**: Never block UI on network. Writes are always local and synchronous.
- **Zero-Backend**: The system must function indefinitely with only static file hosting.

### 2.2 Performance
- **Main Thread Hygiene**: Database and Crypto operations MUST NOT block the main thread.
- **Chunking**: Payloads > 16KB MUST be chunked (WebRTC constraints).
- **Backpressure**: Respect receiver limits. Drop delta messages preferred over unbounded queuing.

### 2.3 Efficiency
- **Bandwidth**: Send only what's new (Vector Clocks).
- **Storage**: Use OPFS on web. aggressively prune history via `CompactPolicy`.
- **Battery**: Avoid persistent polling. Use push or long-polling only when active.

## 3. Product Principles
- **"It Just Works"**: Abstract away NAT, keys, and CRDTs. Technical complexity translates to zero user friction.
- **Privacy by Default**: Shared spaces are ALWAYS end-to-end encrypted.
- **Data Ownership**: The user's file system is the source of truth.

## 4. Technical Standards

### 4.1 TypeScript
- **Strict Mode**: Enforced `noImplicitAny`, `strictNullChecks`.
- **Type Safety**: Use nominal/branded types for IDs (e.g. `SpaceId`, `BlobId`) to prevents mixing.
- **No `any`**: Use `unknown` with type guards at boundaries.

### 4.2 Error Handling
- **Hierarchy**: Use `LocalSyncError` subclasses (`AuthError`, `SyncError`, etc.).
- **Recovery**: Distinguish recoverable (network) vs fatal (corruption) errors.
- **Visibility**: Never swallow errors silently.

### 4.3 Testing
- **Unit**: Isolated logic (CRDT merge, crypto).
- **Simulation**: Sync convergence tests using `mesh-runner`.
- **E2E**: Full user flows (offline write -> online sync).

---

## 5. Agent Workflow
- **Spec Check**: Always start by reading relevant spec sections.
- **Validation**: Verify assumptions against `technical_spec.md`.
- **Documentation**: Update spec documents if implementation discovers new requirements.
