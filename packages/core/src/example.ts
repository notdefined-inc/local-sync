/**
 * LocalSync SDK Example Usage
 * Demonstrates how to use the LocalSync SDK
 */

import { LocalSync, defaultVaultProvider } from './index';
import { createOpfsStorageAdapter, createWebEngineProvider } from '@localsync/engine-crsqlite-web';
import { createNostrControlPlaneProvider } from '@localsync/control-nostr';
import { createWebRTCTransportProvider } from '@localsync/transport-webrtc';
import { createLocalBlobStoreProvider } from '@localsync/blob-local';

async function example() {
  // §14.1 Initialize LocalSync client
  const client = await LocalSync.open({
    appId: 'adhd-dashboard',
    storage: createOpfsStorageAdapter(),
    vault: defaultVaultProvider,
    engine: createWebEngineProvider(),
    transports: [createWebRTCTransportProvider()],
    blobStores: [createLocalBlobStoreProvider()],
    controlPlane: createNostrControlPlaneProvider()
  });

  // §14.2 Login with identity
  const session = await client.login('pubkey-here', 'password');

  // §14.3 Create a personal space
  const space = await session.spaces.createPersonal();

  // §14.4 Create a table
  await space.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_modified INTEGER
    )
  `);

  // §14.4 Insert data (local-first, instant)
  await space.run(
    'INSERT INTO tasks(id, title, completed, created_at) VALUES(?, ?, ?, ?)',
    [crypto.randomUUID(), 'Ship LocalSync v0.1', 0, Date.now()]
  );

  // §14.4 Reactive query (re-renders on changes)
  const unsubscribe = space.watch(
    'SELECT * FROM tasks ORDER BY created_at DESC',
    [],
    (rows: any[]) => {
      console.log('Tasks updated:', rows);
    }
  );

  // §14.5 Start sync (automatic when online)
  await space.sync.start();

  // §14.6 File operations (commented out - not implemented yet)
  // const imageBytes = new Uint8Array([/* ... */]);
  // const blob = await space.files.put(imageBytes, { mime: 'image/jpeg' });
  // await space.run(
  //   'UPDATE tasks SET cover_blob=? WHERE id=?',
  //   [blob.blobId, 'task-id']
  // );

  // Later: cleanup
  unsubscribe();
  await client.logout();
}

// Run example in development
if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
  example().catch(console.error);
}
