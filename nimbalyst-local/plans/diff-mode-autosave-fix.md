---
planStatus:
  planId: plan-diff-mode-autosave-fix
  title: Fix Diff Mode Autosave via Editor State Refactor
  status: in-development
  planType: bug-fix
  priority: high
  owner: ghinkle
  stakeholders:
    - extension-developers
  tags:
    - ai-editing
    - autosave
    - diff-mode
    - lexical
    - editor-api
  created: "2025-12-22"
  updated: "2025-12-23T04:30:00.000Z"
  progress: 80
  relatedPlans:
    - plan-custom-editor-api-refactor
---
# Fix Diff Mode Autosave via Editor State Refactor

## Problem Statement

When an AI agent edits a markdown file and the editor enters diff mode (red/green WYSIWYG view), the system incorrectly triggers autosave even though the user hasn't made any changes. This causes subsequent AI edits to the same file to fail because the file has changed on disk.

### Current Behavior

1. AI agent edits a markdown file via apply_diff tool
2. Editor detects file change and enters diff mode
3. Editor loads `oldContent` (pre-edit baseline) and applies `APPLY_MARKDOWN_REPLACE_COMMAND` to show the diff
4. The diff rendering process causes the editor state to serialize differently than the original `oldContent`
5. `handleContentChange` compares serialized content against `initialContentRef.current` (which is set to `oldContent`)
6. Due to formatting differences from WYSIWYG rendering, `isDirty` becomes `true`
7. Autosave timer fires and saves the (unchanged from user perspective) content
8. Future AI edits fail with "file changed on disk" errors

### Root Cause

The fundamental issue is **confused state ownership**. TabEditor currently:
- Receives `initialContent` as a prop (loaded externally)
- Tracks `initialContentRef` for dirty detection
- Tracks `lastSavedContent` for save comparison
- Tracks `contentRef` for current state
- Has separate `isApplyingDiffRef` and `pendingAIEditTagRef` flags

This creates a complex state machine where dirty detection can produce false positives when WYSIWYG rendering normalizes content differently than the original file text.

## Related Work

This fix should be implemented as part of the **Custom Editor API Refactor** (see `plan-custom-editor-api-refactor`). That plan proposes:

1. **Editors load their own content** via `EditorFileHandle` instead of receiving `initialContent`
2. **Host controls dirty state** by comparing current content to `lastSavedContent`
3. **Unified editor registry** for consistent AI tool integration

By combining these efforts, we get a cleaner architecture that naturally prevents the autosave bug.

## Combined Solution

### Core Insight: Separate "Saved State" from "Diff Baseline"

The current code conflates two concepts:
- **Saved state**: What's on disk (for dirty detection)
- **Diff baseline**: What we're comparing against in diff mode (the pre-edit content)

These should be tracked separately.

### New State Model

```typescript
interface EditorState {
  // Content tracking
  currentContent: string;           // Live editor content
  lastSavedContent: string;         // What's on disk (updated on load/save)

  // Dirty detection (host-controlled)
  isDirty: boolean;                 // currentContent !== lastSavedContent

  // Diff mode (separate from dirty state)
  diffMode: {
    isActive: boolean;
    baseline: string;               // Pre-edit content for diff visualization
    target: string;                 // AI's proposed content
    tagId: string;                  // For history tracking
  } | null;

  // Flags
  isApplyingProgrammaticChange: boolean;  // Suppress dirty detection during programmatic updates
}
```

### Key Changes

#### 1. Host-Controlled Dirty Detection

Move dirty logic to a single, clear location:

```typescript
// In TabEditor or a new useEditorState hook
function computeDirtyState(current: string, lastSaved: string, isApplyingChange: boolean): boolean {
  if (isApplyingChange) return false;  // Programmatic changes don't make dirty
  return current !== lastSaved;
}
```

#### 2. Diff Mode is Orthogonal to Dirty State

Entering diff mode should NOT affect dirty state:

```typescript
function enterDiffMode(baseline: string, target: string, tagId: string) {
  // Store diff state
  setDiffMode({ isActive: true, baseline, target, tagId });

  // Load baseline into editor for visualization
  setIsApplyingProgrammaticChange(true);
  editor.loadContent(baseline);
  editor.dispatchCommand(APPLY_MARKDOWN_REPLACE_COMMAND, [{ newText: target }]);
  setIsApplyingProgrammaticChange(false);

  // Dirty state unchanged - we're showing a diff, not making edits
  // lastSavedContent is still what's on disk (the AI's new content)
}
```

#### 3. Autosave Respects Diff Mode

```typescript
// Autosave logic
if (diffMode?.isActive) {
  // In diff mode, only save if user made additional edits ON TOP of the diff
  // Compare against the diff target (AI's proposed content), not baseline
  if (currentContent === diffMode.target) {
    return; // No additional changes, skip autosave
  }
  // User edited during diff mode - this is a real change, allow autosave
}
```

#### 4. Accept/Reject Update lastSavedContent

```typescript
function acceptDiff() {
  // Content is already showing the target (with diff decorations removed)
  setLastSavedContent(diffMode.target);
  setDiffMode(null);
  save();  // Persist to disk
}

function rejectDiff() {
  // Revert to baseline
  setIsApplyingProgrammaticChange(true);
  editor.loadContent(diffMode.baseline);
  setIsApplyingProgrammaticChange(false);

  // Write baseline back to disk
  setLastSavedContent(diffMode.baseline);
  setDiffMode(null);
  save();
}
```

### Integration with Custom Editor API Refactor

This fix aligns perfectly with the custom editor API refactor:

