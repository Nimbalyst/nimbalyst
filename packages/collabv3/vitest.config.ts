import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globals: true,
    globalSetup: ['test/globalSetup.ts'],
    // Run integration test files sequentially (they share the wrangler instance)
    fileParallelism: false,
  },
});
