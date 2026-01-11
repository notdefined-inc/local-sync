# Addendum v0.1.2 — Multi-Identity Device + Per-Space DBs

## 1) Storage Topology

LocalSync MUST support multiple identities on the same device without deleting data.

### 1.1 OPFS Layout
- device registry is global per appId
- identity vault is per identity pubkey
- data is stored per space (spaceId) under the identity

Example:
  /<appId>/device/registry.sqlite
  /<appId>/identities/<pubkey>/vault.enc
  /<appId>/identities/<pubkey>/spaces/<spaceId>/db.sqlite

## 2) Device Registry (local-only)

Purpose:
- list identities previously used on device
- enable fast account switching

Constraints:
- MUST NOT store plaintext private keys or space keys
- MAY store encrypted vault blobs or references to vault.enc

Recommended schema:
  device_identities(pubkey PRIMARY KEY, display_name, avatar_url, last_login_at)

## 3) Vault Store (per identity)

vault.enc contains:
- identity private key material (NIP-49 compatible or equivalent)
- space key envelopes for all joined spaces
- device secrets (optional)
- user settings that must not be replicated (optional)

Vault MUST be encrypted with a password-derived key (KDF + AEAD).
Decrypted keys MUST exist only in memory for the session.

## 4) Space Databases (per identity, per space)

Each space is its own replication domain:
- independent checkpoints, snapshots, compaction policies
- independent membership and encryption keys (for shared spaces)

Personal spaces MAY omit crypto-RLS by default.
Shared spaces MUST use spaceKey-based confidentiality and membership envelopes.

## 5) Login/Logout Semantics

Startup:
- open registry.sqlite only

Login(pubkey, password):
- unlock vault.enc
- open requested space db(s)
- start sync pipelines for those spaces

Logout:
- close all opened space db handles
- lock vault, wipe decrypted keys from memory
- keep local files intact

One more upgrade: “Spaces as first-class API”

This helps devs build Notion now and Slack later without changing mental model:
	•	client.identities.list()
	•	client.login(pubkey, password)
	•	client.spaces.list()
	•	client.spaces.open(spaceId)
	•	client.spaces.createPersonal()
	•	client.spaces.createShared()