| Current Architecture | New Architecture |
| --- | --- |
| `initialContent` prop | Editor loads via `fileHandle.readContent()` |
| `initialContentRef` for dirty | Host tracks `lastSavedContent` |
| Multiple content refs | Single `currentContent` + `lastSavedContent` |
| `isApplyingDiffRef` flag | `isApplyingProgrammaticChange` flag |
| Dirty detection in `handleContentChange` | Host computes dirty from content comparison |

### Implementation Phases

#### Phase 1: Immediate Fix (Minimal Changes)

Apply the simpler fixes from the original plan to unblock users:

1. Add diff mode check to autosave timer
2. Set `isApplyingDiffRef = true` during diff rendering
3. Reset dirty state after diff application completes

**Files:**
- `packages/electron/src/renderer/components/TabEditor/TabEditor.tsx`

#### Phase 2: State Consolidation

Refactor TabEditor to use the new state model:

1. Create `useEditorState` hook with clear state ownership
2. Separate `diffMode` state from `isDirty` state
3. Move dirty computation to single location
4. Update autosave to use new state model

**Files:**
- `packages/electron/src/renderer/components/TabEditor/TabEditor.tsx`
- New: `packages/electron/src/renderer/components/TabEditor/useEditorState.ts`

#### Phase 3: Custom Editor Integration

Apply new state model to custom editors (from custom-editor-api-refactor):

1. Define `EditorHostCallbacks` with `reportContentChanged()`
2. Host computes dirty for all editor types
3. Diff mode works uniformly across editor types

**Files:**
- `packages/runtime/src/extensions/types.ts`
- `packages/electron/src/renderer/components/TabEditor/TabEditor.tsx`
- Custom editor implementations

## Files to Modify

| File | Phase | Changes |
| --- | --- | --- |
| `TabEditor.tsx` | 1 | Add diff mode check to autosave; reset dirty after diff |
| `TabEditor.tsx` | 2 | Refactor to use new state model |
| `useEditorState.ts` | 2 | New hook for consolidated state management |
| `runtime/types.ts` | 3 | Update `CustomEditorProps` interface |

## Testing Considerations

1. **Verify no autosave in diff mode:**
  - Apply an AI edit to a markdown file
  - Observe diff mode activates
  - Wait for autosave timer interval (2 seconds)
  - Verify no save occurs (no disk write, no "file changed" detection)

2. **Verify user edits during diff mode save correctly:**
  - Enter diff mode with an AI edit
  - Make a manual edit to the content
  - Verify autosave triggers for the user edit
  - Verify the saved content includes user's edit

3. **Verify accept/reject work correctly:**
  - Enter diff mode
  - Accept changes - verify file saves AI's content
  - Reject changes - verify file reverts to baseline

4. **Verify consecutive AI edits work:**
  - Apply an AI edit, enter diff mode
  - Accept changes
  - Apply another AI edit to the same file
  - Verify second edit applies successfully (no "file changed" error)

5. **Verify custom editors work with new API (Phase 3):**
  - CSV editor receives diff state when AI edits CSV
  - Accept/reject work for custom editors

## Acceptance Criteria

- [ ] Entering diff mode does not trigger autosave from WYSIWYG rendering differences
- [ ] User can manually edit during diff mode and have changes saved
- [ ] Accept/Reject work correctly
- [ ] Consecutive AI edits to the same file work without "file changed" errors
- [ ] No regression in normal autosave behavior outside of diff mode
- [ ] (Phase 3) Custom editors can participate in diff mode

## Implementation Summary (2025-12-23)

### Phase 1: Immediate Fixes (Completed)

**File:** `packages/electron/src/renderer/components/TabEditor/TabEditor.tsx`

1. **Added diff mode check to autosave timer** (line 761-765)
  - Autosave now skips when `pendingAIEditTagRef.current` is set
  - Matches existing behavior in periodic snapshot timer

2. **Reset dirty state after diff application** (3 locations)
  - After mount-time diff application (line 520-522)
  - After update-time diff in alreadyInDiffMode (line 1028-1030)
  - After first-time diff application (line 1093-1095)

### Phase 2: State Infrastructure (Completed)

**New file:** `packages/electron/src/renderer/components/TabEditor/useEditorState.ts`

Created a consolidated state management hook that:
- Separates "saved state" from "diff baseline" (key insight)
- Provides `isApplyingProgrammaticChange` flag to suppress dirty detection
- Tracks diff mode state separately from dirty state
- Computes dirty state in a single location

This hook is available for gradual adoption - TabEditor continues to work with its existing refs but can migrate to this hook incrementally.

### Phase 3: Custom Editor API (Completed)

**File:** `packages/runtime/src/extensions/types.ts`

Added new types for custom editor diff support:
- `CustomEditorDiffState` - Diff mode state passed to editors
- `CustomEditorCapabilities` - Capabilities editors can declare
- `CustomEditorHostCallbacks` - Structured callbacks interface

Extended `CustomEditorComponentProps` with:
- `onRegisterCallbacks` / `onUnregisterCallbacks` - Host callback registration
- `diffState` - Diff mode state for opt-in editors
- `onAcceptDiff` / `onRejectDiff` - Diff action callbacks
- `onReloadContent` - External change notification

All new types exported from `packages/runtime/src/extensions/index.ts`.

### Documentation Updated

- `design/Extensions/nimbalyst-extension-api.md` - Added AI Diff Mode section with full API docs
- `design/Extensions/nimbalyst-extension-system.md` - Updated "What's Working" section

### What Remains

1. **Testing** - Manual verification that the bug is fixed
2. **Custom editor migration** - Update CSV and other editors to use new API
3. **Full TabEditor migration** - Gradually replace refs with useEditorState hook
