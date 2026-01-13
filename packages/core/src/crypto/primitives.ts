/**
 * Cryptographic Primitives
 * Implements §6.4 cryptographic requirements
 */

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes } from '@noble/ciphers/utils.js';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import * as pako from 'pako';
import { hexToBytes } from '../utils';

// ============================================================================
// §6.4.2 Data Plane Encryption (XChaCha20-Poly1305)
// ============================================================================

/**
 * Derive encryption key from space key using HKDF-SHA256
 * §6.4.2: encKey = HKDF-SHA256(spaceKey, salt=spaceId, info="localsync:data-plane:v1")
 */
export function deriveDataPlaneKey(spaceKey: Uint8Array, spaceId: string): Uint8Array {
  const salt = new TextEncoder().encode(spaceId);
  const info = new TextEncoder().encode('localsync:data-plane:v1');
  
  return hkdf(sha256, spaceKey, salt, info, 32); // 32 bytes = 256 bits
}

/**
 * Encrypt data using XChaCha20-Poly1305 AEAD
 * §6.4.2: cipher = XChaCha20-Poly1305, nonce = random(24 bytes)
 * §6.4.3: CRITICAL - compress → encrypt (not encrypt → compress)
 * 
 * Output format: nonce(24) || ciphertext || tag(16)
 */
export function encryptDataPlane(
  plaintext: Uint8Array,
  key: Uint8Array,
  shouldCompress: boolean = true
): Uint8Array {
  // §6.4.3: Compress BEFORE encrypting
  const data = shouldCompress ? pako.deflate(plaintext) : plaintext;
  
  // Generate random 24-byte nonce for XChaCha20
  const nonce = randomBytes(24);
  
  // Encrypt with XChaCha20-Poly1305
  const cipher = xchacha20poly1305(key, nonce);
  const ciphertext = cipher.encrypt(data);
  
  // Output: nonce(24) || ciphertext || tag(16)
  const output = new Uint8Array(24 + ciphertext.length);
  output.set(nonce, 0);
  output.set(ciphertext, 24);
  
  return output;
}

/**
 * Decrypt data using XChaCha20-Poly1305 AEAD
 * Input format: nonce(24) || ciphertext || tag(16)
 */
export function decryptDataPlane(
  encrypted: Uint8Array,
  key: Uint8Array,
  shouldDecompress: boolean = true
): Uint8Array {
  if (encrypted.length < 24 + 16) {
    throw new Error('Invalid ciphertext: too short');
  }
  
  // Extract nonce and ciphertext
  const nonce = encrypted.slice(0, 24);
  const ciphertext = encrypted.slice(24);
  
  // Decrypt with XChaCha20-Poly1305
  const cipher = xchacha20poly1305(key, nonce);
  const plaintext = cipher.decrypt(ciphertext);
  
  // Decompress if needed
  return shouldDecompress ? pako.inflate(plaintext) : plaintext;
}

// ============================================================================
// §6.4.4 Control Plane Encryption (NIP-44)
// ============================================================================

/**
 * NIP-44 encryption is handled by nostr-tools library
 * We re-export it here for consistency
 */
export { nip44 } from 'nostr-tools';

// ============================================================================
// Key Envelope Encryption (for space key distribution)
// ============================================================================

/**
 * Encrypt space key for a specific member using their public key
 * Uses NIP-44 encryption (ECDH + XChaCha20-Poly1305)
 */
export async function encryptSpaceKeyEnvelope(
  spaceKey: Uint8Array,
  recipientPubKey: string,
  senderPrivKey: Uint8Array
): Promise<Uint8Array> {
  // Use NIP-44 for envelope encryption
  const { nip44 } = await import('nostr-tools');
  
  // Convert space key to base64 for NIP-44
  const spaceKeyB64 = btoa(String.fromCharCode(...spaceKey));
  
  // Derive conversation key
  const conversationKey = nip44.v2.utils.getConversationKey(senderPrivKey, recipientPubKey);
  
  // Encrypt
  const encrypted = nip44.v2.encrypt(spaceKeyB64, conversationKey);
  
  return new TextEncoder().encode(encrypted);
}

/**
 * Decrypt space key envelope
 */
export async function decryptSpaceKeyEnvelope(
  encryptedEnvelope: Uint8Array,
  senderPubKey: string,
  recipientPrivKey: Uint8Array
): Promise<Uint8Array> {
  const { nip44 } = await import('nostr-tools');
  
  // Derive conversation key
  const conversationKey = nip44.v2.utils.getConversationKey(recipientPrivKey, senderPubKey);
  
  // Decrypt
  const encryptedStr = new TextDecoder().decode(encryptedEnvelope);
  const decrypted = nip44.v2.decrypt(encryptedStr, conversationKey);
  
  // Convert from base64
  const spaceKeyStr = atob(decrypted);
  const spaceKey = new Uint8Array(spaceKeyStr.length);
  for (let i = 0; i < spaceKeyStr.length; i++) {
    spaceKey[i] = spaceKeyStr.charCodeAt(i);
  }
  
  return spaceKey;
}

