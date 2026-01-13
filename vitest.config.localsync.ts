/**
 * Vitest configuration for LocalSync SDK tests
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/localsync/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/localsync/**/*.ts'],
      exclude: [
        'src/localsync/**/*.test.ts',
        'src/localsync/__tests__/**',
        'src/localsync/example.ts'
      ]
    }
  }
});
