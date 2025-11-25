import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import viteStravuPlugin from '../shared/viteStravuPlugin.ts'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import monacoEditorPlugin from 'vite-plugin-monaco-editor'
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
const isOfficialBuild = process.env.OFFICIAL_BUILD === 'true';
// IS_DEV_MODE is true only when running `npm run dev`, not for any packaged builds
const isDevMode = isDev;
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

      // Handle @nimbalyst/runtime subpaths
      if (source.startsWith('@nimbalyst/runtime/')) {
        const subpath = source.replace('@nimbalyst/runtime/', '');
        return resolve(runtimeDistDir, subpath, 'index.js');
      }

      return null;
    }
  };
};

export default defineConfig({
  main: {
    define: {
      'process.env.OFFICIAL_BUILD': JSON.stringify(isOfficialBuild ? 'true' : 'false'),
      'process.env.IS_DEV_MODE': JSON.stringify(isDevMode ? 'true' : 'false')
    },
    plugins: [resolveWorkspaceSubpaths()],
    resolve: {
      alias: {
        // Normalize legacy names to current
        '@stravu-editor/runtime': '@nimbalyst/runtime',
        '@stravu/runtime': '@nimbalyst/runtime',
        // Always use src for bundling - simpler than dealing with ESM/CJS issues
        '@nimbalyst/runtime': runtimeSrcDir,
        'rexical': resolve(__dirname, '../rexical/src')
      }
    },
    build: {
      target: 'node16',
      sourcemap: isDev,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        },
        external: [
          '@anthropic-ai/claude-agent-sdk', // Exclude from bundle - loaded dynamically at runtime
          '@anthropic-ai/sdk', // Anthropic SDK - keep external to avoid bundling issues
          /^@modelcontextprotocol\/sdk/, // MCP SDK - keep external to avoid bundling zod
          'openai', // OpenAI SDK - keep external
          '@electron-toolkit/utils', // Electron toolkit utilities
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
        '@stravu-editor/runtime': '@nimbalyst/runtime',
        '@stravu/runtime': '@nimbalyst/runtime',
        '@nimbalyst/runtime': runtimeSrcDir,
        'rexical': resolve(__dirname, '../rexical/src')
      }
    },
    build: {
      target: 'node16',
      sourcemap: isDev,
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
      'process.env.OFFICIAL_BUILD': JSON.stringify(isOfficialBuild ? 'true' : 'false'),
      'process.env.IS_DEV_MODE': JSON.stringify(isDevMode ? 'true' : 'false'),
      'process.env': '{}'
    },
    plugins: [
      viteStravuPlugin(),
      react(),
      optimizeExcalidrawPlugin(),
      optimizeShikiPlugin(),
      // Monaco Editor plugin handles worker and CSS bundling
      // customDistPath fixes Windows path bug where path.join incorrectly concatenates absolute paths
      (monacoEditorPlugin as any).default({
        languageWorkers: ['editorWorkerService', 'css', 'html', 'json', 'typescript'],
        customDistPath: (root: string, outDir: string, _base: string) => {
          return resolve(root, outDir, 'monacoeditorwork')
        }
      }),
      // NOTE: On Windows, vite-plugin-static-copy uses fast-glob which expects
      // POSIX-style paths. Absolute Windows paths with backslashes won't match
      // and cause "No file was found to copy" errors in CI. Normalize to POSIX.
      // Ref: https://github.com/sapphi-red/vite-plugin-static-copy (fast-glob)
      (() => {
        const toPosix = (p: string) => p.replace(/\\/g, '/');
        const targets: Array<{ src: string; dest: string; overwrite?: boolean }> = [];
        const icon = resolve(__dirname, 'icon.png');
        const logo = resolve(__dirname, 'nimbalyst-logo.png');
        const about = resolve(__dirname, 'about.html');

        if (fs.existsSync(icon)) {
          targets.push({ src: toPosix(icon), dest: '', overwrite: true });
        }
        if (fs.existsSync(logo)) {
          targets.push({ src: toPosix(logo), dest: '', overwrite: true });
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
        // Allow serving files from parent directories and node_modules
        // Monaco Editor requires serving CSS files from node_modules
        allow: ['..', '../../node_modules']
      }
    },
    build: {
      target: 'chrome109',
      sourcemap: isDev,
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
        '@stravu-editor/runtime': '@nimbalyst/runtime',
        '@stravu/runtime': '@nimbalyst/runtime',
        '@nimbalyst/runtime': runtimeSrcDir,
        'rexical/styles': resolve(__dirname, '../rexical/src/themes/PlaygroundEditorTheme.css'),
        'rexical': resolve(__dirname, '../rexical/src')
      },
      dedupe: [
        'react',
        'react-dom',
        'lexical',
        '@lexical/react',
        '@nimbalyst/runtime'
      ]
    },
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'es6-promise-pool',
        // Monaco Editor - include both the main module and workers for proper bundling
        'monaco-editor',
        'monaco-editor/esm/vs/editor/editor.worker',
        'monaco-editor/esm/vs/language/json/json.worker',
        'monaco-editor/esm/vs/language/css/css.worker',
        'monaco-editor/esm/vs/language/html/html.worker',
        'monaco-editor/esm/vs/language/typescript/ts.worker'
      ],
      exclude: [
        '@shikijs/langs',
        'prettier',
        'rexical',
        '@nimbalyst/runtime',
        '@stravu/runtime',
        '@stravu-editor/runtime'
      ],
      esbuildOptions: {
        target: 'chrome109'
      }
    }
  }
})
