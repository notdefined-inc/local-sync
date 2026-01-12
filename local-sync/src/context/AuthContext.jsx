/**
 * Auth Context - Password-based Vault Authentication
 * Uses NIP-49 for secure key encryption with Scrypt
 */

import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { initDatabase, startSync, stopSync, isDatabaseReady } from '../db/index.js';
import { registerUser, loginUser, signEventWithKey, userExists, getUserPubkey } from '../db/vault.js';
import { getPublicKey } from 'nostr-tools/pure';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [dbReady, setDbReady] = useState(false);
    
    // Use ref for privateKey so signEvent always has current value
    const privateKeyRef = useRef(null);

    // Initialize database on mount
    useEffect(() => {
        const init = async () => {
            try {
                await initDatabase();
                setDbReady(true);
                
                // Attempt to restore session from sessionStorage
                const sessionKeyHex = sessionStorage.getItem('adhd_session_key');
                const storedUsername = localStorage.getItem('adhd_username');
                
                if (sessionKeyHex && storedUsername) {
                    try {
                        console.log('[Auth] Restoring session from storage...');
                        const privateKey = hexToBytes(sessionKeyHex);
                        const pubkey = getPublicKey(privateKey);
                        
                        // We need to fetch the vault to verify it exists/decrypt...
                        // But we already have the private key!
                        // We can just start the session directly.
                        
                        // Reconstruct user data
                        const userData = {
                            id: 'restored-session', // ID doesn't matter much for session
                            username: storedUsername,
                            pubkey: pubkey
                        };
                        
                        // Start session immediately
                        await startSession(userData, privateKey);
                        console.log('[Auth] Session restored successfully');
                    } catch (err) {
                        console.error('[Auth] Failed to restore session:', err);
                        sessionStorage.removeItem('adhd_session_key');
                    }
                }
            } catch (err) {
                console.error('[Auth] Init error:', err);
                setError('Failed to initialize database');
            }
            setLoading(false);
        };
        init();
    }, []);

    /**
     * Sign an event with the stored private key
     */
    const signEvent = async (eventTemplate) => {
        if (!privateKeyRef.current) {
            throw new Error('Not authenticated');
        }
        return await signEventWithKey(privateKeyRef.current, eventTemplate);
    };

    /**
     * Start session after successful auth
     */
    const startSession = async (userData, userPrivateKey) => {
        // Store in ref FIRST so signEvent works immediately
        privateKeyRef.current = userPrivateKey;

        // Persist key in sessionStorage for reload support (clears on browser close)
        const keyHex = bytesToHex(userPrivateKey);
        sessionStorage.setItem('adhd_session_key', keyHex);

        setUser({
            id: userData.id,
            username: userData.username,
            pubkey: userData.pubkey,
            name: userData.username,
            picture: `https://robohash.org/${userData.pubkey}.png?set=set4`
        });

        // Store username for session restore hint
        localStorage.setItem('adhd_username', userData.username);

        // Derive conversation key for NIP-44 self-encryption
        const conversationKey = sha256(
            new TextEncoder().encode(userData.pubkey + '-adhd-dashboard')
        );

        // Start Nostr sync
        await startSync(userData.pubkey, signEvent, conversationKey);
    };

    /**
     * Register a new user
     */
    const register = async (username, password) => {
        if (!dbReady) throw new Error('Database not ready');
        
        setLoading(true);
        setError(null);

        try {
            const userData = await registerUser(username, password);
            await startSession(userData, userData.privateKey);
        } catch (err) {
            console.error('[Auth] Registration failed:', err);
            setError(err.message || 'Registration failed');
            throw err;
        } finally {
            setLoading(false);
        }
    };

    /**
     * Login existing user
     */
    const login = async (username, password) => {
        if (!dbReady) throw new Error('Database not ready');

        setLoading(true);
        setError(null);

        try {
            const userData = await loginUser(username, password);
            await startSession(userData, userData.privateKey);
        } catch (err) {
            console.error('[Auth] Login failed:', err);
            setError(err.message || 'Login failed');
            throw err;
        } finally {
            setLoading(false);
        }
    };

    /**
     * Logout
     */
    const logout = () => {
        stopSync();
        setUser(null);
        privateKeyRef.current = null;
        localStorage.removeItem('adhd_username');
        sessionStorage.removeItem('adhd_session_key');
        console.log('[Auth] Logged out');
    };

    /**
     * Check if username is available (async now)
     */
    const checkUsername = async (username) => {
        if (!dbReady) return false;
        const exists = await userExists(username);
        return !exists;
    };

    // Create profile object for backwards compatibility
    const profile = user ? {
        pubkey: user.pubkey,
        name: user.name,
        picture: user.picture
    } : null;

    return (
        <AuthContext.Provider value={{ 
            user,
            profile,
            loading, 
            error,
            dbReady,
            register,
            login, 
            logout,
            signEvent,
            checkUsername
        }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
