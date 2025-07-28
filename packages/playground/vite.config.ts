import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
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
      // Point directly to stravu-editor source for HMR
      'stravu-editor': resolve(__dirname, '../stravu-editor/src/index.ts'),
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
    ]
  }
});