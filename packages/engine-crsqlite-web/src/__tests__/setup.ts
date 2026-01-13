/**
 * Test setup for LocalSync SDK
 */

type DirNode = {
  dirs: Map<string, DirNode>;
  files: Map<string, Uint8Array>;
};

function toUint8Array(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  }
  if (typeof data === 'string') return new TextEncoder().encode(data);
  return new Uint8Array();
}

function makeFileHandle(node: DirNode, name: string) {
  return {
    getFile: vi.fn(async () => {
      const bytes = node.files.get(name);
      if (!bytes) throw new Error('Not found');

      return {
        arrayBuffer: vi.fn(async () => {
          const copy = bytes.slice();
          return copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength);
        })
      };
    }),
    createWritable: vi.fn(async () => {
      let pending: Uint8Array | null = null;
      return {
        write: vi.fn(async (data: unknown) => {
          pending = toUint8Array(data);
        }),
        close: vi.fn(async () => {
          node.files.set(name, pending ?? new Uint8Array());
        })
      };
    })
  };
}

function makeDirHandle(node: DirNode): any {
  return {
    getDirectoryHandle: vi.fn(async (name: string, opts?: { create?: boolean }) => {
      const create = Boolean(opts?.create);
      const existing = node.dirs.get(name);
      if (existing) return makeDirHandle(existing);
      if (!create) throw new Error('Not found');

      const child: DirNode = { dirs: new Map(), files: new Map() };
      node.dirs.set(name, child);
      return makeDirHandle(child);
    }),
    getFileHandle: vi.fn(async (name: string, opts?: { create?: boolean }) => {
      const create = Boolean(opts?.create);
      if (!node.files.has(name)) {
        if (!create) throw new Error('Not found');
        node.files.set(name, new Uint8Array());
      }
      return makeFileHandle(node, name);
    }),
    removeEntry: vi.fn(async (name: string) => {
      node.files.delete(name);
      node.dirs.delete(name);
    })
  };
}

// Mock OPFS APIs for testing (in-memory FS)
const mockRootNode: DirNode = { dirs: new Map(), files: new Map() };
const mockFileSystemDirectoryHandle = makeDirHandle(mockRootNode);
const mockFileSystemFileHandle = makeFileHandle(mockRootNode, '__test__.bin');

// Mock navigator.storage
Object.defineProperty(navigator, 'storage', {
  value: {
    persist: vi.fn().mockResolvedValue(true),
    getDirectory: vi.fn().mockResolvedValue(mockFileSystemDirectoryHandle),
    estimate: vi.fn().mockResolvedValue({ usage: 0, quota: 1000000000 })
  },
  writable: true
});

// Mock crossOriginIsolated
Object.defineProperty(globalThis, 'crossOriginIsolated', {
  value: false,
  writable: true
});

// Export mocks for use in tests
export { mockFileSystemDirectoryHandle, mockFileSystemFileHandle };
