/**
 * Space Key Management
 * Implements §7.3 Space Key Envelopes for encrypted shared workspaces
 */

import type { SpaceId } from '../types';
import type { Vault } from './vault';
import { generateSpaceKey } from '../crypto/primitives';

/**
 * Space key envelope - encrypted space key for a member
 * §7.3 - spaceKey MUST be encrypted to each member's public key
 */
export interface SpaceKeyEnvelope {
  spaceId: SpaceId;
  recipientPubKey: string;
  encryptedKey: Uint8Array;  // Space key encrypted with ECDH
  senderPubKey: string;
  version: 'v1';
}

/**
 * Generate new 32-byte symmetric key for space encryption
 * §7.1 - spaceKey (symmetric; only for shared; stored encrypted per member)
 */
export function generateNewSpaceKey(): Uint8Array {
  return generateSpaceKey();
}

/**
 * Encrypt space key for a specific member
 * §7.3 - envelope encryption using member's public key
 * 
 * @param spaceId - Space identifier
 * @param spaceKey - 32-byte symmetric space key
 * @param recipientPubKey - Member's public key
 * @param senderVault - Sender's unlocked vault (for ECDH)
 * @returns Encrypted space key envelope
 */
export async function encryptSpaceKeyFor(
  spaceId: SpaceId,
  spaceKey: Uint8Array,
  recipientPubKey: string,
  senderVault: Vault
): Promise<SpaceKeyEnvelope> {
  if (spaceKey.length !== 32) {
    throw new Error('Space key must be 32 bytes');
  }

  // Encrypt space key using ECDH
  const encryptedKey = await senderVault.encryptFor(recipientPubKey, spaceKey);
  const senderPubKey = await senderVault.getPublicKey();

  return {
    spaceId,
    recipientPubKey,
    encryptedKey,
    senderPubKey,
    version: 'v1'
  };
}

/**
 * Decrypt space key envelope
 * §7.3 - decrypt space key using recipient's private key
 * 
 * @param envelope - Encrypted space key envelope
 * @param recipientVault - Recipient's unlocked vault
 * @returns Decrypted 32-byte space key
 */
export async function decryptSpaceKey(
  envelope: SpaceKeyEnvelope,
  recipientVault: Vault
): Promise<Uint8Array> {
  if (envelope.version !== 'v1') {
    throw new Error(`Unsupported envelope version: ${envelope.version}`);
  }

  // Verify this envelope is for us
  const ourPubKey = await recipientVault.getPublicKey();
  if (envelope.recipientPubKey !== ourPubKey) {
    throw new Error('Envelope is not for this recipient');
  }

  // Decrypt using ECDH
  const spaceKey = await recipientVault.decryptFrom(
    envelope.senderPubKey,
    envelope.encryptedKey
  );

  if (spaceKey.length !== 32) {
    throw new Error('Decrypted space key has invalid length');
  }

  return spaceKey;
}

/**
 * In-memory space key cache
 * Keys are stored encrypted in the database, but cached in memory when unlocked
 */
class SpaceKeyCache {
  private keys: Map<string, Uint8Array> = new Map();

  /**
   * Store space key in cache
   */
  set(spaceId: SpaceId, spaceKey: Uint8Array): void {
    this.keys.set(spaceId, spaceKey);
  }

  /**
   * Get space key from cache
   */
  get(spaceId: SpaceId): Uint8Array | undefined {
    return this.keys.get(spaceId);
  }

  /**
   * Check if space key is cached
   */
  has(spaceId: SpaceId): boolean {
    return this.keys.has(spaceId);
  }

  /**
   * Remove space key from cache
   */
  delete(spaceId: SpaceId): void {
    const key = this.keys.get(spaceId);
    if (key) {
      // Clear the key from memory
      key.fill(0);
      this.keys.delete(spaceId);
    }
  }

  /**
   * Clear all cached keys (on logout)
   */
  clear(): void {
    // Clear all keys from memory
    for (const key of this.keys.values()) {
      key.fill(0);
    }
    this.keys.clear();
  }
}

/**
 * Global space key cache instance
 */
export const spaceKeyCache = new SpaceKeyCache();

/**
 * Serialize space key envelope for storage
 */
export function serializeEnvelope(envelope: SpaceKeyEnvelope): Uint8Array {
  // Format: version(1) || spaceIdLen(2) || spaceId(variable) || recipientPubKey(64) || senderPubKey(64) || encryptedKey(variable)
  const spaceIdBytes = new TextEncoder().encode(envelope.spaceId);
  const recipientBytes = new TextEncoder().encode(envelope.recipientPubKey);
  const senderBytes = new TextEncoder().encode(envelope.senderPubKey);
  
  const buffer = new Uint8Array(
    1 + 2 + spaceIdBytes.length + 64 + 64 + envelope.encryptedKey.length
  );
  
  let offset = 0;
  
  // Version
  buffer[offset++] = 1; // v1
  
  // Space ID length (2 bytes)
  const view = new DataView(buffer.buffer, offset, 2);
  view.setUint16(0, spaceIdBytes.length, false);
  offset += 2;
  
  // Space ID (variable length)
  buffer.set(spaceIdBytes, offset);
  offset += spaceIdBytes.length;
  
  // Recipient public key (64 bytes hex)
  buffer.set(recipientBytes, offset);
  offset += 64;
  
  // Sender public key (64 bytes hex)
  buffer.set(senderBytes, offset);
  offset += 64;
  
  // Encrypted key
  buffer.set(envelope.encryptedKey, offset);
  
  return buffer;
}

/**
 * Deserialize space key envelope from storage
 */
export function deserializeEnvelope(bytes: Uint8Array): SpaceKeyEnvelope {
  if (bytes.length < 1 + 2 + 64 + 64) {
    throw new Error('Invalid envelope data: too short');
  }
  
  let offset = 0;
  
  // Version
  const version = bytes[offset++];
  if (version !== 1) {
    throw new Error(`Unsupported envelope version: ${version}`);
  }
  
  // Space ID length
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 2);
  const spaceIdLen = view.getUint16(0, false);
  offset += 2;
  
  // Space ID
  const spaceIdBytes = bytes.slice(offset, offset + spaceIdLen);
  const spaceId = new TextDecoder().decode(spaceIdBytes) as SpaceId;
  offset += spaceIdLen;
  
  // Recipient public key
  const recipientBytes = bytes.slice(offset, offset + 64);
  const recipientPubKey = new TextDecoder().decode(recipientBytes);
  offset += 64;
  
  // Sender public key
  const senderBytes = bytes.slice(offset, offset + 64);
  const senderPubKey = new TextDecoder().decode(senderBytes);
  offset += 64;
  
  // Encrypted key
  const encryptedKey = bytes.slice(offset);
  
  return {
    spaceId,
    recipientPubKey,
    encryptedKey,
    senderPubKey,
    version: 'v1'
  };
}
