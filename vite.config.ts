/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import babel from '@rollup/plugin-babel';
import commonjs from '@rollup/plugin-commonjs';
import react from '@vitejs/plugin-react';
import {createRequire} from 'node:module';
import {defineConfig} from 'vite';
import {visualizer} from 'rollup-plugin-visualizer';

import viteMonorepoResolutionPlugin from '../facebooklexical/packages/shared/lexicalMonorepoPlugin';
import viteCopyEsm from './viteCopyEsm';
import viteCopyExcalidrawAssets from './viteCopyExcalidrawAssets';

const require = createRequire(import.meta.url);

// https://vitejs.dev/config/
export default defineConfig(({mode}) => ({
  resolve: {
    alias: {
      '@excalidraw/mermaid-to-excalidraw': new URL('./mermaid-stub.js', import.meta.url).pathname,
      'mermaid': new URL('./mermaid-stub.js', import.meta.url).pathname,
      // Stub out uncommon Shiki language bundles
      // '@shikijs/langs/emacs-lisp': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
      // '@shikijs/langs/wolfram': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
      // '@shikijs/langs/objective-c': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
      // '@shikijs/langs/objective-cpp': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
      // '@shikijs/langs/racket': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
      // '@shikijs/langs/fortran-free-form': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
      // '@shikijs/langs/fortran-fixed-form': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
      // '@shikijs/langs/ocaml': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
      // '@shikijs/langs/stata': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
      // '@shikijs/langs/ada': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
      // '@shikijs/langs/haskell': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
      // '@shikijs/langs/cobol': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
      // '@shikijs/langs/erlang': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
      // '@shikijs/langs/julia': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
      // '@shikijs/langs/crystal': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
      // '@shikijs/langs/system-verilog': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
      // '@shikijs/langs/fsharp': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
      // '@shikijs/langs/vhdl': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
      // '@shikijs/langs/purescript': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
      // '@shikijs/langs/common-lisp': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
      // '@shikijs/langs/nim': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
      // '@shikijs/langs/elixir': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
      // '@shikijs/langs/matlab': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
      // '@shikijs/langs/prolog': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
      // '@shikijs/langs/elm': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
      // '@shikijs/langs/sas': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
      // '@shikijs/langs/scheme': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
      // '@shikijs/langs/smalltalk': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
      // '@shikijs/langs/clojure': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
      // '@shikijs/langs/verilog': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
      // '@shikijs/langs/coq': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
      // '@shikijs/langs/zig': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
      // '@shikijs/langs/tcl': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
      // '@shikijs/langs/pascal': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
      // '@shikijs/langs/lean': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
      // '@shikijs/langs/mipsasm': new URL('./shiki-lang-stub.js', import.meta.url).pathname,
    },
  },
  build: mode === 'library' ? {
    lib: {
      entry: new URL('./src/index.ts', import.meta.url).pathname,
      name: 'StravuEditor',
      fileName: 'index',
      formats: ['es'],
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        // Keep Lexical dependencies as external since they're peer deps
        /^@lexical\/.*/,
        'lexical',
        // Other major dependencies
        '@excalidraw/excalidraw',
        'prettier',
        'yjs',
        'y-websocket',
        'lodash-es',
        'react-error-boundary',
      ],
      output: {
        globals: {
          'react': 'React',
          'react-dom': 'ReactDOM',
          'react/jsx-runtime': 'jsxRuntime',
        },
        // Optimize chunk splitting
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            // Split vendor chunks by package
            if (id.includes('@lexical')) return 'lexical';
            if (id.includes('excalidraw')) return 'excalidraw';
            if (id.includes('prettier')) return 'prettier';
            if (id.includes('shiki')) return 'shiki';
            return 'vendor';
          }
        },
      },
    },
    cssCodeSplit: false,
  } : {
    outDir: 'build',
    sourcemap: mode !== 'production',
    rollupOptions: {
      input: {
        main: new URL('./index.html', import.meta.url).pathname,
        split: new URL('./split/index.html', import.meta.url).pathname,
      },
      output: {
        // Optimize chunk splitting for better caching
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            // Core deps in their own chunks
            if (id.includes('@lexical')) return 'lexical';
            if (id.includes('excalidraw')) return 'excalidraw';
            if (id.includes('prettier')) return 'prettier';
            if (id.includes('shiki')) return 'shiki';
            if (id.includes('katex')) return 'katex';
            if (id.includes('yjs') || id.includes('y-websocket')) return 'collab';
            
            // React ecosystem
            if (id.includes('react')) return 'react';
            
            // Utilities
            if (id.includes('lodash')) return 'lodash';
            
            // All other vendor deps
            return 'vendor';
          }
          
          // App code splitting
          if (id.includes('src/plugins')) {
            // Split large plugins into separate chunks
            if (id.includes('TablePlugin')) return 'plugin-table';
            if (id.includes('CodeHighlightPlugin')) return 'plugin-code';
            if (id.includes('CollabPlugin')) return 'plugin-collab';
            if (id.includes('ExcalidrawPlugin')) return 'plugin-excalidraw';
            return 'plugins';
          }
          
          if (id.includes('src/nodes')) return 'nodes';
          if (id.includes('src/themes')) return 'themes';
          if (id.includes('src/ui')) return 'ui';
        },
        chunkFileNames: (chunkInfo) => {
          const facadeModuleId = chunkInfo.facadeModuleId ? chunkInfo.facadeModuleId.split('/').pop() : '';
          if (chunkInfo.name.includes('plugin-')) {
            return 'assets/plugins/[name]-[hash].js';
          }
          return 'assets/[name]-[hash].js';
        },
      },
    },
    ...(mode === 'production' && {
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: true,
          drop_debugger: true,
          pure_funcs: ['console.log', 'console.info', 'console.debug', 'console.trace'],
          passes: 2,
          toplevel: true,
          unsafe: true,
          unsafe_comps: true,
          unsafe_math: true,
          unsafe_proto: true,
          unsafe_regexp: true,
        },
        mangle: {
          properties: {
            regex: /^_/,
          },
        },
        format: {
          comments: false,
          ascii_only: true,
        },
        keep_classnames: true,
        keep_fnames: false,
      },
    }),
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'es2022',
    },
  },
  plugins: [
    viteMonorepoResolutionPlugin(),
    babel({
      babelHelpers: 'bundled',
      babelrc: false,
      configFile: false,
      exclude: '**/node_modules/**',
      extensions: ['jsx', 'js', 'ts', 'tsx', 'mjs'],
      plugins: [
        '@babel/plugin-transform-flow-strip-types',
        ...(mode !== 'production'
          ? [
              [
                require('../facebooklexical/scripts/error-codes/transform-error-messages'),
                {
                  noMinify: true,
                },
              ],
            ]
          : []),
      ],
      presets: [['@babel/preset-react', {runtime: 'automatic'}]],
    }),
    react({
      jsxRuntime: 'automatic',
      jsxImportSource: 'react',
      ...(mode === 'production' && {
        babel: {
          plugins: [
            ['transform-react-remove-prop-types', {
              removeImport: true,
            }],
          ],
        },
      }),
    }),
    ...viteCopyExcalidrawAssets(),
    viteCopyEsm(),
    commonjs({
      // This is required for React 19 (at least 19.0.0-beta-26f2496093-20240514)
      // because @rollup/plugin-commonjs does not analyze it correctly
      strictRequires: [/\/node_modules\/(react-dom|react)\/[^/]\.js$/],
    }),
    // Bundle analyzer
    mode === 'analyze' && visualizer({
      open: true,
      gzipSize: true,
      brotliSize: true,
      filename: 'bundle-stats.html',
    }),
  ].filter(Boolean),
}));
