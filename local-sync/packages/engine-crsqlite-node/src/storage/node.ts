import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { StorageAdapter } from '@localsync/core';
import { StorageError } from '@localsync/core';

export type NodeStorageAdapterOptions = {
  baseDir?: string;
};

export class NodeStorageAdapter implements StorageAdapter {
  private baseDir: string;

  constructor(options: NodeStorageAdapterOptions = {}) {
    this.baseDir = options.baseDir ?? path.join(os.homedir(), '.localsync');
  }

  async ensureAppRoot(appId: string): Promise<void> {
    const appRoot = path.join(this.baseDir, appId);
    await fs.mkdir(appRoot, { recursive: true });
  }

  async deviceRegistryPath(appId: string): Promise<string> {
    const dir = path.join(this.baseDir, appId, 'device');
    await fs.mkdir(dir, { recursive: true });
    return path.join(dir, 'registry.sqlite');
  }

  async vaultPath(appId: string, pubkey: string): Promise<string> {
    const dir = path.join(this.baseDir, appId, 'identities', pubkey);
    await fs.mkdir(dir, { recursive: true });
    return path.join(dir, 'vault.enc');
  }

  async spaceDbPath(appId: string, pubkey: string, spaceId: string): Promise<string> {
    const dir = path.join(this.baseDir, appId, 'identities', pubkey, 'spaces', spaceId);
    await fs.mkdir(dir, { recursive: true });
    return path.join(dir, 'db.sqlite');
  }

  async spaceBlobsDir(appId: string, pubkey: string, spaceId: string): Promise<string> {
    const dir = path.join(this.baseDir, appId, 'identities', pubkey, 'spaces', spaceId, 'blobs');
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  async readFile(filePath: string): Promise<Uint8Array> {
    try {
      const data = await fs.readFile(filePath);
      return new Uint8Array(data);
    } catch (error) {
      throw new StorageError('FILE_NOT_FOUND', `Failed to read file: ${filePath}`, false, {
        path: filePath,
        error
      });
    }
  }

  async writeFile(filePath: string, data: Uint8Array): Promise<void> {
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, data);
    } catch (error) {
      throw new StorageError('WRITE_FAILED', `Failed to write file: ${filePath}`, false, {
        path: filePath,
        error
      });
    }
  }

  async deleteFile(filePath: string): Promise<void> {
    try {
      await fs.rm(filePath, { force: true });
    } catch (error) {
      throw new StorageError('DELETE_FAILED', `Failed to delete file: ${filePath}`, false, {
        path: filePath,
        error
      });
    }
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async readVault(appId: string, pubkey: string): Promise<Uint8Array> {
    const vaultPath = await this.vaultPath(appId, pubkey);
    return this.readFile(vaultPath);
  }

  async writeVault(appId: string, pubkey: string, data: Uint8Array): Promise<void> {
    const vaultPath = await this.vaultPath(appId, pubkey);
    await this.writeFile(vaultPath, data);
  }

  async vaultExists(appId: string, pubkey: string): Promise<boolean> {
    const vaultPath = await this.vaultPath(appId, pubkey);
    return this.fileExists(vaultPath);
  }
}

export function createNodeStorageAdapter(options?: NodeStorageAdapterOptions): StorageAdapter {
  return new NodeStorageAdapter(options);
}
