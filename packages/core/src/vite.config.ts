import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    dts({
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/__tests__/**']
    })
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'LocalSync',
      formats: ['es'],
      fileName: 'index'
    },
    rollupOptions: {
      external: [
        'sql.js',
        '@noble/ciphers',
        '@noble/curves',
        '@noble/hashes',
        'nostr-tools',
        'pako'
      ],
      output: {
        preserveModules: true,
        preserveModulesRoot: 'src',
        entryFileNames: '[name].js'
      }
    },
    sourcemap: true,
    target: 'es2020'
  }
});
