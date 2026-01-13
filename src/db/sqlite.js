/**
 * SQLite WASM Database Initialization
 * Provides in-browser SQL query capabilities using sql.js
 */
import initSqlJs from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

// Database instance
let db = null;
let isInitialized = false;

// Event listeners for state changes
const listeners = new Set();

/**
 * Initialize SQLite WASM database
 * @returns {Promise<Database>} SQLite database instance
 */
export const initDB = async () => {
    if (db && isInitialized) return db;

    const SQL = await initSqlJs({
        // Use bundled WASM to match the sql.js package version.
        locateFile: () => sqlWasmUrl
    });

    db = new SQL.Database();
    isInitialized = true;

    console.log('[SQLite] Database initialized');
    return db;
};

/**
 * Execute a parameterized SQL statement (INSERT, UPDATE, DELETE)
 * @param {string} sql - SQL statement with ? placeholders
 * @param {Array} params - Parameters to bind
 * @returns {number} Number of rows modified
 */
export const runSQL = (sql, params = []) => {
    if (!db) throw new Error('Database not initialized');
    
    try {
        db.run(sql, params);
        const changes = db.getRowsModified();
        notifyListeners();
        return changes;
    } catch (err) {
        // Handle idempotent migrations (duplicate column, table exists, etc.)
        if (err.message.includes('duplicate column name') ||
            err.message.includes('already exists')) {
            console.log('[SQLite] Idempotent operation skipped:', err.message);
            return 0;
        }
        console.error('[SQLite] Error:', err);
        throw err;
    }
};

/**
 * Execute a SELECT query and return results as array of objects
 * @param {string} sql - SQL SELECT statement
 * @param {Array} params - Parameters to bind
 * @returns {Array<Object>} Query results
 */
export const queryDB = (sql, params = []) => {
    if (!db) throw new Error('Database not initialized');

    const stmt = db.prepare(sql);
    if (params.length > 0) {
        stmt.bind(params);
    }

    const results = [];
    while (stmt.step()) {
        results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
};

/**
 * Export database as binary for snapshots
 * @returns {Uint8Array} Database binary
 */
export const exportDB = () => {
    if (!db) throw new Error('Database not initialized');
    return db.export();
};

/**
 * Import database from binary snapshot
 * @param {Uint8Array} binary - Database binary
 */
export const importDB = async (binary) => {
    const SQL = await initSqlJs({
        locateFile: () => sqlWasmUrl
    });
    
    db = new SQL.Database(binary);
    isInitialized = true;
    notifyListeners();
    console.log('[SQLite] Database imported from snapshot');
};

/**
 * Subscribe to database changes
 * @param {Function} callback - Callback function
 * @returns {Function} Unsubscribe function
 */
export const subscribe = (callback) => {
    listeners.add(callback);
    return () => listeners.delete(callback);
};

/**
 * Notify all listeners of state change
 */
const notifyListeners = () => {
    listeners.forEach(callback => callback());
};

/**
 * Get database instance (for advanced usage)
 * @returns {Database|null}
 */
export const getDB = () => db;

/**
 * Check if database is ready
 * @returns {boolean}
 */
export const isReady = () => isInitialized;
