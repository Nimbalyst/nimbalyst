import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
// no-op

export default defineConfig({
  plugins: [react()],
  assetsInclude: ['**/*.data'],
  server: {
    port: 4102,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    proxy: {
      // OpenAI proxy: call with baseUrl: '/openai/v1'
      '/openai': {
        target: 'https://api.openai.com',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/openai/, ''),
      },
      // Anthropic proxy: call with baseUrl: '/anthropic/v1'
      '/anthropic': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/anthropic/, ''),
      },
      // LM Studio proxy (local): set baseUrl: '/lmstudio'
      '/lmstudio': {
        target: 'http://127.0.0.1:8234',
        changeOrigin: true,
        secure: false,
        rewrite: (p) => p.replace(/^\/lmstudio/, ''),
      },
    },
  },
  resolve: {
    alias: {
      '@stravu/runtime': fileURLToPath(new URL('../runtime/src', import.meta.url)),
      rexical: fileURLToPath(new URL('../rexical/src', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['@electric-sql/pglite'],
  },
});
