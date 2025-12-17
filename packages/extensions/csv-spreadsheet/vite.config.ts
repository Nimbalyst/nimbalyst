import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    react({
      jsxRuntime: 'automatic',
      jsxImportSource: 'react',
    }),
  ],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  mode: 'production',
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.tsx'),
      name: 'CSVSpreadsheetExtension',
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'zustand',
        /^@nimbalyst\/runtime/,
        '@nimbalyst/editor-context',
      ],
      output: {
        // CRITICAL: Inline all chunks into a single file
        // Extensions are loaded via blob URLs which don't support relative imports
        inlineDynamicImports: true,
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          'react/jsx-runtime': 'jsxRuntime',
          zustand: 'zustand',
        },
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'style.css') {
            return 'index.css';
          }
          return assetInfo.name || 'asset';
        },
      },
    },
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false, // Disable sourcemaps for smaller output
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
