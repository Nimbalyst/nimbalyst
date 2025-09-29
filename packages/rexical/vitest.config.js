import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
export default defineConfig({
    plugins: [react()],
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: path.resolve(__dirname, '../../test-utils/setup.ts'),
        include: [
            '**/__tests__/**/*.test.{ts,tsx}',
            '**/__tests__/**/*.spec.{ts,tsx}'
        ],
        exclude: [
            'node_modules',
            'dist',
            'build',
            '.idea',
            '.git',
            '.cache'
        ],
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            'lexical': path.resolve(__dirname, '../../node_modules/lexical'),
            '@lexical': path.resolve(__dirname, '../../node_modules/@lexical')
        }
    }
});
