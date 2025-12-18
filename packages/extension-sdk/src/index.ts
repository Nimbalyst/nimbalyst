/**
 * Nimbalyst Extension SDK
 *
 * This package provides utilities for building Nimbalyst extensions:
 * - Vite configuration helpers
 * - TypeScript types
 * - Build validation
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import react from '@vitejs/plugin-react';
 * import { createExtensionConfig } from '@nimbalyst/extension-sdk/vite';
 *
 * export default createExtensionConfig({
 *   entry: './src/index.tsx',
 *   plugins: [
 *     react({ jsxRuntime: 'automatic', jsxImportSource: 'react' }),
 *   ],
 * });
 * ```
 *
 * @packageDocumentation
 */

// Re-export externals
export {
  REQUIRED_EXTERNALS,
  EXTERNAL_PATTERNS,
  ROLLUP_EXTERNALS,
  type RequiredExternal,
} from './externals.js';

// Re-export types
export * from './types/index.js';

// Re-export validation
export {
  validateExtensionBundle,
  printValidationResult,
  type ValidationResult,
} from './validate.js';
