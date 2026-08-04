import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals:     true,
    environment: 'node',
    include:     ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    exclude:     ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include:  ['src/modules/**/*.ts', 'src/utils/**/*.ts'],
      exclude:  ['src/**/*.test.ts', 'src/**/*.spec.ts', 'src/db/**'],
    },
    
    isolate: true,
    
    testTimeout: 15000,
  },
});