/**
 * LocalSync SDK Main Entry Point
 * Implements §14 Public API
 */

import type {
  BlobStoreProvider,
  ControlPlaneProvider,
  Engine,
  EngineProvider,
  IdentityPubKey,
  SpaceId,
  StorageAdapter,
  TransportProvider,
  Vault,
  VaultProvider,
  WatchOptions
} from './types';
import { generateDeviceId } from './crypto/primitives';
import { createIdentityPubKey, createSpaceId } from './utils';
import { spaceKeyCache } from './vault/space-keys';

/**
 * LocalSync configuration options
 */
export interface LocalSyncOpenParams {
  appId: string;
  storage: StorageAdapter;
  vault: VaultProvider;
  engine: EngineProvider;
  controlPlane?: ControlPlaneProvider;
  transports?: TransportProvider[];
  blobStores?: BlobStoreProvider[];
  deviceId?: string;
}

/**
 * LocalSync client instance
 */
export class LocalSyncClient {
  private appId: string;
  private storage: StorageAdapter;
  private vaultProvider: VaultProvider;
  private engineProvider: EngineProvider;
  private controlPlaneProvider?: ControlPlaneProvider;
  private transportProviders: TransportProvider[];
  private blobStoreProviders: BlobStoreProvider[];
  // @ts-expect-error - Will be used in Phase 2 for session management
  private _currentIdentity: IdentityPubKey | null = null;
  private deviceId: string;

  constructor(config: LocalSyncOpenParams) {
    this.appId = config.appId;
    this.storage = config.storage;
    this.vaultProvider = config.vault;
    this.engineProvider = config.engine;
    this.controlPlaneProvider = config.controlPlane;
    this.transportProviders = config.transports ?? [];
    this.blobStoreProviders = config.blobStores ?? [];
    this.deviceId = config.deviceId ?? generateDeviceId();
    
    console.log('[LocalSync] Client initialized for app:', this.appId);
    console.log('[LocalSync] Device ID:', this.deviceId);
  }

  /**
   * §14.2 Identity management
   */
  get identities() {
    return {
      list: async () => {
        // TODO: Query device registry
        return [];
      }
    };
  }

  /**
   * §14.2 Create new identity with password
   */
  async createIdentity(password: string): Promise<IdentityPubKey> {
    // Create new vault with keypair
    const vault = await this.vaultProvider.create(password);
    const pubkey = await vault.getPublicKey();
    
    // Save encrypted vault to OPFS
    const encryptedVault = await vault.exportEncrypted(password);
    await this.storage.writeVault(this.appId, pubkey, encryptedVault);
    
    console.log('[LocalSync] Created identity:', pubkey);
    return createIdentityPubKey(pubkey);
  }

  /**
   * §14.2 Login with identity
   */
  async login(pubkey: string, password: string): Promise<LocalSyncSession> {
    // Check if vault exists
    const vaultExists = await this.storage.vaultExists(this.appId, pubkey);
    if (!vaultExists) {
      throw new Error(`Identity not found: ${pubkey}`);
    }
    
    // Load and unlock vault
    const encryptedVault = await this.storage.readVault(this.appId, pubkey);
    const vault = await this.vaultProvider.unlock(encryptedVault, password);
    
    this._currentIdentity = createIdentityPubKey(pubkey);
    
    console.log('[LocalSync] Logged in as:', pubkey);
    return new LocalSyncSession(this, vault, pubkey);
  }

  /**
   * §14.2 Logout
   */
  async logout(): Promise<void> {
    // Clear space key cache
    spaceKeyCache.clear();
    
    this._currentIdentity = null;
    
    console.log('[LocalSync] Logged out');
  }

  // Internal getters
  getAppId(): string {
    return this.appId;
  }

  getDeviceId(): string {
    return this.deviceId;
  }

  getStorage(): StorageAdapter {
    return this.storage;
  }

  getVaultProvider(): VaultProvider {
    return this.vaultProvider;
  }

  getEngineProvider(): EngineProvider {
    return this.engineProvider;
  }

  getControlPlaneProvider(): ControlPlaneProvider | undefined {
    return this.controlPlaneProvider;
  }

  getTransportProviders(): TransportProvider[] {
    return this.transportProviders;
  }

  getBlobStoreProviders(): BlobStoreProvider[] {
    return this.blobStoreProviders;
  }
}

/**
 * Session after login
 */
export class LocalSyncSession {
  constructor(
    private client: LocalSyncClient,
    private vault: Vault,
    private pubkey: string
  ) {}

  /**
   * Sign data with identity private key
   */
  async signData(data: Uint8Array): Promise<Uint8Array> {
    return this.vault.sign(data);
  }

  /**
   * Encrypt data for recipient using ECDH
   */
  async encryptFor(recipientPubKey: string, data: Uint8Array): Promise<Uint8Array> {
    return this.vault.encryptFor(recipientPubKey, data);
  }

  /**
   * Decrypt data from sender using ECDH
   */
  async decryptFrom(senderPubKey: string, encrypted: Uint8Array): Promise<Uint8Array> {
    return this.vault.decryptFrom(senderPubKey, encrypted);
  }

  /**
   * Get identity public key
   */
  async getPublicKey(): Promise<string> {
    return this.vault.getPublicKey();
  }

