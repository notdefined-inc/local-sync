/**
 * OPFS Storage Adapter for Web
 * Implements §3.1.1 StorageAdapter interface and §5.5 OPFS persistence
 */

import type { StorageAdapter } from '@localsync/core';
import { StorageError } from '@localsync/core';

/**
 * OPFS-based storage adapter for web browsers
 * Handles path resolution and directory management
 */
export class OPFSStorageAdapter implements StorageAdapter {
  private root: FileSystemDirectoryHandle | null = null;
  private appRoot: FileSystemDirectoryHandle | null = null;
  private appId: string = '';

  constructor() {
    this.detectCapabilities();
  }

  /**
   * §5.5.1 Detect OPFS capabilities (fast path vs fallback)
   */
  private detectCapabilities(): void {
    const hasFastPath = 
      typeof crossOriginIsolated !== 'undefined' && 
      crossOriginIsolated &&
      typeof (globalThis as any).FileSystemSyncAccessHandle !== 'undefined';

    if (hasFastPath) {
      console.log('[Storage] OPFS fast path available (COOP/COEP enabled)');
    } else {
      console.log('[Storage] OPFS fallback path (async handles or IDB-backed VFS)');
    }
  }

  /**
   * Initialize OPFS root and request persistent storage
   */
  async ensureAppRoot(appId: string): Promise<void> {
    if (this.appRoot && this.appId === appId) {
      return; // Already initialized
    }

    this.appId = appId;
    
    try {
      // Request persistent storage
      if (navigator.storage && navigator.storage.persist) {
        const isPersisted = await navigator.storage.persist();
        console.log('[Storage] Persistent storage:', isPersisted ? 'granted' : 'denied');
      }

      // Get OPFS root
      this.root = await navigator.storage.getDirectory();
      
      // Initialize app root directory
      this.appRoot = await this.root.getDirectoryHandle(appId, { create: true });
      console.log(`[Storage] App root initialized: /${appId}/`);
    } catch (error) {
      throw new StorageError(
        'STORAGE_INIT_FAILED',
        'Failed to initialize OPFS storage',
        false,
        { error }
      );
    }
  }

  /**
   * §3.1 Device registry path: /<appId>/device/registry.sqlite
   */
  async deviceRegistryPath(appId: string): Promise<string> {
    await this.ensureDirectory(appId, 'device');
    return `/${appId}/device/registry.sqlite`;
  }

  /**
   * §3.1 Vault path: /<appId>/identities/<pubkey>/vault.enc
   */
  async vaultPath(appId: string, pubkey: string): Promise<string> {
    await this.ensureDirectory(appId, 'identities', pubkey);
    return `/${appId}/identities/${pubkey}/vault.enc`;
  }

  /**
   * §3.1 Space database path: /<appId>/identities/<pubkey>/spaces/<spaceId>/db.sqlite
   */
  async spaceDbPath(appId: string, pubkey: string, spaceId: string): Promise<string> {
    await this.ensureDirectory(appId, 'identities', pubkey, 'spaces', spaceId);
    return `/${appId}/identities/${pubkey}/spaces/${spaceId}/db.sqlite`;
  }

  /**
   * §3.1 Space blobs directory: /<appId>/identities/<pubkey>/spaces/<spaceId>/blobs/
   */
  async spaceBlobsDir(appId: string, pubkey: string, spaceId: string): Promise<string> {
    await this.ensureDirectory(appId, 'identities', pubkey, 'spaces', spaceId, 'blobs');
    return `/${appId}/identities/${pubkey}/spaces/${spaceId}/blobs/`;
  }

  /**
   * Helper: Ensure nested directory exists
   */
  private async ensureDirectory(appId: string, ...pathSegments: string[]): Promise<void> {
    if (!this.root) {
      await this.ensureAppRoot(appId);
    }

    let current = this.root!;
    
    // Start with appId
    current = await current.getDirectoryHandle(appId, { create: true });
    
    // Create nested directories
    for (const segment of pathSegments) {
      current = await current.getDirectoryHandle(segment, { create: true });
    }
  }

