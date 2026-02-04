---
planStatus:
  planId: plan-project-move-rename
  title: Project Move/Rename Feature
  status: in-development
  planType: feature
  priority: medium
  owner: ghinkle
  stakeholders: []
  tags:
    - project-management
    - data-migration
    - workspace
  created: "2026-02-04"
  updated: "2026-02-04T20:00:00.000Z"
  progress: 90
  startDate: "2026-02-04"
---

# Project Move/Rename Feature

## Implementation Progress

- [x] Phase 1: Backend Service (ProjectMigrationService.ts)
  - [x] Create ProjectMigrationService.ts with path escaping utilities
  - [x] Implement canMoveProject() validation
  - [x] Implement moveProject() with migration steps
  - [x] Implement rollback capability
- [x] Phase 2: IPC Handlers
  - [x] Create ProjectMigrationHandlers.ts
  - [x] Register handlers in ipc/index.ts
  - [x] Add projectMigration API to preload
  - [x] TypeScript types defined inline in preload
- [x] Phase 3: UI Implementation
  - [x] Add context menu to WorkspaceManager.tsx
  - [x] Implement rename dialog/workflow
  - [x] Implement move workflow with directory picker
  - [x] Add progress/feedback (loading, toasts, error dialogs)
  - [x] Refresh list after operation
- [ ] Phase 4: Testing
  - [ ] Manual testing of all scenarios

## Overview

Enable users to move or rename a project from the Project Manager window while preserving all associated data including AI session history, file history, workspace settings, and Claude Code native data.

## Problem Statement

Currently, if a user moves or renames a project directory:
1. All AI session history is "lost" (still exists but inaccessible due to path mismatch)
2. Workspace settings are orphaned under the old path key
3. File history becomes inaccessible
4. Claude Code session files in `~/.claude/projects/` are orphaned

Users need a way to safely relocate projects while maintaining full data continuity.

## Requirements

### Functional Requirements
1. **Move project**: Copy project to new location and update all references
2. **Rename project**: Rename project directory in place (special case of move)
3. **Safety checks**: Prevent move/rename while project is open
4. **Data integrity**: Migrate all associated data atomically
5. **Rollback capability**: Ability to undo if migration fails partway through

### Non-Functional Requirements
1. Operation should be fast (most time spent on file copy)
2. Clear error messages if operation fails
3. Progress indication for large projects

## Data Migration Scope

### 1. Filesystem Operations
- Copy/move the project directory itself
- Rename Claude Code session directory: `~/.claude/projects/[old-escaped-path]/` to `~/.claude/projects/[new-escaped-path]/`

### 2. PGLite Database Updates
Tables requiring `workspace_id` updates:
- `ai_sessions` - session history
- `session_files` - file linkage records
- `document_history` - file edit history
- `tracker_items` - bugs/tasks/ideas
- `worktrees` - git worktree records (also update `path` field)

### 3. Electron-Store Updates
- **workspace-settings.json**: Migrate workspace state from old key (`ws:[old-base64]`) to new key (`ws:[new-base64]`)
- **app-settings.json**: Update paths in `recent.workspaces[]`

### 4. Path Updates Within Data
- Update absolute file paths stored in workspace state (e.g., `recentDocuments`)
- Update paths in `.claude/settings.local.json` if `additionalDirectories` contains absolute paths

## Safety Constraints

### Project Must Be Closed
- Use `findWindowByWorkspace(oldPath)` to verify no windows have project open
- Check for active worktrees that might have windows open
- Return clear error if project is in use

### Pre-Migration Backup
- Leverage existing `DatabaseBackupService` before database updates
- Keep original project directory until migration confirmed successful

## User Experience

### UI Location
Project Manager window - context menu on each project item in the sidebar list.

### Context Menu Items
Right-click on a project shows:
- **Open Project** - same as double-click
- **Rename...** - rename in place
- **Move to...** - move to new location
- (separator)
- **Remove from Recent** - existing functionality

### Workflow: Rename
1. User right-clicks project → "Rename..."
2. Inline text field appears (or simple dialog) for entering new name
3. System validates:
   - Project is not open
   - No worktrees exist for this project
   - New name doesn't conflict with existing directory
