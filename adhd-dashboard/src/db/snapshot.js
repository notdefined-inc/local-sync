/**
 * Snapshot Management
 * Handles database checkpoints for fast bootstrapping
 */

import pako from 'pako';
import { SimplePool } from 'nostr-tools';
import { exportDB, importDB, runSQL, queryDB } from './sqlite.js';
import { RELAYS, SNAPSHOT_KIND, setLastSyncTime } from './nostr-sync.js';

// Snapshot configuration
const SNAPSHOT_INTERVAL = 100; // Create snapshot every N events
const MAX_SNAPSHOT_SIZE = 64 * 1024; // 64KB max for single event

let eventsSinceSnapshot = 0;

/**
 * Check if we should create a new snapshot
 */
export const shouldCreateSnapshot = () => {
    return eventsSinceSnapshot >= SNAPSHOT_INTERVAL;
};

/**
 * Increment event counter
 */
export const incrementEventCount = () => {
    eventsSinceSnapshot++;
};

/**
 * Reset event counter after snapshot
 */
export const resetEventCount = () => {
    eventsSinceSnapshot = 0;
};

/**
 * Create and publish a database snapshot
 * @param {string} pubkey - User's public key
 * @param {Function} signEvent - NIP-07 signing function
 */
export const createSnapshot = async (pubkey, signEvent) => {
    console.log('[Snapshot] Creating new snapshot...');

    // Export database
    const dbBinary = exportDB();
    
    // Compress with pako (gzip)
    const compressed = pako.deflate(dbBinary);
    
    // Convert to base64 for Nostr
    const base64 = btoa(String.fromCharCode(...compressed));
    
    console.log(`[Snapshot] DB: ${dbBinary.length} bytes -> ${compressed.length} compressed -> ${base64.length} base64`);

    // Check size limit
    if (base64.length > MAX_SNAPSHOT_SIZE) {
        console.warn('[Snapshot] Snapshot too large for single event, skipping');
        // TODO: Implement chunking or Blossom upload
        return null;
    }

    const eventTemplate = {
        kind: SNAPSHOT_KIND,
        pubkey: pubkey,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
            ['d', 'adhd-dashboard-snapshot'], // Addressable identifier
        ],
        content: base64
    };

    const signedEvent = await signEvent(eventTemplate);
    
    // Publish
    const pool = new SimplePool();
    await Promise.allSettled(pool.publish(RELAYS, signedEvent));
    
    // Reset counter
    resetEventCount();
    
    // Update sync time
    setLastSyncTime(signedEvent.created_at);

    console.log('[Snapshot] Published snapshot:', signedEvent.id.slice(0, 8) + '...');
    return signedEvent;
};

/**
 * Load the latest snapshot from Nostr
 * @param {string} pubkey - User's public key
 * @returns {number} Timestamp of loaded snapshot (for catching up)
 */
export const loadSnapshot = async (pubkey) => {
    console.log('[Snapshot] Looking for latest snapshot...');
    
    const pool = new SimplePool();
    
    const events = await pool.querySync(RELAYS, {
        authors: [pubkey],
        kinds: [SNAPSHOT_KIND],
        '#d': ['adhd-dashboard-snapshot'],
        limit: 1
    });

    if (events.length === 0) {
        console.log('[Snapshot] No snapshot found, starting fresh');
        return 0;
    }

    const latestSnapshot = events[0];
    console.log('[Snapshot] Found snapshot from:', new Date(latestSnapshot.created_at * 1000));

    try {
        // Decode base64
        const binary = atob(latestSnapshot.content);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        
        // Decompress
        const decompressed = pako.inflate(bytes);
        
        // Import to SQLite
        await importDB(decompressed);
        
        console.log('[Snapshot] Loaded snapshot successfully');
        return latestSnapshot.created_at;
    } catch (err) {
        console.error('[Snapshot] Error loading snapshot:', err);
        return 0;
    }
};

/**
 * Get event count since last snapshot
 * @returns {number}
 */
export const getEventCount = () => eventsSinceSnapshot;
