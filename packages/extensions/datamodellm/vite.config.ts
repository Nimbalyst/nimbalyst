import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  // Replace process.env.NODE_ENV with "production" during build
  // This is necessary because some dependencies (like use-sync-external-store)
  // use process.env.NODE_ENV for conditional exports, and the browser doesn't have process
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.tsx'),
      name: 'DatamodelLMExtension',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      // Externalize dependencies that Nimbalyst provides
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'zustand',
        'html2canvas',
        /^@nimbalyst\/runtime/,
        '@nimbalyst/editor-context',
        // Lexical must be externalized to use the host's instance
        'lexical',
        /^@lexical\//,
      ],
      output: {
        // Provide global variables for externals
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          'react/jsx-runtime': 'jsxRuntime',
          zustand: 'zustand',
          html2canvas: 'html2canvas',
        },
        // Ensure CSS is extracted
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'style.css') {
            return 'index.css';
          }
          return assetInfo.name || 'asset';
        },
      },
    },
    // Output to dist directory
    outDir: 'dist',
    // Don't empty outDir (preserve other assets)
    emptyOutDir: true,
    // Generate sourcemaps for debugging
    sourcemap: true,
  },
  // Resolve aliases
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
