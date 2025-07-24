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

import viteMonorepoResolutionPlugin from '../facebooklexical/packages/shared/lexicalMonorepoPlugin';
import viteCopyEsm from './viteCopyEsm';
import viteCopyExcalidrawAssets from './viteCopyExcalidrawAssets';

const require = createRequire(import.meta.url);

// https://vitejs.dev/config/
export default defineConfig(({mode}) => ({
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
        'katex',
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
      },
    },
    cssCodeSplit: false,
  } : {
    outDir: 'build',
    rollupOptions: {
      input: {
        main: new URL('./index.html', import.meta.url).pathname,
        split: new URL('./split/index.html', import.meta.url).pathname,
      },
    },
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
    react(),
    ...viteCopyExcalidrawAssets(),
    viteCopyEsm(),
    commonjs({
      // This is required for React 19 (at least 19.0.0-beta-26f2496093-20240514)
      // because @rollup/plugin-commonjs does not analyze it correctly
      strictRequires: [/\/node_modules\/(react-dom|react)\/[^/]\.js$/],
    }),
  ],
}));
