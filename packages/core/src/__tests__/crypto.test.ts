/**
 * Unit tests for cryptographic primitives
 * Tests §6.4 encryption, key derivation, and signing
 */

import { describe, it, expect } from 'vitest';
import {
  deriveDataPlaneKey,
  encryptDataPlane,
  decryptDataPlane,
  signBytes,
  verifySignature,
  generateSpaceKey,
  generateDeviceId
} from '../crypto/primitives';

describe('Cryptographic Primitives', () => {
  describe('§6.4.2 HKDF Key Derivation', () => {
    it('should derive encryption key from space key', () => {
      const spaceKey = new Uint8Array(32).fill(1);
      const spaceId = 'space-123';

      const derivedKey = deriveDataPlaneKey(spaceKey, spaceId);

      expect(derivedKey).toBeInstanceOf(Uint8Array);
      expect(derivedKey.length).toBe(32); // 256 bits
    });

    it('should derive deterministic keys', () => {
      const spaceKey = new Uint8Array(32).fill(1);
      const spaceId = 'space-123';

      const key1 = deriveDataPlaneKey(spaceKey, spaceId);
      const key2 = deriveDataPlaneKey(spaceKey, spaceId);

      expect(key1).toEqual(key2);
    });

    it('should derive different keys for different spaceIds', () => {
      const spaceKey = new Uint8Array(32).fill(1);

      const key1 = deriveDataPlaneKey(spaceKey, 'space-1');
      const key2 = deriveDataPlaneKey(spaceKey, 'space-2');

      expect(key1).not.toEqual(key2);
    });
  });

  describe('§6.4.2 XChaCha20-Poly1305 Encryption', () => {
    it('should encrypt and decrypt data', () => {
      const plaintext = new TextEncoder().encode('Hello, LocalSync!');
      const key = new Uint8Array(32).fill(42);

      const encrypted = encryptDataPlane(plaintext, key, false); // no compression
      const decrypted = decryptDataPlane(encrypted, key, false);

      expect(Array.from(decrypted)).toEqual(Array.from(plaintext));
      expect(new TextDecoder().decode(decrypted)).toBe('Hello, LocalSync!');
    });

    it('should produce different ciphertexts (random nonce)', () => {
      const plaintext = new TextEncoder().encode('test');
      const key = new Uint8Array(32).fill(1);

      const encrypted1 = encryptDataPlane(plaintext, key, false);
      const encrypted2 = encryptDataPlane(plaintext, key, false);

      // Ciphertexts should differ due to random nonce
      expect(encrypted1).not.toEqual(encrypted2);
    });

    it('should fail decryption with wrong key', () => {
      const plaintext = new TextEncoder().encode('secret');
      const key1 = new Uint8Array(32).fill(1);
      const key2 = new Uint8Array(32).fill(2);

      const encrypted = encryptDataPlane(plaintext, key1, false);

      expect(() => {
        decryptDataPlane(encrypted, key2, false);
      }).toThrow();
    });

    it('§6.4.3 should compress before encrypting', () => {
      const plaintext = new TextEncoder().encode('a'.repeat(1000)); // Compressible data
      const key = new Uint8Array(32).fill(1);

      const withCompression = encryptDataPlane(plaintext, key, true);
      const withoutCompression = encryptDataPlane(plaintext, key, false);

      // Compressed version should be smaller
      expect(withCompression.length).toBeLessThan(withoutCompression.length);

      // Both should decrypt correctly
      const decrypted1 = decryptDataPlane(withCompression, key, true);
      const decrypted2 = decryptDataPlane(withoutCompression, key, false);

      expect(Array.from(decrypted1)).toEqual(Array.from(plaintext));
      expect(Array.from(decrypted2)).toEqual(Array.from(plaintext));
    });
  });

  describe('§6.4.1 BIP340 Schnorr Signatures', () => {
    it('should sign and verify bytes', async () => {
      const message = new TextEncoder().encode('Sign this message');
      const privateKey = new Uint8Array(32).fill(3);
      
      // Get public key for verification
      const { schnorr } = await import('@noble/curves/secp256k1.js');
      const publicKey = schnorr.getPublicKey(privateKey);

      const signature = await signBytes(message, privateKey);
      const isValid = await verifySignature(message, signature, Buffer.from(publicKey).toString('hex'));

      expect(isValid).toBe(true);
    });

    it('should fail verification with wrong message', async () => {
      const message1 = new TextEncoder().encode('Original message');
      const message2 = new TextEncoder().encode('Tampered message');
      const privateKey = new Uint8Array(32).fill(3);
      
      const { schnorr } = await import('@noble/curves/secp256k1.js');
      const publicKey = schnorr.getPublicKey(privateKey);

      const signature = await signBytes(message1, privateKey);
      const isValid = await verifySignature(message2, signature, Buffer.from(publicKey).toString('hex'));

      expect(isValid).toBe(false);
    });
  });

  describe('Key Generation', () => {
    it('should generate random 32-byte space key', () => {
      const key1 = generateSpaceKey();
      const key2 = generateSpaceKey();

      expect(key1).toBeInstanceOf(Uint8Array);
      expect(key1.length).toBe(32);
      expect(key1).not.toEqual(key2); // Should be random
    });

    it('should generate random device ID', () => {
      const id1 = generateDeviceId();
      const id2 = generateDeviceId();

      expect(typeof id1).toBe('string');
      expect(id1.length).toBe(32); // 16 bytes * 2 hex chars
      expect(id1).not.toBe(id2); // Should be random
    });
  });
});
