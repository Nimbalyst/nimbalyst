import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/renderer/**/*.ts', 'src/renderer/**/*.tsx'],
    rules: {
      // Enforce importing atomFamily from the tracked wrapper instead of jotai/utils.
      // The wrapper auto-registers every atomFamily for the Developer Dashboard stats view.
      // The registry itself (atomFamilyRegistry.ts) is excluded via the ignores pattern below.
      'no-restricted-imports': ['error', {
        paths: [{
          name: 'jotai/utils',
          importNames: ['atomFamily'],
          message: 'Import atomFamily from \'../debug/atomFamilyRegistry\' (or correct relative path) instead of \'jotai/utils\'. This ensures automatic registration for the Developer Dashboard > AtomFamily Stats.'
        }]
      }],
    },
  },
  {
    // The registry itself must import the real atomFamily from jotai/utils
    files: ['src/renderer/store/debug/atomFamilyRegistry.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    // Disable rules that conflict with the codebase patterns
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off',
    },
  },
  {
    ignores: ['out/**', 'out2/**', 'node_modules/**', 'dist/**'],
  },
);
