/**
 * Vault - Encrypted Identity Storage
 * Implements §6.2 Vault Interface with NIP-49 encryption
 */

import type { Vault as IVault, UnlockedSession, VaultProvider } from '../types';
import {
  encryptPrivateKey,
  decryptPrivateKey,
  serializeVault,
  deserializeVault,
  type EncryptedVault
} from '../crypto/nip49';
import {
  generateKeypair,
  getPublicKey,
  signBytes,
  verifySignature,
  deriveSharedSecret,
  encryptWithSharedSecret,
  decryptWithSharedSecret
} from '../crypto/primitives';
import { hexToBytes } from '../utils';

/**
 * Vault implementation with NIP-49 encryption
 * §6.2 - Vault stores identity private key encrypted at rest
 */
export class Vault implements IVault {
  private encryptedVault: EncryptedVault | null = null;
  private privateKey: Uint8Array | null = null;
  private publicKey: string | null = null;
  private isUnlocked: boolean = false;

  /**
   * Create new vault with generated keypair
   * §6.2 - create(password): Promise<void>
   */
  async create(password: string): Promise<void> {
    if (this.privateKey || this.publicKey || this.encryptedVault) {
      throw new Error('Vault already exists');
    }

    // Basic password strength check (full KDF happens during export).
    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }

    // Generate new secp256k1 keypair
    const keypair = await generateKeypair();
    
    this.privateKey = keypair.privateKey;
    this.publicKey = keypair.publicKey;
    this.isUnlocked = true;
  }

  /**
   * Unlock existing vault with password
   * §6.2 - unlock(password): Promise<UnlockedSession>
   */
  async unlock(password: string): Promise<UnlockedSession> {
    if (this.isUnlocked && this.privateKey && this.publicKey) {
      return { pubKey: this.publicKey };
    }

    if (!this.encryptedVault) {
      throw new Error('Vault must be loaded from storage before unlocking');
    }

    const privateKey = decryptPrivateKey(this.encryptedVault, password);
    const publicKey = await getPublicKey(privateKey);

    this.privateKey = privateKey;
    this.publicKey = publicKey;
    this.isUnlocked = true;

    return { pubKey: publicKey };
  }

  /**
   * Lock vault (clear in-memory keys)
   * §6.2 - lock(): void
   */
  lock(): void {
    // Clear sensitive data from memory
    if (this.privateKey) {
      this.privateKey.fill(0);
      this.privateKey = null;
    }
    this.isUnlocked = false;
  }

  /**
   * Get public key
   * §6.2 - getPublicKey(): Promise<string>
   */
  async getPublicKey(): Promise<string> {
    if (!this.publicKey) {
      throw new Error('Vault not initialized');
    }
    return this.publicKey;
  }

  /**
   * Encrypt data for recipient using ECDH
   * §6.2 - encryptFor(pubKey, bytes): Promise<Uint8Array>
   */
  async encryptFor(recipientPubKey: string, bytes: Uint8Array): Promise<Uint8Array> {
    if (!this.isUnlocked || !this.privateKey) {
      throw new Error('Vault must be unlocked to encrypt');
    }

    if (!this.publicKey) {
      throw new Error('Vault not initialized');
    }

    // Derive shared secret using ECDH
    const sharedSecret = await deriveSharedSecret(this.privateKey, recipientPubKey);
    
    // Encrypt with XChaCha20-Poly1305.
    // Output: version(1) || senderPubKey(32) || nonce(24) || ciphertext || tag(16)
    const payload = encryptWithSharedSecret(sharedSecret, bytes);
    const senderPubKeyBytes = hexToBytes(this.publicKey);

    if (senderPubKeyBytes.length !== 32) {
      throw new Error('Invalid public key length');
    }

    const output = new Uint8Array(1 + 32 + payload.length);
    output[0] = 1; // v1
    output.set(senderPubKeyBytes, 1);
    output.set(payload, 1 + 32);

    return output;
  }

  /**
   * Decrypt data encrypted for this identity
   * §6.2 - decrypt(bytes): Promise<Uint8Array>
   */
  async decrypt(encrypted: Uint8Array): Promise<Uint8Array> {
    if (!this.isUnlocked || !this.privateKey) {
      throw new Error('Vault must be unlocked to decrypt');
    }

    if (encrypted.length < 1 + 32 + 24 + 16) {
      throw new Error('Invalid ciphertext: too short');
    }

    const version = encrypted[0];
    if (version !== 1) {
      throw new Error(`Unsupported envelope version: ${version}`);
    }

    const senderPubKeyBytes = encrypted.slice(1, 33);
    const senderPubKeyHex = Array.from(senderPubKeyBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const payload = encrypted.slice(1 + 32);

    // Derive shared secret using ECDH and decrypt.
    const sharedSecret = await deriveSharedSecret(this.privateKey, senderPubKeyHex);
    return decryptWithSharedSecret(sharedSecret, payload);
  }

  /**
   * Decrypt data from specific sender
   */
  async decryptFrom(senderPubKey: string, encrypted: Uint8Array): Promise<Uint8Array> {
    if (encrypted.length < 1 + 32) {
      throw new Error('Invalid ciphertext: too short');
    }

    const senderPubKeyBytes = encrypted.slice(1, 33);
    const senderPubKeyHex = Array.from(senderPubKeyBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    if (senderPubKeyHex !== senderPubKey) {
      throw new Error('Envelope sender mismatch');
    }

    return this.decrypt(encrypted);
  }

  /**
   * Sign data with identity private key
   * §6.2 - sign(bytes): Promise<Uint8Array>
   */
  async sign(bytes: Uint8Array): Promise<Uint8Array> {
    if (!this.isUnlocked || !this.privateKey) {
      throw new Error('Vault must be unlocked to sign');
    }

    return signBytes(bytes, this.privateKey);
  }

  /**
   * Verify signature
   * §6.2 - verify(pubKey, bytes, sig): Promise<boolean>
   */
  async verify(pubKey: string, bytes: Uint8Array, sig: Uint8Array): Promise<boolean> {
    return verifySignature(bytes, sig, pubKey);
  }

  /**
   * Export vault to encrypted bytes for storage
   * Uses NIP-49 encryption format
   */
  async exportEncrypted(password: string): Promise<Uint8Array> {
    if (!this.privateKey) {
      throw new Error('Vault not initialized');
    }

    // Encrypt private key with password
    const encryptedVault = encryptPrivateKey(this.privateKey, password);
    this.encryptedVault = encryptedVault;
    
    // Serialize to bytes
    return serializeVault(encryptedVault);
  }

  /**
   * Import vault from encrypted bytes
   * Returns a new Vault instance ready to be unlocked
   */
  static async importEncrypted(encryptedBytes: Uint8Array): Promise<Vault> {
    const vault = new Vault();
    vault.encryptedVault = deserializeVault(encryptedBytes);
    vault.isUnlocked = false;
    return vault;
  }

  /**
   * Check if vault is unlocked
   */
  isVaultUnlocked(): boolean {
    return this.isUnlocked;
  }
}

/**
 * Create a new vault
 */
export async function createVault(password: string): Promise<Vault> {
  const vault = new Vault();
  await vault.create(password);
  return vault;
}

/**
 * Load and unlock vault from encrypted bytes
 */
export async function unlockVault(encryptedBytes: Uint8Array, password: string): Promise<Vault> {
  const vault = await Vault.importEncrypted(encryptedBytes);
  await vault.unlock(password);
  return vault;
}

export const defaultVaultProvider: VaultProvider = {
  create: createVault,
  unlock: unlockVault
};
