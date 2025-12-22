# Worktree Session Creation - Implementation Sub-Plan

## Scope

This sub-plan covers the minimal implementation to:
1. Add a "New Worktree" button in the agent sessions sidebar
2. Create a git worktree when clicked
3. Create a session associated with that worktree
4. Display the worktree session with a distinctive look (badge overlay on AI icon)
5. Run Claude Code sessions in the worktree directory

## Visual Design Reference

See mockup: `nimbalyst-local/mockups/worktrees-mockups/agent-mode.mockup.html`

### Single-Session Worktree Design (Alt 3)
From the mockup, a worktree session with a single session should display:
- AI icon (28x28px, orange gradient) with a **small worktree badge overlay** in bottom-right corner
- Session title on first line
- Meta row showing: worktree name (blue, primary-color) + git status badge (e.g., "3 ahead")
- Message count badge on right
- Background: `var(--surface-tertiary)` to distinguish from regular sessions

```css
.worktree-single {
  padding: 8px 12px;
  background: var(--surface-tertiary);
  border-radius: 6px;
  margin-bottom: 8px;
}
```

### New Worktree Button
- Position: In sidebar header next to the existing + button
- Icon: Git branch icon with + symbol
- Tooltip: "New Worktree"

## Implementation Steps

### Phase 1: Database Schema

**File**: `packages/electron/src/main/database/migrations/005_worktrees.sql`

```sql
-- Worktrees table
CREATE TABLE IF NOT EXISTS worktrees (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  branch TEXT NOT NULL,
  base_branch TEXT DEFAULT 'main',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_worktrees_workspace ON worktrees(workspace_id);

-- Add worktree_id to ai_sessions
ALTER TABLE ai_sessions ADD COLUMN worktree_id TEXT REFERENCES worktrees(id);
CREATE INDEX IF NOT EXISTS idx_ai_sessions_worktree ON ai_sessions(worktree_id);
```

### Phase 2: GitWorktreeService (Main Process)

**File**: `packages/electron/src/main/services/GitWorktreeService.ts`

Key methods:
- `createWorktree(workspacePath: string, name?: string): Promise<Worktree>` - Creates a git worktree with a random name in the default worktrees directory
- `getWorktreeStatus(worktreePath: string): Promise<GitStatus>` - Returns ahead/behind counts
- `deleteWorktree(worktreePath: string): Promise<void>` - Removes a worktree

Default worktrees directory: `../<project_name>_worktrees/` relative to project root

### Phase 3: IPC Handlers

**File**: `packages/electron/src/main/handlers/WorktreeHandlers.ts`

Register handlers:
- `worktree:create` - Create worktree and return its data
- `worktree:get-status` - Get git status for worktree
- `worktree:delete` - Delete worktree

### Phase 4: Renderer Service

**File**: `packages/electron/src/renderer/services/RendererWorktreeService.ts`

IPC wrapper for renderer process to call worktree operations.

### Phase 5: UI Components

#### WorktreeSingle Component
**File**: `packages/electron/src/renderer/components/AgenticCoding/WorktreeSingle.tsx`

Props:
```typescript
interface WorktreeSingleProps {
  session: SessionListItemData;
  worktree: Worktree;
  isActive: boolean;
  onClick: () => void;
}
```

Visual elements:
- Icon wrapper with AI icon + worktree badge overlay
- Session title
- Meta row: worktree name (blue) + status badge
- Message count

#### SessionHistory Updates
**File**: `packages/electron/src/renderer/components/AgenticCoding/SessionHistory.tsx`

Changes:
1. Add "New Worktree" button in header (next to existing + button)
2. Group sessions by worktree_id
3. Render worktree sessions using WorktreeSingle component
4. Keep standalone sessions in "Sessions" section below

### Phase 6: Session Creation with Worktree

Modify session creation flow to:
1. When "New Worktree" clicked: create worktree first, then create session with worktree_id
2. Pass worktree path to ClaudeCodeProvider so it runs in that directory

**Key modification in AIService**: When creating a session with a worktree, use `worktree.path` as the working directory for ClaudeCodeProvider instead of the main workspace path.

### Phase 7: ClaudeCodeProvider Integration

**File**: `packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts`

The provider already accepts a `workspacePath` parameter. When a session has a worktree:
- Use `worktree.path` instead of the main workspace path
- This ensures Claude Code operations (file reads, writes, tool calls) happen in the worktree

## E2E Test Requirements

**File**: `packages/electron/e2e/worktree/worktree-session-creation.spec.ts`

The test MUST verify:
1. "New Worktree" button exists and is clickable
2. Clicking creates a new session with worktree association
3. The session displays with the distinctive worktree badge UI
4. **CRITICAL**: Claude Code runs in the worktree directory

### Verifying Claude Code runs in worktree

Use the `/context` command which is deterministic and returns the current working directory:
1. Create worktree session
2. Send `/context` command to Claude Code
3. Parse the response to extract the working directory
4. Verify it matches the worktree path (not the main project path)

Alternative: Check the database for the session's worktree association and verify the path.

## Files to Create/Modify

### New Files
- `packages/electron/src/main/database/migrations/005_worktrees.sql`
- `packages/electron/src/main/services/GitWorktreeService.ts`
- `packages/electron/src/main/handlers/WorktreeHandlers.ts`
- `packages/electron/src/renderer/services/RendererWorktreeService.ts`
- `packages/electron/src/renderer/components/AgenticCoding/WorktreeSingle.tsx`
- `packages/electron/src/renderer/components/AgenticCoding/WorktreeSingle.css`
- `packages/electron/e2e/worktree/worktree-session-creation.spec.ts`

### Modified Files
- `packages/electron/src/main/database/worker.js` - Add migration
- `packages/electron/src/main/handlers/index.ts` - Register worktree handlers
- `packages/electron/src/preload/index.ts` - Expose worktree IPC methods
- `packages/electron/src/renderer/components/AgenticCoding/SessionHistory.tsx` - Add button, group by worktree
- `packages/electron/src/renderer/components/AgenticCoding/SessionHistory.css` - Style new button
- `packages/runtime/src/ai/server/SessionManager.ts` - Add worktree_id support
- `packages/electron/src/main/services/ai/AIService.ts` - Use worktree path for provider

## Dependencies

- `simple-git` - Already available in the project for git operations

## Out of Scope

- Multi-session worktree groups (only single-session worktrees for now)
- Worktree renaming when session is named
- Diff view / Changes tab
- Commit / merge operations
- Git status polling/updates
