# @localsync/core

> Local-first sync SDK with no backend required

[![npm version](https://img.shields.io/npm/v/@localsync/core.svg)](https://www.npmjs.com/package/@localsync/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

LocalSync is a local-first replication SDK that lets you build apps like Notion, Linear, or Obsidian—**without running any backend**.

## Features

- ✅ **Zero backend** - Works from static hosting (GitHub Pages, Vercel)
- ✅ **Local-first** - Instant reads/writes, sync is opportunistic
- ✅ **SQL as the API** - Familiar relational model with reactive queries
- ✅ **Offline-first** - Full functionality without internet
- ✅ **OPFS Persistence** - Data survives page reloads (Phase 2A complete)
- ✅ **Reactive Watch Queries** - Real-time UI updates on data changes
- ✅ **Snapshots** - Export/import database state for backup and bootstrap
- 🚧 **End-to-end encrypted** - Shared spaces with cryptographic access control (Phase 3)
- 🚧 **P2P sync** - WebRTC data channels for direct device-to-device sync (Phase 5)
- 🚧 **Nostr control plane** - Decentralized coordination without servers (Phase 4)

## Installation

```bash
npm install @localsync/core sql.js
# or
pnpm add @localsync/core sql.js
# or
yarn add @localsync/core @localsync/engine-crsqlite-web
```

## Quick Start

```typescript
import { LocalSync, defaultVaultProvider } from '@localsync/core';
import { createOpfsStorageAdapter, createWebEngineProvider } from '@localsync/engine-crsqlite-web';

// Initialize client
const client = await LocalSync.open({
  appId: 'my-app',
  storage: createOpfsStorageAdapter(),
  vault: defaultVaultProvider,
  engine: createWebEngineProvider()
});

// Login
const session = await client.login(pubkey, password);

// Create a personal space
const space = await session.spaces.createPersonal();

// Create a table
await space.exec(`
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    completed INTEGER DEFAULT 0
  )
`);

// Insert data (instant, local-first)
await space.run(
  'INSERT INTO tasks(id, title) VALUES(?, ?)',
  [crypto.randomUUID(), 'Ship LocalSync v0.1']
);

// Reactive query (re-renders on changes)
space.watch('SELECT * FROM tasks', [], (rows) => {
  console.log('Tasks:', rows);
});

// Start sync (automatic when online)
await space.sync.start();
```

## Documentation

- [Getting Started Guide](./docs/getting-started.md)
- [API Reference](./docs/api.md)
- [Spec](../../spec_consolidated.md)

## Architecture

LocalSync implements the [LocalSync Protocol Specification](../../spec_consolidated.md) v0.1.4:

- **Storage**: OPFS (web) with SQLite WASM ✅
- **Crypto**: XChaCha20-Poly1305, HKDF-SHA256, BIP340 Schnorr 🚧
- **Sync**: Vector clocks, delta replication, conflict resolution 🚧
- **Transport**: WebRTC (P2P) + WebSocket relay (fallback) 🚧
- **Control Plane**: Nostr for coordination 🚧

## Development Status

### ✅ Phase 2A: Core Engine Integration (Complete)
- SQLite WASM engine with sql.js
- OPFS persistence (data survives page reloads)
- Reactive watch queries
- Snapshot export/import
- Replication primitives (checkpoints, changes)
- **Test Coverage**: 59/59 tests passing

### 🚧 Phase 2B: CR-SQLite Integration (Planned)
- CR-SQLite WASM extension
- Automatic CRDT conflict resolution
- CRR table registration

### 🚧 Phase 3: Vault & Crypto (Next)
- NIP-49 vault encryption
- Identity keypair management
- Space key encryption

### 🚧 Phase 4: Nostr Control Plane
- Peer discovery and presence
- WebRTC signaling

### 🚧 Phase 5: WebRTC Data Plane
- P2P sync implementation
- LSYNC/1 protocol

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Test
pnpm test

# Watch mode
pnpm dev
```

## Publishing

```bash
# Build and test
pnpm prepublishOnly

# Publish to npm
pnpm publish
```

## License

MIT © LocalSync Contributors

## Links

- [Specification](../../spec_consolidated.md)
- [Product Vision](../../product_vision.md)
- [Technical Spec](../../technical_spec.md)
