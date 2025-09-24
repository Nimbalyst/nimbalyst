/**
 * ESLint rules to prevent accidentally using Lexical's markdown import
 * instead of our forked version that handles 2-space indents.
 *
 * Include this in your main .eslintrc.js:
 * extends: ['./.eslintrc.markdown-import.js']
 */

module.exports = {
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: '@lexical/markdown',
            importNames: ['$convertFromMarkdownString'],
            message:
              'DO NOT use Lexical\'s $convertFromMarkdownString! ' +
              'Use $convertFromEnhancedMarkdownString or $convertFromMarkdownStringRexical instead. ' +
              'See src/markdown/FORKED_MARKDOWN_IMPORT.md for details.'
          }
        ],
        patterns: [
          {
            group: ['@lexical/markdown'],
            importNames: ['$convertFromMarkdownString'],
            message:
              'DO NOT use Lexical\'s $convertFromMarkdownString! ' +
              'Use our 2-space indent version instead.'
          }
        ]
      }
    ],
    'no-restricted-syntax': [
      'error',
      {
        selector: 'CallExpression[callee.name="$convertFromMarkdownString"]',
        message:
          'Verify this is OUR $convertFromMarkdownStringRexical, not Lexical\'s version. ' +
          'Lexical\'s version doesn\'t handle 2-space indents correctly.'
      }
    ]
  }
};