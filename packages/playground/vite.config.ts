import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import viteStravuPlugin from '../shared/viteStravuPlugin';

export default defineConfig({
  plugins: [
    viteStravuPlugin(),
    react()
  ],
  server: {
    port: 4101,
    host: true,
    fs: {
      // Allow access to files outside project root
      strict: false
    }
  },
  build: {
    sourcemap: true,
    outDir: 'dist'
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      // Alias for images directory  
      '/images': resolve(__dirname, '../stravu-editor/src/images')
    }
  },
  optimizeDeps: {
    // Only include the essentials that MUST be pre-bundled
    include: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      'react/jsx-dev-runtime'
    ],
    // Exclude lexical packages to avoid duplicate instances
    exclude: [
      '@lexical/react',
      'lexical',
      '@lexical/react/LexicalComposerContext'
    ]
  }
});