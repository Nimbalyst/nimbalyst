---
planStatus:
  planId: plan-topt-diff-system-status
  title: TOPT-Based Diff System - Status and Next Steps
  status: in-development
  planType: system-design
  priority: high
  owner: ghinkle
  stakeholders:
    - ghinkle
  tags:
    - diff-algorithm
    - TOPT
    - markdown
    - testing
  created: "2025-01-06"
  updated: "2025-01-06T18:58:00.000Z"
  progress: 70
---

# TOPT-Based Diff System - Status and Next Steps

## Overview

Over the past week, we've been migrating the DiffPlugin from a custom matching algorithm to a proper TOPT (Thresholded Order-Preserving Tree) based algorithm. This work addresses fundamental issues with how the diff system matches nodes and applies changes to documents.

## What Works Well

### 1. Basic Exact Matching
- **Identity matches are now prioritized**: When identical content exists in both old and new documents, TOPT correctly identifies and matches them
- **Headings**: Headings with identical text (e.g., "## MD Editor") now correctly match even when surrounded by large insertions
- **Lists**: List nodes with identical content are matched correctly
- **Text nodes**: Paragraph and text nodes with exact matches are preferred over positional matches

### 2. Textual Node Weighting
- Successfully implemented `isTextual` classification for:
  - `text` nodes
  - `paragraph` nodes
  - `heading` nodes
  - `list` nodes
  - `listitem` nodes
- Text similarity is now weighted very heavily (`wText: 3.0`) to prefer exact matches over position-based alignments

### 3. Forced Exact Match Algorithm
- Modified TOPT's `alignChildren` function to detect exact text matches and force their cost to 0
- This ensures that when source[N] and target[N] have identical text, they ALWAYS match, regardless of other cost considerations
- The algorithm now correctly handles append-only scenarios where new content is added at the end

### 4. Nested List Handling
- Fixed issues where adding sublists under existing list items caused positioning problems
- The "Three" in nested list scenarios now maintains correct position
- Removed incorrect DELETE+INSERT→UPDATE conversion that was causing nodes to be marked as modified when they were actually moved

## What Still Needs Improvement

### 1. ListDiffHandler Sub-tree Diffs
- **Issue**: Even when parent lists match correctly at the top level, the ListDiffHandler runs recursive sub-tree diffs that sometimes create bad matches
- **Symptom**: 1 list node still marked as MODIFIED in the append-content test when it should be unchanged
- **Root cause**: Sub-tree diff runs independently and may make different matching decisions than the parent TOPT algorithm
- **Solution needed**: Either skip sub-tree diff when parent lists are exact matches, or ensure sub-tree diff uses the same exact-match forcing logic

### 2. Empty Paragraph Handling
- **Issue**: Trailing empty paragraphs are being deleted when they could be matched
- **Example**: Old doc has 3 empty paragraphs, new doc has 3 empty paragraphs (but at different positions due to insertion)
- **Current behavior**: 2 empty paragraphs marked as REMOVED
- **Desired behavior**: Empty paragraphs should be reused/matched where possible
- **Challenge**: Empty paragraphs have no distinguishing text, so matching them is ambiguous

### 3. Large Document Performance
- TOPT's dynamic programming approach has O(mn) complexity where m and n are the number of nodes
- For very large documents (hundreds of nodes), this could be slow
- Need to profile and potentially optimize for large documents

### 4. Table Diff Edge Cases
- Table separator normalization works, but complex table modifications (adding/removing columns) may still have issues
- Need comprehensive table diff tests

### 5. Debug Logging Cleanup
- Extensive debug logging was added during development (DIFF_DEBUG=1)
- Logs are currently scattered across multiple files:
  - `TreeMatcher.ts`
  - `ThresholdedOrderPreservingTree.ts`
  - `diffUtils.ts`
  - `canonicalTree.ts`
- Need to consolidate, clean up, and make debug logging more structured

## Comprehensive Testing System Plan

### Testing Philosophy
- **Exhaustive coverage**: Test every common markdown structure
- **Combinatorial edits**: Test each structure undergoing all types of edits
- **Real-world scenarios**: Use actual user documents (like the Josh Feedback files)
- **Regression prevention**: Every bug found should get a test

### Test Organization Structure

```
__tests__/unit/
├── basic/
│   ├── text-nodes.test.ts           # Plain text edits
│   ├── paragraphs.test.ts           # Paragraph add/remove/modify
│   ├── headings.test.ts             # Heading changes
│   └── empty-nodes.test.ts          # Empty paragraphs/headings
├── lists/
│   ├── flat-lists.test.ts           # Simple bullet/numbered lists
│   ├── nested-lists.test.ts         # Multi-level nesting
│   ├── list-item-edits.test.ts      # Modify items
│   ├── reordering.test.ts           # Change item order
│   └── mixed-lists.test.ts          # Bullets + numbered
├── tables/
│   ├── basic-tables.test.ts         # Simple table edits
│   ├── add-remove-rows.test.ts      # Row operations
│   ├── add-remove-columns.test.ts   # Column operations
│   └── table-separators.test.ts    # Separator formatting
├── complex/
│   ├── append-content.test.ts       # Add content at end (current test)
│   ├── prepend-content.test.ts      # Add content at start
│   ├── insert-middle.test.ts        # Insert in middle
│   ├── multiple-sections.test.ts    # Multi-section docs
│   └── real-world-docs.test.ts      # User-provided documents
└── regressions/
    ├── nested-list-bug.test.ts      # "Three" positioning bug
    ├── table-addition.test.ts       # Table insert bugs
    └── [each-bug-found].test.ts     # One test per bug
```

