/**
 * useTasks Hook - SQLite + Nostr Implementation
 * Provides task CRUD operations with local-first sync
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { execSQL, query, onDBChange, isDatabaseReady } from '../db/index.js';

/**
 * Hook for managing tasks with SQLite and Nostr sync
 */
export const useTasks = () => {
    const [tasks, setTasks] = useState([]);
    const [refreshKey, setRefreshKey] = useState(0);

    // Load tasks from SQLite
    const loadTasks = useCallback(() => {
        if (!isDatabaseReady()) return;
        
        try {
            const rows = query(`
                SELECT 
                    id, title, description, status, priority,
                    is_current_focus as isCurrentFocus,
                    scheduled_date as scheduledDate,
                    created_at as createdAt,
                    completed_at as completedAt,
                    version
                FROM tasks 
                ORDER BY created_at DESC
            `);
            
            // Convert SQLite integers to booleans
            const mapped = rows.map(row => ({
                ...row,
                isCurrentFocus: Boolean(row.isCurrentFocus)
            }));
            
            setTasks(mapped);
            console.log('[useTasks] Loaded', mapped.length, 'tasks');
        } catch (err) {
            console.error('[useTasks] Error loading tasks:', err);
        }
    }, []);

    // Subscribe to database changes
    useEffect(() => {
        // Initial load
        loadTasks();

        // Subscribe to changes (local + sync)
        const unsubscribe = onDBChange(() => {
            console.log('[useTasks] DB change detected, reloading...');
            loadTasks();
        });
        return unsubscribe;
    }, [loadTasks, refreshKey]);

    // Force refresh function
    const forceRefresh = useCallback(() => {
        setRefreshKey(k => k + 1);
    }, []);

    /**
     * Add a new task
     */
    const addTask = useCallback(async (task) => {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const timestamp = Date.now();
        
        // Optimistic update
        const newTask = {
            id,
            title: task.title,
            description: task.description || null,
            status: task.status || 'today',
            priority: task.priority || 0,
            isCurrentFocus: false,
            scheduledDate: task.scheduledDate || now.split('T')[0],
            createdAt: now,
            completedAt: null,
            version: 1
        };
        setTasks(prev => [newTask, ...prev]);
        
        await execSQL(
            `INSERT INTO tasks (id, title, description, status, priority, is_current_focus, scheduled_date, created_at, last_modified) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                task.title,
                task.description || null,
                task.status || 'today',
                task.priority || 0,
                0,
                task.scheduledDate || now.split('T')[0],
                now,
                timestamp
            ]
        );
        
        loadTasks();
    }, [loadTasks]);

    /**
     * Update a task with optimistic concurrency
     */
    const updateTask = useCallback(async (id, updates) => {
        // Optimistic update - update local state immediately
        setTasks(prev => prev.map(t => {
            if (t.id !== id) return t;
            return {
                ...t,
                ...updates,
                isCurrentFocus: updates.isCurrentFocus !== undefined 
                    ? updates.isCurrentFocus 
                    : t.isCurrentFocus
            };
        }));

        // Build dynamic update query
        const fields = [];
        const values = [];

        if (updates.title !== undefined) {
            fields.push('title = ?');
            values.push(updates.title);
        }
        if (updates.description !== undefined) {
            fields.push('description = ?');
            values.push(updates.description);
        }
        if (updates.status !== undefined) {
            fields.push('status = ?');
            values.push(updates.status);
            if (updates.status === 'done') {
                fields.push('completed_at = ?');
                values.push(new Date().toISOString());
            }
        }
        if (updates.priority !== undefined) {
            fields.push('priority = ?');
            values.push(updates.priority);
        }
        if (updates.isCurrentFocus !== undefined) {
            fields.push('is_current_focus = ?');
            values.push(updates.isCurrentFocus ? 1 : 0);
        }
        if (updates.scheduledDate !== undefined) {
            fields.push('scheduled_date = ?');
            values.push(updates.scheduledDate);
        }

        // Increment version for optimistic concurrency
        fields.push('version = version + 1');

        // Update last_modified for conflict resolution
        const timestamp = Date.now();
        fields.push('last_modified = ?');
        values.push(timestamp);

        // Add id for WHERE clause
        values.push(id);

        const sql = `UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`;
        await execSQL(sql, values);
        
        // Reload to sync with actual DB state
        loadTasks();
    }, [loadTasks]);

    /**
     * Delete a task
     */
    const deleteTask = useCallback(async (id) => {
        // Optimistic update
        setTasks(prev => prev.filter(t => t.id !== id));
        
        await execSQL('DELETE FROM tasks WHERE id = ?', [id]);
        loadTasks();
    }, [loadTasks]);

    /**
     * Set a task as the current focus
     */
    const setCurrentFocus = useCallback(async (taskId) => {
        // Optimistic update - clear all focus first
        setTasks(prev => prev.map(t => ({
            ...t,
            isCurrentFocus: t.id === taskId
        })));

        const timestamp = Date.now();
        
        // Clear all current focus
        await execSQL(
            'UPDATE tasks SET is_current_focus = 0, last_modified = ? WHERE is_current_focus = 1',
            [timestamp]
        );

        if (taskId) {
            // Set new focus
            await execSQL(
                'UPDATE tasks SET is_current_focus = 1, last_modified = ? WHERE id = ?',
                [timestamp, taskId]
            );

            // Create focus session
            await execSQL(
                'INSERT INTO focus_sessions (id, task_id, started_at) VALUES (?, ?, ?)',
                [crypto.randomUUID(), taskId, new Date().toISOString()]
            );
        }

        loadTasks();
    }, [loadTasks]);

    return {
        tasks,
        addTask,
        updateTask,
        deleteTask,
        setCurrentFocus,
        forceRefresh
    };
};
