/**
 * Backward Compatibility Wrapper
 * Wraps LocalSync SDK to maintain compatibility with existing ADHD dashboard code
 * This allows gradual migration from old DB layer to new SDK
 */

import {
  LocalSync,
  LocalSyncClient,
  SpaceHandle,
  createOpfsStorageAdapter,
  createWebEngineProvider,
  defaultVaultProvider,
  createNostrControlPlaneProvider,
  createWebRTCTransportProvider,
  createLocalBlobStoreProvider
} from '../localsync';
import type { IdentityPubKey } from '../localsync/types';

// Module state (mimics old db/index.js)
let client: LocalSyncClient | null = null;
let currentSpace: SpaceHandle | null = null;
let isInitialized = false;

/**
 * Initialize the database system (backward compatible)
 */
export const initDatabase = async () => {
  if (isInitialized) return;

  // Initialize LocalSync client
  client = await LocalSync.open({
    appId: 'localsync',
    storage: createOpfsStorageAdapter(),
    vault: defaultVaultProvider,
    engine: createWebEngineProvider(),
    transports: [createWebRTCTransportProvider()],
    blobStores: [createLocalBlobStoreProvider()],
    controlPlane: createNostrControlPlaneProvider()
  });

  isInitialized = true;
  console.log('[DB Compat] Database system initialized with LocalSync SDK');
};

/**
 * Start syncing with Nostr (backward compatible)
 */
export const startSync = async (
  pubkey: string,
  signEvent: Function,
  conversationKey?: Uint8Array
) => {
  if (!client) {
    throw new Error('Database not initialized');
  }

  // Login with LocalSync
  const session = await client.login(pubkey, 'temp-password'); // TODO: Handle password properly
  
  // Open or create personal space
  const spaces = await session.spaces.list();
  if (spaces.length > 0) {
    currentSpace = await session.spaces.open(spaces[0].spaceId);
  } else {
    currentSpace = await session.spaces.createPersonal();
  }

  // Start sync
  await currentSpace.sync.start();

  console.log('[DB Compat] Sync started with LocalSync SDK');
};

/**
 * Stop syncing (backward compatible)
 */
export const stopSync = async () => {
  if (currentSpace) {
    await currentSpace.sync.stop();
  }
  if (client) {
    await client.logout();
  }
  currentSpace = null;
};

/**
 * Execute and publish SQL (backward compatible)
 */
export const execSQL = async (sql: string, params: unknown[] = []) => {
  if (!currentSpace) {
    throw new Error('Not logged in');
  }

  // Execute locally (optimistic UI) - LocalSync handles sync automatically
  await currentSpace.run(sql, params);
};

/**
 * Query the database (backward compatible)
 */
export const query = (sql: string, params: unknown[] = []) => {
  if (!currentSpace) {
    throw new Error('Not logged in');
  }

  // Synchronous query for backward compatibility
  // Note: This is a limitation - we should migrate to async
  // For now, we'll need to refactor calling code
  throw new Error('query() must be migrated to async - use queryAsync()');
};

/**
 * Async query (new API)
 */
export const queryAsync = async (sql: string, params: unknown[] = []) => {
  if (!currentSpace) {
    throw new Error('Not logged in');
  }

  const result = await currentSpace.exec(sql, params);
  return result.rows;
};

/**
 * Subscribe to database changes (backward compatible)
 */
export const onDBChange = (callback: () => void) => {
  if (!currentSpace) {
    throw new Error('Not logged in');
  }

  // Use watch with a dummy query to detect any changes
  // This is a simplification - ideally we'd track all tables
  const unsubscribe = currentSpace.watch(
    'SELECT 1', // Dummy query
    [],
    () => callback()
  );

  return unsubscribe;
};

/**
 * Check if database is ready (backward compatible)
 */
export const isDatabaseReady = () => isInitialized && client !== null;

/**
 * Get pending outbox event count (backward compatible)
 */
export const getPendingCount = () => {
  // TODO: Query _ls_outbound_queue table
  return 0;
};

/**
 * Subscribe to outbox changes (backward compatible)
 */
export const onPendingChange = (callback: () => void) => {
  // TODO: Watch _ls_outbound_queue table
  return () => {};
};

// Export for direct access if needed
export { queryAsync as queryDB };
export const runSQL = execSQL;
