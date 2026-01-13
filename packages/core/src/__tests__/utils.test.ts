/**
 * Unit tests for LocalSync utilities
 * Tests §5.1.1 replicaId generation, checkpoint operations, retry logic
 */

import { describe, it, expect, vi } from 'vitest';
import {
  generateReplicaId,
  generateBlobId,
  generateSpaceTopic,
  mergeCheckpoints,
  checkpointGte,
  checkpointEqual,
  retryWithBackoff,
  debounce,
  createDeviceId,
  createIdentityPubKey,
  createSpaceId
} from '../utils';

describe('LocalSync Utils', () => {
  describe('Branded Type Constructors', () => {
    it('should create branded DeviceId', () => {
      const deviceId = createDeviceId('device-123');
      expect(deviceId).toBe('device-123');
    });

    it('should create branded IdentityPubKey', () => {
      const pubkey = createIdentityPubKey('pubkey-abc');
      expect(pubkey).toBe('pubkey-abc');
    });

    it('should create branded SpaceId', () => {
      const spaceId = createSpaceId('space-xyz');
      expect(spaceId).toBe('space-xyz');
    });
  });

  describe('§5.1.1 ReplicaId Generation', () => {
    it('should generate deterministic replicaId', () => {
      const deviceId = createDeviceId('device-1');
      const identityPubKey = createIdentityPubKey('pubkey-1');
      const spaceId = createSpaceId('space-1');

      const replicaId1 = generateReplicaId(deviceId, identityPubKey, spaceId);
      const replicaId2 = generateReplicaId(deviceId, identityPubKey, spaceId);

      expect(replicaId1).toBe(replicaId2);
      expect(replicaId1).toBeTruthy();
      expect(typeof replicaId1).toBe('string');
    });

    it('should generate different replicaIds for different inputs', () => {
      const deviceId1 = createDeviceId('device-1');
      const deviceId2 = createDeviceId('device-2');
      const identityPubKey = createIdentityPubKey('pubkey-1');
      const spaceId = createSpaceId('space-1');

      const replicaId1 = generateReplicaId(deviceId1, identityPubKey, spaceId);
      const replicaId2 = generateReplicaId(deviceId2, identityPubKey, spaceId);

      expect(replicaId1).not.toBe(replicaId2);
    });
  });

  describe('Content Addressing', () => {
    it('should generate blobId from bytes', () => {
      const bytes = new Uint8Array([1, 2, 3, 4, 5]);
      const blobId = generateBlobId(bytes);

      expect(blobId).toBeTruthy();
      expect(typeof blobId).toBe('string');
      expect(blobId.length).toBeGreaterThan(0);
    });

    it('should generate same blobId for same content', () => {
      const bytes = new Uint8Array([1, 2, 3, 4, 5]);
      const blobId1 = generateBlobId(bytes);
      const blobId2 = generateBlobId(bytes);

      expect(blobId1).toBe(blobId2);
    });
  });

  describe('§11.5.1 Space Topic Hashing', () => {
    it('should generate space topic hash', () => {
      const appId = 'test-app';
      const spaceId = createSpaceId('space-123');

      const topic = generateSpaceTopic(appId, spaceId);

      expect(topic).toBeTruthy();
      expect(typeof topic).toBe('string');
    });

    it('should generate deterministic topic hash', () => {
      const appId = 'test-app';
      const spaceId = createSpaceId('space-123');

      const topic1 = generateSpaceTopic(appId, spaceId);
      const topic2 = generateSpaceTopic(appId, spaceId);

      expect(topic1).toBe(topic2);
    });
  });

  describe('Checkpoint Operations', () => {
    it('should merge checkpoints correctly', () => {
      const cp1 = { vv: { 'replica-1': 5, 'replica-2': 3 } };
      const cp2 = { vv: { 'replica-2': 7, 'replica-3': 2 } };

      const merged = mergeCheckpoints(cp1, cp2);

      expect(merged.vv['replica-1']).toBe(5);
      expect(merged.vv['replica-2']).toBe(7); // max(3, 7)
      expect(merged.vv['replica-3']).toBe(2);
    });

    it('should check checkpoint >= correctly', () => {
      const cp1 = { vv: { 'replica-1': 5, 'replica-2': 7 } };
      const cp2 = { vv: { 'replica-1': 3, 'replica-2': 5 } };

      expect(checkpointGte(cp1, cp2)).toBe(true);
      expect(checkpointGte(cp2, cp1)).toBe(false);
    });

    it('should check checkpoint equality', () => {
      const cp1 = { vv: { 'replica-1': 5, 'replica-2': 3 } };
      const cp2 = { vv: { 'replica-1': 5, 'replica-2': 3 } };
      const cp3 = { vv: { 'replica-1': 5, 'replica-2': 4 } };

      expect(checkpointEqual(cp1, cp2)).toBe(true);
      expect(checkpointEqual(cp1, cp3)).toBe(false);
    });
  });

  describe('§10.4 Retry with Exponential Backoff', () => {
    it('should succeed on first try', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const result = await retryWithBackoff(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValue('success');

      const result = await retryWithBackoff(fn, { maxRetries: 3, initialDelayMs: 10 });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should throw after max retries', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('always fails'));

      await expect(
        retryWithBackoff(fn, { maxRetries: 2, initialDelayMs: 10 })
      ).rejects.toThrow('always fails');

      expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
    });
  });

  describe('Debounce', () => {
    it('should debounce function calls', async () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 50);

      debounced();
      debounced();
      debounced();

      expect(fn).not.toHaveBeenCalled();

      await new Promise(resolve => setTimeout(resolve, 60));

      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});
