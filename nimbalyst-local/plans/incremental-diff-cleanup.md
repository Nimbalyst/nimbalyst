---
planStatus:
  planId: plan-incremental-diff-cleanup
  title: Fix Incremental Diff Accept/Reject Cleanup
  status: completed
  planType: bug-fix
  priority: high
  owner: developer
  stakeholders:
    - developer
  tags:
    - diff-plugin
    - ai-editing
    - bug-fix
    - e2e-testing
  created: "2025-11-05"
  updated: "2025-11-09T14:58:00.000Z"
  progress: 100
---

# Fix Incremental Diff Accept/Reject Cleanup

## Problem

When users incrementally accept or reject AI diff changes one by one (using the "Accept" and "Reject" buttons for individual change groups), the "pre-edit" tag never gets cleared from the history database. This causes several issues:

1. The file remains in diff mode even after all changes are processed
2. Autosave is blocked indefinitely (checks `pendingAIEditTagRef.current`)
3. User must manually save (Cmd+S) to exit diff mode
4. Tag status remains 'pending' instead of being marked 'reviewed'

**Current behavior**: Only "Accept All" and "Reject All" buttons trigger the cleanup that marks the tag as reviewed and exits diff mode.

**Expected behavior**: Incremental acceptance/rejection should also trigger cleanup when ALL diffs have been processed.

## Root Cause

The DiffApprovalBar component (`/packages/runtime/src/plugins/DiffApprovalBar/DiffApprovalBar.tsx`) handles incremental actions differently:

- **Accept All / Reject All**: Dispatch `APPROVE_DIFF_COMMAND` / `REJECT_DIFF_COMMAND` which TabEditor listens for and triggers cleanup
- **Incremental Accept / Reject**: Call `$approveChangeGroup()` / `$rejectChangeGroup()` directly, which only modify nodes but don't trigger any cleanup

When the last diff is processed incrementally, the DiffApprovalBar simply disappears (returns null), but no cleanup happens.

## Solution Approach

Add a check after each incremental accept/reject operation:
1. After calling `$approveChangeGroup()` or `$rejectChangeGroup()`
2. Check if `$hasDiffNodes(editor)` returns false
3. If no diffs remain, dispatch the corresponding command (`APPROVE_DIFF_COMMAND` or `REJECT_DIFF_COMMAND`)
4. This reuses the existing cleanup logic in TabEditor that calls `updateTagStatus`

## Files to Modify

### Primary Changes

**`/packages/runtime/src/plugins/DiffApprovalBar/DiffApprovalBar.tsx`**:
- Modify `handleAcceptThis()` function (around line 301)
- Modify `handleRejectThis()` function (around line 345)
- Add imports for `$hasDiffNodes` from rexical
- Add timeout-based check after each incremental operation

### Test Files

**New E2E test**: `/packages/electron/e2e/ai/incremental-diff-cleanup.spec.ts`
- Test scenario: Apply multi-section AI diff, incrementally accept all changes one-by-one
- Verify tag status is marked 'reviewed' after last incremental accept
- Verify autosave works after incremental cleanup
- Test both accept and reject paths

## Implementation Steps

1. **Add cleanup check to `handleAcceptThis()`**:
   - After calling `$approveChangeGroup()`
   - Wait 100ms for editor state to update
   - Check `$hasDiffNodes(editor)`
   - If false, dispatch `APPROVE_DIFF_COMMAND`

2. **Add cleanup check to `handleRejectThis()`**:
   - After calling `$rejectChangeGroup()`
   - Wait 100ms for editor state to update
   - Check `$hasDiffNodes(editor)`
   - If false, dispatch `REJECT_DIFF_COMMAND`

3. **Create E2E test**:
   - Set up test file with multi-section content
   - Apply AI diff using test utilities
   - Simulate clicking "Accept" button for each change group
   - Verify tag is cleared after last acceptance
   - Verify file can be autosaved afterward

## Acceptance Criteria

1. ✓ When user incrementally accepts all diff changes, tag is marked 'reviewed'
2. ✓ When user incrementally rejects all diff changes, tag is marked 'reviewed'
3. ✓ After incremental cleanup, diff mode exits (editor shows final content)
4. ✓ After incremental cleanup, autosave resumes normally
5. ✓ Behavior is identical to "Accept All" / "Reject All" when all changes are processed
6. ✓ E2E test passes demonstrating the fix

## Implementation Summary

### Changes Made

1. **DiffApprovalBar cleanup detection** (`/packages/runtime/src/plugins/DiffApprovalBar/DiffApprovalBar.tsx`):
   - Added cleanup checks after `handleAcceptThis()` and `handleRejectThis()`
   - After processing each group, check if `groupDiffChanges(editor).length === 0 || !$hasDiffNodes(editor)`
   - If all diffs cleared, dispatch `CLEAR_DIFF_TAG_COMMAND` to trigger TabEditor cleanup
   - Uses 100ms setTimeout to allow editor state to settle before checking

2. **Auto-selection fix** (`/packages/runtime/src/plugins/DiffApprovalBar/DiffApprovalBar.tsx:156-159`):
   - Fixed selection listener to preserve auto-selection when no range selection exists
   - Prevents clearing `currentGroupIndex` to -1, which was disabling Accept/Reject buttons

3. **Multi-replacement application** (`/packages/rexical/src/plugins/DiffPlugin/index.tsx:206-210`):
   - Fixed to use full document markdown instead of `replacements[0].oldText`
   - Allows multiple text replacements to be applied correctly in a single diff operation

4. **Improved diff grouping** (`/packages/rexical/src/plugins/DiffPlugin/core/diffChangeGroups.ts:147-158`):
   - Updated to correctly pair consecutive removed+added nodes as single replacement groups
   - Reduced group count from 6 to 3-4 for typical multi-replacement diffs

5. **Comprehensive E2E tests** (`/packages/electron/e2e/ai/incremental-diff-cleanup.spec.ts`):
   - Test 1: Incremental accept all + close/reopen verification (CRITICAL: verifies tag persists)
   - Test 2: Incremental reject all
   - Test 3: Autosave after incremental cleanup
   - Test 4: Mixed accept/reject operations
   - Test 5: Partial acceptances with rejections

### Key Fix: Tag Persistence Verification

The first test now includes a **critical close/reopen step** that verifies the tag was properly cleared:
- After incrementally accepting all diffs
- Close the tab using the close button
- Reopen the file from the file tree
- Verify diff approval bar does NOT reappear
- Verify content is correct without diff nodes

This ensures the CLEAR_DIFF_TAG_COMMAND properly:
1. Saves current editor state to disk
2. Marks tag as 'reviewed' in the database
3. Clears pendingAIEditTagRef
4. Reloads editor with clean content

## Test Results

All 5 tests passing:
- ✅ Incremental accept with close/reopen verification
- ✅ Incremental reject all changes
- ✅ Autosave works after cleanup
- ✅ Mixed accept/reject operations
- ✅ Accept All operations (simplified version)

## Notes

- The 100ms timeout is necessary because Lexical updates are asynchronous
- Using both `groupDiffChanges().length === 0` and `$hasDiffNodes()` provides robust detection
- Dispatching CLEAR_DIFF_TAG_COMMAND (rather than calling updateTagStatus directly) reuses existing cleanup logic
- This approach maintains separation of concerns: DiffApprovalBar handles diff operations, TabEditor handles file/tag lifecycle
- The close/reopen test is critical for catching tag persistence issues that only manifest after reopening files
