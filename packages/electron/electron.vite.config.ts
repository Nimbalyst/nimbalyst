import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import viteStravuPlugin from '../shared/viteStravuPlugin.ts'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import fs from 'fs'

// Custom plugin to exclude Excalidraw locales and optimize imports (copied from rexical)
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

const isDev = process.env.NODE_ENV !== 'production';
const runtimeSrcDir = resolve(__dirname, '../runtime/src');
const runtimeDistDir = resolve(__dirname, '../runtime/dist');
const rexicalDistDir = resolve(__dirname, '../rexical/dist');

// Plugin to resolve workspace package subpaths correctly in production
const resolveWorkspaceSubpaths = () => {
  return {
    name: 'resolve-workspace-subpaths',
    enforce: 'pre' as const,
    resolveId(source: string, importer?: string) {
      if (isDev) return null; // Only apply in production

      // Handle @stravu/runtime subpaths
      if (source.startsWith('@stravu/runtime/')) {
        const subpath = source.replace('@stravu/runtime/', '');
        return resolve(runtimeDistDir, subpath, 'index.js');
      }

      return null;
    }
  };
};

export default defineConfig({
  main: {
    plugins: [resolveWorkspaceSubpaths()],
    resolve: {
      alias: {
        // Normalize legacy name to current
        '@stravu-editor/runtime': '@stravu/runtime',
        // Always use src for bundling - simpler than dealing with ESM/CJS issues
        '@stravu/runtime': runtimeSrcDir,
        'rexical': resolve(__dirname, '../rexical/src')
      }
    },
    build: {
      target: 'node16',
      sourcemap: true,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        },
        external: [
          '@anthropic-ai/claude-agent-sdk', // Exclude from bundle - loaded dynamically at runtime
          '@anthropic-ai/sdk', // Anthropic SDK - keep external to avoid bundling issues
          'openai', // OpenAI SDK - keep external
          'sharp', // Native module with platform-specific binaries
          // Node runtime dependencies required by AI SDKs
          'node-fetch',
          'formdata-node',
          'form-data-encoder',
          'abort-controller',
          'agentkeepalive',
          'web-streams-polyfill',
          // Renderer-only packages
          '@excalidraw/excalidraw',
          '@excalidraw/excalidraw/index.css'
        ]
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@stravu-editor/runtime': '@stravu/runtime',
        '@stravu/runtime': runtimeSrcDir,
        'rexical': resolve(__dirname, '../rexical/src')
      }
    },
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
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
      'process.env': '{}'
    },
    plugins: [
      viteStravuPlugin(),
      react(),
      optimizeExcalidrawPlugin(),
      optimizeShikiPlugin(),
      // NOTE: On Windows, vite-plugin-static-copy uses fast-glob which expects
      // POSIX-style paths. Absolute Windows paths with backslashes won't match
      // and cause "No file was found to copy" errors in CI. Normalize to POSIX.
      // Ref: https://github.com/sapphi-red/vite-plugin-static-copy (fast-glob)
      (() => {
        const toPosix = (p: string) => p.replace(/\\/g, '/');
        const targets: Array<{ src: string; dest: string; overwrite?: boolean }> = [];
        const icon = resolve(__dirname, 'icon.png');
        const about = resolve(__dirname, 'about.html');

        if (fs.existsSync(icon)) {
          targets.push({ src: toPosix(icon), dest: '', overwrite: true });
        }
        if (fs.existsSync(about)) {
          targets.push({ src: toPosix(about), dest: '', overwrite: true });
        }
        return viteStaticCopy({ targets });
      })()
    ].filter(Boolean),
    server: {
      port: 5273,
      strictPort: true,
      watch: {
        // Force watching rexical and runtime source files in dev mode
        ignored: ['!**/rexical/src/**', '!**/runtime/src/**']
      },
      fs: {
        // Allow serving files from rexical and runtime
        allow: ['..']
      }
    },
    build: {
      target: 'chrome109',
      sourcemap: true,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          update: resolve(__dirname, 'src/renderer/update.html')
        }
      }
    },
    resolve: {
      alias: {
        // Block mermaid imports to prevent large bundle
        '@excalidraw/mermaid-to-excalidraw': resolve(__dirname, '../rexical/src/mocks/mermaid-mock.ts'),
        // Ensure renderer also points runtime imports at source
        '@stravu-editor/runtime': '@stravu/runtime',
        '@stravu/runtime': runtimeSrcDir,
        'rexical/styles': resolve(__dirname, '../rexical/src/themes/PlaygroundEditorTheme.css'),
        'rexical': resolve(__dirname, '../rexical/src')
      },
      dedupe: [
        'react',
        'react-dom',
        'lexical',
        '@lexical/react',
        '@stravu/runtime'
      ]
    },
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'es6-promise-pool'
      ],
      exclude: [
        '@shikijs/langs',
        'prettier',
        'rexical',
        '@stravu/runtime',
        '@stravu-editor/runtime'
      ],
      esbuildOptions: {
        target: 'chrome109'
      }
    }
  }
})
