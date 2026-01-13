import type { EngineProvider, StorageAdapter } from '@localsync/core';
import {
  SQLiteNodeEngine,
  createSQLiteEngine as createSQLiteEngineImpl,
  type NodeCRSQLiteEngineOptions
} from './engine/sqlite';
import { createNodeStorageAdapter as createNodeStorageAdapterImpl, NodeStorageAdapter } from './storage/node';

export { SQLiteNodeEngine, NodeStorageAdapter, createSQLiteEngineImpl as createSQLiteEngine };

export function createNodeEngineProvider(options?: NodeCRSQLiteEngineOptions): EngineProvider {
  return {
    createEngine: (params) => {
      void params;
      return new SQLiteNodeEngine(options);
    }
  };
}

export function createNodeStorageAdapter(
  options?: Parameters<typeof createNodeStorageAdapterImpl>[0]
): StorageAdapter {
  return createNodeStorageAdapterImpl(options);
}

export type { NodeCRSQLiteEngineOptions };