4. Progress indicator during migration
5. Success toast / error dialog
6. Project list refreshes with updated name

### Workflow: Move
1. User right-clicks project → "Move to..."
2. Directory picker dialog opens
3. User selects destination folder
4. System validates:
   - Project is not open
   - No worktrees exist for this project
   - Destination + project name doesn't already exist
5. Progress dialog during copy operation
6. Success toast / error dialog
7. Project list refreshes with updated path

## Technical Design

### New IPC Handlers

```typescript
// Check if project can be moved
'project:can-move': (oldPath: string) => Promise<{
  canMove: boolean;
  reason?: string;  // e.g., "Project is currently open"
}>;

// Execute the move/rename
'project:move': (oldPath: string, newPath: string) => Promise<{
  success: boolean;
  error?: string;
}>;
```

### Migration Service

New service: `ProjectMigrationService.ts`

```typescript
class ProjectMigrationService {
  async canMoveProject(oldPath: string): Promise<CanMoveResult>;
  async moveProject(oldPath: string, newPath: string): Promise<MoveResult>;

  private async migrateFilesystem(oldPath: string, newPath: string): Promise<void>;
  private async migrateClaudeProjects(oldPath: string, newPath: string): Promise<void>;
  private async migrateDatabase(oldPath: string, newPath: string): Promise<void>;
  private async migrateElectronStore(oldPath: string, newPath: string): Promise<void>;
  private async rollback(oldPath: string, newPath: string): Promise<void>;
}
```

### Path Escaping for Claude Projects

```typescript
function escapePathForClaude(absolutePath: string): string {
  return absolutePath.replace(/\//g, '-');
}

function unescapeClaudePath(escaped: string): string {
  const normalized = escaped.startsWith('-')
    ? escaped.slice(1).replace(/-/g, '/')
    : escaped.replace(/-/g, '/');
  return `/${normalized}`;
}
```

## Implementation Steps

### Phase 1: Backend Service (ProjectMigrationService.ts)

1. **Create service file** at `packages/electron/src/main/services/ProjectMigrationService.ts`

2. **Implement `canMoveProject(oldPath: string)`**:
   - Check `findWindowByWorkspace(oldPath)` returns null
   - Query database for worktrees: `SELECT COUNT(*) FROM worktrees WHERE workspace_id = $1`
   - If worktrees exist, return `{ canMove: false, reason: "Project has worktrees. Please delete worktrees first." }`
   - Check old path exists

3. **Implement `moveProject(oldPath: string, newPath: string)`**:
   - Re-validate canMove (for safety)
   - Trigger database backup via `DatabaseBackupService`
   - Execute migration steps in order (see below)
   - On any failure, rollback and return error
   - On success, delete original directory

4. **Migration steps in order**:
   ```
   a. Copy project directory (oldPath -> newPath) using recursive copy
   b. Rename Claude session directory:
      ~/.claude/projects/[old-escaped] -> ~/.claude/projects/[new-escaped]
   c. Update database tables (single transaction):
      - UPDATE ai_sessions SET workspace_id = $2 WHERE workspace_id = $1
      - UPDATE session_files SET workspace_id = $2 WHERE workspace_id = $1
      - UPDATE document_history SET workspace_id = $2 WHERE workspace_id = $1
      - UPDATE tracker_items SET workspace = $2 WHERE workspace = $1
   d. Migrate electron-store workspace settings:
      - Read from old key: ws:[base64(oldPath)]
      - Update workspacePath field in the state
      - Update file paths in recentDocuments array
      - Write to new key: ws:[base64(newPath)]
      - Delete old key
   e. Update recent workspaces in app-settings:
      - Find entry with old path, update to new path
   f. Update .claude/settings.local.json if additionalDirectories contains old path
   g. Delete original project directory
   ```

5. **Rollback capability**:
   - If failure after step (a): delete newPath copy
   - If failure after step (b): rename Claude dir back
   - Database uses transaction - auto-rollback on failure
   - Store changes are atomic per-key

### Phase 2: IPC Handlers

