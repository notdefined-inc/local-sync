/**
 * Event Queue with Deterministic Ordering
 * Handles conflict resolution using timestamp + event ID
 */

import { runSQL, queryDB } from './sqlite.js';

// In-memory event queue for pending events
let eventQueue = [];

// Set of applied event IDs (for deduplication)
const appliedEventIds = new Set();

/**
 * Initialize applied events from database
 */
export const initEventQueue = () => {
    try {
        const rows = queryDB('SELECT event_id FROM applied_events');
        rows.forEach(row => appliedEventIds.add(row.event_id));
        console.log(`[EventQueue] Loaded ${appliedEventIds.size} applied event IDs`);
    } catch (err) {
        console.log('[EventQueue] No applied events found, starting fresh');
    }
};

/**
 * Check if an event has already been applied
 * @param {string} eventId - Nostr event ID
 * @returns {boolean}
 */
export const isEventApplied = (eventId) => {
    return appliedEventIds.has(eventId);
};

/**
 * Mark an event as applied
 * @param {string} eventId - Nostr event ID
 */
export const markEventApplied = (eventId) => {
    if (appliedEventIds.has(eventId)) return;
    
    appliedEventIds.add(eventId);
    runSQL(
        'INSERT OR IGNORE INTO applied_events (event_id, applied_at) VALUES (?, ?)',
        [eventId, new Date().toISOString()]
    );
};

/**
 * Add event to queue and sort by deterministic order
 * @param {Object} event - Nostr event object
 */
export const enqueueEvent = (event) => {
    // Skip if already applied
    if (isEventApplied(event.id)) {
        return false;
    }

    eventQueue.push(event);
    
    // Sort by created_at (ascending), then by id (alphabetical) for ties
    eventQueue.sort((a, b) => {
        if (a.created_at !== b.created_at) {
            return a.created_at - b.created_at;
        }
        return a.id.localeCompare(b.id);
    });

    return true;
};

/**
 * Process all queued events in order
 * @param {Function} applyEvent - Function to apply a single event
 */
export const processQueue = (applyEvent) => {
    while (eventQueue.length > 0) {
        const event = eventQueue.shift();
        
        // Double-check not already applied
        if (isEventApplied(event.id)) {
            continue;
        }

        try {
            applyEvent(event);
            markEventApplied(event.id);
        } catch (err) {
            console.error('[EventQueue] Error applying event:', event.id, err);
            // Put back at front? Or discard? For now, discard to avoid infinite loop
        }
    }
};

/**
 * Get current queue size
 * @returns {number}
 */
export const getQueueSize = () => eventQueue.length;

/**
 * Clear the queue (for testing)
 */
export const clearQueue = () => {
    eventQueue = [];
};
