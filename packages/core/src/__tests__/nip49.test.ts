/**
 * NIP-49 Encryption Tests
 * Tests §6.3 Vault Encryption Format compliance
 */

import { describe, it, expect } from 'vitest';
import {
  encryptPrivateKey,
  decryptPrivateKey,
  deriveKey,
  serializeVault,
  deserializeVault,
  DEFAULT_SCRYPT_PARAMS
} from '../crypto/nip49';
import { randomBytes } from '@noble/hashes/utils';

describe('NIP-49 Vault Encryption', () => {
  const testPrivateKey = randomBytes(32);
  const testPassword = 'test-password-123';
  const FAST_SCRYPT_PARAMS = { N: 1024, r: 8, p: 1 };

  describe('Key Derivation', () => {
    it('should derive consistent keys from same password and salt', () => {
      const salt = randomBytes(16);
      const key1 = deriveKey(testPassword, salt, FAST_SCRYPT_PARAMS);
      const key2 = deriveKey(testPassword, salt, FAST_SCRYPT_PARAMS);

      expect(key1).toEqual(key2);
      expect(key1.length).toBe(32);
    });

    it('should derive different keys from different salts', () => {
      const salt1 = randomBytes(16);
      const salt2 = randomBytes(16);
      
      const key1 = deriveKey(testPassword, salt1, FAST_SCRYPT_PARAMS);
      const key2 = deriveKey(testPassword, salt2, FAST_SCRYPT_PARAMS);

      expect(key1).not.toEqual(key2);
    });

    it('should derive different keys from different passwords', () => {
      const salt = randomBytes(16);
      
      const key1 = deriveKey('password1', salt, FAST_SCRYPT_PARAMS);
      const key2 = deriveKey('password2', salt, FAST_SCRYPT_PARAMS);

      expect(key1).not.toEqual(key2);
    });

    it('should use correct scrypt parameters', () => {
      const salt = randomBytes(16);
      const key = deriveKey(testPassword, salt, FAST_SCRYPT_PARAMS);

      expect(key.length).toBe(32);
      expect(DEFAULT_SCRYPT_PARAMS.N).toBe(65536); // 2^16
      expect(DEFAULT_SCRYPT_PARAMS.r).toBe(8);
      expect(DEFAULT_SCRYPT_PARAMS.p).toBe(1);
    });
  });

  describe('Encryption', () => {
    it('should encrypt private key with password', () => {
      const vault = encryptPrivateKey(testPrivateKey, testPassword, FAST_SCRYPT_PARAMS);

      expect(vault.version).toBe('nip49-v1');
      expect(vault.salt.length).toBe(16);
      expect(vault.nonce.length).toBe(24);
      expect(vault.ciphertext.length).toBe(32);
      expect(vault.tag.length).toBe(16);
      expect(vault.params).toEqual(FAST_SCRYPT_PARAMS);
    });

    it('should generate random salt and nonce', () => {
      const vault1 = encryptPrivateKey(testPrivateKey, testPassword, FAST_SCRYPT_PARAMS);
      const vault2 = encryptPrivateKey(testPrivateKey, testPassword, FAST_SCRYPT_PARAMS);

      expect(vault1.salt).not.toEqual(vault2.salt);
      expect(vault1.nonce).not.toEqual(vault2.nonce);
    });

    it('should reject private key with wrong length', () => {
      const badKey = randomBytes(16); // Wrong length
      
      expect(() => {
        encryptPrivateKey(badKey, testPassword);
      }).toThrow('Private key must be 32 bytes');
    });

    it('should reject weak password', () => {
      expect(() => {
        encryptPrivateKey(testPrivateKey, 'short', FAST_SCRYPT_PARAMS);
      }).toThrow('Password must be at least 8 characters');
    });
  });

  describe('Decryption', () => {
    it('should decrypt with correct password', () => {
      const vault = encryptPrivateKey(testPrivateKey, testPassword, FAST_SCRYPT_PARAMS);
      const decrypted = decryptPrivateKey(vault, testPassword);

      expect(decrypted).toEqual(testPrivateKey);
    });

    it('should fail with wrong password', () => {
      const vault = encryptPrivateKey(testPrivateKey, testPassword, FAST_SCRYPT_PARAMS);

      expect(() => {
        decryptPrivateKey(vault, 'wrong-password');
      }).toThrow('Failed to decrypt vault');
    });

    it('should fail with corrupted ciphertext', () => {
      const vault = encryptPrivateKey(testPrivateKey, testPassword, FAST_SCRYPT_PARAMS);
      
      // Corrupt the ciphertext
      vault.ciphertext[0] ^= 0xFF;

      expect(() => {
        decryptPrivateKey(vault, testPassword);
      }).toThrow('Failed to decrypt vault');
    });

    it('should fail with corrupted tag', () => {
      const vault = encryptPrivateKey(testPrivateKey, testPassword, FAST_SCRYPT_PARAMS);
      
      // Corrupt the authentication tag
      vault.tag[0] ^= 0xFF;

      expect(() => {
        decryptPrivateKey(vault, testPassword);
      }).toThrow('Failed to decrypt vault');
    });

    it('should reject unsupported version', () => {
      const vault = encryptPrivateKey(testPrivateKey, testPassword, FAST_SCRYPT_PARAMS);
      vault.version = 'unsupported' as any;

      expect(() => {
        decryptPrivateKey(vault, testPassword);
      }).toThrow('Unsupported vault version');
    });
  });

  describe('Serialization', () => {
    it('should serialize and deserialize vault', () => {
      const vault = encryptPrivateKey(testPrivateKey, testPassword, FAST_SCRYPT_PARAMS);
      const serialized = serializeVault(vault);
      const deserialized = deserializeVault(serialized);

      expect(deserialized.version).toBe(vault.version);
      expect(deserialized.salt).toEqual(vault.salt);
      expect(deserialized.nonce).toEqual(vault.nonce);
      expect(deserialized.ciphertext).toEqual(vault.ciphertext);
      expect(deserialized.tag).toEqual(vault.tag);
      expect(deserialized.params).toEqual(vault.params);
    });

    it('should decrypt after serialization round-trip', () => {
      const vault = encryptPrivateKey(testPrivateKey, testPassword, FAST_SCRYPT_PARAMS);
      const serialized = serializeVault(vault);
      const deserialized = deserializeVault(serialized);
      const decrypted = decryptPrivateKey(deserialized, testPassword);

      expect(decrypted).toEqual(testPrivateKey);
    });

    it('should reject invalid serialized data', () => {
      const tooShort = new Uint8Array(10);

      expect(() => {
        deserializeVault(tooShort);
      }).toThrow('Invalid vault data: too short');
    });

    it('should have correct serialized format', () => {
      const vault = encryptPrivateKey(testPrivateKey, testPassword, FAST_SCRYPT_PARAMS);
      const serialized = serializeVault(vault);

      // Check format: version(1) + params(12) + salt(16) + nonce(24) + ciphertext(32) + tag(16)
      expect(serialized.length).toBe(1 + 12 + 16 + 24 + 32 + 16);
      expect(serialized[0]).toBe(1); // version
    });
  });

  describe('End-to-End', () => {
    it('should complete full encryption/decryption cycle', () => {
      // Encrypt
      const vault = encryptPrivateKey(testPrivateKey, testPassword, FAST_SCRYPT_PARAMS);
      
      // Serialize
      const serialized = serializeVault(vault);
      
      // Deserialize
      const deserialized = deserializeVault(serialized);
      
      // Decrypt
      const decrypted = decryptPrivateKey(deserialized, testPassword);

      expect(decrypted).toEqual(testPrivateKey);
    });

    it('should handle multiple encryption/decryption cycles', () => {
      for (let i = 0; i < 5; i++) {
        const privateKey = randomBytes(32);
        const password = `password-${i}`;
        
        const vault = encryptPrivateKey(privateKey, password, FAST_SCRYPT_PARAMS);
        const decrypted = decryptPrivateKey(vault, password);

        expect(decrypted).toEqual(privateKey);
      }
    });
  });
});
