import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import viteStravuPlugin from '../shared/viteStravuPlugin'
import { viteStaticCopy } from 'vite-plugin-static-copy'

// Custom plugin to exclude Excalidraw locales and optimize imports (copied from stravu-editor)
// Plugin to optimize Shiki language imports
const optimizeShikiPlugin = () => {
  return {
    name: 'optimize-shiki',
    enforce: 'pre' as const,
    resolveId(source: string) {
      // Block ALL shiki language imports
      if (source.startsWith('@shikijs/langs/') && !source.includes('common')) {
        return { id: 'virtual:shiki-lang-stub', moduleSideEffects: false };
      }
      // Block prettier parsers
      if (source.startsWith('prettier/parser-')) {
        return { id: 'virtual:prettier-parser-stub', moduleSideEffects: false };
      }
      return null;
    },
    load(id: string) {
      if (id === 'virtual:shiki-lang-stub') {
        return 'export default function() { return { name: "unsupported", patterns: [], repository: {} }; }';
      }
      if (id === 'virtual:prettier-parser-stub') {
        return 'export default {};';
      }
    }
  };
};

const optimizeExcalidrawPlugin = () => {
  return {
    name: 'optimize-excalidraw',
    enforce: 'pre' as const,
    resolveId(source: string, importer?: string) {
      // Block any locale imports from Excalidraw
      if (source.includes('@excalidraw/excalidraw')) {
        if (/locales\/[a-z]{2}-[A-Z]{2}/.test(source)) {
          return { id: 'virtual:empty-locale', moduleSideEffects: false };
        }
        if (source.endsWith('/locales')) {
          return { id: 'virtual:empty-locale-index', moduleSideEffects: false };
        }
      }
      return null;
    },
    load(id: string) {
      if (id === 'virtual:empty-locale') {
        return 'export default {};';
      }
      if (id === 'virtual:empty-locale-index') {
        return 'export default { "en": {} };';
      }
    },
    transform(code: string, id: string) {
      // Strip out locale imports from Excalidraw bundle
      if (id.includes('@excalidraw/excalidraw')) {
        let hasChanges = false;
        // Replace dynamic locale imports with empty object
        const dynamicImportRegex = /import\(.+?locales\/[^)]+\)/g;
        if (dynamicImportRegex.test(code)) {
          code = code.replace(dynamicImportRegex, 'Promise.resolve({default: {}})');
          hasChanges = true;
        }
        // Replace static locale imports
        const staticImportRegex = /from\s+["']\.\.?\/locales\/[^"']+["']/g;
        if (staticImportRegex.test(code)) {
          code = code.replace(staticImportRegex, 'from "virtual:empty-locale"');
          hasChanges = true;
        }
        if (hasChanges) {
          return { code, map: null };
        }
      }
      return null;
    }
  };
};

export default defineConfig({
  main: {
    build: {
      target: 'node16',
      sourcemap: true,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    build: {
      target: 'node16',
      sourcemap: true,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [
      viteStravuPlugin(), 
      react(), 
      optimizeExcalidrawPlugin(), 
      optimizeShikiPlugin(),
      viteStaticCopy({
        targets: [
          {
            src: resolve(__dirname, 'icon.png'),
            dest: ''
          },
          {
            src: resolve(__dirname, 'about.html'),
            dest: ''
          }
        ]
      })
    ],
    server: {
      port: 5273,
      strictPort: true
    },
    build: {
      target: 'chrome109',
      sourcemap: true,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    },
    resolve: {
      alias: {
        // Block mermaid import to prevent large bundle
        '@excalidraw/mermaid-to-excalidraw': resolve(__dirname, '../stravu-editor/src/mocks/mermaid-mock.ts')
      }
    },
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'es6-promise-pool'
      ],
      exclude: [
        'stravu-editor',
        '@shikijs/langs',
        'prettier'
      ],
      esbuildOptions: {
        target: 'chrome109'
      }
    }
  }
})