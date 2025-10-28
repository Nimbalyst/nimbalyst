---
planStatus:
  planId: plan-diff-markdown-export-filter
  title: Filter Removed Nodes from Markdown Export
  status: completed
  planType: bug-fix
  priority: high
  owner: ghinkle
  stakeholders:
    - ghinkle
  tags:
    - diff
    - markdown
    - export
    - serialization
  created: "2025-10-09"
  updated: "2025-10-09T20:53:29.349Z"
  progress: 100
  startDate: "2025-10-09"
  agentSessions:
    - id: d36681ec-898e-481c-a0b6-883ecfcf086e
      createdAt: "2025-10-09T20:53:29.349Z"
      status: active
---
# Filter Removed Nodes from Markdown Export


## Problem
The DiffPlugin uses Lexical text nodes with NodeState.added and NodeState.removed to track additions (green) and removals (red). Currently, markdown serialization persists both added and removed content, so when a file is saved and reopened, both versions appear in the document - making it look like all diffs were accepted.

## Goal
Filter out nodes with NodeState.removed during markdown export so that saved files only contain the "accepted" state (original content + additions, without the removed content).

## Implementation Plan

### 1. Locate Markdown Serialization
Find where text nodes are serialized to markdown format in the DiffPlugin or related markdown export code.

### 2. Add NodeState Check
During serialization, check each text node for NodeState.removed and skip serialization if found.

### 3. Test the Change
Create a test document with:
- Original text
- Added text (green)
- Removed text (red)

Verify that after save and reload:
- Original text appears
- Added text appears
- Removed text does NOT appear

## Acceptance Criteria
- Markdown files saved with active diffs contain only "accepted" content
- Removed (red) text nodes are filtered during export
- Added (green) text nodes are included in export
- No corruption of markdown format
- Existing documents without diffs are unaffected

## Trade-offs
This quick fix means diff state cannot be restored after reopening a file. Future work (Option 2) will store Lexical state separately to enable diff restoration when the on-disk file hasn't changed.

## Implementation Summary

Successfully implemented the filter for removed diff nodes during markdown export.

### Changes Made

1. **EnhancedMarkdownExport.ts**: Added import for `$getDiffState` from DiffState module
2. **exportChildren function**: Added check at the start of the main loop to skip any child nodes with `diffState === 'removed'`
3. **Tests**: Created comprehensive test suite in `diff-export-filter.test.ts` with 4 test cases:
  - Excluding removed nodes
  - Including added nodes
  - Handling multiple removed nodes in sequence
  - Preserving normal text without diff state

### Results

All tests pass successfully. The implementation correctly filters out nodes marked with `removed` diff state during markdown serialization, ensuring that saved files only contain the "accepted" version of the content (original + additions).

### Files Modified

- `/packages/rexical/src/markdown/EnhancedMarkdownExport.ts`
- `/packages/rexical/src/markdown/__tests__/diff-export-filter.test.ts` (new)

Location: packages/rexical/src/markdown/EnhancedMarkdownExport.ts:249-253
