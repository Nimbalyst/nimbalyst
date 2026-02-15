import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [
    react({
      jsxRuntime: 'automatic',
      include: [
        '**/*.tsx',
        '**/*.ts',
        '**/*.jsx',
        '**/*.js',
        // Include files from aliased packages
        '../runtime/**/*.{tsx,ts,jsx,js}',
        '../rexical/**/*.{tsx,ts,jsx,js}',
      ],
    }),
  ],
  server: {
    port: 4102,
  },
  resolve: {
    alias: {
      '@nimbalyst/runtime': fileURLToPath(new URL('../runtime/src', import.meta.url)),
      'rexical': fileURLToPath(new URL('../rexical/src', import.meta.url)),
    },
  },
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        transcript: resolve(__dirname, 'transcript.html'),
      },
    },
  },
});
