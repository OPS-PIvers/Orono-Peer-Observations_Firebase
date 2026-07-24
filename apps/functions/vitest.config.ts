import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      exclude: ['node_modules/', 'lib/', '**/*.config.*', '**/*.d.ts'],
    },
  },
});
