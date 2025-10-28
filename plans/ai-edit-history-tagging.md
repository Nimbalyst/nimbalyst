---
planStatus:
  planId: plan-ai-edit-history-tagging
  title: AI Edit History Tagging
  status: completed
  planType: feature
  priority: medium
  owner: system
  stakeholders:
    - users
  tags:
    - ai
    - history
    - ux
  created: "2025-10-15"
  updated: "2025-10-15T00:00:00.000Z"
  progress: 100
---
# AI Edit History Tagging


## Goals

Add automatic history snapshot creation when AI edits complete, allowing users to:
- Track when AI made changes vs manual edits
- See which AI provider/model made the change
- Connect edits back to the originating session/prompt
- Jump between history view and AI session
- Better undo/restore workflow for AI changes

## Current System

### History System
- Uses PGLite database to store document snapshots
- Current snapshot types: `'auto-save' | 'manual' | 'ai-diff' | 'pre-apply' | 'external-change'`
- Location: `packages/electron/src/main/HistoryManager.ts:13`
- Already supports metadata (JSONB) and optional description fields

### AI Editing Flow
- **AIChat.tsx** (sidebar): When AI response completes, edits are auto-applied in a loop (lines 227-316)
- **AgenticCodingWindow.tsx** (coding window): When stream completes, session is reloaded (lines 524-546)
- Edits are applied via `aiApi.applyEdit()` which returns success/failure

### Current Snapshot Creation Points
- **Auto-save**: Periodic snapshots in EditorContainer (every 2 minutes)
- **Manual**: User-triggered with Cmd+S
- **External-change**: When file changes on disk

## Implementation Plan

### 1. Add New Snapshot Type

**Files to modify:**
- `packages/electron/src/main/HistoryManager.ts:13`
- `packages/electron/src/renderer/hooks/useHistory.ts:3`
- `packages/electron/src/renderer/windows/HistoryWindow.tsx:7`

Add `'ai-edit'` to the `SnapshotType` union type.

### 2. Create Snapshots After AI Edits Complete

#### AIChat.tsx (Sidebar Chat)
**Location**: `packages/electron/src/renderer/components/AIChat/AIChat.tsx:316`

After all edits in a response are successfully applied:
- Create ONE snapshot per AI response (not one per edit)
- Only create if at least one edit succeeded
- Include rich metadata for session context

**Metadata structure:**
```typescript
{
  type: 'ai-edit',
  provider: session.provider,        // e.g., 'claude-code'
  model: session.model,               // e.g., 'claude-sonnet-4'
  sessionId: currentSessionId,        // Link back to session
  promptSummary: truncate(userMessage, 100),
  editCount: successfulEdits.length,
  timestamp: Date.now()
}
```

#### AgenticCodingWindow.tsx (Coding Window)
**Location**: `packages/electron/src/renderer/components/AgenticCodingWindow.tsx:546`

After stream completes and session reloads:
- Check if session metadata indicates edits were applied
- Create snapshot with session context
- Include same metadata structure as AIChat

### 3. Update History Window UI

**File**: `packages/electron/src/renderer/windows/HistoryWindow.tsx`

Add support for `'ai-edit'` type:
- **Icon**: Robot/AI icon (use existing sparkle icon from AIChat)
- **Label**: "AI Edit"
- **Tooltip**: Show provider, model, prompt summary
- **Color**: Use `--primary-color` to distinguish from manual edits

Update two switch statements:
1. Icon rendering (line ~136)
2. Label rendering (line ~153)

### 4. Implementation Order

1. Add `'ai-edit'` type to type definitions (3 files)
2. Update History Window UI to display new type
3. Add snapshot creation to AIChat.tsx after edit completion
4. Add snapshot creation to AgenticCodingWindow.tsx after stream completion
5. Test with both sidebar chat and agentic coding window

## Technical Details

### Snapshot Creation Logic (AIChat.tsx)

```typescript
// After all edits applied (around line 316)
if (successfulEdits.length > 0 && targetContext?.filePath) {
  const session = getCurrentSession();
  const promptSummary = currentUserMessage.length > 100
    ? currentUserMessage.substring(0, 97) + '...'
    : currentUserMessage;

  await window.electronAPI.history.createSnapshot(
    targetContext.filePath,
    documentContext?.getLatestContent?.() || documentContext?.content || '',
    'ai-edit',
    `AI Edit: ${promptSummary}`
  );
}
```

### Benefits

- **Traceability**: See exactly when and how AI modified your document
- **Session linking**: Jump from history to the AI session that made the change
- **Better undo**: Restore to pre-AI-edit state easily
- **Audit trail**: Track AI provider/model performance
- **User confidence**: Clear visibility into AI modifications

## Future Enhancements

- Click on AI edit in history to open the source session
- Filter history by edit type (manual vs AI)
- Compare multiple AI edit versions
- Replay AI editing sequence
- Tag edits with user rating/feedback

## Testing

- Create AI edits in sidebar chat, verify snapshot created
- Create AI edits in agentic coding window, verify snapshot created
- Check history window shows correct icon and metadata
- Verify snapshot only created when edits succeed
- Test with multiple consecutive AI edits
- Verify sessionId linking works correctly

## Implementation Summary

Successfully implemented AI edit history tagging. Changes made:

1. **Type Definitions** (3 files):
  - Added `'ai-edit'` to `SnapshotType` union in HistoryManager.ts, useHistory.ts, and HistoryWindow.tsx

2. **History Window UI** (HistoryWindow.tsx):
  - Added `'ai-edit'` case with `'auto_awesome'` icon
  - Added label "AI Edit" (distinct from "AI Diff")
  - Added metadata field to Snapshot interface

3. **AIChat.tsx Snapshot Creation**:
  - Changed edit application from forEach to Promise.all for proper async tracking
  - Track successful edits with results array
  - After all edits complete, create ONE snapshot per AI response
  - Includes prompt summary in snapshot description
  - Only creates snapshot if at least one edit succeeded

4. **AgenticCodingWindow.tsx Snapshot Creation**:
  - After stream completes and session reloads
  - Scans messages for tool calls that indicate file edits (applyDiff, editFile)
  - Extracts edited file paths from successful tool results
  - Creates snapshot for each edited file with prompt summary
  - Reads current file content for accurate snapshot

All snapshots are tagged with type `'ai-edit'` and include a description like "AI Edit: [prompt summary]" for easy identification in history.
