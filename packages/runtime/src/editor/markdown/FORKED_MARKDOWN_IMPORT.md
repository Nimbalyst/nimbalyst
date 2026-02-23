# Forked Markdown Import - Critical Documentation

## Why We Forked Lexical's Markdown Import

Lexical's built-in `$convertFromMarkdownString` is hardcoded to expect 4-space indentation for nested lists. This is incompatible with our design decision to use 2-space indentation as our standard. The specific issues were:

1. **Hardcoded 4-space assumption**: Lexical treats lines starting with 2-3 spaces as continuation paragraphs, not as indented list items
2. **No configuration options**: Lexical doesn't provide any way to configure the indent size expectation

## What We Changed

1. **Copied `LexicalMarkdownImport.ts`**: Forked from `@lexical/markdown` module
2. **Disabled aggressive line merging**: Added `DISABLE_LINE_MERGING` flag to prevent indented lines from being merged
3. **Normalization layer**: Added `normalizeMarkdown` to convert any 2-4 space indents to our standard 2-space format before import

## Files Involved

- `LexicalMarkdownImport.ts` - Our forked version of Lexical's markdown import
- `EnhancedMarkdownImport.ts` - Uses our forked version, adds normalization
- `MarkdownNormalizer.ts` - Handles converting various indent sizes to 2-space standard
- `ListTransformers.ts` - Our custom list transformers that understand 2-space indents

## How to Prevent Using Lexical's Version

### Current Safeguards

1. **Named differently**: Our function is called `$convertFromMarkdownStringRexical` to avoid confusion
2. **Never import from `@lexical/markdown`** for the conversion functions
3. **Always use our functions**:
   - Primary: Use `$convertFromEnhancedMarkdownString` from `./EnhancedMarkdownImport` (includes normalization)
   - Alternative: Use `$convertFromMarkdownStringRexical` from `./LexicalMarkdownImport` (raw forked version)
   - NEVER: Use Lexical's `$convertFromMarkdownString` from `@lexical/markdown`

### Recommended Linting Rule

Add this ESLint rule to `.eslintrc.js`:

```javascript
module.exports = {
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: '@lexical/markdown',
            importNames: ['$convertFromMarkdownString'],
            message: 'Use our forked version from ./LexicalMarkdownImport or $convertFromEnhancedMarkdownString instead. See FORKED_MARKDOWN_IMPORT.md'
          }
        ]
      }
    ]
  }
};
```

### Function Naming

We've renamed our function to `$convertFromMarkdownStringRexical` to make it impossible to accidentally use Lexical's version. The "Rexical" suffix makes it clear this is our fork.

## Taking Upstream Fixes

When Lexical releases updates to their markdown module:

1. **Check the changelog** for `@lexical/markdown`
2. **Review changes** in their GitHub repo: https://github.com/facebook/lexical
3. **Manually apply relevant fixes** to our `LexicalMarkdownImport.ts`

### Key areas to watch for upstream fixes:

- Security fixes
- Performance improvements
- New markdown features (e.g., new syntax support)
- Bug fixes for edge cases

### How to apply upstream changes:

1. Compare their latest version with our fork
2. Identify changes that don't conflict with our indent handling
3. Manually port those changes while preserving our modifications
4. Test thoroughly with our 2-space indent test suite

## Testing

Always run these tests after any changes:

```bash
npx vitest run four-space-indent.test.ts
npx vitest run list-normalization-integration.test.ts
npx vitest run ListTransformers.test.ts
```

## Future Considerations

If Lexical ever adds configurable indent support, we could potentially switch back to their implementation. Until then, this fork is critical for our 2-space indent standard.

## Contact

If you have questions about this fork, reach out to the team or check the git history for context on specific changes.