1. **Add handlers** in new file `packages/electron/src/main/ipc/ProjectMigrationHandlers.ts`:
   ```typescript
   'project:can-move': (oldPath: string) => Promise<CanMoveResult>
   'project:move': (oldPath: string, newPath: string) => Promise<MoveResult>
   'project:rename': (oldPath: string, newName: string) => Promise<MoveResult>
   ```

2. **Register handlers** in `packages/electron/src/main/ipc/index.ts`

3. **Add to preload** in `packages/electron/src/preload/index.ts`:
   ```typescript
   projectMigration: {
     canMove: (oldPath: string) => ipcRenderer.invoke('project:can-move', oldPath),
     move: (oldPath: string, newPath: string) => ipcRenderer.invoke('project:move', oldPath, newPath),
     rename: (oldPath: string, newName: string) => ipcRenderer.invoke('project:rename', oldPath, newName),
   }
   ```

### Phase 3: UI Implementation

1. **Add context menu to WorkspaceManager.tsx**:
   - Add `onContextMenu` handler to workspace items
   - Use Electron's `Menu.buildFromTemplate()` via IPC or a custom context menu component
   - Menu items: Open Project, Rename..., Move to..., (separator), Remove from Recent

2. **Rename dialog** (inline or modal):
   - Simple text input for new name
   - Validate: not empty, no invalid characters, doesn't exist
   - Call `projectMigration.rename(oldPath, newName)`

3. **Move workflow**:
   - Call `electronAPI.dialog.showOpenDialog({ properties: ['openDirectory'] })`
   - Confirm action with user
   - Call `projectMigration.move(oldPath, newPath)`

4. **Progress/feedback**:
   - Disable UI during operation
   - Show loading spinner
   - Toast notification on success
   - Error dialog on failure with actionable message

5. **Refresh list** after successful operation

### Phase 4: Testing

1. **Unit tests** for `ProjectMigrationService`:
   - Path escaping/unescaping functions
   - canMoveProject validation logic (mocked dependencies)

2. **Integration tests**:
   - Database migration with test data
   - Electron-store key migration

3. **Manual testing checklist**:
   - [ ] Rename project, verify sessions load
   - [ ] Move project to different directory, verify sessions load
   - [ ] Try to move open project, verify error
   - [ ] Try to move project with worktrees, verify error
   - [ ] Move project, verify workspace settings preserved
   - [ ] Move project, verify Claude session files accessible

## Design Decisions

Based on user feedback:

1. **Move Strategy**: Copy-then-delete approach (safer, works across volumes, keeps original until verified)
2. **Worktrees**: Block move if worktrees exist - require user to clean up worktrees first
3. **UI Trigger**: Context menu only (right-click on project item)
4. **Destination validation**: Error if destination exists (no merge support)

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Data loss during migration | Keep original until confirmed successful |
| Partial migration failure | Transaction-like approach with rollback |
| Database corruption | Pre-migration backup via existing service |
| Race condition (project opened during move) | Lock check at start, atomic operations |

## Success Criteria

1. User can rename a closed project from Project Manager
2. User can move a closed project to a new location
3. All AI sessions remain accessible after move
4. All file history remains accessible after move
5. Workspace settings (sidebar width, recent files, etc.) preserved
6. Clear error message if project is open
7. Operation can be undone if it fails partway through

## Files to Create/Modify

### New Files
| File | Purpose |
|------|---------|
| `packages/electron/src/main/services/ProjectMigrationService.ts` | Core migration logic |
| `packages/electron/src/main/ipc/ProjectMigrationHandlers.ts` | IPC handlers for migration operations |

### Modified Files
| File | Changes |
|------|---------|
| `packages/electron/src/main/ipc/index.ts` | Register ProjectMigrationHandlers |
| `packages/electron/src/preload/index.ts` | Add `projectMigration` API |
| `packages/electron/src/preload/index.d.ts` | TypeScript types for new API |
| `packages/electron/src/renderer/components/WorkspaceManager/WorkspaceManager.tsx` | Add context menu, rename dialog |

## References

- `WindowManager.ts:findWindowByWorkspace()` - Window detection
- `ClaudeCodeSessionScanner.ts:normalizeWorkspacePath()` - Path encoding
- `store.ts:workspaceKey()` - Workspace key generation
- `WorkspaceHandlers.ts` - Existing workspace IPC patterns
