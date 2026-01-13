# Multiple Sessions Per Worktree

## Summary

Enable multiple AI sessions under a single worktree. Right-clicking a worktree shows "Add Session" option. The left bar displays worktrees as collapsible parents with sessions indented underneath.

## Current State

- Database already supports multiple sessions per worktree (`ai_sessions.worktree_id` -> `worktrees.id`)
- Sessions are displayed flat in time groups via `SessionHistory.tsx`
- `WorktreeSingle.tsx` shows a single worktree+session combo
- No UI for adding sessions to existing worktrees

## Implementation Plan

### 1. Create WorktreeGroup Component

**New file:** `packages/electron/src/renderer/components/AgenticCoding/WorktreeGroup.tsx`

A collapsible group for a worktree with its sessions as children:
- Worktree header row with expand/collapse chevron
- Worktree icon, name, and git status badges on header
- Right-click context menu with "Add Session" option
- Indented session list when expanded (16px indent)
- Each child session shows: provider icon, title, message count

```
[v] worktree-icon  swift-falcon  [2 ahead] [uncommitted]
     |-- claude  Implement auth feature  (12)
     |-- claude  Fix login bug  (5)
```

### 2. Update SessionHistory to Group by Worktree

**File:** `packages/electron/src/renderer/components/AgenticCoding/SessionHistory.tsx`

Changes:
1. Separate sessions into worktree vs non-worktree groups
2. Group worktree sessions by `worktree_id`
3. Fetch worktree metadata for each unique worktree
4. Render worktrees section at top using new `WorktreeGroup` component
5. Regular sessions below in existing time groups

New state:
```typescript
const [worktreeGroups, setWorktreeGroups] = useState<Map<string, {
  worktree: WorktreeWithStatus;
  sessions: SessionItem[];
}>>(new Map());
```

### 3. Add Session Creation Handler

**File:** `packages/electron/src/renderer/components/UnifiedAI/AgenticPanel.tsx`

Add `handleAddSessionToWorktree(worktreeId: string)` callback:
- Get worktree data via `worktreeGet(worktreeId)`
- Create session with `aiCreateSession()` passing `worktreeId`
- Use default provider: `claude-code:sonnet`
- Update tabs, refresh session list

Pass this callback down to `SessionHistory` -> `WorktreeGroup`.

### 4. Add SessionHistory Props

**File:** `packages/electron/src/renderer/components/AgenticCoding/SessionHistory.tsx`

Add new prop:
```typescript
onAddSessionToWorktree?: (worktreeId: string) => void;
```

### 5. Create WorktreeSessionChild Component (Optional)

**New file:** `packages/electron/src/renderer/components/AgenticCoding/WorktreeSessionChild.tsx`

Simplified session display for use within WorktreeGroup:
- Provider icon
- Session title (truncated)
- Message count
- Click to select, right-click for session actions (archive, delete)

Alternatively, reuse `SessionListItem` with modified styling.

### 6. Add Styling

**New file:** `packages/electron/src/renderer/components/AgenticCoding/WorktreeGroup.css`

- Worktree header styling (height 32px)
- Expand/collapse chevron animation
- Indented session list (padding-left: 16px)
- Git status badges
- Hover and active states

## Files to Modify

| File | Changes |
|------|---------|
| `packages/electron/src/renderer/components/AgenticCoding/WorktreeGroup.tsx` | **New** - Collapsible worktree component with context menu |
| `packages/electron/src/renderer/components/AgenticCoding/WorktreeGroup.css` | **New** - Styling for worktree groups |
| `packages/electron/src/renderer/components/AgenticCoding/SessionHistory.tsx` | Group sessions by worktree, render WorktreeGroups at top |
| `packages/electron/src/renderer/components/UnifiedAI/AgenticPanel.tsx` | Add `handleAddSessionToWorktree` callback |

## Design Decisions

1. **Worktrees at top section** - More discoverable, matches mental model of worktrees as long-running environments
2. **Default provider for new sessions** - Use `claude-code:sonnet` for simplicity; user can change after creation
3. **Collapsed state persistence** - Use existing `collapsedGroups` pattern for consistency
4. **Reuse existing components** - `CollapsibleGroup` pattern, existing context menu styling

## Out of Scope

- Context menu actions other than "Add Session" (delete worktree, etc.)
- Drag and drop sessions between worktrees
- Provider picker when adding session
