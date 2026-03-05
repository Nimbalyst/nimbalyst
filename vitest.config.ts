import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    environmentMatchGlobs: [
      ['packages/electron/src/main/**/*.{test,spec}.{ts,tsx}', 'node'],
      ['packages/runtime/src/ai/**/*.{test,spec}.{ts,tsx}', 'node']
    ],
    setupFiles: './test-utils/setup.ts',
    include: [
      'packages/**/__tests__/**/*.test.{ts,tsx}',
      'packages/**/__tests__/**/*.spec.{ts,tsx}'
    ],
    exclude: [
      'node_modules',
      'dist',
      'build',
      '.idea',
      '.git',
      '.cache'
    ],
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'test-utils/',
        'dist/',
        '**/*.d.ts',
        '**/__tests__/**',
        '**/index.ts'
      ]
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './packages/runtime/src/editor'),
      '@nimbalyst/runtime': path.resolve(__dirname, './packages/runtime/src'),
      'lexical': path.resolve(__dirname, './node_modules/lexical'),
      '@lexical': path.resolve(__dirname, './node_modules/@lexical')
    }
  }
});
