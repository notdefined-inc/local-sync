/**
 * Outbox Module - Offline Event Queue
 * Handles queuing and flushing of events when device is offline/online
 */

import { runSQL, queryDB } from './sqlite.js';

// Max retry attempts before discarding
const MAX_RETRIES = 5;

// Listeners for outbox status changes
const outboxListeners = new Set();

/**
 * Add a signed event to the outbox for later sync
 * @param {Object} signedEvent - Signed Nostr event
 */
export const addToOutbox = (signedEvent) => {
    runSQL(
        'INSERT OR REPLACE INTO outbox (id, event_json, created_at, retry_count) VALUES (?, ?, ?, ?)',
        [signedEvent.id, JSON.stringify(signedEvent), Date.now(), 0]
    );
    console.log('[Outbox] Queued event:', signedEvent.id.slice(0, 8) + '...');
    notifyOutboxListeners();
};

/**
 * Get all pending events from outbox, ordered by creation time
 * @returns {Array<Object>} Array of signed events
 */
export const getPendingEvents = () => {
    try {
        const rows = queryDB('SELECT id, event_json, retry_count FROM outbox ORDER BY created_at ASC');
        return rows.map(row => ({
            ...JSON.parse(row.event_json),
            _retryCount: row.retry_count
        }));
    } catch (err) {
        console.error('[Outbox] Error reading:', err);
        return [];
    }
};

/**
 * Remove an event from the outbox (successfully published)
 * @param {string} eventId - Event ID to remove
 */
export const removeFromOutbox = (eventId) => {
    runSQL('DELETE FROM outbox WHERE id = ?', [eventId]);
    console.log('[Outbox] Removed event:', eventId.slice(0, 8) + '...');
    notifyOutboxListeners();
};

/**
 * Increment retry count for a failed event
 * @param {string} eventId - Event ID
 */
export const incrementRetry = (eventId) => {
    runSQL('UPDATE outbox SET retry_count = retry_count + 1 WHERE id = ?', [eventId]);
};

/**
 * Remove events that have exceeded max retries
 */
export const cleanupFailedEvents = () => {
    const removed = queryDB(
        'SELECT id FROM outbox WHERE retry_count >= ?',
        [MAX_RETRIES]
    );
    
    if (removed.length > 0) {
        runSQL('DELETE FROM outbox WHERE retry_count >= ?', [MAX_RETRIES]);
        console.log('[Outbox] Cleaned up', removed.length, 'failed events');
        notifyOutboxListeners();
    }
};

/**
 * Get the count of pending events
 * @returns {number}
 */
export const getOutboxCount = () => {
    try {
        const rows = queryDB('SELECT COUNT(*) as count FROM outbox');
        return rows[0]?.count || 0;
    } catch {
        return 0;
    }
};

/**
 * Check if outbox has pending events
 * @returns {boolean}
 */
export const hasOutboxEvents = () => getOutboxCount() > 0;

/**
 * Subscribe to outbox status changes
 * @param {Function} callback
 * @returns {Function} Unsubscribe
 */
export const onOutboxChange = (callback) => {
    outboxListeners.add(callback);
    return () => outboxListeners.delete(callback);
};

/**
 * Notify listeners of outbox changes
 */
const notifyOutboxListeners = () => {
    const count = getOutboxCount();
    outboxListeners.forEach(cb => cb(count));
};

/**
 * Check if browser is online
 * @returns {boolean}
 */
export const isOnline = () => {
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
};
