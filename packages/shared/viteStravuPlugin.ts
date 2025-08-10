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
                find: 'stravu-editor/styles',
                replacement: isDevMode 
                  ? resolve(__dirname, '../stravu-editor/src/index.css')
                  : resolve(__dirname, '../stravu-editor/dist/style.css')
              },
              {
                find: 'stravu-editor',
                replacement: isDevMode
                  ? resolve(__dirname, '../stravu-editor/src/index.ts')
                  : resolve(__dirname, '../stravu-editor/dist/index.js')
              },
              {
                find: /^stravu-editor\//,
                replacement: isDevMode
                  ? resolve(__dirname, '../stravu-editor/src') + '/'
                  : resolve(__dirname, '../stravu-editor/dist') + '/'
              }
            ]
          }
        }),
        config
      );
    }
  };
}