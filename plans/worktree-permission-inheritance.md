---
planStatus:
  planId: plan-worktree-permission-inheritance
  title: Worktree Permission Inheritance
  status: in-development
  planType: feature
  priority: high
  owner: claude
  stakeholders:
    - jordanbentley
  tags:
    - permissions
    - worktrees
    - security
  created: "2025-12-30"
  updated: "2025-12-30T21:15:00.000Z"
  progress: 90
---

# Worktree Permission Inheritance

## Problem Statement

When an AI session runs in a git worktree, the permission system currently treats the worktree as a completely separate workspace. This creates a poor user experience because:

1. **Trust must be re-established**: Even though the worktree is the same codebase (just a different branch), the user is prompted to trust the worktree as if it were a new project
2. **Tool patterns are not inherited**: Approved patterns like `Bash(npm test:*)` stored in the main project's `.claude/settings.local.json` are not recognized in the worktree
3. **Settings files don't exist in worktrees**: The worktree directory doesn't have `.claude/settings.local.json`, so all tool calls require re-approval

### Current Behavior

When a session is created for a worktree:
- `workspacePath` is set to the worktree path (e.g., `/project_worktrees/swift-falcon/`)
- `PermissionService.getPermissionMode(worktreePath)` returns `null` (untrusted)
- `ClaudeSettingsManager.getEffectiveSettings(worktreePath)` looks in `{worktreePath}/.claude/` which doesn't exist
- Trust dialog appears asking user to trust the worktree
- Every tool call prompts for approval

### Desired Behavior

Worktrees should inherit permissions from their parent project:
- Trust state from the main project applies to all its worktrees
- Tool patterns from the main project's `.claude/settings.local.json` are used
- New approvals in a worktree are saved to the main project's settings file
- User experience is seamless - no redundant trust dialogs or re-approvals

## Technical Analysis

### Key Components Involved

1. **PermissionService** (`packages/electron/src/main/services/PermissionService.ts`)
   - Stores trust state per workspace path using `getAgentPermissions(workspacePath)` / `saveAgentPermissions(workspacePath)`
   - Uses the full workspace path as the storage key

2. **ClaudeSettingsManager** (`packages/electron/src/main/services/ClaudeSettingsManager.ts`)
   - Reads/writes `.claude/settings.local.json` relative to workspace path
   - Methods like `addAllowedTool(workspacePath, pattern)` use the path directly

3. **ClaudeCodeProvider** (`packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts`)
   - Uses injected callbacks that accept `workspacePath`:
     - `trustChecker(workspacePath)` - checks if workspace is trusted
     - `claudeSettingsPatternSaver(workspacePath, pattern)` - saves approved patterns
     - `claudeSettingsPatternChecker(workspacePath, pattern)` - checks if pattern is allowed
   - Currently passes the worktree path for worktree sessions

4. **AIService** (`packages/electron/src/main/services/ai/AIService.ts`)
   - Resolves `worktreePath` from `worktreeId` when creating sessions
   - Uses `effectiveWorkspacePath = session.worktreePath || workspacePath`

5. **PermissionHandlers** (`packages/electron/src/main/ipc/PermissionHandlers.ts`)
   - All IPC handlers accept `workspacePath` and use it directly

6. **WorktreeStore** (`packages/electron/src/main/services/WorktreeStore.ts`)
   - Can map worktree path back to project via `projectPath` field

### Path Resolution Strategy

Need a utility to resolve worktree paths to their parent project:

```typescript
// Option A: Use git command (most accurate)
async function resolveProjectPath(workspacePath: string): Promise<string> {
  const git = simpleGit(workspacePath);
  const gitDir = await git.revparse(['--git-dir']);
  // If it's a worktree, gitDir points to main repo
  // e.g., "/path/to/project/.git/worktrees/swift-falcon"
  // Parse to get "/path/to/project"
}

// Option B: Use naming convention (fast, no git call)
function resolveProjectPath(workspacePath: string): string {
  // Match pattern: /{project}_worktrees/{name}/
  const match = workspacePath.match(/^(.+)_worktrees\/[^/]+\/?$/);
  return match ? match[1] : workspacePath;
}

// Option C: Use database lookup (requires DB access)
async function resolveProjectPath(workspacePath: string): Promise<string> {
  const worktree = await worktreeStore.getByPath(workspacePath);
  return worktree?.projectPath ?? workspacePath;
}
```

**Recommendation**: Option B (naming convention) is preferred because:
- No async operations needed
- Works without database access
- Matches our worktree creation pattern exactly
- Can be used in both main and runtime packages

## Implementation Plan

### Phase 1: Add Path Resolution Utility

Create a shared utility function that resolves worktree paths to parent project paths.

**Files to modify:**
- `packages/core/src/utils/path.ts` (new file or add to existing)

**Implementation:**
```typescript
/**
 * Resolve a workspace path to its parent project path.
 * If the path is a worktree (matches {project}_worktrees/{name}/ pattern),
 * returns the parent project path. Otherwise returns the original path.
 */
export function resolveProjectPath(workspacePath: string): string {
  // Match pattern: /{project}_worktrees/{name}/ or /{project}_worktrees/{name}
  const match = workspacePath.match(/^(.+)_worktrees\/[^/]+\/?$/);
  return match ? match[1] : workspacePath;
}

/**
 * Check if a path is a worktree path.
 */
export function isWorktreePath(path: string): boolean {
  return /_worktrees\/[^/]+\/?$/.test(path);
}
```