### Edit Type Matrix

For each structure, test these edit operations:
1. **Add**: Insert new instance of the structure
2. **Remove**: Delete existing instance
3. **Modify**: Change content within the structure
4. **Reorder**: Move structure to different position
5. **Nest**: Add child structures (where applicable)
6. **Unnest**: Remove nesting level
7. **Replace**: Swap one structure type for another
8. **Append**: Add at end of document
9. **Prepend**: Add at start of document
10. **Interleave**: Add between existing instances

### Test Utility Improvements Needed

Current test utilities in `__tests__/utils/`:
- `testConfig.ts` - Editor setup
- `index.ts` - Basic helpers
- `treeDebugUtils.ts` - Tree visualization

Needed additions:
- **Markdown generators**: Functions to programmatically create test markdown
  - `createFlatList(items: string[]): string`
  - `createNestedList(structure: object): string`
  - `createTable(rows: number, cols: number): string`
- **Diff assertions**: High-level assertions about diff results
  - `expectOnlyAdds(result)` - Assert only additions, no removes/modifies
  - `expectOnlyRemoves(result)` - Assert only deletions
  - `expectExactMatch(sourceIdx, targetIdx)` - Assert specific nodes matched
- **Snapshot testing**: Capture expected diff operations for complex scenarios
- **Performance benchmarks**: Measure diff time for various document sizes

### Test Data Management

- **Fixtures directory**: `__tests__/fixtures/markdown/`
  - Small, focused examples (10-20 lines each)
  - Large real-world documents (100+ lines)
  - Edge cases (deeply nested, mixed content, etc.)
- **Paired files**: For each test, have `.old.md` and `.new.md` files
- **Expected results**: JSON files describing expected diff operations

### Continuous Testing Strategy

- Run full test suite on every commit
- Flag any test that takes > 1 second (performance regression)
- Track test coverage - aim for 90%+ coverage of diff algorithm code
- Add new test for every bug report before fixing the bug

## Debug Logging Cleanup Tasks

### 1. Consolidate Logging
- Create a central `DiffLogger` class
- All debug logs should go through this logger
- Support log levels: ERROR, WARN, INFO, DEBUG, TRACE

### 2. Remove Scattered console.log
Files with logging to clean up:
- `packages/rexical/src/plugins/DiffPlugin/core/TreeMatcher.ts`
- `packages/rexical/src/plugins/DiffPlugin/core/ThresholdedOrderPreservingTree.ts`
- `packages/rexical/src/plugins/DiffPlugin/core/diffUtils.ts`
- `packages/rexical/src/plugins/DiffPlugin/core/canonicalTree.ts`
- `packages/rexical/src/plugins/DiffPlugin/handlers/ListDiffHandler.ts`

### 3. Structured Logging Format
Instead of:
```typescript
console.log(`[TOPT] cost=${cost} for "${text}"`);
```

Use structured format:
```typescript
logger.debug('topt.pairCost', {
  cost,
  text,
  sourceIdx,
  targetIdx,
  nodeType
});
```

### 4. Conditional Compilation
- Use environment variable or config flag to enable debug logging
- In production builds, logging should compile away (zero overhead)
- Consider using a library like `debug` or `pino` for structured logging

### 5. Key Logging Points to Keep
Even after cleanup, maintain these essential logs:
- TOPT operation summary (counts of EQUAL, REPLACE, INSERT, DELETE)
- Performance metrics (time to compute diff)
- Warnings when fallbacks are used
- Errors when diff application fails

## Next Immediate Steps

1. **Fix ListDiffHandler** (highest priority)
   - Skip sub-tree diff when parent lists are exact matches
   - Or apply same exact-match forcing to sub-tree diffs
   - Target: Get append-content test to 0 modified nodes

2. **Clean up debug logging**
   - Remove console.log statements
   - Add structured logger
   - Keep essential metrics

3. **Run existing test suite**
   - Ensure all previous tests still pass
   - Fix any regressions from TOPT changes
   - Document any behavioral changes

4. **Create commit**
   - Clear commit message explaining TOPT migration
   - Reference specific bugs fixed
   - Note any breaking changes

5. **Begin comprehensive test suite**
   - Start with lists/ directory (most problematic area)
   - Create 10-15 focused list tests
   - Use these to validate fixes

## Success Criteria

### Short-term (This Week)
- [ ] Append-content test passes completely (0 modified, 0 unexpected removes)
- [ ] All existing diff tests pass
- [ ] Debug logging cleaned up
- [ ] Changes committed with clear documentation

### Medium-term (Next 2 Weeks)
- [ ] 50+ new diff tests covering common scenarios
- [ ] ListDiffHandler issues fully resolved
- [ ] Table diff edge cases addressed
- [ ] Performance profiled for large documents (1000+ nodes)

### Long-term (Next Month)
- [ ] 200+ comprehensive diff tests
- [ ] < 0.1% false positive rate on real user documents
- [ ] Diff performance under 100ms for typical documents
- [ ] User-facing diff reliability at 99%+

## Technical Debt Notes

### Code That Needs Refactoring
- `diffUtils.ts` is ~1500 lines and doing too much
- TreeMatcher and TOPT are tightly coupled
- Diff state management is complex and error-prone

### Architecture Improvements
- Consider separating "diff computation" from "diff application"
- Make TOPT algorithm more pluggable (easier to test variations)
- Better separation between document-level and node-level diffing

### Documentation Needed
- Algorithm explanation for future maintainers
- Flowcharts showing diff application process
- Performance characteristics and complexity analysis
- Guide for adding new node types to diff system