  /**
   * Get file handle for reading/writing
   */
  async getFileHandle(path: string, create: boolean = false): Promise<FileSystemFileHandle> {
    if (!this.root) {
      throw new StorageError('OPFS_UNAVAILABLE', 'Storage not initialized', false);
    }

    const segments = path.split('/').filter(s => s.length > 0);
    const fileName = segments.pop()!;
    
    let current = this.root;
    for (const segment of segments) {
      current = await current.getDirectoryHandle(segment, { create });
    }

    return await current.getFileHandle(fileName, { create });
  }

  /**
   * Read file as Uint8Array
   */
  async readFile(path: string): Promise<Uint8Array> {
    try {
      const fileHandle = await this.getFileHandle(path, false);
      const file = await fileHandle.getFile();
      const buffer = await file.arrayBuffer();
      return new Uint8Array(buffer);
    } catch (error) {
      throw new StorageError(
        'FILE_NOT_FOUND',
        `Failed to read file: ${path}`,
        false,
        { path, error }
      );
    }
  }

  /**
   * Write file
   */
  async writeFile(path: string, data: Uint8Array): Promise<void> {
    try {
      // Ensure parent directory exists
      const parts = path.split('/').filter(p => p);
      const fileName = parts.pop()!;
      const dirPath = '/' + parts.join('/');
      
      // Get or create parent directory
      // This helper ensures the full directory path exists and returns the handle to the deepest directory
      const parentDir = await this.getDirectoryHandle(dirPath, true);
      
      // Get file handle (create if doesn't exist)
      const fileHandle = await parentDir.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(data as any);
      await writable.close();
    } catch (error) {
      throw new StorageError(
        'WRITE_FAILED',
        `Failed to write file: ${path}`,
        false,
        { path, error }
      );
    }
  }

  /**
   * Helper: Get a directory handle for a given path, creating it if specified.
   * This is a new helper to support the `writeFile` change.
   */
  private async getDirectoryHandle(path: string, create: boolean = false): Promise<FileSystemDirectoryHandle> {
    if (!this.root) {
      throw new StorageError('OPFS_UNAVAILABLE', 'Storage not initialized', false);
    }

    let current = this.root;
    const segments = path.split('/').filter(s => s.length > 0);

    for (const segment of segments) {
      current = await current.getDirectoryHandle(segment, { create });
    }
    return current;
  }

  /**
   * Check if file exists
   */
  async fileExists(path: string): Promise<boolean> {
    try {
      await this.getFileHandle(path, false);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read vault file for an identity
   * §3.1 - /appId/identities/{pubkey}/vault.enc
   */
  async readVault(appId: string, pubkey: string): Promise<Uint8Array> {
    const vaultPath = `/${appId}/identities/${pubkey}/vault.enc`;
    return this.readFile(vaultPath);
  }

  /**
   * Write vault file for an identity
   * §3.1 - /appId/identities/{pubkey}/vault.enc
   */
  async writeVault(appId: string, pubkey: string, data: Uint8Array): Promise<void> {
    // Ensure app root exists
    await this.ensureAppRoot(appId);
    
    const vaultPath = `/${appId}/identities/${pubkey}/vault.enc`;
    await this.writeFile(vaultPath, data);
  }

  /**
   * Check if vault exists for an identity
   */
  async vaultExists(appId: string, pubkey: string): Promise<boolean> {
    const vaultPath = `/${appId}/identities/${pubkey}/vault.enc`;
    return this.fileExists(vaultPath);
  }

  /**
   * Delete file
   */
  async deleteFile(path: string): Promise<void> {
    try {
      const segments = path.split('/').filter(s => s.length > 0);
      const fileName = segments.pop()!;
      
      let current = this.root!;
      for (const segment of segments) {
        current = await current.getDirectoryHandle(segment, { create: false });
      }

      await current.removeEntry(fileName);
    } catch (error) {
      throw new StorageError(
        'DELETE_FAILED',
        `Failed to delete file: ${path}`,
        false,
        { path, error }
      );
    }
  }

  /**
   * Get storage quota information
   */
  async getQuota(): Promise<{ usage: number; quota: number }> {
    if (!navigator.storage?.estimate) {
      return { usage: 0, quota: 0 };
    }

    const estimate = await navigator.storage.estimate();
    return {
      usage: estimate.usage || 0,
      quota: estimate.quota || 0
    };
  }
}

/**
 * Create storage adapter instance
 */
export function createStorageAdapter(): StorageAdapter {
  return new OPFSStorageAdapter();
}
