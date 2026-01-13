import type { TransportProvider } from '@localsync/core';

export function createWebRTCTransportProvider(): TransportProvider {
  return {
    name: 'webrtc',
    createTransport: (params) => {
      void params;
      throw new Error('WebRTC transport not implemented yet');
    }
  };
}
