/**
 * Nostr Synchronization Module
 * Handles publishing and receiving SQL commands over Nostr
 */

import { SimplePool, finalizeEvent, nip04, nip44 } from 'nostr-tools';
import { runSQL, queryDB } from './sqlite.js';
import { enqueueEvent, processQueue, isEventApplied, markEventApplied } from './event-queue.js';
import { addToOutbox, isOnline } from './outbox.js';

// Configuration
export const RELAYS = [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.nostr.band',
    'wss://nostr.wine',
    'wss://purplepag.es'
];

// Kind 1 (Text Note) is universally supported and indexed
export const SQL_KIND = 1; 

// ...



export const SNAPSHOT_KIND = 30005; // Custom kind for DB snapshots

// State
let pool = null;
let subscription = null;
let currentPubkey = null;
let conversationKey = null; // NIP-44 key
let signEventFn = null;
const syncListeners = new Set();
// Track connection status
let isConnected = false;

/**
 * Set current user's public key
 */
export const setCurrentUser = (pubkey) => {
    currentPubkey = pubkey;
};

/**
 * Set NIP-44 conversation key
 */
export const setConversationKey = (key) => {
    conversationKey = key;
};

/**
 * Set signing function
 */
export const setSignFunction = (fn) => {
    signEventFn = fn;
    // Update outbox module with sign function
    import('./outbox.js').then(mod => {
        if (mod.setSignFunction) mod.setSignFunction(fn);
    });
};

/**
 * Encrypt content using NIP-44 (xchacha20)
 */
const encryptContent = (content) => {
    if (!conversationKey) throw new Error('No conversation key set');
    
    if (conversationKey.length !== 32) {
        console.error('[Nostr] Invalid conversation key length:', conversationKey.length);
        throw new Error('Conversation key must be 32 bytes');
    }

    // Let library generate nonce
    return nip44.v2.encrypt(content, conversationKey);
};

/**
 * Decrypt content using NIP-44
 */
const decryptContent = (content) => {
    if (!conversationKey) throw new Error('No conversation key set');
    return nip44.v2.decrypt(content, conversationKey);
};

/**
 * Publish a SQL command to Nostr
 * @param {string} sql - SQL statement
 * @param {Array} params - Parameters
 * @param {Function} signEvent - Signing function
 * @param {number} timestamp - Creation timestamp (ms or seconds)
 */
export const publishSQL = async (sql, params = [], signEvent, timestamp = Date.now()) => {
    const timestampMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
    const payload = JSON.stringify({ sql, params });
    const encrypted = encryptContent(payload);

    // Use unique 'd' tag to ensure persistence (append-only log via NIP-78)
    const uniqueId = crypto.randomUUID();
    const dTag = `sql-log-${timestampMs}-${uniqueId}`;

    const eventTemplate = {
        kind: SQL_KIND,
        created_at: Math.floor(timestampMs / 1000),
        tags: [
            ['t', 'adhd-sync-log'], // Hashtag for indexing (Relays support this for Kind 1)
            ['p', currentPubkey],   // Self-dm
            ['d', dTag]
        ],
        content: encrypted
    };

    let signedEvent;
    try {
        signedEvent = await signEvent(eventTemplate);

        if (!isOnline()) {
            console.log('[Nostr] Offline, saving to outbox');
            addToOutbox(signedEvent);
            return signedEvent;
        }
    
        if (!pool) initNostrPool();
        
        // Use Promise.any to proceed as soon as one relay accepts
        // but retry others in background
        const pubs = pool.publish(RELAYS, signedEvent);
        await Promise.any(pubs);
        
        console.log(`[Nostr] Published SQL kind=${signedEvent.kind} d=${dTag}`);
        return signedEvent;
    } catch (err) {
        console.warn('[Nostr] Publish failed, saving to outbox:', err);
        if (signedEvent) {
            addToOutbox(signedEvent);
        }
        throw err;
    }
};



export const initNostrPool = () => {
    if (pool) return;
    pool = new SimplePool();
    isConnected = true;
    console.log('[Nostr] Pool initialized (Kind 1 SQL log)');
};

/**
 * Fetch and apply events synchronously (for initial load)
 * @param {string} pubkey - User's public key
 * @param {number} since - Timestamp to fetch from
 * @returns {Promise<number>} Count of applied events
 */
