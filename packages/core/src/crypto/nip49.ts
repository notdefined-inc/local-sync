/**
 * NIP-49 Compatible Vault Encryption
 * Implements password-based encryption for private keys
 * 
 * Format: scrypt + XChaCha20-Poly1305
 * Spec: §6.3 Vault Encryption Format
 */

import { scrypt } from '@noble/hashes/scrypt';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes } from '@noble/hashes/utils';

/**
 * NIP-49 encryption parameters
 * N=2^16 for moderate security (faster than spec's 2^20 for better UX)
 * Can be increased for production
 */
export interface ScryptParams {
  N: number;  // CPU/memory cost (2^N)
  r: number;  // Block size
  p: number;  // Parallelization
}

export const DEFAULT_SCRYPT_PARAMS: ScryptParams = {
  N: 65536,  // 2^16 - moderate security, good UX
  r: 8,
  p: 1
};

/**
 * Encrypted vault format (NIP-49 compatible)
 */
export interface EncryptedVault {
  version: 'nip49-v1';
  salt: Uint8Array;      // 16 bytes for scrypt
  nonce: Uint8Array;     // 24 bytes for XChaCha20
  ciphertext: Uint8Array;
  tag: Uint8Array;       // 16 bytes auth tag
  params: ScryptParams;
}

/**
 * Derive encryption key from password using scrypt
 * §6.3 - Password-derived key via scrypt
 */
export function deriveKey(
  password: string,
  salt: Uint8Array,
  params: ScryptParams = DEFAULT_SCRYPT_PARAMS
): Uint8Array {
  const passwordBytes = new TextEncoder().encode(password);
  
  // Derive 32-byte key for XChaCha20-Poly1305
  return scrypt(passwordBytes, salt, {
    N: params.N,
    r: params.r,
    p: params.p,
    dkLen: 32
  });
}

/**
 * Encrypt private key with password (NIP-49 format)
 * 
 * @param privateKey - 32-byte secp256k1 private key
 * @param password - User password
 * @param params - Optional scrypt parameters
 * @returns Encrypted vault structure
 */
export function encryptPrivateKey(
  privateKey: Uint8Array,
  password: string,
  params: ScryptParams = DEFAULT_SCRYPT_PARAMS
): EncryptedVault {
  if (privateKey.length !== 32) {
    throw new Error('Private key must be 32 bytes');
  }
  
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  // Generate random salt and nonce
  const salt = randomBytes(16);
  const nonce = randomBytes(24);

  // Derive encryption key from password
  const key = deriveKey(password, salt, params);

  // Encrypt with XChaCha20-Poly1305
  const cipher = xchacha20poly1305(key, nonce);
  const encrypted = cipher.encrypt(privateKey);

  // Split ciphertext and tag
  const ciphertext = encrypted.slice(0, -16);
  const tag = encrypted.slice(-16);

  return {
    version: 'nip49-v1',
    salt,
    nonce,
    ciphertext,
    tag,
    params
  };
}

/**
 * Decrypt private key with password (NIP-49 format)
 * 
 * @param vault - Encrypted vault structure
 * @param password - User password
 * @returns Decrypted 32-byte private key
 * @throws Error if password is incorrect or vault is corrupted
 */
export function decryptPrivateKey(
  vault: EncryptedVault,
  password: string
): Uint8Array {
  if (vault.version !== 'nip49-v1') {
    throw new Error(`Unsupported vault version: ${vault.version}`);
  }

  // Derive encryption key from password
  const key = deriveKey(password, vault.salt, vault.params);

  // Decrypt with XChaCha20-Poly1305
  const cipher = xchacha20poly1305(key, vault.nonce);
  
  // Combine ciphertext and tag for decryption
  const encrypted = new Uint8Array(vault.ciphertext.length + vault.tag.length);
  encrypted.set(vault.ciphertext);
  encrypted.set(vault.tag, vault.ciphertext.length);

  try {
    const decrypted = cipher.decrypt(encrypted);
    
    if (decrypted.length !== 32) {
      throw new Error('Decrypted key has invalid length');
    }
    
    return decrypted;
  } catch (error) {
    throw new Error('Failed to decrypt vault: incorrect password or corrupted data');
  }
}

/**
 * Serialize encrypted vault to bytes for storage
 */
export function serializeVault(vault: EncryptedVault): Uint8Array {
  // Format: version(1) || params(12) || salt(16) || nonce(24) || ciphertext(32) || tag(16)
  const buffer = new Uint8Array(1 + 12 + 16 + 24 + vault.ciphertext.length + 16);
  let offset = 0;

  // Version byte
  buffer[offset++] = 1; // nip49-v1

  // Scrypt params (4 bytes each for N, r, p)
  const paramsView = new DataView(buffer.buffer, offset, 12);
  paramsView.setUint32(0, vault.params.N, false);
  paramsView.setUint32(4, vault.params.r, false);
  paramsView.setUint32(8, vault.params.p, false);
  offset += 12;

  // Salt
  buffer.set(vault.salt, offset);
  offset += 16;

  // Nonce
  buffer.set(vault.nonce, offset);
  offset += 24;

  // Ciphertext
  buffer.set(vault.ciphertext, offset);
  offset += vault.ciphertext.length;

  // Tag
  buffer.set(vault.tag, offset);

  return buffer;
}

/**
 * Deserialize encrypted vault from bytes
 */
export function deserializeVault(bytes: Uint8Array): EncryptedVault {
  if (bytes.length < 1 + 12 + 16 + 24 + 32 + 16) {
    throw new Error('Invalid vault data: too short');
  }

  let offset = 0;

  // Version
  const version = bytes[offset++];
  if (version !== 1) {
    throw new Error(`Unsupported vault version: ${version}`);
  }

  // Scrypt params
  const paramsView = new DataView(bytes.buffer, bytes.byteOffset + offset, 12);
  const params: ScryptParams = {
    N: paramsView.getUint32(0, false),
    r: paramsView.getUint32(4, false),
    p: paramsView.getUint32(8, false)
  };
  offset += 12;

  // Salt
  const salt = bytes.slice(offset, offset + 16);
  offset += 16;

  // Nonce
  const nonce = bytes.slice(offset, offset + 24);
  offset += 24;

  // Ciphertext (remaining - 16 for tag)
  const ciphertext = bytes.slice(offset, -16);
  
  // Tag (last 16 bytes)
  const tag = bytes.slice(-16);

  return {
    version: 'nip49-v1',
    salt,
    nonce,
    ciphertext,
    tag,
    params
  };
}
