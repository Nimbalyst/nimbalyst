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
              {
                find: 'rexical/styles',
                replacement: isDevMode 
                  ? resolve(__dirname, '../rexical/src/index.css')
                  : resolve(__dirname, '../rexical/dist/style.css')
              },
              {
                find: 'rexical',
                replacement: isDevMode
                  ? resolve(__dirname, '../rexical/src/index.ts')
                  : resolve(__dirname, '../rexical/dist/index.js')
              },
              {
                find: /^rexical\//,
                replacement: isDevMode
                  ? resolve(__dirname, '../rexical/src') + '/'
                  : resolve(__dirname, '../rexical/dist') + '/'
              },
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
