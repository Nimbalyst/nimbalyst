---
planStatus:
  planId: plan-files-edited-sidebar-color-redesign
  title: Files Edited Sidebar - Color-Based Status Redesign
  status: in-review
  planType: improvement
  priority: medium
  owner: ghinkle
  stakeholders: []
  tags:
    - agent-mode
    - ux
    - file-sidebar
  created: "2026-01-26"
  updated: "2026-01-26T19:20:00.000Z"
  progress: 100
  startDate: "2026-01-26"
---

# Files Edited Sidebar - Color-Based Status Redesign

## Implementation Progress

- [x] Add CSS variables for file status colors (new, edited, deleted, committed) to theme system
- [x] Update FileEditsSidebar.tsx to use text colors instead of operation icons
- [x] Remove git badge display (M/S/?/D letters)
- [x] Hide line stats by default (remove from display)
- [x] Implement color transition when files are committed (colored -> gray)
- [x] Add strikethrough styling for deleted files
- [x] Add hover tooltips showing file status details
- [x] Keep pending review banner (keep existing implementation)
- [x] Add context menu with "Open in Files", "View Diff", "Copy Path", "Reveal in Finder"
- [x] Test in dark mode and light mode

## Problem Statement

The current FilesEditedSidebar component displays file status using multiple icons (pending review icon, operation icon, git badge), which creates visual clutter and makes the list hard to scan. Users want a cleaner approach that:

1. Uses subtle text colors instead of icons to indicate file status
2. Works across a series of commits (files stay in list even after commit)
3. Clearly distinguishes between "has uncommitted changes" vs "fully committed"
4. Works in non-git repos using the pending-review system as the status indicator

## Current State

The existing implementation shows:
- Pending review icon (amber rate_review icon)
- Operation icon (green/blue/red add_circle/edit/delete icons)
- Git badge (M/S/?/D letters in colored boxes)
- File name
- Line stats (+/-)

This results in 3-4 visual elements competing for attention before the filename.

## Design Goals

1. **Reduce visual clutter**: Remove redundant icons, use text color as primary indicator
2. **Readable colors**: Use muted/pastel shades that don't strain the eyes
3. **Multi-commit workflow**: Support files staying in list across commits with appropriate status changes
4. **Non-git support**: Use pending-review status when git is unavailable
5. **Deleted file handling**: Show deleted files appropriately even after commit

## Proposed Color System

### Primary Status (Text Color)

The file name color should indicate whether the file has **uncommitted/unreviewed changes**:

| State | Color | When |
|-------|-------|------|
| Has changes | Muted blue | File has uncommitted changes (git) or pending review (non-git) |
| Committed/Kept | Default gray | All changes have been committed or "kept" |

### Operation Type Indicator

Rather than using color for operation type, we could:

**Option A: Small prefix character**
- `+` for new files
- `~` for edited files
- `-` for deleted files
- Shown in the same color as the filename

**Option B: No operation indicator**
- Let the line stats (+/- lines) imply the operation
- New files have only additions
- Edited files have both
- Deleted files are a special case (see below)

**Option C: Subtle icon only for create/delete**
- Keep small icon for truly new files and deleted files
- No icon for edits (the most common case)

### Handling Deleted Files

Deleted files present unique challenges:
1. After deletion but before commit: Show with red text color, strikethrough optional
2. After commit: Should they disappear from the list? Or stay with a "tombstone" style?

**Recommendation**: Deleted files should:
- Stay in list until session ends (so user remembers what was deleted)
- Use muted red/pink text with optional strikethrough
- Turn to gray+strikethrough after commit (showing it was successfully deleted and committed)

### Non-Git Repos

In non-git repos, we use "pending review" status as the indicator:
- **Pending review** = File has changes that haven't been "kept" yet
- **Kept** = User has accepted/reviewed the changes

This maps cleanly to the git model:
- Pending review = "has uncommitted changes" (colored)
- Kept = "committed" (gray)

## Visual Mockup Requirements

The mockup should show:

1. **Side-by-side comparison**: Current icon-heavy design vs proposed color-based design
2. **Multi-commit flow**:
   - State 1: Several files with uncommitted changes (colored)
   - State 2: After committing some files (those turn gray, others stay colored)
   - State 3: New changes to a committed file (turns colored again)
3. **Deleted file lifecycle**:
   - Before commit: Red/muted-red text
   - After commit: Gray + strikethrough
4. **Non-git repo variant**: Showing "pending review" vs "kept" states

## Color Palette (Muted/Readable)

Using the `--nim-*` variables as base, with adjustments for readability:

```css
/* For light themes */
--file-status-changed: color-mix(in srgb, var(--nim-primary) 70%, var(--nim-text));
--file-status-new: color-mix(in srgb, var(--nim-success) 70%, var(--nim-text));
--file-status-deleted: color-mix(in srgb, var(--nim-error) 70%, var(--nim-text));
--file-status-committed: var(--nim-text-muted);

/* For dark themes - may need different mixing ratios */
```

The key is that colors should be:
- Noticeable but not harsh
- Readable as text (not just accent spots)
- Distinguishable from each other

## Design Decisions

1. **Line stats hidden by default** - Non-technical users find them confusing. Could be an optional setting for developers.

2. **Integrated commit checkboxes** - In Manual and Worktree modes, show checkboxes inline in the file tree instead of a separate staging list. This unifies the file list with git staging.
   - Checkboxes only appear on files with uncommitted changes
   - Hidden (or removed) for already-committed files

3. **Context menu** - Right-click on any file shows:
   - "Open in Files" - Opens file in main Files mode
   - "View Diff" - Shows git diff
   - "Copy Path" - Copies file path
   - "Reveal in Finder" - Opens in system file browser

4. **Color distinction** - Keep separate colors for new (teal-green) vs edited (blue) files:
   - Teal-green (#4fd1c5 dark / #0d9488 light) for new files
   - Blue (#60a5fa dark / #2563eb light) for edited files
   - Red (#f87171 dark / #dc2626 light) + strikethrough for deleted
   - Gray for committed/kept files

5. **Mode variations**:
   - **Agent Mode**: Simple view, no checkboxes (git operations handled by agent)
   - **Manual/Worktree Mode**: Checkboxes for selecting files to commit

## Resolved Questions

1. **Pending review banner** - Keep the amber "X files pending review" banner with "Keep All" button

2. **Hover behavior** - Add tooltips showing details like "Created in this session, uncommitted"

## Implementation Notes

Changes will span:
- `packages/runtime/src/ui/AgentTranscript/components/FileEditsSidebar.tsx` - Core rendering
- `packages/electron/src/renderer/components/AgentMode/FilesEditedSidebar.tsx` - Data fetching
- May need new IPC to check if workspace is a git repo

## Visual Mockup

![Files Edited Sidebar V2](screenshot.png){mockup:../mockups/files-edited-sidebar-v2.mockup.html}

The mockup shows four sections:
1. **Color Palette Reference** - All status colors with sample filenames
2. **Fresh Session** - All files with uncommitted changes (teal-green for new, blue for edited, red+strikethrough for deleted)
3. **After First Commit** - Mix of committed (gray) and still-pending files
4. **Re-edit After Commit** - Previously committed file returns to blue when re-edited

## Next Steps

1. Review mockup and finalize color choices
2. Decide on the open questions above
3. Implement in FileEditsSidebar component
