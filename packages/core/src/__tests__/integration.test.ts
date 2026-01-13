/**
 * Integration Tests
 * Tests §14 Public API integration
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LocalSyncClient, createMemoryStorageAdapter, defaultVaultProvider } from '../index';
import { createWebEngineProvider } from '@localsync/engine-crsqlite-web';

describe('LocalSync SDK Integration', () => {
  let client: LocalSyncClient;
  const testPassword = 'test-password-123';

  beforeEach(() => {
    client = new LocalSyncClient({
      appId: `test-app-${Date.now()}`,
      storage: createMemoryStorageAdapter(),
      vault: defaultVaultProvider,
      engine: createWebEngineProvider()
    });
  });

  describe('§14.1 Client Initialization', () => {
    it('should initialize client with config', () => {
      expect(client).toBeDefined();
      expect(client.getAppId()).toBeTruthy();
      expect(client.getDeviceId()).toBeTruthy();
    });
  });

  describe('§14.2 Identity Management', () => {
    it('should create new identity', async () => {
      const pubkey = await client.createIdentity(testPassword);
      
      expect(pubkey).toBeTruthy();
      expect(typeof pubkey).toBe('string');
      expect(pubkey.length).toBe(64); // 32 bytes hex
    });

    it('should login with created identity', async () => {
      const pubkey = await client.createIdentity(testPassword);
      const session = await client.login(pubkey, testPassword);

      expect(session).toBeDefined();
      expect(session.spaces).toBeDefined();
    });

    it('should logout successfully', async () => {
      const pubkey = await client.createIdentity(testPassword);
      await client.login(pubkey, testPassword);
      
      await expect(client.logout()).resolves.not.toThrow();
    });
  });
});
