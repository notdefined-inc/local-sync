/**
 * Database Module - Main Entry Point
 * Initializes SQLite, schema, and Nostr sync with offline support
 */

import { initDB, runSQL, queryDB, subscribe, isReady } from './sqlite.js';
import { initializeSchema, DEFAULT_SETTINGS } from './schema.js';
import { initEventQueue } from './event-queue.js';
import { 
    initNostrPool, 
    setCurrentUser, 
    setConversationKey,
    setSignFunction,
    publishSQL,
    getLastSyncTime,
    disconnectNostr,
    onSyncUpdate,
    setupConnectivityListeners,
    flushOutbox,
    fetchAndApplyEvents,
    RELAYS
} from './nostr-sync.js';
import { loadSnapshot, createSnapshot, shouldCreateSnapshot, incrementEventCount } from './snapshot.js';
import { getOutboxCount, onOutboxChange } from './outbox.js';

// Module state
let isInitialized = false;
let currentSignEvent = null;
let currentPubkey = null;

/**
 * Initialize the complete database system
 * @returns {Promise<void>}
 */
export const initDatabase = async () => {
    if (isInitialized) return;

    // 1. Initialize SQLite WASM
    await initDB();

    // 2. Initialize schema (includes outbox table)
    initializeSchema(runSQL);

    // 3. Initialize event queue
    initEventQueue();

    // 4. Initialize default settings if empty
    const existingSettings = queryDB('SELECT COUNT(*) as count FROM settings');
    if (existingSettings[0]?.count === 0) {
        for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
            runSQL(
                'INSERT OR IGNORE INTO settings (key, value, last_modified) VALUES (?, ?, ?)',
                [key, JSON.stringify(value), Date.now()]
            );
        }
    }

    // 5. Initialize Nostr pool
    initNostrPool();

    // 6. Setup online/offline listeners
    setupConnectivityListeners();

    isInitialized = true;
    console.log('[DB] Database system initialized');
};

/**
 * Start syncing with Nostr
 * @param {string} pubkey - User's public key
 * @param {Function} signEvent - NIP-07 signing function
 * @param {Uint8Array} conversationKey - NIP-44 conversation key
 */
export const startSync = async (pubkey, signEvent, conversationKey) => {
    currentPubkey = pubkey;
    currentSignEvent = signEvent;

    // Set user and encryption key
    setCurrentUser(pubkey);
    setSignFunction(signEvent);
    if (conversationKey) {
        setConversationKey(conversationKey);
    }

    // Try loading snapshot first
    const snapshotTime = await loadSnapshot(pubkey);
    
    // Get last sync time (either from snapshot or stored)
    const since = Math.max(snapshotTime, getLastSyncTime());

    console.log('[DB] Fetching events since:', new Date(since * 1000));

    // IMPORTANT: Fetch and apply all events BEFORE showing UI
    // This ensures data is loaded on login
    const eventCount = await fetchAndApplyEvents(pubkey, since);
    console.log('[DB] Applied', eventCount, 'events from Nostr');

    // Flush any pending outbox events
    flushOutbox();

    console.log('[DB] Sync started successfully');
};

/**
 * Stop syncing
 */
export const stopSync = () => {
    disconnectNostr();
    currentPubkey = null;
    currentSignEvent = null;
};

/**
 * Execute and publish a SQL command with last_modified timestamp
 * @param {string} sql - SQL statement
 * @param {Array} params - Parameters
 */
export const execSQL = async (sql, params = []) => {
    const timestampMs = Date.now();

    // 1. Execute locally (optimistic UI)
    runSQL(sql, params);

    // 2. Publish to Nostr if syncing
    if (currentSignEvent && currentPubkey) {
        try {
            await publishSQL(sql, params, currentSignEvent, timestampMs);
            incrementEventCount();

            // Check if we should create a snapshot
            if (shouldCreateSnapshot()) {
                await createSnapshot(currentPubkey, currentSignEvent);
            }
        } catch (err) {
            console.error('[DB] Failed to publish SQL:', err);
            // Event is queued in outbox automatically
        }
    }
};

/**
 * Query the database
 * @param {string} sql - SQL SELECT statement
 * @param {Array} params - Parameters
 * @returns {Array<Object>}
 */
export const query = (sql, params = []) => {
    return queryDB(sql, params);
};

/**
 * Subscribe to database changes
 * @param {Function} callback
 * @returns {Function} Unsubscribe
 */
export const onDBChange = (callback) => {
    const unsubLocal = subscribe(callback);
    const unsubSync = onSyncUpdate(callback);
    
    return () => {
        unsubLocal();
        unsubSync();
    };
};

/**
 * Check if database is ready
 */
export const isDatabaseReady = () => isInitialized && isReady();

/**
 * Get pending outbox event count
 */
export const getPendingCount = () => getOutboxCount();

/**
 * Subscribe to outbox changes
 */
export const onPendingChange = (callback) => onOutboxChange(callback);

// Export for direct access if needed
export { runSQL, queryDB } from './sqlite.js';