export const fetchAndApplyEvents = async (pubkey, since = 0) => {
    if (!pool) initNostrPool();
    
    console.log('[Nostr] Fetching events from relays...');
    
    try {
        const filter = {
            authors: [pubkey],
            kinds: [SQL_KIND],
            since: since,
            limit: 500 // Safety cap, rely on client-side filtering
        };

        // Fetch all events with an EOSE timeout to avoid hanging on slow relays.
        const events = await pool.querySync(RELAYS, filter, { maxWait: 8000 });

        if (events.length === 0) {
            console.log('[Nostr] Pool initialized (v6 - Client-Side Filtering applied)');
            subscribeToEvents(() => {}, since); // Start listening for new ones
            return 0;
        }

        // Sort by created_at (oldest first), then by id for deterministic ordering
        events.sort((a, b) => {
            if (a.created_at !== b.created_at) {
                return a.created_at - b.created_at;
            }
            return a.id.localeCompare(b.id);
        });

        console.log(`[Nostr] Applying ${events.length} historical events...`);

        // Apply events in order
        let appliedCount = 0;
        let latestTime = since;
        for (const event of events) {
            if (isEventApplied(event.id)) {
                continue;
            }

            if (event.created_at > latestTime) {
                latestTime = event.created_at;
            }

            try {
                // Client-side filter: Only process SQL logs (ignore Vault etc)
                // Check if 't' tag exists and value is 'adhd-sync-log'
                const isSqlLog = event.tags.some(t => t[0] === 't' && t[1] === 'adhd-sync-log');
                if (!isSqlLog) {
                    console.log('[Nostr] Skipping non-SQL log event:', event.id, 'Tags:', event.tags);
                    continue; 
                }

                const decrypted = decryptContent(event.content);
                const payload = JSON.parse(decrypted);
                
                // Execute directly to ensure synchronous DB state
                applyRemoteSQL(payload.sql, payload.params, event.created_at);
                appliedCount++;
                markEventApplied(event.id);
            } catch (err) {
                console.error('[Nostr] Failed to decrypt/apply event:', event.id, err);
            }
        }

        console.log(`[Nostr] Successfully applied ${appliedCount} events`);
        
        // Start live subscription from the latest applied event time
        const overlapSeconds = 60;
        const baseSince = appliedCount > 0 ? latestTime : since;
        const liveSince = Math.max(0, baseSince - overlapSeconds);
        subscribeToEvents(() => {}, liveSince);

        return appliedCount;
    } catch (err) {
        console.error('[Nostr] Error fetching events:', err);
        // Fallback to regular subscription
        subscribeToEvents(() => {}, since);
        return 0;
    }
};

/**
 * Subscribe to SQL events from Nostr
 * @param {Function} onEvent - Callback for each event
 * @param {number} since - Unix timestamp to fetch from
 */
export const subscribeToEvents = (onEvent, since = 0) => {
    if (!pool) initNostrPool();
    if (!currentPubkey) throw new Error('User not set');

    if (subscription) {
        subscription.close();
    }

    const filter = {
        authors: [currentPubkey],
        kinds: [SQL_KIND],
        since: since, // Start from NOW only (or since loading finished)
        limit: 100
    };

    console.log('[Nostr] Starting live subscription from:', new Date(since * 1000));

    subscription = pool.subscribeMany(RELAYS, filter, {
        onevent(event) {
            if (isEventApplied(event.id)) {
                return;
            }

            try {
                // Client-side filter: Only process SQL logs
                const isSqlLog = event.tags.some(t => t[0] === 't' && t[1] === 'adhd-sync-log');
                if (!isSqlLog) return;

                const decrypted = decryptContent(event.content);
                const payload = JSON.parse(decrypted);
                
                if (enqueueEvent(event)) {
                    processQueue((evt) => {
                        // Re-decrypt needed because queue stores raw event
                        // Optimization: could store decrypted payload
                        const rawPayload = decryptContent(evt.content);
                        const data = JSON.parse(rawPayload);
                        applyRemoteSQL(data.sql, data.params, evt.created_at);
                    });
                    
                    notifySyncListeners();
                }
            } catch (err) {
                console.error('[Nostr] Error processing event:', err);
            }
        },
        oneose() {
            // Live phases don't really end, but good to know we connected
            console.log('[Nostr] Connected to relays');
        }
    });

    return subscription;
};

/**
 * Apply a SQL command received from remote
 * Uses timestamp-based conflict resolution
 * @param {string} sql - SQL statement
 * @param {Array} params - Parameters  
 * @param {number} eventTimestamp - When the event was created (seconds)
 */
