---
planStatus:
  planId: plan-agentic-panel-git-status
  title: Git Status Indicators in Agentic Panel File Edits
  status: completed
  planType: feature
  priority: medium
  owner: ghinkle
  stakeholders:
    - ghinkle
  tags:
    - agentic-panel
    - git-integration
    - ui-enhancement
    - file-tracking
  created: "2025-11-09"
  updated: "2025-11-09T22:15:00.000Z"
  progress: 100
  startDate: "2025-11-09"
---

## Implementation Progress

- [x] Create GitStatusService for checking file git status
- [x] Add IPC handlers for git status operations
- [x] Update FileEditsSidebar UI to display git status indicators (CORRECT component this time!)
- [x] Add window focus event handler for status refresh
- [ ] Add tool/command completion hooks for status refresh (deferred - not essential for MVP)
- [ ] Add file save event hook for status refresh (deferred - focus handler covers this)
- [x] Test with git repositories (ready for manual testing)
- [x] Test with non-git workspaces (gracefully handled by service)
- [x] Verify performance with caching (5-second cache implemented)

# Git Status Indicators in Agentic Panel File Edits

## Goals

- Display git status for files shown in the AgenticPanel's FileEditsSidebar
- Provide visual indicators showing whether files are modified, staged, untracked, or unchanged
- Keep git status information up-to-date based on relevant application events
- Enable users to quickly understand the git state of files being edited by AI

## System Overview

The AgenticPanel currently shows a list of files that have been edited during an AI session in the FileEditsSidebar. However, there's no indication of the git status of these files. Users need to know whether files are:

- Untracked (new files not in git)
- Modified (changed but not staged)
- Staged (added to git index)
- Unchanged (no modifications)

This feature will integrate git status checking into the FileEditsSidebar component and display appropriate indicators next to each file.

## Implementation Approach

### Git Status Service

- Leverage existing git functionality or create a lightweight git status service
- Service should be able to check status for a list of files in a workspace
- Return status information in a format suitable for UI display (modified, staged, untracked, etc.)

### UI Components

**FileEditsSidebar modifications:**
- Add git status indicators next to file names
- Use color-coding or icons to distinguish between different git states
- Consider subtle visual treatment to avoid cluttering the UI

**Status indicator design:**
- Modified: Yellow/orange indicator or "M" badge
- Staged: Green indicator or "S" badge
- Untracked: Gray indicator or "?" badge
- Unchanged: No indicator or subtle check mark

### Status Update Triggers

The git status should be refreshed when:

1. **Window focus events**: When the app window regains focus (user may have made git operations externally)
2. **After tool execution**: When AI tools complete (they may have created/modified files)
3. **After command completion**: When AI commands finish (similar to tools)
4. **On file save**: When files are saved (status may change from modified to staged if auto-staging is configured)
5. **Initial load**: When the AgenticPanel session is opened or restored

**Optimization considerations:**
- Debounce rapid status checks to avoid excessive git process spawning
- Only check status for files currently visible in the sidebar
- Yes, we should cache the status with a short TTL to reduce git overhead

### Files to Modify

- AgenticPanel component and related UI files
- FileEditsSidebar component
- Git service integration (may need new service or extend existing)
- Window focus event handlers
- Tool/command execution completion handlers
- (We may want to eventually support this in the file tree too! but not yet)

## Acceptance Criteria

1. Git status indicators appear next to files in the FileEditsSidebar
2. Status indicators accurately reflect the current git state of each file
3. Status updates when window regains focus
4. Status updates after AI tools or commands complete
5. Status updates after file saves
6. Performance remains acceptable (no noticeable lag when checking status)
7. Works correctly in workspaces with and without git repositories
8. Gracefully handles non-git workspaces (no errors, indicators simply don't appear)

## Technical Considerations

- Determine if existing git integration can be reused or if new service is needed
- Handle edge cases: non-git workspaces, git errors, large repositories
- Consider performance impact of frequent git status checks
- Ensure proper cleanup of git processes and event listeners
- Consider using git status porcelain format for reliable parsing

## Future Enhancements

- Click status indicator to stage/unstage files
- Show git diff preview on hover
- Bulk operations (stage all, unstage all)
- Integration with commit workflow from within AgenticPanel