// ============================================================================
// Signing (BIP340 Schnorr via nostr-tools)
// ============================================================================

/**
 * Sign bytes using BIP340 Schnorr signatures
 * §6.4.1: Signatures: BIP340 Schnorr over canonical message bytes
 */
export async function signBytes(
  bytes: Uint8Array,
  privateKey: Uint8Array
): Promise<Uint8Array> {
  const { schnorr } = await import('@noble/curves/secp256k1.js');
  const hash = sha256(bytes);
  return schnorr.sign(hash, privateKey);
}

/**
 * Verify signature
 */
export async function verifySignature(
  bytes: Uint8Array,
  signature: Uint8Array,
  publicKey: string
): Promise<boolean> {
  try {
    const { schnorr } = await import('@noble/curves/secp256k1.js');
    const hash = sha256(bytes);
    return schnorr.verify(signature, hash, hexToBytes(publicKey));
  } catch {
    return false;
  }
}

// ============================================================================
// Random Key Generation
// ============================================================================

/**
 * Generate random 32-byte key for space encryption
 */
export function generateSpaceKey(): Uint8Array {
  return randomBytes(32);
}

/**
 * Generate random device ID
 */
export function generateDeviceId(): string {
  const bytes = randomBytes(16);
  return Array.from(bytes as Uint8Array)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ============================================================================
// §6.4.1 Identity Keys (secp256k1)
// ============================================================================

/**
 * Generate new secp256k1 keypair for identity
 */
export async function generateKeypair(): Promise<{ privateKey: Uint8Array; publicKey: string }> {
  const { schnorr } = await import('@noble/curves/secp256k1.js');
  const privateKey = schnorr.utils.randomSecretKey();
  const publicKey = schnorr.getPublicKey(privateKey);
  
  return {
    privateKey,
    publicKey: Array.from(publicKey)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  };
}

/**
 * Get public key from private key
 */
export async function getPublicKey(privateKey: Uint8Array): Promise<string> {
  const { schnorr } = await import('@noble/curves/secp256k1.js');
  const publicKey = schnorr.getPublicKey(privateKey);
  
  return Array.from(publicKey)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Derive shared secret using ECDH
 * §6.4.1 - Used for encrypting data to a recipient
 */
export async function deriveSharedSecret(
  privateKey: Uint8Array,
  publicKeyHex: string
): Promise<Uint8Array> {
  const { secp256k1, schnorr } = await import('@noble/curves/secp256k1.js');
  
  // Convert hex to bytes
  const publicKeyBytes = hexToBytes(publicKeyHex);
  
  // secp256k1.getSharedSecret expects uncompressed public key (65 bytes with 0x04 prefix)
  // If we have 32 bytes (x-only/schnorr format), we need to convert
  let fullPublicKey: Uint8Array;
  if (publicKeyBytes.length === 32) {
    // This is x-only format from schnorr, need to lift to full point
    // Convert bytes to bigint for lift_x
    const xBigInt = BigInt('0x' + publicKeyHex);
    const point = schnorr.utils.lift_x(xBigInt);
    // Get uncompressed bytes (65 bytes with 0x04 prefix)
    const uncompressedHex = point.toHex(false); // false = uncompressed
    fullPublicKey = hexToBytes(uncompressedHex);
  } else {
    fullPublicKey = publicKeyBytes;
  }
  
  const sharedPoint = secp256k1.getSharedSecret(privateKey, fullPublicKey);
  
  // Use x-coordinate as shared secret (skip first byte which is 0x04)
  return sharedPoint.slice(1, 33);
}

/**
 * Encrypt data with shared secret (XChaCha20-Poly1305)
 */
export function encryptWithSharedSecret(
  sharedSecret: Uint8Array,
  plaintext: Uint8Array
): Uint8Array {
  const nonce = randomBytes(24);
  const cipher = xchacha20poly1305(sharedSecret, nonce);
  const ciphertext = cipher.encrypt(plaintext);
  
  // Output: nonce(24) || ciphertext || tag(16)
  const output = new Uint8Array(24 + ciphertext.length);
  output.set(nonce, 0);
  output.set(ciphertext, 24);
  
  return output;
}

/**
 * Decrypt data with shared secret (XChaCha20-Poly1305)
 */
export function decryptWithSharedSecret(
  sharedSecret: Uint8Array,
  encrypted: Uint8Array
): Uint8Array {
  if (encrypted.length < 24 + 16) {
    throw new Error('Invalid ciphertext: too short');
  }
  
  const nonce = encrypted.slice(0, 24);
  const ciphertext = encrypted.slice(24);
  
  const cipher = xchacha20poly1305(sharedSecret, nonce);
  return cipher.decrypt(ciphertext);
}
