/**
 * Vite plugin for Stravu Editor monorepo
 * Based on Lexical's approach but simplified
 */
import { defineConfig, mergeConfig } from 'vite';
import { resolve } from 'path';
export default function viteStravuPlugin() {
    return {
        name: 'vite-stravu-plugin',
        enforce: 'pre',
        config(config, env) {
            const isDevMode = env.mode !== 'production';
            return mergeConfig(defineConfig({
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
                        }
                    ]
                }
            }), config);
        }
    };
}
