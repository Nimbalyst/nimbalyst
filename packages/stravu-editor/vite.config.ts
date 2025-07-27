import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import dts from 'vite-plugin-dts';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    dts({
      insertTypesEntry: true,
      include: ['src']
    }),
    viteStaticCopy({
      targets: [
        {
          src: 'src/images/**/*',
          dest: 'images'
        }
      ]
    })
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'StravuEditor',
      fileName: 'index',
      formats: ['es']
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'lexical',
        /^@lexical\//
      ]
    },
    sourcemap: true,
    ...(mode === 'production' && {
      minify: 'terser',
      terserOptions: {
        compress: {
          toplevel: true,
        },
        keep_classnames: true,
      },
    }),
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'es2022',
      treeShaking: true,
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  }
}));