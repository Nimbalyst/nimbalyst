---
planStatus:
  planId: plan-file-edits-directory-grouping
  title: File Edits Directory Grouping and Collapsing
  status: in-review
  planType: feature
  priority: medium
  owner: ghinkle
  stakeholders: []
  tags:
    - ui
    - file-management
    - ux-improvement
  created: "2026-01-13"
  updated: "2026-01-13T18:00:00.000Z"
  progress: 100
  startDate: "2026-01-13"
---
# File Edits Directory Grouping and Collapsing

## Implementation Progress

- [x] Add control bar UI with three toggle buttons
- [x] Implement directory tree builder with path parsing logic
- [x] Add path collapsing algorithm for single-child directories
- [x] Create recursive directory node rendering component
- [x] Update FileEditsSidebar with control bar and conditional rendering
- [x] Add CSS styling for controls and directory nodes
- [x] Update FileGutter for horizontal layout
- [x] Handle edge cases (root-level files, deep nesting, single files)
- [x] Test with various project structures
- [x] Verify git status and metadata display still works

## Overview

Enhance the file edits display system (FileEditsSidebar and FileGutter) with directory-based grouping capabilities to minimize screen real estate and improve file organization visualization.

## Current State

Two integrated components display edited files:
- **FileEditsSidebar**: Right-side panel in agent mode (`packages/runtime/src/ui/AgentTranscript/components/FileEditsSidebar.tsx`)
- **FileGutter**: Bottom panel in chat mode (`packages/electron/src/renderer/components/AIChat/FileGutter.tsx`)

Both currently group files by type (Edited, Referenced, Read) but display files as a flat list within each section.

## Goals

1. Add directory-based grouping option with intelligent path collapsing
2. Provide toggle controls for grouping mode and expand/collapse all
3. Minimize screen real estate by showing collapsed directory paths
4. Maintain existing functionality (git status, line counts, operation icons)

## User Interface Changes

### Control Bar

Add a toolbar above the file list with icon-only toggle buttons:

```
[🗂️] Group by Directory    [⊞] Expand All    [⊟] Collapse All
```

Controls:
- **Group by Directory** - Toggle between flat list and directory grouping
- **Expand All** - Expand all directory folders (enabled only in directory mode)
- **Collapse All** - Collapse all directory folders (enabled only in directory mode)

### Directory Grouping Behavior

When "Group by Directory" is enabled:

1. **Collapse shared paths** - Show only the minimal path needed to distinguish files
  - Example: Files in `src/components/table/` appear under a single folder node `src/components/table`
  - Files in different subdirs create separate folder nodes

2. **Hierarchical structure** - Break up paths as necessary
```
   services/voice                    3 files
     ├─ RealtimeAPIClient.ts
     ├─ VoiceModeService.ts
     └─ VoiceModeSettingsHandler.ts

   renderer/components               3 files
     ├─ Settings                     2 files
     │  ├─ SettingsView.tsx
     │  └─ VoiceModePanel.tsx
     └─ UnifiedAI                    1 file
        └─ VoiceModeButton.tsx
```

3. **File count indicators** - Show count next to each folder
4. **Collapsible folders** - Click chevron to expand/collapse
5. **Preserve metadata** - Operation icons, git status, line counts still visible on files

### Flat List Mode (Default)

When "Group by Directory" is disabled, maintain current behavior:
- Files listed directly under their type section (Edited, Referenced, Read)
- No folder grouping
- Expand All/Collapse All buttons disabled

## Technical Design

### Data Structure

Add new state and computed values:

```typescript
// View state
const [groupByDirectory, setGroupByDirectory] = useState(false);
const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

// Computed directory tree structure
interface DirectoryNode {
  path: string;           // Full directory path
  displayPath: string;    // Collapsed path for display
  files: FileEditSummary[];
  subdirectories: Map<string, DirectoryNode>;
  fileCount: number;      // Total files in this dir and subdirs
}
```

### Path Collapsing Algorithm

1. **Build directory tree** from file paths
2. **Identify common prefixes** within each type section
3. **Collapse single-child paths**:
  - If a directory has only one subdirectory and no files, merge them
  - `src/` → `components/` → `table/` becomes `src/components/table/`
4. **Split at branching points**:
  - When a directory has multiple subdirectories or files, create separate nodes

### Component Changes

#### FileEditsSidebar.tsx

Add:
- Control bar component with three toggle buttons
- `buildDirectoryTree()` function to create hierarchical structure
- `renderDirectoryNode()` recursive function to render folders and files
- State management for grouping mode and expanded folders
- Preserve existing git status fetching and metadata display

#### FileGutter.tsx

Same changes adapted for horizontal layout:
- May need to consider if directory grouping works well in horizontal space
- Could limit depth or use a different visual treatment

### Styling

New CSS classes needed:
- `.file-edits-sidebar__controls` - Control bar container
- `.file-edits-sidebar__control-button` - Individual toggle buttons
- `.file-edits-sidebar__directory-node` - Directory folder item
- `.file-edits-sidebar__directory-header` - Folder name and count
- `.file-edits-sidebar__directory-children` - Nested files/folders
- `.file-edits-sidebar__directory-indent` - Indentation for hierarchy

## Implementation Steps

1. **Add control bar UI**
  - Create control button component
  - Wire up state toggles
  - Add CSS for button styling

2. **Implement directory tree builder**
  - Write path parsing and tree construction logic
  - Add path collapsing algorithm
  - Calculate file counts

3. **Create directory rendering**
  - Recursive component for folders
  - Preserve file rendering from existing code
  - Add expand/collapse interaction

4. **Update FileEditsSidebar**
  - Integrate control bar
  - Add conditional rendering (flat vs grouped)
  - Test with various file structures

5. **Update FileGutter**
  - Adapt changes for horizontal layout
  - Consider space constraints
  - Test in chat mode

6. **Polish and edge cases**
  - Handle empty states
  - Root-level files (no directory)
  - Very deep nesting
  - Single file in directory

## Edge Cases

- **Root-level files**: Files without directories shown at top level
- **Deep nesting**: May need max depth limit or visual treatment
- **Single file in folder**: Should folder be shown or collapsed away?
- **Mixed sections**: Each type section (Edited, Referenced, Read) gets its own tree
- **Path resolution**: Ensure relative paths work correctly with workspace root

## Testing Considerations

- Test with various project structures (shallow, deep, mixed)
- Verify git status still loads correctly
- Check performance with large file lists
- Ensure expand/collapse states persist during file updates
- Test keyboard navigation accessibility
- Verify both FileEditsSidebar and FileGutter implementations

## Dependencies

- Existing FileEditsSummary interface (no changes needed)
- Git status fetching (preserve existing functionality)
- MaterialSymbol icon component (for folder icons)

## Future Enhancements

- Remember user's grouping preference per workspace
- Add search/filter within file lists
- Show directory-level git status summary
- Quick actions on folders (open all, compare all)
