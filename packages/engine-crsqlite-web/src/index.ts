import type { EngineProvider, StorageAdapter } from '@localsync/core';
import { SQLiteEngine, type WebCRSQLiteEngineOptions } from './engine/sqlite';
import { OPFSStorageAdapter } from './storage/opfs';

export { SQLiteEngine };
export { OPFSStorageAdapter };

export function createSQLiteEngine(options?: WebCRSQLiteEngineOptions): SQLiteEngine {
  return new SQLiteEngine(options);
}

export function createWebEngineProvider(options?: WebCRSQLiteEngineOptions): EngineProvider {
  return {
    createEngine: (params) => {
      void params;
      return new SQLiteEngine(options);
    }
  };
}

export function createOpfsStorageAdapter(): StorageAdapter {
  return new OPFSStorageAdapter();
}

export type { WebCRSQLiteEngineOptions };
