# Git Worktree Integration

Nimbalyst supports creating git worktrees for isolated AI coding sessions. This allows Claude Code to work in a separate branch without affecting the main workspace, enabling safe experimentation and parallel development workflows.

## Overview

Git worktrees allow you to have multiple working directories from a single git repository, each checked out to a different branch. Nimbalyst leverages this to create isolated environments for AI-assisted coding sessions.

## Key Concepts

### Worktree Sessions vs Regular Sessions

- **Regular AI Sessions**: Run in the main workspace directory, operate on the current branch
- **Worktree Sessions**: Run in a separate directory with their own branch, isolated from the main workspace

### Relationship Model

**One worktree can have multiple sessions, but one session can only belong to one worktree.**

This is implemented using a foreign key relationship:
- `ai_sessions.worktree_id` → `worktrees.id` (nullable, many-to-one)
- When `worktree_id` is NULL, the session is a regular session
- When `worktree_id` is set, the session belongs to that worktree

## Database Schema

### worktrees Table

Stores metadata about git worktrees created from Nimbalyst.

```sql
CREATE TABLE worktrees (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,  -- The main workspace/project path
  name TEXT NOT NULL,           -- Human-readable worktree name
  path TEXT NOT NULL,           -- Absolute path to worktree directory
  branch TEXT NOT NULL,         -- Git branch name for this worktree
  base_branch TEXT DEFAULT 'main',  -- Branch this worktree was created from
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_worktrees_workspace ON worktrees(workspace_id);
CREATE INDEX idx_worktrees_path ON worktrees(path);
```

### ai_sessions Table (Worktree Association)

The `ai_sessions` table includes a foreign key to associate sessions with worktrees.

```sql
ALTER TABLE ai_sessions ADD COLUMN worktree_id TEXT REFERENCES worktrees(id);
CREATE INDEX idx_ai_sessions_worktree ON ai_sessions(worktree_id);
```

## Architecture

### Main Process Services

#### GitWorktreeService

**Location**: `packages/electron/src/main/services/GitWorktreeService.ts`

Manages git worktree operations using the `simple-git` library.

**Key methods:**
- `createWorktree(workspacePath, options?)`: Creates a new git worktree
  - Generates unique branch name using ULID
  - Creates worktree in `../{project_name}_worktrees/` directory
  - Returns worktree metadata
- `getWorktreeStatus(worktreePath)`: Fetches git status for a worktree
  - Returns uncommitted changes count
  - Returns commits ahead/behind relative to base branch
  - Returns merge conflict status
- `deleteWorktree(worktreePath, workspacePath)`: Removes a git worktree
  - Deletes the worktree directory
  - Removes git worktree registration

#### WorktreeStore

**Location**: `packages/electron/src/main/services/WorktreeStore.ts`

Database persistence layer for worktree metadata.

**Key methods:**
- `create(worktree)`: Insert new worktree record
- `get(id)`: Retrieve worktree by ID
- `list(workspaceId)`: List all worktrees for a workspace
- `delete(id)`: Delete worktree record
- `getWorktreeSessions(worktreeId)`: Get all sessions associated with a worktree

### IPC Communication

**Location**: `packages/electron/src/main/ipc/WorktreeHandlers.ts`

Exposes worktree operations to the renderer process via IPC.

**IPC Channels:**
- `worktree:create` - Create new worktree
- `worktree:get-status` - Get git status for worktree
- `worktree:delete` - Delete worktree and its database record
- `worktree:list` - List all worktrees for a workspace
- `worktree:get` - Get single worktree by ID

**Preload API** (`packages/electron/src/preload/index.ts`):
```typescript
window.electronAPI.createWorktree(workspacePath, name?)
window.electronAPI.getWorktreeStatus(worktreePath)
window.electronAPI.deleteWorktree(worktreeId, workspacePath)
window.electronAPI.listWorktrees(workspacePath)
window.electronAPI.getWorktree(worktreeId)
```

### Renderer Services

#### RendererWorktreeService

**Location**: `packages/electron/src/renderer/services/RendererWorktreeService.ts`

Type-safe wrapper around worktree IPC calls for the renderer process.

Returns consistent `{ success, data?, error? }` shape for all operations.

## UI Components

### WorktreeSingle Component

**Location**: `packages/electron/src/renderer/components/AgenticCoding/WorktreeSingle.tsx`

Displays a worktree session with distinctive visual treatment:

**Visual elements:**
- AI provider icon (28x28px) with small worktree badge overlay in bottom-right corner
- Session title on first line
- Meta row showing: worktree name (blue, `--primary-color`) + git status badge
- Message count badge on right
- Background: `--surface-tertiary` to distinguish from regular sessions

