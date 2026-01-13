/**
 * useRoutines Hook - SQLite + Nostr Implementation
 * Provides routine CRUD operations with local-first sync
 */

import { useState, useEffect, useCallback } from 'react';
import { execSQL, query, onDBChange, isDatabaseReady } from '../db/index.js';

/**
 * Hook for managing routines with SQLite and Nostr sync
 */
export const useRoutines = () => {
    const [routines, setRoutines] = useState([]);
    const [logs, setLogs] = useState([]);

    // Load routines from SQLite
    const loadRoutines = useCallback(() => {
        if (!isDatabaseReady()) return;

        try {
            const routineRows = query(`
                SELECT 
                    id, title, 
                    time_of_day as timeOfDay,
                    reminder_time as reminderTime,
                    estimated_minutes as estimatedMinutes,
                    sort_order as sortOrder,
                    version
                FROM routines 
                ORDER BY sort_order ASC
            `);

            const logRows = query(`
                SELECT 
                    id, 
                    routine_id as routineId,
                    completed_date as completedDate,
                    completed_at as completedAt
                FROM routine_logs
                ORDER BY completed_at DESC
            `);

            setRoutines(routineRows);
            setLogs(logRows);
        } catch (err) {
            console.error('[useRoutines] Error loading:', err);
        }
    }, []);

    // Subscribe to database changes
    useEffect(() => {
        loadRoutines();
        const unsubscribe = onDBChange(loadRoutines);
        return unsubscribe;
    }, [loadRoutines]);

    /**
     * Add a new routine
     */
    const addRoutine = useCallback(async (routine) => {
        const id = crypto.randomUUID();

        await execSQL(
            `INSERT INTO routines (id, title, time_of_day, reminder_time, estimated_minutes, sort_order)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                id,
                routine.title,
                routine.timeOfDay || 'morning',
                routine.reminderTime || null,
                routine.estimatedMinutes || 5,
                routine.sortOrder || 0
            ]
        );

        loadRoutines();
    }, [loadRoutines]);

    /**
     * Toggle routine completion for today
     */
    const toggleRoutine = useCallback(async (routineId) => {
        const today = new Date().toISOString().split('T')[0];

        // Check if already logged today
        const existing = query(
            `SELECT id FROM routine_logs WHERE routine_id = ? AND completed_date = ?`,
            [routineId, today]
        );

        if (existing.length > 0) {
            // Remove log (untoggle)
            await execSQL(
                'DELETE FROM routine_logs WHERE routine_id = ? AND completed_date = ?',
                [routineId, today]
            );
        } else {
            // Add log
            await execSQL(
                `INSERT INTO routine_logs (id, routine_id, completed_date, completed_at)
                 VALUES (?, ?, ?, ?)`,
                [crypto.randomUUID(), routineId, today, new Date().toISOString()]
            );
        }

        loadRoutines();
    }, [loadRoutines]);

    /**
     * Delete a routine
     */
    const deleteRoutine = useCallback(async (id) => {
        // Delete routine and its logs
        await execSQL('DELETE FROM routine_logs WHERE routine_id = ?', [id]);
        await execSQL('DELETE FROM routines WHERE id = ?', [id]);
        
        loadRoutines();
    }, [loadRoutines]);

    /**
     * Update a routine
     */
    const updateRoutine = useCallback(async (id, updates) => {
        const fields = [];
        const values = [];

        if (updates.title !== undefined) {
            fields.push('title = ?');
            values.push(updates.title);
        }
        if (updates.timeOfDay !== undefined) {
            fields.push('time_of_day = ?');
            values.push(updates.timeOfDay);
        }
        if (updates.reminderTime !== undefined) {
            fields.push('reminder_time = ?');
            values.push(updates.reminderTime);
        }
        if (updates.estimatedMinutes !== undefined) {
            fields.push('estimated_minutes = ?');
            values.push(updates.estimatedMinutes);
        }
        if (updates.sortOrder !== undefined) {
            fields.push('sort_order = ?');
            values.push(updates.sortOrder);
        }

        fields.push('version = version + 1');
        values.push(id);

        const sql = `UPDATE routines SET ${fields.join(', ')} WHERE id = ?`;
        await execSQL(sql, values);
        
        loadRoutines();
    }, [loadRoutines]);

    return { routines, logs, addRoutine, toggleRoutine, deleteRoutine, updateRoutine };
};
