import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { resolve } from 'node:path';

/**
 * Vite config for building the mobile Lexical editor bundle.
 * Produces a standalone bundle for WKWebView with the full Lexical plugin set
 * (minus desktop-only plugins like DiffPlugin, SpeechToText, DraggableBlock).
 *
 * Usage: npx vite build --config vite.config.editor.ts
 * Output: dist-editor/editor.html + assets/
 */
export default defineConfig({
  plugins: [
    react({
      jsxRuntime: 'automatic',
      include: [
        '**/*.tsx',
        '**/*.ts',
        '**/*.jsx',
        '**/*.js',
        '../runtime/**/*.{tsx,ts,jsx,js}',
      ],
    }),
    // Fix script tags for file:// loading in WKWebView:
    // - Strip crossorigin (CORS rejects file:// origin null)
    // - Replace type="module" with defer (modules enforce CORS; defer preserves execution order)
    {
      name: 'wkwebview-compat',
      transformIndexHtml(html) {
        return html
          .replace(/ crossorigin/g, '')
          .replace(/ type="module"/g, ' defer');
      },
    },
  ],
  resolve: {
    alias: {
      '@nimbalyst/runtime': fileURLToPath(new URL('../runtime/src', import.meta.url)),
    },
  },
  base: './',
  build: {
    outDir: 'dist-editor',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        editor: resolve(__dirname, 'editor.html'),
      },
      output: {
        // IIFE format for WKWebView file:// compatibility (no ES module CORS issues)
        format: 'iife',
      },
    },
  },
});