### Phase 2: Update PermissionService

Modify trust state operations to use the resolved project path.

**Files to modify:**
- `packages/electron/src/main/services/PermissionService.ts`

**Changes:**
1. Import path resolution utility
2. Resolve worktree paths to project paths in all methods:
   - `trustWorkspace()`
   - `revokeWorkspaceTrust()`
   - `isWorkspaceTrusted()`
   - `getPermissionMode()`
   - `setPermissionMode()`

### Phase 3: Update ClaudeSettingsManager

Modify settings file operations to use the resolved project path.

**Files to modify:**
- `packages/electron/src/main/services/ClaudeSettingsManager.ts`

**Changes:**
1. Import path resolution utility
2. Resolve paths in methods that determine file paths:
   - `getProjectSharedPath()` - resolve before joining
   - `getProjectLocalPath()` - resolve before joining
   - `getEffectiveSettings()`
   - `addAllowedTool()`
   - `removeAllowedTool()`
   - `addAdditionalDirectory()`
   - `removeAdditionalDirectory()`
   - `watchSettings()`
   - `isPatternAllowedLocally()`
   - `getLocalPatterns()`
   - `getSharedPatterns()`

### Phase 4: Update Permission Handlers

Modify IPC handlers to resolve paths before operations.

**Files to modify:**
- `packages/electron/src/main/ipc/PermissionHandlers.ts`

**Changes:**
1. Import path resolution utility
2. Resolve `workspacePath` at the start of each handler
3. Use resolved path for all operations
4. Broadcast changes to both worktree path and project path

### Phase 5: Update ClaudeCodeProvider Callbacks

Ensure the injected callbacks receive the correct path.

**Files to modify:**
- `packages/electron/src/main/services/ai/AIService.ts`

**Changes:**
1. When injecting callbacks into ClaudeCodeProvider, wrap them to resolve paths
2. OR: Always pass the main project path for permission checks, not worktree path

**Key consideration:** The callbacks are injected once at startup, so the path resolution should happen when the callbacks are invoked with a workspacePath, not when they're injected.

### Phase 6: Update Renderer Components

Ensure permission UI uses the correct project path.

**Files to check:**
- `packages/electron/src/renderer/components/AgenticCoding/AgentSessionHeader.tsx`
- `packages/electron/src/renderer/components/Permissions/ProjectTrustToast.tsx`
- `packages/electron/src/renderer/components/Permissions/TrustIndicator.tsx`
- `packages/electron/src/renderer/components/Settings/ProjectPermissionsPanel.tsx`

**Changes:**
1. Add a renderer-side path resolution utility
2. Use resolved path when calling permission IPC handlers
3. OR: Have the main process handle resolution (preferred - single source of truth)

### Phase 7: Add Worktree-Specific Additional Directories

When running in a worktree, automatically add the worktree path as an additional directory.

**Rationale:**
- Claude Code's cwd is the worktree path
- But settings are read from the main project
- Need to ensure worktree directory is accessible for file operations

**Files to modify:**
- `packages/electron/src/main/services/ai/AIService.ts` (where additionalDirectoriesLoader is set)

**Changes:**
1. When loading additional directories for a worktree session, include:
   - The worktree path itself
   - The main project path (if different)
   - Any additional directories from settings

## Testing Strategy

### Unit Tests

1. **Path resolution utility tests**
   - Regular paths return unchanged
   - Worktree paths resolve to parent project
   - Edge cases: trailing slashes, nested paths

2. **PermissionService tests**
   - Trust set on project applies to worktree
   - Trust set on worktree applies to project
   - Permission mode inheritance

3. **ClaudeSettingsManager tests**
   - Settings from project are used for worktree
   - Patterns saved in worktree go to project file
   - Additional directories are merged correctly

### E2E Tests

1. **Trust flow with worktree**
   - Trust project, create worktree session, verify no trust dialog
   - Create worktree session first, trust it, verify project is trusted

2. **Pattern approval in worktree**
   - Approve pattern in worktree session with "Always"
   - Verify pattern appears in project's `.claude/settings.local.json`
   - Verify pattern works in subsequent project sessions

3. **Permission UI in worktree**
   - Permission settings panel shows correct patterns
   - Changes in worktree reflect in project
   - Trust indicator shows correct state

## Security Considerations

1. **Path validation**: Ensure resolved project path is valid and not manipulated
2. **Trust isolation**: Worktrees from different projects should not share trust
3. **Pattern scope**: Patterns approved for a worktree apply to all sessions of that project
4. **Audit logging**: Log when permission resolution occurs for debugging

## Migration

No data migration required. The change is backward compatible:
- Existing project trust continues to work
- Existing patterns continue to work
- Worktrees created before this change will start inheriting on next session

## Open Questions

1. **Should worktrees be able to have different permission modes than their parent?**
   - Current proposal: No, they inherit. Simpler UX.
   - Alternative: Allow override, store separately with inheritance.

2. **What about the `.claude/settings.json` (shared, committed) file?**
   - Current proposal: Also resolve to project path
   - This means team settings work correctly in worktrees

3. **Should we show an indicator that permissions are inherited?**
   - Could add "(inherited from project)" label in permission UI
   - Low priority, can be added later

## Success Criteria

1. Creating a worktree session for a trusted project shows no trust dialog
2. Tool patterns approved for the project work in worktree sessions
3. Patterns approved in a worktree session are saved to the project's settings
4. Permission settings UI works correctly when in a worktree context
5. No regression in non-worktree permission behavior
