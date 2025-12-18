/**
 * Vite configuration helpers for Nimbalyst extensions.
 */
import type { UserConfig, PluginOption } from 'vite';
import { ROLLUP_EXTERNALS } from './externals.js';

export interface ExtensionConfigOptions {
  /**
   * Entry point for the extension (e.g., './src/index.tsx')
   */
  entry: string;

  /**
   * Output filename (without extension). Defaults to 'index'
   */
  fileName?: string;

  /**
   * Additional externals to add beyond the required ones.
   * Use this for libraries accessed via window.__nimbalyst_extensions
   */
  additionalExternals?: (string | RegExp)[];

  /**
   * Additional Vite plugins to include
   */
  plugins?: PluginOption[];

  /**
   * Whether to generate sourcemaps. Defaults to true
   */
  sourcemap?: boolean;

  /**
   * Whether to inline dynamic imports into a single file. Defaults to true.
   * Required because extensions load via blob URLs which don't support relative imports.
   */
  inlineDynamicImports?: boolean;
}

/**
 * Creates a Vite configuration for building a Nimbalyst extension.
 *
 * This sets up:
 * - Production mode and NODE_ENV for proper React JSX transform
 * - ES module output format
 * - Correct externals for host-provided dependencies
 * - Inlined dynamic imports (required for blob URL loading)
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { createExtensionConfig } from '@nimbalyst/extension-sdk/vite';
 *
 * export default createExtensionConfig({
 *   entry: './src/index.tsx',
 * });
 * ```
 */
export function createExtensionConfig(options: ExtensionConfigOptions): UserConfig {
  const {
    entry,
    fileName = 'index',
    additionalExternals = [],
    plugins = [],
    sourcemap = true,
    inlineDynamicImports = true,
  } = options;

  // Combine required externals with any additional ones
  const external = [...ROLLUP_EXTERNALS, ...additionalExternals];

  return {
    // Ensure production mode for proper JSX transform (jsx vs jsxDEV)
    mode: 'production',

    // Replace process.env.NODE_ENV at build time
    // Required for libraries that use conditional exports
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },

    plugins: [
      // Note: User must add @vitejs/plugin-react themselves with proper config:
      // react({ jsxRuntime: 'automatic', jsxImportSource: 'react' })
      ...plugins,
    ],

    build: {
      lib: {
        entry,
        formats: ['es'],
        fileName: () => `${fileName}.js`,
      },

      rollupOptions: {
        external,
        output: {
          // Required: Extensions load via blob URLs which can't resolve relative imports
          inlineDynamicImports,

          // Standard globals for externals
          globals: {
            react: 'React',
            'react-dom': 'ReactDOM',
            'react/jsx-runtime': 'jsxRuntime',
          },

          // Name CSS output consistently
          assetFileNames: (assetInfo) => {
            if (assetInfo.name === 'style.css') {
              return `${fileName}.css`;
            }
            return assetInfo.name || 'asset';
          },
        },
      },

      // Output directory
      outDir: 'dist',
      emptyOutDir: true,

      // Sourcemaps for debugging
      sourcemap,
    },
  };
}

/**
 * Merges a base extension config with custom overrides.
 * Useful when you need to extend the base config.
 *
 * @example
 * ```ts
 * import { createExtensionConfig, mergeExtensionConfig } from '@nimbalyst/extension-sdk/vite';
 *
 * const baseConfig = createExtensionConfig({ entry: './src/index.tsx' });
 *
 * export default mergeExtensionConfig(baseConfig, {
 *   resolve: {
 *     alias: { '@': './src' }
 *   }
 * });
 * ```
 */
export function mergeExtensionConfig(
  base: UserConfig,
  overrides: Partial<UserConfig>
): UserConfig {
  return {
    ...base,
    ...overrides,
    define: {
      ...base.define,
      ...overrides.define,
    },
    build: {
      ...base.build,
      ...overrides.build,
      rollupOptions: {
        ...base.build?.rollupOptions,
        ...overrides.build?.rollupOptions,
      },
    },
    resolve: {
      ...base.resolve,
      ...overrides.resolve,
    },
  };
}
