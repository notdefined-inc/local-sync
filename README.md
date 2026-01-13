# PocketPeer (LocalSync) — Server-optional backend for static apps

PocketPeer lets a **static website** (Next.js/React/Vite/etc.) have a “backend” without running one.

It works by keeping your app’s database **on the user’s device** (not on your server), and syncing only when needed.

---

## What it gives you

- ✅ **Local-first database**: fast reads/writes, works offline
- ✅ **Basic auth** (no email/password server needed)
- ✅ **Multi-device sync** (optional): phone ↔ laptop
- ✅ **Shared spaces** (optional): Trello/Slack-style workspaces later
- ✅ **Privacy by default**: data stays on the user’s device unless they share/backup

---

## The simplest mental model

PocketPeer = **SQLite + Sync + Identity** in one library.

1) **SQLite on the device**  
Your app uses SQLite (via WASM) and saves it to disk using OPFS (browser file system).  
So refresh/close/reopen → data is still there.

2) **Nostr for identity + signaling**  
Nostr is used like a “public phonebook + mailbox”:
- identity = public/private key
- signaling = “hey, I’m online, connect to me”
- small messages only (pointers, invites, checkpoints)

3) **WebRTC for heavy data**  
When two devices can connect, PocketPeer uses WebRTC to send:
- database deltas (tiny changes)
- snapshots (one-time full DB) for new devices

---

## How auth works (no backend)

PocketPeer uses **keys** (like SSH keys), but it hides them behind a normal UX.

**User experience:**
- user types username + password
- they “log in”

**Behind the scenes:**
- PocketPeer derives/unwraps a key vault (encrypted)
- loads the user’s Nostr keypair for this session
- now the app has an identity for sync/sharing

No hosted auth database required.

---

## How sync works (2 modes)

PocketPeer uses two sync modes:

### 1) Delta Sync (normal)
When you update data, PocketPeer generates a small “changeset” (delta).
Only these deltas are synced — not the whole DB.

### 2) Snapshot Bootstrap (rare)
If a user logs in on a **new device** (no local DB):
- PocketPeer downloads a **snapshot** once (full DB)
- then switches back to delta sync

---

## Nostr’s role (what it is / isn’t)

PocketPeer does **not** put your whole database into Nostr.

Nostr is used for:
- identity discovery (who am I / who are my peers)
- invites and membership messages
- “I have new changes since checkpoint X”
- pointers to where to fetch data (via WebRTC or optional blob storage)

Actual bytes (deltas/snapshots) go over WebRTC when possible.

---

## Single-library usage (conceptual)

```js
import PocketPeer from "pocketpeer";

// 1) Init: opens/creates a local SQLite DB on disk (OPFS)
const pp = await PocketPeer.init({ appId: "my-notes" });

// 2) Login: unlocks keys (nostr identity) for this device
await pp.auth.login({ username, password });

// 3) Use DB normally
await pp.db.exec(`CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY, text TEXT, updatedAt INT)`);
await pp.db.exec(`INSERT INTO notes VALUES(?, ?, ?)`, [id, text, Date.now()]);

// 4) Optional sync: connect to peers automatically
await pp.sync.start();

// 5) Subscribe to changes (reactive UI)
pp.db.watch(`SELECT * FROM notes ORDER BY updatedAt DESC`, [], (rows) => {
  render(rows);
});