**Props:**
```typescript
interface WorktreeSingleProps {
  session: SessionListItemData;
  worktree: Worktree;
  isActive: boolean;
  onClick: () => void;
}
```

### New Worktree Button

**Location**: `packages/electron/src/renderer/components/AgenticCoding/SessionHistory.tsx`

- Position: Agent mode sidebar header, next to the existing "New Session" button
- Icon: Git branch icon
- Tooltip: "New Worktree"
- Behavior: Creates worktree first, then creates a Claude Code session associated with it

## Workflow

### Creating a Worktree Session

1. User clicks "New Worktree" button in agent mode
2. `SessionHistory.tsx` calls `handleNewWorktreeSession()`
3. IPC call to `worktree:create` with workspace path
4. `GitWorktreeService` creates git worktree:
   - Generates unique branch name (e.g., `worktree-01JBCD3FG2H5K6M7N8P9QR`)
   - Creates directory: `../{project_name}_worktrees/{branch_name}/`
   - Checks out new branch in that directory
5. `WorktreeStore` saves worktree metadata to database
6. AI session created with `worktreeId` set
7. `SessionManager` passes `worktreePath` to `ClaudeCodeProvider`
8. Claude Code operations execute in the worktree directory

### Session-Worktree Association

When creating a session with worktree:

```typescript
// In AIService.ts
const session = await this.sessionManager.createSession({
  provider: 'claude-code',
  workspacePath: worktree.path,  // Use worktree path instead of main workspace
  worktreeId: worktree.id,        // Associate with worktree
  // ... other params
});
```

The `worktreePath` is used as the working directory for Claude Code, ensuring all file operations happen in the isolated worktree.

### Displaying Worktree Sessions

`SessionHistory.tsx` groups sessions by worktree association:

1. Sessions with `worktreeId` are rendered using `WorktreeSingle` component
2. Sessions without `worktreeId` are rendered as regular sessions
3. Worktree sessions appear first, followed by regular sessions

## File Locations

### Worktree Directory Structure

Worktrees are created outside the main workspace:

```
/path/to/project/                    # Main workspace
/path/to/project_worktrees/          # Worktrees directory
  └── worktree-01JBCD3FG2H5K6M7N8P9QR/  # Individual worktree
      ├── .git (file pointing to main repo)
      └── ... (project files)
```

This keeps worktrees separate from the main workspace while maintaining git connectivity.

## Provider Integration

### Claude Code Provider

**Location**: `packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts`

The provider accepts a `workspacePath` parameter. For worktree sessions:
- Main workspace sessions: `workspacePath = /path/to/project`
- Worktree sessions: `workspacePath = /path/to/project_worktrees/branch-name`

All Claude Code operations (file reads, writes, tool calls) execute in the specified workspace path, ensuring worktree isolation.

## Testing

### E2E Tests

**Location**: `packages/electron/e2e/worktree/worktree-session-creation.spec.ts`

Tests verify:
1. "New Worktree" button appears in agent mode
2. Clicking creates a git worktree in the filesystem
3. Session is created with worktree association
4. WorktreeSingle component renders with correct visual treatment
5. Claude Code runs in the worktree directory (when provider is configured)

**Test selectors** (`packages/electron/e2e/utils/testHelpers.ts`):
- `newWorktreeSessionButton`: The "New Worktree" button
- `worktreeSingle`: Worktree session container
- `worktreeSingleBadge`: Worktree badge overlay on AI icon
- `worktreeSingleName`: Worktree name display
- `worktreeSingleTitle`: Session title

## Platform Compatibility

The implementation is cross-platform compatible:
- Uses Node.js `path` module for all path operations
- Git commands via `simple-git` work on Windows, macOS, and Linux
- Worktree paths are normalized for the current platform

## Error Handling

All worktree operations follow the project's error handling patterns:

1. **Parameter validation**: Required parameters throw if missing
2. **IPC responses**: Return `{ success, data?, error? }` shape
3. **Logging**: All operations logged with `log.scope('WorktreeHandlers')` or `log.scope('GitWorktreeService')`
4. **User feedback**: Errors should be surfaced to users (implementation TBD)

## Future Enhancements

Potential features for worktree sessions:

- Worktree renaming when session is named
- Diff view showing changes in worktree vs base branch
- Commit and merge operations from the UI
- Git status polling and real-time updates
- Multi-session worktree groups (multiple sessions sharing one worktree)

## Related Documentation

- [AI_PROVIDER_TYPES.md](AI_PROVIDER_TYPES.md) - AI provider architecture
- [INTERNAL_MCP_SERVERS.md](INTERNAL_MCP_SERVERS.md) - MCP server implementation
- [ANALYTICS_GUIDE.md](ANALYTICS_GUIDE.md) - Adding analytics events
