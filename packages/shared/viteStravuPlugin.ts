/**
 * Vite plugin for Stravu Editor monorepo
 * Based on Lexical's approach but simplified
 */
import { defineConfig, mergeConfig, type Plugin } from 'vite';
import { resolve } from 'path';

export default function viteStravuPlugin(): Plugin {
  return {
    name: 'vite-stravu-plugin',
    enforce: 'pre',
    config(config, env) {
      const isDevMode = env.mode !== 'production';

      return mergeConfig(
        defineConfig({
          resolve: {
            alias: [
              // Runtime package aliases. First, normalize legacy to current name
              { find: '@stravu-editor/runtime', replacement: '@stravu/runtime' },
              { find: /^@stravu-editor\/runtime\//, replacement: '@stravu/runtime/' },
              // Then map current name to src in dev, dist in prod
              {
                find: '@stravu/runtime',
                replacement: isDevMode
                  ? resolve(__dirname, '../runtime/src/index.ts')
                  : resolve(__dirname, '../runtime/dist/index.js')
              },
              {
                find: /^@stravu\/runtime\//,
                replacement: isDevMode
                  ? resolve(__dirname, '../runtime/src') + '/'
                  : resolve(__dirname, '../runtime/dist') + '/'
              }
            ]
          }
        }),
        config
      );
    }
  };
}
