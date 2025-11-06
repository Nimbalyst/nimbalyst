# How to Enable Diff Debug Mode

## Option 1: Set environment variable before starting dev server

```bash
cd packages/electron
DIFF_DEBUG=1 npm run dev
```

## Option 2: Add to your .env file (if you have one)

```bash
echo "DIFF_DEBUG=1" >> packages/electron/.env
```

## Option 3: Set in vite config (for HMR)

Add to `packages/electron/electron.vite.config.ts`:

```typescript
export default {
  // ... other config
  main: {
    // ... other main config
    define: {
      'process.env.DIFF_DEBUG': JSON.stringify('1'),
    }
  },
  renderer: {
    // ... other renderer config
    define: {
      'process.env.DIFF_DEBUG': JSON.stringify('1'),
    }
  }
}
```

## What You'll See

When debug mode is enabled, every time a diff is applied you'll see in the browser console:

```
[TreeMatcher] Skipping exact match at source[0] -> target[0]: heading "Title"
[calculateSimilarity] NOT exact match for paragraph:
  textMatches: true (source="Risk: Something", target="Risk: Something")
  attrsMatch: false
  source.attrs: {...}
  target.attrs: {...}
[TreeMatcher] Creating UPDATE for source[2] -> target[2]: paragraph "..." (similarity=0.6857, isExact=false)

=== DIFF SUMMARY ===
Total operations: 5
  Adds: 2
  Removes: 1
  Updates: 2

=== UPDATE OPERATIONS ===
[0] paragraph [0->0] sim=0.900 match=exact
    "Risk: Something that changed"
[1] paragraph [2->2] sim=0.686 match=similar
    "Old paragraph."
```

## What to Look For

If unchanged content is being marked as modified, you'll see:

1. **Should be skipped but isn't:**
   - Look for nodes that say `Creating UPDATE` instead of `Skipping exact match`
   - Check the similarity score - should be `1.000` for identical nodes
   - Check `matchType` - should be `exact` for identical nodes

2. **Attrs not matching:**
   - If you see `attrsMatch: false` for identical-looking content
   - Check what's in `source.attrs` vs `target.attrs` to see the difference

3. **Text not matching:**
   - If you see `textMatches: false` for identical-looking content
   - Check if there are hidden characters, extra spaces, or formatting differences

## Example Debug Session

```bash
# Start app with debug mode
cd packages/electron
DIFF_DEBUG=1 npm run dev

# Open a document
# Make a small edit
# Apply the diff
# Check browser console (Cmd+Option+I)
# Look for the debug output
```

The output will show exactly which nodes are being marked and why.
