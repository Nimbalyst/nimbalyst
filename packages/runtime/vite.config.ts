import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    dts({
      insertTypesEntry: true,
      include: ['src'],
      logDiagnostics: false
    })
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'StravuRuntime',
      fileName: 'index',
      formats: ['es']
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'lexical',
        /^@lexical\//,
        '@electric-sql/pglite',
        '@anthropic-ai/sdk',
        'openai',
        'yjs',
        'y-websocket'
      ],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM'
        }
      }
    },
    sourcemap: true,
    watch: mode === 'development' ? {} : null
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'lexical',
      '@lexical/react'
    ]
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode || 'development')
  }
}));