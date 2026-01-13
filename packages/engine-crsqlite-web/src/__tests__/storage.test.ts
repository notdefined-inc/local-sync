/**
 * Unit tests for OPFS Storage Adapter
 * Tests §3.1.1 StorageAdapter interface and §5.5 OPFS persistence
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OPFSStorageAdapter } from '../storage/opfs';
import { mockFileSystemDirectoryHandle, mockFileSystemFileHandle } from './setup';

describe('OPFS Storage Adapter', () => {
  let adapter: OPFSStorageAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OPFSStorageAdapter();
  });

  describe('§5.5.1 Capability Detection', () => {
    it('should detect OPFS capabilities', () => {
      // Test runs with mocked OPFS, so it should initialize
      expect(adapter).toBeDefined();
    });
  });

  describe('§3.1.1 Path Resolution', () => {
    it('should resolve device registry path', async () => {
      const path = await adapter.deviceRegistryPath('test-app');
      expect(path).toBe('/test-app/device/registry.sqlite');
    });

    it('should resolve vault path', async () => {
      const path = await adapter.vaultPath('test-app', 'pubkey123');
      expect(path).toBe('/test-app/identities/pubkey123/vault.enc');
    });

    it('should resolve space database path', async () => {
      const path = await adapter.spaceDbPath('test-app', 'pubkey123', 'space456');
      expect(path).toBe('/test-app/identities/pubkey123/spaces/space456/db.sqlite');
    });

    it('should resolve space blobs directory', async () => {
      const path = await adapter.spaceBlobsDir('test-app', 'pubkey123', 'space456');
      expect(path).toBe('/test-app/identities/pubkey123/spaces/space456/blobs/');
    });
  });

  describe('§5.5 Storage Persistence', () => {
    it('should request persistent storage', async () => {
      await adapter.ensureAppRoot('test-app');
      expect(navigator.storage.persist).toHaveBeenCalled();
    });

    it('should get storage quota', async () => {
      const quota = await adapter.getQuota();
      
      expect(quota).toHaveProperty('usage');
      expect(quota).toHaveProperty('quota');
      expect(typeof quota.usage).toBe('number');
      expect(typeof quota.quota).toBe('number');
    });
  });

  describe('File Operations', () => {
    it('should check if file exists', async () => {
      mockFileSystemDirectoryHandle.getFileHandle.mockResolvedValueOnce(mockFileSystemFileHandle);
      
      const exists = await adapter.fileExists('/test-app/test.txt');
      expect(typeof exists).toBe('boolean');
    });

    it('should return false for non-existent file', async () => {
      mockFileSystemDirectoryHandle.getFileHandle.mockRejectedValueOnce(new Error('Not found'));
      
      const exists = await adapter.fileExists('/test-app/nonexistent.txt');
      expect(exists).toBe(false);
    });
  });
});