  /**
   * §14.3 Space operations
   */
  get spaces() {
    return {
      list: async () => {
        // TODO: Query _ls_spaces table
        return [];
      },
      
      open: async (spaceId: SpaceId) => {
        const handle = new SpaceHandle(
          spaceId,
          this.client.getAppId(),
          this.pubkey,
          this.client.getDeviceId(),
          this.client.getStorage(),
          this.client.getEngineProvider(),
          this.vault,
          this.client.getControlPlaneProvider(),
          this.client.getTransportProviders(),
          this.client.getBlobStoreProviders()
        );
        await handle.initialize();
        return handle;
      },
      
      createPersonal: async () => {
        const spaceId = createSpaceId(crypto.randomUUID());
        const handle = new SpaceHandle(
          spaceId,
          this.client.getAppId(),
          this.pubkey,
          this.client.getDeviceId(),
          this.client.getStorage(),
          this.client.getEngineProvider(),
          this.vault,
          this.client.getControlPlaneProvider(),
          this.client.getTransportProviders(),
          this.client.getBlobStoreProviders()
        );
        await handle.initialize();
        return handle;
      },
      
      createShared: async () => {
        const spaceId = createSpaceId(crypto.randomUUID());
        const handle = new SpaceHandle(
          spaceId,
          this.client.getAppId(),
          this.pubkey,
          this.client.getDeviceId(),
          this.client.getStorage(),
          this.client.getEngineProvider(),
          this.vault,
          this.client.getControlPlaneProvider(),
          this.client.getTransportProviders(),
          this.client.getBlobStoreProviders()
        );
        await handle.initialize();
        return handle;
      }
    };
  }
}

/**
 * Handle to an open space
 */
export class SpaceHandle {
  private engine: Engine | null = null;
  private initialized: boolean = false;

  constructor(
    private spaceId: SpaceId,
    private appId: string,
    private identityPubKey: string,
    private deviceId: string,
    private storage: StorageAdapter,
    private engineProvider: EngineProvider,
    private vault: Vault,
    private controlPlaneProvider?: ControlPlaneProvider,
    private transportProviders: TransportProvider[] = [],
    private blobStoreProviders: BlobStoreProvider[] = []
  ) {
  }

  /**
   * Initialize the engine (must be called after construction)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const dbPath = await this.storage.spaceDbPath(
      this.appId,
      this.identityPubKey,
      this.spaceId
    );

    const openParams = {
      appId: this.appId,
      identityPubKey: this.identityPubKey,
      spaceId: this.spaceId,
      deviceId: this.deviceId,
      dbPath,
      storage: this.storage
    };

    this.engine = this.engineProvider.createEngine(openParams);
    await this.engine.open(openParams);

    this.initialized = true;
  }

  private getEngine(): Engine {
    if (!this.engine) {
      throw new Error('SpaceHandle is not initialized');
    }
    return this.engine;
  }

  /**
   * §14.4 Execute SQL
   */
  async exec(sql: string, params?: unknown[]) {
    return await this.getEngine().exec(sql, params);
  }

  /**
   * §14.4 Run SQL (no results)
   */
  async run(sql: string, params?: unknown[]) {
    return await this.getEngine().run(sql, params);
  }

  /**
   * §14.4 Reactive watch
   */
  watch(query: string, params: unknown[], cb: (rows: unknown[]) => void, options?: WatchOptions) {
    return this.getEngine().watch(query, params, cb, options);
  }

  /**
   * §14.5 Sync control
   */
  get sync() {
    return {
      start: async () => {
        // TODO: Start sync pipeline
        if (this.transportProviders.length === 0) {
          throw new Error('No transports configured for sync');
        }
        console.log('[Sync] Started');
      },
      
      stop: async () => {
        // TODO: Stop sync pipeline
        console.log('[Sync] Stopped');
      },
      
      once: async () => {
        // TODO: Trigger one-time sync
        if (this.transportProviders.length === 0) {
          throw new Error('No transports configured for sync');
        }
        console.log('[Sync] One-time sync triggered');
      },
      
      exportSnapshot: async () => {
        return await this.getEngine().exportSnapshot(this.spaceId);
      },
      
      importSnapshot: async (bytes: Uint8Array) => {
        return await this.getEngine().importSnapshot(this.spaceId, bytes);
      }
    };
  }

  /**
   * §14.6 File operations
   */
  get files() {
    return {
      put: async (_fileBytes: Uint8Array, _meta: { mime: string }) => {
        // TODO: Implement blob storage
        if (this.blobStoreProviders.length === 0) {
          throw new Error('No blob stores configured');
        }
        throw new Error('Not implemented');
      },
      
      get: async (_blobId: string) => {
        // TODO: Implement blob retrieval
        if (this.blobStoreProviders.length === 0) {
          throw new Error('No blob stores configured');
        }
        throw new Error('Not implemented');
      },
      
      has: async (_blobId: string) => {
        // TODO: Check blob existence
        if (this.blobStoreProviders.length === 0) {
          return false;
        }
        return false;
      }
    };
  }

  /**
   * §7.3 Invite member to shared space
   */
  async invite(options: { memberPubKey: string; role: string }) {
    // TODO: Create and publish invite envelope
    if (!this.controlPlaneProvider) {
      throw new Error('Control plane not configured for invites');
    }
    const senderPubKey = await this.vault.getPublicKey();
    console.log('[Space] Invite sent from:', senderPubKey, 'to:', options.memberPubKey);
  }
}

/**
 * §14.1 Top-level API
 */
export const LocalSync = {
  /**
   * Open LocalSync client
   */
  open: async (config: LocalSyncOpenParams): Promise<LocalSyncClient> => {
    const client = new LocalSyncClient(config);
    
    // Initialize storage
    await client.getStorage().ensureAppRoot(config.appId);
    
    return client;
  }
};

export { defaultVaultProvider } from './vault/vault';
export { createMemoryStorageAdapter, MemoryStorageAdapter } from './storage/memory';
export { createOfflineQueue, SQLiteOfflineQueue } from './queue/offline';

// Re-export types for convenience
export type * from './types';
export * from './types';