const applyRemoteSQL = (sql, params = [], eventTimestamp = 0) => {
    try {
        let result = 0;
        
        // For UPDATE statements, inject timestamp check for conflict resolution
        if (sql.toUpperCase().includes('UPDATE') && eventTimestamp > 0) {
            // Modify UPDATE to only apply if incoming is newer
            // Check last_modified (millis) against eventTimestamp (seconds * 1000)
            const modifiedSQL = sql.replace(
                /WHERE\s+id\s*=\s*\?/i,
                `WHERE id = ? AND (last_modified IS NULL OR last_modified < ${eventTimestamp * 1000})`
            );
            
            console.log(`[Nostr] Applying UPDATE: ${modifiedSQL} (Ts: ${eventTimestamp * 1000})`);
            result = runSQL(modifiedSQL, params);
            
            if (result === 0) {
                 // Debug why it failed - check the current row
                 const idParam = params[params.length - 1]; // ID is usually last
                 const rows = queryDB('SELECT last_modified FROM tasks WHERE id = ?', [idParam]);
                 if (rows.length > 0) {
                     console.warn(`[Nostr] Conflict: Skipping update. Local: ${rows[0].last_modified} >= Remote: ${eventTimestamp * 1000}`);
                 } else {
                     console.warn('[Nostr] Update failed: Row not found');
                 }
            } else {
                 console.log('[Nostr] UPDATE applied successfully');
            }
        } else {
            result = runSQL(sql, params);
            console.log('[Nostr] Applied SQL:', sql.substring(0, 100));
        }
    } catch (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
            console.log('[Nostr] Duplicate entry, skipping');
            return;
        }
        console.error('[Nostr] SQL error:', err);
    }
};

/**
 * Add a listener for sync updates
 */
export const onSyncUpdate = (callback) => {
    syncListeners.add(callback);
    return () => syncListeners.delete(callback);
};

const notifySyncListeners = () => {
    syncListeners.forEach(cb => cb());
};

/**
 * Get the last sync timestamp from DB
 */
export const getLastSyncTime = () => {
    try {
        // Ensure table exists just in case
        const rows = queryDB("SELECT value FROM sync_meta WHERE key = 'last_sync_time'");
        if (rows.length > 0) {
            return parseInt(rows[0].value, 10);
        }
    } catch (err) {}
    return 0;
};

/**
 * Update the last sync timestamp
 */
export const setLastSyncTime = (timestamp) => {
    runSQL(
        "INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('last_sync_time', ?)",
        [String(timestamp)]
    );
};

/**
 * Disconnect from Nostr
 */
export const disconnectNostr = () => {
    if (subscription) {
        subscription.close();
        subscription = null;
    }
    // We don't clear keys/user immediately on disconnect as we might reconnect
    isConnected = false;
    console.log('[Nostr] Disconnected');
};

/**
 * Setup listeners for online/offline status
 */
export const setupConnectivityListeners = () => {
    window.addEventListener('online', () => {
        console.log('[Network] Online');
        isConnected = true;
        flushOutbox();
    });
    
    window.addEventListener('offline', () => {
        console.log('[Network] Offline');
        isConnected = false;
    });
};

/**
 * Flush outbox locally
 * Uses getPendingEvents and removeFromOutbox from outbox.js
 */
export const flushOutbox = async () => {
    if (!isOnline() || !pool) return;

    // Dynamically import to get fresh state if needed, or use imported functions
    // We already imported getPendingEvents etc at top level
    const { getPendingEvents, removeFromOutbox, incrementRetry } = await import('./outbox.js');
    
    const  pending = getPendingEvents();
    if (pending.length === 0) return;

    console.log(`[Outbox] Flushing ${pending.length} events...`);

    for (const event of pending) {
        try {
            // We can't use publishSQL here because it might queue again if check fails?
            // Actually publishSQL checks isOnline().
            // But we already have the signed event! We just need to publish it.
            
            // Note: event is already signed.
            // We just publish directly to pool.
            
            const pubs = pool.publish(RELAYS, event);
            try {
                await Promise.any(pubs);
                console.log('[Outbox] Successfully published:', event.id.slice(0, 8));
                removeFromOutbox(event.id);
            } catch (err) {
                console.warn('[Outbox] Failed to publish:', event.id.slice(0, 8), err);
                incrementRetry(event.id);
            }
            
        } catch (err) {
            console.error('[Outbox] Error flushing event:', err);
        }
    }
};
