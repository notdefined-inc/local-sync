import type { StorageAdapter } from '../types';
import { StorageError } from '../types';

/**
 * In-memory storage adapter for tests and ephemeral sessions.
 */
export class MemoryStorageAdapter implements StorageAdapter {
  private files = new Map<string, Uint8Array>();

  async ensureAppRoot(_appId: string): Promise<void> {
    // No-op for in-memory storage.
  }

  async deviceRegistryPath(appId: string): Promise<string> {
    return `/${appId}/device/registry.sqlite`;
  }

  async vaultPath(appId: string, pubkey: string): Promise<string> {
    return `/${appId}/identities/${pubkey}/vault.enc`;
  }

  async spaceDbPath(appId: string, pubkey: string, spaceId: string): Promise<string> {
    return `/${appId}/identities/${pubkey}/spaces/${spaceId}/db.sqlite`;
  }

  async spaceBlobsDir(appId: string, pubkey: string, spaceId: string): Promise<string> {
    return `/${appId}/identities/${pubkey}/spaces/${spaceId}/blobs/`;
  }

  async readFile(path: string): Promise<Uint8Array> {
    const data = this.files.get(path);
    if (!data) {
      throw new StorageError('FILE_NOT_FOUND', `Missing file: ${path}`, false, { path });
    }
    return new Uint8Array(data);
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    this.files.set(path, new Uint8Array(data));
  }

  async deleteFile(path: string): Promise<void> {
    this.files.delete(path);
  }

  async fileExists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async readVault(appId: string, pubkey: string): Promise<Uint8Array> {
    const path = await this.vaultPath(appId, pubkey);
    return this.readFile(path);
  }

  async writeVault(appId: string, pubkey: string, data: Uint8Array): Promise<void> {
    const path = await this.vaultPath(appId, pubkey);
    await this.writeFile(path, data);
  }

  async vaultExists(appId: string, pubkey: string): Promise<boolean> {
    const path = await this.vaultPath(appId, pubkey);
    return this.fileExists(path);
  }
}

export function createMemoryStorageAdapter(): StorageAdapter {
  return new MemoryStorageAdapter();
}
