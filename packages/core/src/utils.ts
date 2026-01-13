/**
 * LocalSync Utility Functions
 * Helper functions for branded types, hashing, encoding, etc.
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import type { DeviceId, IdentityPubKey, SpaceId, ReplicaId, BlobId } from './types';

// ============================================================================
// Branded Type Constructors
// ============================================================================

export function createDeviceId(id: string): DeviceId {
  return id as DeviceId;
}

export function createIdentityPubKey(pubkey: string): IdentityPubKey {
  return pubkey as IdentityPubKey;
}

export function createSpaceId(id: string): SpaceId {
  return id as SpaceId;
}

export function createBlobId(hash: string): BlobId {
  return hash as BlobId;
}

// ============================================================================
// §5.1.1 ReplicaId Generation
// ============================================================================

/**
 * Generate deterministic replicaId from deviceId + identityPubKey + spaceId.
 * Format: base64url(sha256(deviceId + ":" + identityPubKey + ":" + spaceId)).slice(0, 16)
 * NOTE: Truncated to 16 chars to align with CR-SQLite 16-byte site_id binding (§9.2).
 */
export function generateReplicaId(
  deviceId: DeviceId,
  identityPubKey: IdentityPubKey,
  spaceId: SpaceId
): ReplicaId {
  const input = `${deviceId}:${identityPubKey}:${spaceId}`;
  const hash = sha256(new TextEncoder().encode(input));
  const base64url = base64urlEncode(hash);
  return base64url.slice(0, 16) as ReplicaId;
}

// ============================================================================
// Content Addressing for Blobs
// ============================================================================

/**
 * Generate content-addressed blobId from blob bytes
 * Format: sha256 hash in hex
 */
export function generateBlobId(bytes: Uint8Array): BlobId {
  const hash = sha256(bytes);
  return bytesToHex(hash) as BlobId;
}

// ============================================================================
// Space Topic Hashing (§11.5.1)
// ============================================================================

/**
 * Generate space topic hash for Nostr tags without revealing spaceId
 * Format: base64url(sha256(appId + ":" + spaceId))
 */
export function generateSpaceTopic(appId: string, spaceId: SpaceId): string {
  const input = `${appId}:${spaceId}`;
  const hash = sha256(new TextEncoder().encode(input));
  return base64urlEncode(hash);
}

// ============================================================================
// Encoding Utilities
// ============================================================================

export function base64urlEncode(bytes: Uint8Array): string {
  let base64: string;
  const BufferRef = (globalThis as any)?.Buffer as
    | { from: (input: Uint8Array) => { toString: (format: string) => string } }
    | undefined;
  if (BufferRef) {
    base64 = BufferRef.from(bytes).toString('base64');
  } else {
    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    base64 = btoa(binary);
  }
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

// ============================================================================
// Checkpoint Utilities
// ============================================================================

/**
 * Merge two checkpoints (union of vector clocks)
 */
export function mergeCheckpoints(a: { vv: Record<string, number> }, b: { vv: Record<string, number> }): { vv: Record<string, number> } {
  const merged: Record<string, number> = { ...a.vv };
  
  for (const [replicaId, counter] of Object.entries(b.vv)) {
    merged[replicaId] = Math.max(merged[replicaId] || 0, counter);
  }
  
  return { vv: merged };
}

/**
 * Check if checkpoint A is >= checkpoint B (A has everything B has)
 */
export function checkpointGte(a: { vv: Record<string, number> }, b: { vv: Record<string, number> }): boolean {
  for (const [replicaId, counter] of Object.entries(b.vv)) {
    if ((a.vv[replicaId] || 0) < counter) {
      return false;
    }
  }
  return true;
}

/**
 * Check if two checkpoints are equal
 */
export function checkpointEqual(a: { vv: Record<string, number> }, b: { vv: Record<string, number> }): boolean {
  const aKeys = Object.keys(a.vv).sort();
  const bKeys = Object.keys(b.vv).sort();
  
  if (aKeys.length !== bKeys.length) return false;
  
  for (let i = 0; i < aKeys.length; i++) {
    const aKey = aKeys[i];
    const bKey = bKeys[i];
    if (!aKey || !bKey) continue; // Skip if undefined
    if (aKey !== bKey) return false;
    if (a.vv[aKey] !== b.vv[bKey]) return false;
  }
  
  return true;
}

// ============================================================================
// Retry with Exponential Backoff (§10.4)
// ============================================================================

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  jitterFactor?: number;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 5,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    backoffMultiplier = 2,
    jitterFactor = 0.1
  } = options;

  let lastError: Error | undefined;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === maxRetries) {
        break;
      }
      
      // Calculate delay with exponential backoff
      const baseDelay = Math.min(initialDelayMs * Math.pow(backoffMultiplier, attempt), maxDelayMs);
      
      // Add jitter
      const jitter = baseDelay * jitterFactor * (Math.random() * 2 - 1);
      const delay = Math.max(0, baseDelay + jitter);
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

// ============================================================================
// Debounce Utility (for watch)
// ============================================================================

export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  delayMs: number
): T {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  
  return ((...args: any[]) => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, delayMs);
  }) as T;
}
