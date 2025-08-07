/**
 * Vite plugin for Stravu Editor monorepo
 * Based on Lexical's approach but simplified
 */
import { defineConfig, mergeConfig, type Plugin } from 'vite';
import { resolve } from 'path';

export default function viteStravuPlugin(): Plugin {
  return {
    name: 'vite-stravu-plugin',
    config(config, env) {
      const isDev = env.mode !== 'production';
      
      return mergeConfig(
        defineConfig({
          resolve: {
            alias: isDev ? {
              // In dev, point directly to source files
              'stravu-editor': resolve(__dirname, '../stravu-editor/src/index.ts'),
              'stravu-editor/': resolve(__dirname, '../stravu-editor/src/'),
            } : {
              // In production, use the built package
              'stravu-editor': resolve(__dirname, '../stravu-editor/dist/index.js'),
            }
          }
        }),
        config
      );
    }
  };
}