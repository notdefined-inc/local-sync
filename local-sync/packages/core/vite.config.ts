import { defineConfig } from 'vite';
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
      entry: './src/index.ts',
      name: 'LocalSync',
      formats: ['es'],
      fileName: 'index'
    },
    rollupOptions: {
      external: [
        'sql.js',
        '@noble/ciphers/chacha.js',
        '@noble/ciphers/utils.js',
        '@noble/curves/secp256k1.js',
        '@noble/hashes/hkdf',
        '@noble/hashes/sha256',
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
