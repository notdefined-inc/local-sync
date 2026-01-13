/**
 * Vault Module - Password-based Key Encryption with Nostr Sync
 * Uses NIP-49 (Scrypt-based) for secure key storage
 * Syncs encrypted vault to Nostr for cross-browser access
 */

import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import * as nip49 from 'nostr-tools/nip49';
import { SimplePool } from 'nostr-tools';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { runSQL, queryDB } from './sqlite.js';

// Nostr relays for vault sync
const RELAYS = [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.nostr.band',
    'wss://nostr.wine'
];

// Custom kind for vault storage (addressable event)
const VAULT_KIND = 30078; // Application-specific data

/**
 * Generate a deterministic "lookup key" from username
 * This allows finding the vault without knowing the private key
 * @param {string} username
 * @returns {string} Hex string
 */
const getUsernameHash = (username) => {
    const hash = sha256(new TextEncoder().encode('adhd-vault:' + username.toLowerCase()));
    return bytesToHex(hash);
};

/**
 * Register a new user with encrypted key vault
 * Publishes vault to Nostr for cross-browser sync
 */
export const registerUser = async (username, password) => {
    // Generate new Nostr identity
    const privateKey = generateSecretKey();
    const pubkey = getPublicKey(privateKey);

    // Encrypt private key with password using NIP-49
    const encryptedVault = await nip49.encrypt(privateKey, password);

    // Create vault event for Nostr
    const usernameHash = getUsernameHash(username);
    const vaultEvent = {
        kind: VAULT_KIND,
        pubkey: pubkey,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
            ['d', 'adhd-vault'],
            ['u', usernameHash],
        ],
        content: JSON.stringify({
            username: username.toLowerCase(),
            vault: encryptedVault
        })
    };

    // Sign with the new private key
    const signedVaultEvent = finalizeEvent(vaultEvent, privateKey);
    console.log('[Vault] Created event:', signedVaultEvent.id, 'tags:', signedVaultEvent.tags);

    // Publish to Nostr and WAIT for confirmations
    const pool = new SimplePool();
    try {
        const pubResults = await Promise.allSettled(
            RELAYS.map(relay => pool.publish([relay], signedVaultEvent))
        );
        
        const successes = pubResults.filter(r => r.status === 'fulfilled');
        console.log(`[Vault] Published to ${successes.length}/${RELAYS.length} relays`);
        
        if (successes.length === 0) {
            console.error('[Vault] Failed to publish to any relay!');
        }
    } catch (err) {
        console.error('[Vault] Publish error:', err);
    }

    // Also store locally
    const id = crypto.randomUUID();
    runSQL(
        'INSERT INTO users (id, username, vault, pubkey, created_at) VALUES (?, ?, ?, ?, ?)',
        [id, username.toLowerCase(), encryptedVault, pubkey, new Date().toISOString()]
    );

    console.log('[Vault] User registered:', username, 'pubkey:', pubkey.slice(0, 8) + '...');

    return {
        id,
        username: username.toLowerCase(),
        pubkey,
        privateKey
    };
};

/**
 * Login user - try local first, then fetch from Nostr
 */
export const loginUser = async (username, password) => {
    // Try local database first
    const localRows = queryDB(
        'SELECT id, username, vault, pubkey FROM users WHERE username = ?',
        [username.toLowerCase()]
    );

    let vaultData;

    if (localRows.length > 0) {
        // Found locally
        vaultData = localRows[0];
        console.log('[Vault] Found user locally:', username);
    } else {
        // Try fetching from Nostr
        console.log('[Vault] User not found locally, checking Nostr...');
        vaultData = await fetchVaultFromNostr(username);
        
        if (!vaultData) {
            throw new Error('User not found');
        }
    }

    try {
        // Attempt to decrypt vault with password
        const privateKey = await nip49.decrypt(vaultData.vault, password);

        // If we fetched from Nostr, save locally for next time
        if (localRows.length === 0) {
            runSQL(
                'INSERT OR REPLACE INTO users (id, username, vault, pubkey, created_at) VALUES (?, ?, ?, ?, ?)',
                [crypto.randomUUID(), vaultData.username, vaultData.vault, vaultData.pubkey, new Date().toISOString()]
            );
            console.log('[Vault] Saved remote vault locally');
        }

        console.log('[Vault] Login successful:', username);

        return {
            id: vaultData.id || crypto.randomUUID(),
            username: vaultData.username,
            pubkey: vaultData.pubkey,
            privateKey
        };
    } catch (err) {
        console.error('[Vault] Decryption failed:', err.message);
        throw new Error('Invalid password');
    }
};

/**
 * Fetch vault from Nostr by username hash
 */
const fetchVaultFromNostr = async (username) => {
    const usernameHash = getUsernameHash(username);
    console.log('[Vault] Searching Nostr for hash:', usernameHash.slice(0, 16) + '...');
    
    const pool = new SimplePool();

    try {
        // Query with timeout
        const queryPromise = pool.querySync(RELAYS, {
            kinds: [VAULT_KIND],
            '#u': [usernameHash],
            limit: 5  // Get more results to debug
        });
        
        // Add timeout
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Query timeout')), 10000)
        );
        
        const events = await Promise.race([queryPromise, timeoutPromise]);
        
        console.log('[Vault] Nostr query returned', events.length, 'events');

        if (events.length === 0) {
            console.log('[Vault] No vault found on Nostr for:', username);
            return null;
        }

        // Get the most recent event
        const event = events.sort((a, b) => b.created_at - a.created_at)[0];
        const data = JSON.parse(event.content);

        console.log('[Vault] Found vault on Nostr for:', data.username, 'event:', event.id.slice(0, 8));

        return {
            username: data.username,
            vault: data.vault,
            pubkey: event.pubkey
        };
    } catch (err) {
        console.error('[Vault] Error fetching from Nostr:', err);
        return null;
    }
};

/**
 * Change user's password
 */
export const changePassword = async (username, oldPassword, newPassword) => {
    const user = await loginUser(username, oldPassword);
    const newVault = await nip49.encrypt(user.privateKey, newPassword);

    // Update local
    runSQL(
        'UPDATE users SET vault = ? WHERE username = ?',
        [newVault, username.toLowerCase()]
    );

    // Re-publish to Nostr
    const usernameHash = getUsernameHash(username);
    const vaultEvent = {
        kind: VAULT_KIND,
        pubkey: user.pubkey,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
            ['d', 'adhd-vault'],
            ['u', usernameHash],
        ],
        content: JSON.stringify({
            username: username.toLowerCase(),
            vault: newVault
        })
    };

    const signedEvent = finalizeEvent(vaultEvent, user.privateKey);
    const pool = new SimplePool();
    await Promise.allSettled(pool.publish(RELAYS, signedEvent));

    console.log('[Vault] Password changed for:', username);
};

/**
 * Check if username exists (local or remote)
 */
export const userExists = async (username) => {
    const localRows = queryDB('SELECT id FROM users WHERE username = ?', [username.toLowerCase()]);
    if (localRows.length > 0) return true;
    
    // Also check Nostr
    const remote = await fetchVaultFromNostr(username);
    return remote !== null;
};

/**
 * Get user's public key by username
 */
export const getUserPubkey = (username) => {
    const rows = queryDB('SELECT pubkey FROM users WHERE username = ?', [username.toLowerCase()]);
    return rows.length > 0 ? rows[0].pubkey : null;
};

/**
 * Sign a Nostr event with the user's private key
 */
export const signEventWithKey = async (privateKey, eventTemplate) => {
    return finalizeEvent(eventTemplate, privateKey);
};
