/**
 * useSettings Hook - SQLite + Nostr Implementation
 * Provides settings management with local-first sync
 */

import { useState, useEffect, useCallback } from 'react';
import { execSQL, query, onDBChange, isDatabaseReady } from '../db/index.js';
import { DEFAULT_SETTINGS } from '../db/schema.js';

// Re-export for backwards compatibility
export { DEFAULT_SETTINGS as defaultSettings } from '../db/schema.js';

/**
 * Hook for managing settings with SQLite and Nostr sync
 */
export const useSettings = () => {
    const [settings, setSettings] = useState(DEFAULT_SETTINGS);
    const [loading, setLoading] = useState(true);

    // Load settings from SQLite
    const loadSettings = useCallback(() => {
        if (!isDatabaseReady()) return;

        try {
            const rows = query('SELECT key, value FROM settings');
            
            const merged = { ...DEFAULT_SETTINGS };
            rows.forEach(row => {
                try {
                    merged[row.key] = JSON.parse(row.value);
                } catch {
                    merged[row.key] = row.value;
                }
            });

            setSettings(merged);
            setLoading(false);
        } catch (err) {
            console.error('[useSettings] Error loading:', err);
            setLoading(false);
        }
    }, []);

    // Subscribe to database changes
    useEffect(() => {
        loadSettings();
        const unsubscribe = onDBChange(loadSettings);
        return unsubscribe;
    }, [loadSettings]);

    /**
     * Update a setting
     */
    const updateSetting = useCallback(async (key, value) => {
        const jsonValue = JSON.stringify(value);
        
        await execSQL(
            'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
            [key, jsonValue]
        );

        loadSettings();
    }, [loadSettings]);

    /**
     * Batch update multiple settings
     */
    const updateSettings = useCallback(async (updates) => {
        for (const [key, value] of Object.entries(updates)) {
            await execSQL(
                'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
                [key, JSON.stringify(value)]
            );
        }
        loadSettings();
    }, [loadSettings]);

    /**
     * Reset all settings to defaults
     */
    const resetSettings = useCallback(async () => {
        for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
            await execSQL(
                'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
                [key, JSON.stringify(value)]
            );
        }
        loadSettings();
    }, [loadSettings]);

    return { settings, updateSetting, updateSettings, resetSettings, loading };
};
