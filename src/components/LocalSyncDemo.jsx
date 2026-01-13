import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    LocalSync,
    createMemoryStorageAdapter,
    createWebEngineProvider,
    defaultVaultProvider
} from '../localsync';

const DEMO_APP_ID = 'localsync-demo';
const DEMO_PASSWORD = 'demo-password';

const statusStyles = {
    idle: 'bg-surface text-gray-500 dark:bg-navyLight dark:text-gray-300',
    initializing: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200',
    ready: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200',
    error: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200'
};

const statusLabels = {
    idle: 'Idle',
    initializing: 'Initializing',
    ready: 'Ready',
    error: 'Error'
};

const LocalSyncDemo = () => {
    const [status, setStatus] = useState('idle');
    const [error, setError] = useState('');
    const [items, setItems] = useState([]);
    const [draft, setDraft] = useState('');
    const [identity, setIdentity] = useState('');
    const spaceRef = useRef(null);
    const initRef = useRef(false);

    const loadItems = useCallback(async () => {
        if (!spaceRef.current) return;
        const result = await spaceRef.current.exec(
            'SELECT id, body, created_at as createdAt FROM demo_items ORDER BY created_at DESC'
        );
        setItems(result.rows);
    }, []);

    useEffect(() => {
        if (initRef.current) return;
        initRef.current = true;

        let isActive = true;
        const initialize = async () => {
            setStatus('initializing');
            try {
                const storage = createMemoryStorageAdapter();
                const client = await LocalSync.open({
                    appId: DEMO_APP_ID,
                    storage,
                    vault: defaultVaultProvider,
                    engine: createWebEngineProvider()
                });

                const pubkey = await client.createIdentity(DEMO_PASSWORD);
                const session = await client.login(pubkey, DEMO_PASSWORD);
                const space = await session.spaces.createPersonal();

                await space.run(
                    'CREATE TABLE IF NOT EXISTS demo_items (id TEXT PRIMARY KEY, body TEXT NOT NULL, created_at INTEGER)'
                );

                spaceRef.current = space;
                setIdentity(pubkey);
                await loadItems();

                if (isActive) {
                    setStatus('ready');
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to initialize demo';
                setError(message);
                setStatus('error');
            }
        };

        initialize();

        return () => {
            isActive = false;
        };
    }, [loadItems]);

    const handleAdd = async () => {
        if (!spaceRef.current || !draft.trim()) return;
        const id = crypto.randomUUID();
        const body = draft.trim();
        setDraft('');
        await spaceRef.current.run(
            'INSERT INTO demo_items (id, body, created_at) VALUES (?, ?, ?)',
            [id, body, Date.now()]
        );
        await loadItems();
    };

    const handleKeyDown = async (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            await handleAdd();
        }
    };

    return (
        <div className="bg-white dark:bg-navyLight rounded-2xl border border-surface dark:border-navyLight shadow-sm p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-lg font-bold text-gray-800 dark:text-white">
                        LocalSync Demo
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-300">
                        Local-first todo list powered by the LocalSync SDK.
                    </p>
                </div>
                <span
                    className={`text-xs font-semibold uppercase tracking-wide px-3 py-1 rounded-full ${
                        statusStyles[status] || statusStyles.idle
                    }`}
                >
                    {statusLabels[status] || statusLabels.idle}
                </span>
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <input
                    type="text"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Add a synced item..."
                    className="flex-1 px-4 py-2 rounded-xl bg-surface dark:bg-navyLight border border-transparent focus:border-primary focus:bg-white dark:focus:bg-navyLight outline-none text-sm transition-all shadow-inner"
                    disabled={status !== 'ready'}
                />
                <button
                    onClick={handleAdd}
                    disabled={status !== 'ready' || !draft.trim()}
                    className="px-5 py-2 rounded-xl bg-primary text-white font-semibold shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                    Add
                </button>
            </div>

            {identity && (
                <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
                    Identity: {identity.slice(0, 12)}...{identity.slice(-6)}
                </p>
            )}

            {error && (
                <div className="mt-4 text-sm text-rose-600 dark:text-rose-300">
                    {error}
                </div>
            )}

            <div className="mt-4 space-y-3">
                {items.length === 0 && status === 'ready' && (
                    <div className="text-sm text-gray-400 dark:text-gray-500">
                        No items yet. Add one to see LocalSync updates.
                    </div>
                )}
                {items.map((item) => (
                    <div
                        key={item.id}
                        className="flex items-center justify-between rounded-xl bg-cream/60 dark:bg-navy/40 px-4 py-3"
                    >
                        <span className="text-sm text-gray-700 dark:text-gray-100">
                            {item.body}
                        </span>
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                            {new Date(item.createdAt).toLocaleTimeString()}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default LocalSyncDemo;
