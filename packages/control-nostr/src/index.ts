import type { ControlPlaneProvider } from '@localsync/core';

export function createNostrControlPlaneProvider(): ControlPlaneProvider {
  return {
    createControlPlane: (params) => {
      void params;
      throw new Error('Nostr control plane not implemented yet');
    }
  };
}
