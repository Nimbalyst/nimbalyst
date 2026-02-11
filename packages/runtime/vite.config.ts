import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// Plugin to copy theme JSON files to dist
function copyThemes() {
  return {
    name: 'copy-themes',
    closeBundle() {
      const srcThemesDir = resolve(__dirname, 'src/themes/builtin');
      const distThemesDir = resolve(__dirname, 'dist/themes/builtin');

      // Recursively copy themes directory
      const copyDir = (src: string, dest: string) => {
        mkdirSync(dest, { recursive: true });
        const entries = readdirSync(src);

        for (const entry of entries) {
          const srcPath = join(src, entry);
          const destPath = join(dest, entry);

          if (statSync(srcPath).isDirectory()) {
            copyDir(srcPath, destPath);
          } else {
            copyFileSync(srcPath, destPath);
          }
        }
      };

      try {
        copyDir(srcThemesDir, distThemesDir);
        console.log('✓ Copied theme files to dist/themes/builtin');
      } catch (err) {
        console.error('Failed to copy theme files:', err);
      }
    }
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    dts({
      insertTypesEntry: true,
      include: ['src'],
      exclude: ['src/ai/server/providers/mcp-stdio-server.ts'],
    }),
    copyThemes()
  ],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        'ui/index': resolve(__dirname, 'src/ui/index.ts'),
      },
      name: 'StravuRuntime',
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
        '@openai/codex-sdk',
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
    sourcemap: mode !== 'production',
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
