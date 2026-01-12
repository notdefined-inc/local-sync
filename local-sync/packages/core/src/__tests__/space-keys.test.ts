/**
 * Space Key Management Tests
 * Tests §7.3 Space Key Envelopes
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateNewSpaceKey,
  encryptSpaceKeyFor,
  decryptSpaceKey,
  spaceKeyCache,
  serializeEnvelope,
  deserializeEnvelope,
  type SpaceKeyEnvelope
} from '../vault/space-keys';
import { createVault } from '../vault/vault';
import { createSpaceId } from '../utils';

describe('Space Key Management', () => {
  const testPassword = 'test-password-123';

  describe('Key Generation', () => {
    it('should generate 32-byte space key', () => {
      const spaceKey = generateNewSpaceKey();
      
      expect(spaceKey).toBeInstanceOf(Uint8Array);
      expect(spaceKey.length).toBe(32);
    });

    it('should generate different keys', () => {
      const key1 = generateNewSpaceKey();
      const key2 = generateNewSpaceKey();
      
      expect(key1).not.toEqual(key2);
    });
  });

  describe('Envelope Encryption', () => {
    it('should encrypt space key for recipient', async () => {
      const ownerVault = await createVault(testPassword);
      const memberVault = await createVault(testPassword);
      
      const spaceId = createSpaceId('test-space-123');
      const spaceKey = generateNewSpaceKey();
      const memberPubKey = await memberVault.getPublicKey();
      
      const envelope = await encryptSpaceKeyFor(
        spaceId,
        spaceKey,
        memberPubKey,
        ownerVault
      );
      
      expect(envelope.spaceId).toBe(spaceId);
      expect(envelope.recipientPubKey).toBe(memberPubKey);
      expect(envelope.encryptedKey).toBeInstanceOf(Uint8Array);
      expect(envelope.encryptedKey.length).toBeGreaterThan(32); // encrypted + nonce + tag
      expect(envelope.version).toBe('v1');
    });

    it('should reject invalid space key length', async () => {
      const vault = await createVault(testPassword);
      const spaceId = createSpaceId('test-space');
      const badKey = new Uint8Array(16); // Wrong length
      const recipientPubKey = await vault.getPublicKey();
      
      await expect(
        encryptSpaceKeyFor(spaceId, badKey, recipientPubKey, vault)
      ).rejects.toThrow('Space key must be 32 bytes');
    });
  });

  describe('Envelope Decryption', () => {
    it('should decrypt space key envelope', async () => {
      const ownerVault = await createVault(testPassword);
      const memberVault = await createVault(testPassword);
      
      const spaceId = createSpaceId('test-space-123');
      const spaceKey = generateNewSpaceKey();
      const memberPubKey = await memberVault.getPublicKey();
      
      const envelope = await encryptSpaceKeyFor(
        spaceId,
        spaceKey,
        memberPubKey,
        ownerVault
      );
      
      const decryptedKey = await decryptSpaceKey(envelope, memberVault);
      
      expect(decryptedKey).toEqual(spaceKey);
    });

    it('should reject envelope for wrong recipient', async () => {
      const ownerVault = await createVault(testPassword);
      const member1Vault = await createVault(testPassword);
      const member2Vault = await createVault(testPassword);
      
      const spaceId = createSpaceId('test-space');
      const spaceKey = generateNewSpaceKey();
      const member1PubKey = await member1Vault.getPublicKey();
      
      const envelope = await encryptSpaceKeyFor(
        spaceId,
        spaceKey,
        member1PubKey,
        ownerVault
      );
      
      // Try to decrypt with member2's vault
      await expect(
        decryptSpaceKey(envelope, member2Vault)
      ).rejects.toThrow('Envelope is not for this recipient');
    });

    it('should reject unsupported envelope version', async () => {
      const vault = await createVault(testPassword);
      const spaceId = createSpaceId('test-space');
      const spaceKey = generateNewSpaceKey();
      const pubKey = await vault.getPublicKey();
      
      const envelope = await encryptSpaceKeyFor(
        spaceId,
        spaceKey,
        pubKey,
        vault
      );
      
      // Corrupt version
      envelope.version = 'v99' as any;
      
      await expect(
        decryptSpaceKey(envelope, vault)
      ).rejects.toThrow('Unsupported envelope version');
    });
  });

  describe('Space Key Cache', () => {
    beforeEach(() => {
      spaceKeyCache.clear();
    });

    it('should cache space key', () => {
      const spaceId = createSpaceId('test-space');
      const spaceKey = generateNewSpaceKey();
      
      spaceKeyCache.set(spaceId, spaceKey);
      
      expect(spaceKeyCache.has(spaceId)).toBe(true);
      expect(spaceKeyCache.get(spaceId)).toEqual(spaceKey);
    });

    it('should delete space key from cache', () => {
      const spaceId = createSpaceId('test-space');
      const spaceKey = generateNewSpaceKey();
      
      spaceKeyCache.set(spaceId, spaceKey);
      spaceKeyCache.delete(spaceId);
      
      expect(spaceKeyCache.has(spaceId)).toBe(false);
      expect(spaceKeyCache.get(spaceId)).toBeUndefined();
    });

    it('should clear all cached keys', () => {
      const space1 = createSpaceId('space-1');
      const space2 = createSpaceId('space-2');
      
      spaceKeyCache.set(space1, generateNewSpaceKey());
      spaceKeyCache.set(space2, generateNewSpaceKey());
      
      spaceKeyCache.clear();
      
      expect(spaceKeyCache.has(space1)).toBe(false);
      expect(spaceKeyCache.has(space2)).toBe(false);
    });
  });

  describe('Serialization', () => {
    it('should serialize and deserialize envelope', async () => {
      const ownerVault = await createVault(testPassword);
      const memberVault = await createVault(testPassword);
      
      const spaceId = createSpaceId('test-space-123');
      const spaceKey = generateNewSpaceKey();
      const memberPubKey = await memberVault.getPublicKey();
      
      const envelope = await encryptSpaceKeyFor(
        spaceId,
        spaceKey,
        memberPubKey,
        ownerVault
      );
      
      const serialized = serializeEnvelope(envelope);
      const deserialized = deserializeEnvelope(serialized);
      
      expect(deserialized.spaceId).toBe(envelope.spaceId);
      expect(deserialized.recipientPubKey).toBe(envelope.recipientPubKey);
      expect(deserialized.senderPubKey).toBe(envelope.senderPubKey);
      expect(deserialized.encryptedKey).toEqual(envelope.encryptedKey);
      expect(deserialized.version).toBe(envelope.version);
    });

    it('should decrypt after serialization round-trip', async () => {
      const ownerVault = await createVault(testPassword);
      const memberVault = await createVault(testPassword);
      
      const spaceId = createSpaceId('test-space');
      const spaceKey = generateNewSpaceKey();
      const memberPubKey = await memberVault.getPublicKey();
      
      const envelope = await encryptSpaceKeyFor(
        spaceId,
        spaceKey,
        memberPubKey,
        ownerVault
      );
      
      const serialized = serializeEnvelope(envelope);
      const deserialized = deserializeEnvelope(serialized);
      const decryptedKey = await decryptSpaceKey(deserialized, memberVault);
      
      expect(decryptedKey).toEqual(spaceKey);
    });

    it('should reject invalid serialized data', () => {
      const tooShort = new Uint8Array(10);
      
      expect(() => {
        deserializeEnvelope(tooShort);
      }).toThrow('Invalid envelope data: too short');
    });
  });

  describe('End-to-End', () => {
    it('should handle multi-member space key distribution', async () => {
      // Owner creates space
      const ownerVault = await createVault('owner-password');
      const spaceId = createSpaceId('shared-space');
      const spaceKey = generateNewSpaceKey();
      
      // Add 3 members
      const member1Vault = await createVault('member1-password');
      const member2Vault = await createVault('member2-password');
      const member3Vault = await createVault('member3-password');
      
      // Create envelopes for each member
      const envelope1 = await encryptSpaceKeyFor(
        spaceId,
        spaceKey,
        await member1Vault.getPublicKey(),
        ownerVault
      );
      
      const envelope2 = await encryptSpaceKeyFor(
        spaceId,
        spaceKey,
        await member2Vault.getPublicKey(),
        ownerVault
      );
      
      const envelope3 = await encryptSpaceKeyFor(
        spaceId,
        spaceKey,
        await member3Vault.getPublicKey(),
        ownerVault
      );
      
      // Each member can decrypt their envelope
      const key1 = await decryptSpaceKey(envelope1, member1Vault);
      const key2 = await decryptSpaceKey(envelope2, member2Vault);
      const key3 = await decryptSpaceKey(envelope3, member3Vault);
      
      // All members get the same space key
      expect(key1).toEqual(spaceKey);
      expect(key2).toEqual(spaceKey);
      expect(key3).toEqual(spaceKey);
    });
  });
});
