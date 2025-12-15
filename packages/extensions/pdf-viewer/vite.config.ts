import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export default defineConfig({
  plugins: [
    react(),
    // Custom plugin to copy PDF.js worker after build
    {
      name: 'copy-pdfjs-worker',
      closeBundle() {
        // Copy the PDF.js worker to the dist folder
        // pdfjs-dist is installed at the root of the monorepo
        const workerSrc = resolve(__dirname, '../../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs');
        const workerDest = resolve(__dirname, 'dist/pdf.worker.min.mjs');

        try {
          mkdirSync(dirname(workerDest), { recursive: true });
          copyFileSync(workerSrc, workerDest);
          console.log('✓ Copied PDF.js worker to dist/');
        } catch (error) {
          console.error('Failed to copy PDF.js worker:', error);
        }
      },
    },
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.tsx'),
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'pdfjs-dist',
        'virtua',
      ],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          'pdfjs-dist': 'pdfjsLib',
          'virtua': 'Virtua',
        },
      },
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
});
