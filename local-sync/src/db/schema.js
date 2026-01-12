/**
 * Database Schema Definitions
 * Idempotent migrations - safe to run multiple times
 */

// Schema version for tracking migrations
export const SCHEMA_VERSION = 2;

// All table creation statements (idempotent)
export const SCHEMA_SQL = `
-- Tasks table with last_modified for conflict resolution
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'today',
    priority INTEGER DEFAULT 0,
    is_current_focus INTEGER DEFAULT 0,
    scheduled_date TEXT,
    created_at TEXT,
    completed_at TEXT,
    last_modified INTEGER DEFAULT 0,
    version INTEGER DEFAULT 1
);

-- Routines table with last_modified
CREATE TABLE IF NOT EXISTS routines (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    time_of_day TEXT DEFAULT 'morning',
    reminder_time TEXT,
    estimated_minutes INTEGER DEFAULT 5,
    sort_order INTEGER DEFAULT 0,
    last_modified INTEGER DEFAULT 0,
    version INTEGER DEFAULT 1
);

-- Routine completion logs
CREATE TABLE IF NOT EXISTS routine_logs (
    id TEXT PRIMARY KEY,
    routine_id TEXT NOT NULL,
    completed_date TEXT NOT NULL,
    completed_at TEXT,
    last_modified INTEGER DEFAULT 0,
    FOREIGN KEY (routine_id) REFERENCES routines(id)
);

-- Focus sessions
CREATE TABLE IF NOT EXISTS focus_sessions (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    started_at TEXT,
    ended_at TEXT,
    FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- Settings (key-value store)
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    last_modified INTEGER DEFAULT 0
);

-- Sync metadata
CREATE TABLE IF NOT EXISTS sync_meta (
    key TEXT PRIMARY KEY,
    value TEXT
);

-- Applied events tracking (prevent re-applying)
CREATE TABLE IF NOT EXISTS applied_events (
    event_id TEXT PRIMARY KEY,
    applied_at TEXT
);

-- Outbox for offline events (pending sync)
CREATE TABLE IF NOT EXISTS outbox (
    id TEXT PRIMARY KEY,
    event_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    retry_count INTEGER DEFAULT 0
);

-- Users table for password vault auth
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    vault TEXT NOT NULL,
    pubkey TEXT NOT NULL,
    created_at TEXT
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_focus ON tasks(is_current_focus);
CREATE INDEX IF NOT EXISTS idx_tasks_modified ON tasks(last_modified);
CREATE INDEX IF NOT EXISTS idx_routine_logs_date ON routine_logs(completed_date);
CREATE INDEX IF NOT EXISTS idx_outbox_created ON outbox(created_at);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
`;

// Migration SQL for adding columns to existing tables
export const MIGRATIONS_SQL = `
-- Add last_modified to existing tables (idempotent via try/catch)
ALTER TABLE tasks ADD COLUMN last_modified INTEGER DEFAULT 0;
ALTER TABLE routines ADD COLUMN last_modified INTEGER DEFAULT 0;
ALTER TABLE routine_logs ADD COLUMN last_modified INTEGER DEFAULT 0;
ALTER TABLE settings ADD COLUMN last_modified INTEGER DEFAULT 0;
`;

/**
 * Initialize schema on a database
 * @param {Function} runSQL - SQL execution function
 */
export const initializeSchema = (runSQL) => {
    // Split and execute each statement
    const statements = SCHEMA_SQL
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0);

    for (const stmt of statements) {
        try {
            runSQL(stmt + ';');
        } catch (err) {
            // Ignore "already exists" errors for idempotency
            if (!err.message.includes('already exists')) {
                console.error('[Schema] Error:', err);
            }
        }
    }

    // Run migrations (add columns to existing tables)
    const migrations = MIGRATIONS_SQL
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0);

    for (const stmt of migrations) {
        try {
            runSQL(stmt + ';');
        } catch (err) {
            // Ignore "duplicate column" errors
            if (!err.message.includes('duplicate column')) {
                // Silently skip other migration errors
            }
        }
    }

    console.log('[Schema] Database schema initialized (v' + SCHEMA_VERSION + ')');
};

/**
 * Default settings values
 */
export const DEFAULT_SETTINGS = {
    theme: 'dark',
    focusDuration: 25,
    breakDuration: 5,
    bedtime: '23:30',
    soundEnabled: true,
    gamificationEnabled: true
};
