import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pnpmStoreDir = path.resolve(__dirname, 'node_modules/.pnpm');

const resolvePnpmPackageDir = (folderPrefix, packagePath) => {
  if (!fs.existsSync(pnpmStoreDir)) {
    return null;
  }

  const match = fs
    .readdirSync(pnpmStoreDir)
    .find((entry) => entry.startsWith(folderPrefix));

  if (!match) {
    return null;
  }

  return path.join(pnpmStoreDir, match, 'node_modules', ...packagePath);
};

const waSqlitePath =
  resolvePnpmPackageDir('@vlcn.io+wa-sqlite@', ['@vlcn.io', 'wa-sqlite']) ??
  path.resolve(__dirname, 'packages/engine-crsqlite-web/node_modules/@vlcn.io/wa-sqlite');

const crsqliteWasmPath =
  resolvePnpmPackageDir('@vlcn.io+crsqlite-wasm@', ['@vlcn.io', 'crsqlite-wasm']) ??
  path.resolve(__dirname, 'packages/engine-crsqlite-web/node_modules/@vlcn.io/crsqlite-wasm');

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@vlcn.io/wa-sqlite': waSqlitePath,
      '@vlcn.io/crsqlite-wasm': crsqliteWasmPath
    }
  },
  optimizeDeps: {
    include: ['@vlcn.io/wa-sqlite', '@vlcn.io/crsqlite-wasm']
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './vitest.setup.js',
    include: ['src/**/*.{test,spec}.{js,jsx}']
  }
});
