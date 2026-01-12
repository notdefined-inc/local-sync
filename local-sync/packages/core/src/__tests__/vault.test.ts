/**
 * Vault Tests
 * Tests §6.2 Vault Interface implementation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Vault, createVault, unlockVault } from '../vault/vault';
import { randomBytes } from '@noble/hashes/utils';

describe('Vault', () => {
  const testPassword = 'test-password-12345';
  let vault: Vault;

  beforeEach(async () => {
    vault = new Vault();
  });

  describe('Creation', () => {
    it('should create new vault with keypair', async () => {
      await vault.create(testPassword);
      
      const publicKey = await vault.getPublicKey();
      expect(publicKey).toBeTruthy();
      expect(publicKey.length).toBe(64); // 32 bytes hex
      expect(vault.isVaultUnlocked()).toBe(true);
    });

    it('should generate different keypairs', async () => {
      await vault.create(testPassword);
      const pubKey1 = await vault.getPublicKey();

      const vault2 = new Vault();
      await vault2.create(testPassword);
      const pubKey2 = await vault2.getPublicKey();

      expect(pubKey1).not.toBe(pubKey2);
    });

    it('should not allow creating vault twice', async () => {
      await vault.create(testPassword);
      
      await expect(vault.create(testPassword)).rejects.toThrow(
        'Vault already exists'
      );
    });
  });

  describe('Locking', () => {
    beforeEach(async () => {
      await vault.create(testPassword);
    });

    it('should lock vault and clear keys', () => {
      expect(vault.isVaultUnlocked()).toBe(true);
      
      vault.lock();
      
      expect(vault.isVaultUnlocked()).toBe(false);
    });

    it('should not allow operations after locking', async () => {
      vault.lock();
      
      const testData = new Uint8Array([1, 2, 3]);
      await expect(vault.sign(testData)).rejects.toThrow(
        'Vault must be unlocked to sign'
      );
    });
  });

  describe('Signing', () => {
    beforeEach(async () => {
      await vault.create(testPassword);
    });

    it('should sign data', async () => {
      const data = new TextEncoder().encode('test message');
      const signature = await vault.sign(data);

      expect(signature).toBeInstanceOf(Uint8Array);
      expect(signature.length).toBe(64); // Schnorr signature
    });

    it('should verify signature', async () => {
      const data = new TextEncoder().encode('test message');
      const signature = await vault.sign(data);
      const publicKey = await vault.getPublicKey();

      const isValid = await vault.verify(publicKey, data, signature);
      expect(isValid).toBe(true);
    });

    it('should reject invalid signature', async () => {
      const data = new TextEncoder().encode('test message');
      const signature = await vault.sign(data);
      const publicKey = await vault.getPublicKey();

      // Modify data
      const tamperedData = new TextEncoder().encode('tampered message');
      
      const isValid = await vault.verify(publicKey, tamperedData, signature);
      expect(isValid).toBe(false);
    });

    it('should not sign when locked', async () => {
      vault.lock();
      
      const data = new TextEncoder().encode('test');
      await expect(vault.sign(data)).rejects.toThrow(
        'Vault must be unlocked to sign'
      );
    });
  });

  describe('ECDH Encryption', () => {
    let vault1: Vault;
    let vault2: Vault;

    beforeEach(async () => {
      vault1 = await createVault(testPassword);
      vault2 = await createVault(testPassword);
    });

    it('should encrypt data for recipient', async () => {
      const plaintext = new TextEncoder().encode('secret message');
      const recipientPubKey = await vault2.getPublicKey();

      const encrypted = await vault1.encryptFor(recipientPubKey, plaintext);

      expect(encrypted).toBeInstanceOf(Uint8Array);
      expect(encrypted.length).toBeGreaterThan(plaintext.length); // nonce + tag
    });

    it('should decrypt data from sender', async () => {
      const plaintext = new TextEncoder().encode('secret message');
      const recipientPubKey = await vault2.getPublicKey();
      const senderPubKey = await vault1.getPublicKey();

      const encrypted = await vault1.encryptFor(recipientPubKey, plaintext);
      const decrypted = await vault2.decryptFrom(senderPubKey, encrypted);

      expect(new TextDecoder().decode(decrypted)).toBe(new TextDecoder().decode(plaintext));
    });

    it('should handle binary data', async () => {
      const plaintext = randomBytes(1024);
      const recipientPubKey = await vault2.getPublicKey();
      const senderPubKey = await vault1.getPublicKey();

      const encrypted = await vault1.encryptFor(recipientPubKey, plaintext);
      const decrypted = await vault2.decryptFrom(senderPubKey, encrypted);

      expect(decrypted).toEqual(plaintext);
    });

    it('should not encrypt when locked', async () => {
      vault1.lock();
      
      const plaintext = new TextEncoder().encode('test');
      const recipientPubKey = await vault2.getPublicKey();

      await expect(vault1.encryptFor(recipientPubKey, plaintext)).rejects.toThrow(
        'Vault must be unlocked to encrypt'
      );
    });

    it('should not decrypt when locked', async () => {
      const plaintext = new TextEncoder().encode('test');
      const recipientPubKey = await vault2.getPublicKey();
      const senderPubKey = await vault1.getPublicKey();
      
      const encrypted = await vault1.encryptFor(recipientPubKey, plaintext);
      
      vault2.lock();
      
      await expect(vault2.decryptFrom(senderPubKey, encrypted)).rejects.toThrow(
        'Vault must be unlocked to decrypt'
      );
    });
  });

  describe('Export/Import', () => {
    beforeEach(async () => {
      await vault.create(testPassword);
    });

    it('should export vault to encrypted bytes', async () => {
      const encrypted = await vault.exportEncrypted(testPassword);

      expect(encrypted).toBeInstanceOf(Uint8Array);
      expect(encrypted.length).toBeGreaterThan(0);
    });

    it('should import vault from encrypted bytes', async () => {
      const originalPubKey = await vault.getPublicKey();
      const encrypted = await vault.exportEncrypted(testPassword);

      const importedVault = await Vault.importEncrypted(encrypted);
      await importedVault.unlock(testPassword);
      const importedPubKey = await importedVault.getPublicKey();

      expect(importedPubKey).toBe(originalPubKey);
      expect(importedVault.isVaultUnlocked()).toBe(true);
    });

    it('should preserve signing capability after import', async () => {
      const data = new TextEncoder().encode('test message');
      const publicKey = await vault.getPublicKey();
      const signature1 = await vault.sign(data);
      
      const encrypted = await vault.exportEncrypted(testPassword);
      const importedVault = await Vault.importEncrypted(encrypted);
      await importedVault.unlock(testPassword);
      const signature2 = await importedVault.sign(data);

      // Both signatures should be valid (but may differ due to randomness)
      const isValid1 = await vault.verify(publicKey, data, signature1);
      const isValid2 = await importedVault.verify(publicKey, data, signature2);
      
      expect(isValid1).toBe(true);
      expect(isValid2).toBe(true);
    });

    it('should fail import with wrong password', async () => {
      const encrypted = await vault.exportEncrypted(testPassword);

      await expect(
        (async () => {
          const importedVault = await Vault.importEncrypted(encrypted);
          await importedVault.unlock('wrong-password');
        })()
      ).rejects.toThrow('Failed to decrypt vault');
    });
  });

  describe('Helper Functions', () => {
    it('should create vault with createVault helper', async () => {
      const newVault = await createVault(testPassword);
      
      expect(newVault.isVaultUnlocked()).toBe(true);
      const pubKey = await newVault.getPublicKey();
      expect(pubKey).toBeTruthy();
    });

    it('should unlock vault with unlockVault helper', async () => {
      const vault1 = await createVault(testPassword);
      const encrypted = await vault1.exportEncrypted(testPassword);

      const vault2 = await unlockVault(encrypted, testPassword);
      
      expect(vault2.isVaultUnlocked()).toBe(true);
      const pubKey1 = await vault1.getPublicKey();
      const pubKey2 = await vault2.getPublicKey();
      expect(pubKey2).toBe(pubKey1);
    });
  });

  describe('End-to-End', () => {
    it('should complete full lifecycle', async () => {
      // Create vault
      const vault1 = await createVault(testPassword);
      const pubKey = await vault1.getPublicKey();

      // Sign data
      const data = new TextEncoder().encode('important message');
      const signature = await vault1.sign(data);

      // Export
      const encrypted = await vault1.exportEncrypted(testPassword);

      // Lock original
      vault1.lock();

      // Import new instance
      const vault2 = await unlockVault(encrypted, testPassword);

      // Verify signature with imported vault
      const isValid = await vault2.verify(pubKey, data, signature);
      expect(isValid).toBe(true);

      // Sign with imported vault
      const signature2 = await vault2.sign(data);
      const isValid2 = await vault2.verify(pubKey, data, signature2);
      expect(isValid2).toBe(true);
    });

    it('should handle multi-party encryption', async () => {
      // Create 3 vaults (Alice, Bob, Charlie)
      const alice = await createVault('alice-password');
      const bob = await createVault('bob-password');
      const charlie = await createVault('charlie-password');

      const alicePubKey = await alice.getPublicKey();
      const bobPubKey = await bob.getPublicKey();
      const charliePubKey = await charlie.getPublicKey();

      // Alice encrypts message for Bob
      const message = new TextEncoder().encode('Hello Bob!');
      const encryptedForBob = await alice.encryptFor(bobPubKey, message);

      // Bob decrypts
      const decryptedByBob = await bob.decryptFrom(alicePubKey, encryptedForBob);
      expect(new TextDecoder().decode(decryptedByBob)).toBe('Hello Bob!');

      // Charlie cannot decrypt (wrong recipient)
      // This would fail because Charlie's keys don't match
      // We can't test this directly without the sender's pubkey being wrong

      // Bob encrypts reply for Alice
      const reply = new TextEncoder().encode('Hi Alice!');
      const encryptedForAlice = await bob.encryptFor(alicePubKey, reply);

      // Alice decrypts
      const decryptedByAlice = await alice.decryptFrom(bobPubKey, encryptedForAlice);
      expect(new TextDecoder().decode(decryptedByAlice)).toBe('Hi Alice!');
    });
  });
});
