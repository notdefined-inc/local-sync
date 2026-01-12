import type { BlobStoreProvider } from '@localsync/core';

export function createLocalBlobStoreProvider(): BlobStoreProvider {
  return {
    name: 'local',
    createStore: (params) => {
      void params;
      throw new Error('Local blob store not implemented yet');
    }
  };
}
