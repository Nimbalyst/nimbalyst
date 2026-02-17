---
planStatus:
  planId: plan-flat-virtualized-file-tree
  title: Flat Virtualized File Tree
  status: in-development
  planType: refactor
  priority: high
  owner: ghinkle
  stakeholders: []
  tags:
    - file-tree
    - performance
    - architecture
    - gitignore
    - lazy-loading
    - keyboard-navigation
    - drag-drop
    - accessibility
  created: "2026-02-16"
  updated: "2026-02-17T01:00:00.000Z"
  progress: 65
---
# Flat Virtualized File Tree

## Implementation Progress

- [x] Step 3: Tree Model Atoms -- `fileTreeItemsAtom`, `selectedPathsAtom`, `lastSelectedPathAtom`, `focusedIndexAtom`, `dragStateAtom`, `visibleNodesAtom`, `flattenTree()` pure function
- [x] Step 4: FlatFileTree Component + Row Renderer -- `FlatFileTree.tsx` (Virtuoso), `FileTreeRow.tsx` (memoized row with git status indicators)
- [x] Step 5: Keyboard Navigation -- `treeKeyboardHandler.ts` with arrow keys, enter, space, F2 rename, delete, home/end, page up/down, cmd+a, escape, type-ahead find, shift+arrow range selection
- [x] Step 6: Inline Rename -- F2 triggers inline `<input>`, auto-selects filename without extension, enter/escape/blur handling
- [x] Step 7: Drag-Drop Internal -- move/copy with Alt/Cmd modifier, auto-scroll near edges (40px rAF loop), expand-on-hover (500ms timer), prevent drop into own children
- [x] Step 8 partial: Drag-Drop External In -- files dragged from Finder are copied into target directory
- [x] Step 9: Reveal + Scroll -- expand parents + `scrollToIndex`, auto-scroll on active file change with interaction suppression
- [x] Step 11: WorkspaceSidebar wired up -- `<FlatFileTree>` replaces `<FileTree>`, items synced to atom via `store.set()`
- [x] Step 12: CSS -- `.file-tree-container`, `.focused` outline, `.file-tree-rename-input` styles
- [x] Step 13: Old FileTree removed -- `FileTree.tsx` deleted (889 lines), no remaining imports
- [x] ARIA accessibility -- `role="tree"`, `role="treeitem"`, `aria-expanded`, `aria-selected`, `aria-level`
- [ ] Step 1: WorkspaceIgnore + Gitignore Integration -- not started (main process `WorkspaceIgnore` class, `isGitignored` marking, watcher integration)
- [ ] Step 2: Lazy Loading IPC -- not started (`getFolderContents` depth parameter, `folder-contents-loaded` event, sparse tree model)
- [ ] Step 8 remaining: Native drag-out to Finder -- not started (`webContents.startDrag`, IPC handler)
- [ ] Step 10: Show Ignored Files Toggle -- not started (depends on Step 1)
- [x] Central IPC listener for file tree -- `fileTreeListeners.ts` subscribes to `onWorkspaceFileTreeUpdated`, writes `rawFileTreeAtom`; WorkspaceSidebar reads from atom via `useAtomValue`

### Files Changed

**New files:**
- `packages/electron/src/renderer/components/FlatFileTree.tsx` -- flat virtualized tree component
- `packages/electron/src/renderer/components/FileTreeRow.tsx` -- memoized row renderer with inline rename
- `packages/electron/src/renderer/utils/treeKeyboardHandler.ts` -- keyboard navigation handler

**Modified files:**
- `packages/electron/src/renderer/store/atoms/fileTree.ts` -- new atoms and `flattenTree()` pure function
- `packages/electron/src/renderer/store/index.ts` -- re-exports for new atoms/types
- `packages/electron/src/renderer/components/WorkspaceSidebar.tsx` -- uses `<FlatFileTree>` instead of `<FileTree>`
- `packages/electron/src/renderer/index.css` -- file tree container, focused, rename styles

**Deleted files:**
- `packages/electron/src/renderer/components/FileTree.tsx` -- old recursive component (889 lines)

## Problem

The current `FileTree` component is a recursive React component where each directory level creates a new `<FileTree>` instance with its own hooks. This architecture has fundamental issues:

1. **State fragmentation**: Expanded dirs, selection, drag state, and scroll behavior are scattered across Jotai atoms, local useState, and prop-drilling (`sharedExpandedDirs`, `sharedSelectionState`, `sharedDragState`)
2. **No virtualization**: Every node in the tree is a real DOM element. For large repos this means thousands of DOM nodes
3. **Reveal is broken**: Programmatic reveal (breadcrumb click, quick-open) requires expanding parent dirs AND having the target in the `items` data AND waiting for React to recursively render intermediate components. This chain is fragile and currently broken
4. **Recursive re-renders**: Any state change (expand/collapse, selection, drag) re-renders the entire tree from the changed level down
5. **Fixed-height rows (28px) already exist** in CSS but aren't leveraged for virtualization
6. **Full tree loaded upfront**: `getFolderContents()` recursively builds the entire tree (up to 10k items, 8 levels deep) on workspace open and every file change, even for directories the user never expands
7. **No gitignore awareness**: Gitignored files appear in the file tree and are searchable. The watcher and tree builder use a hardcoded exclusion list duplicated in 5 formats in `fileFilters.ts`, while every other IDE respects `.gitignore`. Large gitignored directories (e.g. `site/@hubspot`) cause EMFILE errors
8. **No keyboard navigation**: Zero keyboard support -- no arrow keys, no enter to open, no F2 to rename, no delete key, no tabIndex, no focus management. Users cannot navigate the file tree without a mouse.
9. **Incomplete drag-drop**: Internal drag-move works but missing: auto-scroll near edges, expand-folder-on-hover during drag, drag files out to Finder, drag files in from Finder

## How VS Code Does It

VS Code uses a **flat virtualized list**:

- The tree model is a separate data structure that manages nodes, parent-child relationships, expanded state
- The **visible** nodes are flattened into a single array based on which directories are expanded
- A single flat list component renders only the rows visible in the viewport (virtual scrolling)
- Each row is indented based on its depth (CSS `padding-left`)
- Expand/collapse recalculates the flat array -- no recursive component mounting
- Reveal = expand parents in the model + find the node's index in the flat array + scroll to that index

## Design

### Architecture

```
Main Process                      Renderer
==========================        ================================================
WorkspaceIgnore (.gitignore)      Tree Model (Jotai atoms)     Flat List (derived)     Renderer (Virtuoso)
  |                               ========================     ===================     ===================
  v                               fileTreeAtom (raw tree) -->  visibleNodesAtom  --->  <Virtuoso> single list
getFolderContents(dir, depth:1)   expandedDirsAtom        -->  (filters expanded)      row renderer with indent
  |                               selectedPathsAtom                                    28px fixed height per row
  v                               dragStateAtom
IPC: folder-contents-loaded       revealRequestAtom
```

Four clean layers:
1. **Ignore Filter** (main process): `WorkspaceIgnore` reads `.gitignore` and provides `isIgnored(path)` used by the watcher and tree builder. Gitignored files are still loaded but marked as ignored -- hidden by default, searchable via toggle (like VS Code).
2. **Tree Model** (atoms): Raw tree structure + UI state (expanded, selected, drag). Source of truth. Directories can have `children: undefined` (not yet loaded) vs `children: []` (loaded, empty). No rendering concerns.
3. **Visible Nodes** (derived atom): A flat `FlatTreeNode[]` array computed from the tree + expanded state. This is the only thing the renderer sees.
4. **Renderer** (single component): One `<Virtuoso>` component renders the visible rows. Each row gets a `FlatTreeNode` with depth for indentation. No recursion.

### Lazy Loading

Instead of recursively building the entire tree upfront, the main process only loads one level at a time:

1. **On workspace open**: Load root directory contents (depth 1 only). Directories have `children: undefined`.
2. **On folder expand**: Renderer requests contents for that directory via IPC. Main process returns one level. Children get merged into `fileTreeAtom`.
3. **File watcher**: Only watches expanded directories (already the case with `OptimizedWorkspaceWatcher`). When changes are detected, re-fetches that single directory's contents.
4. **Reveal**: When revealing a file in a collapsed directory, expand parents one at a time, fetching each level's contents before proceeding to the next.

This means the tree in memory is a sparse structure -- only the paths the user has actually navigated contain loaded children.

### Gitignore Filtering

Gitignored files are **loaded but hidden by default**, matching VS Code behavior:

1. **`WorkspaceIgnore`** class (from `plans/gitignore-aware-file-watching.md`) reads `.gitignore` and provides `isIgnored(path)`.
2. **`getFolderContents`** still returns gitignored files but marks them: `{ ...item, isGitignored: true }`.
3. **`visibleNodesAtom`** filters out gitignored items by default.
4. **Toggle**: A "Show Ignored Files" toggle in the file tree header (similar to VS Code's "Toggle Excluded Files") adds them back, visually dimmed.
5. **Search**: Quick Open already uses ripgrep which respects `.gitignore` by default. The file tree search filter should also exclude gitignored files unless the toggle is on.

This approach avoids the EMFILE problem (watcher skips gitignored directories entirely) while still allowing users to see ignored files when needed.

### Keyboard Navigation

The flat list makes keyboard navigation straightforward -- it's just index math on `visibleNodes`. The current recursive component has zero keyboard support.

**Focus model**: A single `focusedIndexAtom` tracks which row has keyboard focus. The Virtuoso container gets `tabIndex={0}` and a single `onKeyDown` handler. Individual rows are not focusable -- focus stays on the container, and the focused row gets a visual ring via CSS class.

**Key bindings (matching VS Code):**

| Key | Action |
| --- | --- |
| `ArrowDown` | Move focus to next visible row |
| `ArrowUp` | Move focus to previous visible row |
| `ArrowRight` | If focused is collapsed directory: expand. If expanded directory: move focus to first child. If file: no-op. |
| `ArrowLeft` | If focused is expanded directory: collapse. If collapsed directory or file: move focus to parent directory. |
| `Enter` | Open file / toggle directory expand |
| `Space` | Preview file (open without replacing current tab, like VS Code's peek) |
| `F2` | Start inline rename on focused item |
| `Delete` / `Backspace` | Delete focused item(s) with confirmation |
| `Home` | Move focus to first row |
| `End` | Move focus to last row |
| `PageUp` | Move focus up by one viewport height |
| `PageDown` | Move focus down by one viewport height |
| `Cmd+A` | Select all visible items |
| `Escape` | Clear selection, cancel rename if active |
| Letter keys | Type-ahead find: jump to next item starting with typed character(s). Resets after 500ms of no typing. |

**Shift+Arrow**: Extends multi-selection while moving focus (shift+down selects current and moves down, like VS Code).

**Scroll follows focus**: When keyboard navigation moves focus outside the visible viewport, `virtuosoRef.scrollToIndex` keeps the focused row visible.

**Focus atom:**

```typescript
focusedIndexAtom: number | null  // index into visibleNodes, null = no focus
```

Focus is set on click (to the clicked row's index) and on keyboard nav. When `visibleNodes` recomputes (expand/collapse), the focused index is adjusted to keep the same path focused -- find the path's new index, or clamp to bounds if it was removed.

**Inline rename**: When F2 is pressed or "Rename" is selected from context menu, a `renamingPathAtom` is set. The `FileTreeRow` for that path renders an `<input>` instead of the name label. Enter confirms, Escape cancels. The input auto-selects the filename without extension (for files) or the full name (for directories).

### Drag and Drop

The flat list with Virtuoso needs a rethought drag-drop implementation. The current recursive component has basic internal drag-move, but we're going for full VS Code parity.

**Internal drag (move/copy between folders):**

Ported from current implementation with improvements:
- `onDragStart`: Sets `dragStateAtom` with source path(s). If multi-selected, drags all selected items. Creates a custom drag image showing count (e.g. "3 items").
- `onDragOver`: Highlights the drop target row. For directories: highlights the directory. For files: highlights the parent directory (drop between files = move into same folder).
- `onDrop`: Moves or copies (if Alt/Cmd held) files via IPC.
- **Alt/Cmd modifier**: Tracked via keydown/keyup on the container. Shows "(copy)" indicator on drop target and changes cursor.

**Auto-scroll while dragging:**

When dragging near the top or bottom edge of the Virtuoso container, auto-scroll the list:
- Top 40px zone: scroll up, speed increases closer to edge
- Bottom 40px zone: scroll down, speed increases closer to edge
- Uses `requestAnimationFrame` loop during drag, stopped on `dragend`/`drop`
- Virtuoso exposes `scrollTo()` for programmatic scrolling

```typescript
// In onDragOver handler
const rect = containerRef.current.getBoundingClientRect();
const y = e.clientY - rect.top;
const EDGE_ZONE = 40;

if (y < EDGE_ZONE) {
  autoScrollSpeed.current = -(1 - y / EDGE_ZONE) * 8; // pixels per frame
} else if (y > rect.height - EDGE_ZONE) {
  autoScrollSpeed.current = (1 - (rect.height - y) / EDGE_ZONE) * 8;
} else {
  autoScrollSpeed.current = 0;
}
```

**Expand folder on hover during drag:**

When hovering over a collapsed directory during a drag operation, expand it after a 500ms delay (matching VS Code). Timer resets if the cursor moves to a different target.

```typescript
const expandTimerRef = useRef<NodeJS.Timeout | null>(null);

// In onDragOver for a collapsed directory
if (node.type === 'directory' && !node.isExpanded) {
  if (expandTimerRef.current?.path !== node.path) {
    clearTimeout(expandTimerRef.current?.timer);
    expandTimerRef.current = {
      path: node.path,
      timer: setTimeout(() => toggleExpand(node.path), 500),
    };
  }
}
```

**Native drag-out (to Finder/desktop):**

Electron supports native file drag-out via `webContents.startDrag()`:

```typescript
// In onDragStart, for external drag support
if (e.dataTransfer) {
  // Set the file:// URL so Finder/other apps can receive it
  e.dataTransfer.setData('text/uri-list', `file://${node.path}`);
  e.dataTransfer.effectAllowed = 'copyMove';

  // Tell Electron to provide the native file to the OS drag system
  window.electronAPI.startNativeDrag(node.path);
}
```

Main process handler:
```typescript
ipcMain.handle('start-native-drag', (event, filePath: string) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  event.sender.startDrag({
    file: filePath,
    icon: nativeImage.createFromPath(getIconForFile(filePath)), // or a generic file icon
  });
});
```

Multi-file drag-out: When multiple items are selected, pass an array of paths to `startDrag({ files: [...paths] })`.

**Native drag-in (from Finder/desktop):**

Handle files dropped from external sources (Finder, other apps) onto the file tree:

```typescript
// On the Virtuoso container
onDrop={(e) => {
  const files = Array.from(e.dataTransfer.files);
  if (files.length > 0) {
    // External drop -- copy files into the target directory
    const targetDir = getDropTargetDir(e); // resolved from hovered row
    for (const file of files) {
      window.electronAPI.copyFileInto(file.path, targetDir);
    }
    return;
  }
  // Otherwise, internal drag-drop (existing logic)
}}
```

This gives full drag-in support -- users can drag images, documents, or any files from Finder directly into a folder in the tree.

**Drag state atom:**

```typescript
interface DragState {
  sourcePaths: string[];      // paths being dragged (single or multi-select)
  dropTargetPath: string | null; // directory highlighted as drop target
  isCopy: boolean;            // Alt/Cmd held = copy instead of move
  isExternal: boolean;        // drag originated from outside the app
}

dragStateAtom: DragState | null  // null = no drag in progress
```

### ARIA / Accessibility

The flat list structure makes proper ARIA straightforward:

```tsx
<div role="tree" aria-label="File Explorer" tabIndex={0} onKeyDown={handleKeyDown}>
  <Virtuoso
    itemContent={(index) => (
      <div
        role="treeitem"
        aria-expanded={node.isExpanded}  // only for directories
        aria-selected={node.isMultiSelected || node.isActive}
        aria-level={node.depth + 1}
        aria-setsize={siblingCount}
        aria-posinset={positionInParent}
        data-focused={index === focusedIndex}
      >
        ...
      </div>
    )}
  />
</div>
```

### Data Structures

```typescript
// Raw tree node (from main process)
interface FileTreeItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeItem[];  // undefined = not yet loaded, [] = loaded + empty
  isGitignored?: boolean;     // marked by WorkspaceIgnore
}

// Flat node for rendering (derived from tree + expanded state)
interface FlatTreeNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  depth: number;            // indentation level
  index: number;            // position in flat list (for keyboard nav)
  parentPath: string | null; // for ArrowLeft -> parent navigation
  hasChildren: boolean;     // show chevron
  isExpanded: boolean;      // chevron direction
  isLoading: boolean;       // children requested but not yet loaded
  isActive: boolean;        // currently open file
  isSelected: boolean;      // folder selection
  isMultiSelected: boolean; // multi-select
  isGitignored: boolean;    // dimmed styling
  isDragOver: boolean;      // drop target highlight
  isRenaming: boolean;      // inline rename active
}
```

### State Architecture

This plan follows the Jotai patterns from `docs/JOTAI.md` and `docs/IPC_LISTENERS.md`:

**No prop drilling.** The current FileTree passes `sharedExpandedDirs`, `sharedSelectionState`, `sharedDragState` as props through recursive component levels. All of these become Jotai atoms -- any component at any depth reads the atom directly.

**No component-level IPC subscriptions.** The current tree subscribes to `workspace-file-tree-updated` inside WorkspaceSidebar. The new approach adds a central listener in `store/listeners/fileTreeListeners.ts` that updates `fileTreeAtom` via `mergeChildrenAtom`. Components read from atoms, never from IPC.

**Derived atoms, not synced atoms.** `visibleNodesAtom` derives from `fileTreeAtom` + `expandedDirsAtom` + `showGitignoredAtom` etc. There is no manual sync code. When any source atom changes, the flat list recomputes automatically.

**UI-only atoms for transient state.** `focusedIndexAtom`, `dragStateAtom`, `renamingPathAtom`, `loadingDirsAtom`, `typeAheadBufferAtom` are ephemeral -- lost on page reload, which is correct.

**Persisted atoms for user preferences.** `showGitignoredAtom` and `expandedDirsAtom` are persisted to workspace state via debounced IPC write, following the existing pattern (see `docs/JOTAI.md` "Persisted Atom with Debounced Write").

```
IPC Data Flow (Lazy Loading):

Main Process: file change detected in /src
    │
    ▼
Main Process: getFolderContents('/src', depth: 1)
    │
    ▼
Main Process: sends IPC 'folder-contents-loaded' { dirPath, children }
    │
    ▼
Central Listener: store/listeners/fileTreeListeners.ts
    │
    ▼
store.set(mergeChildrenAtom, { parentPath: '/src', children })
    │
    ▼
fileTreeAtom updated (children merged at /src node)
    │
    ▼
visibleNodesAtom recomputes (derived, synchronous)
    │
    ▼
FlatFileTree re-renders affected rows via Virtuoso
```

### Key Atom Changes

```typescript
// Existing (keep)
expandedDirsAtom: Set<string>          // persisted to workspace state
selectedFolderPathAtom: string | null
revealRequestAtom: RevealRequest | null

// New -- selection & focus (UI-only, transient)
selectedPathsAtom: Set<string>        // multi-select (replaces sharedSelectionState prop drilling)
lastSelectedPathAtom: string | null   // for shift-click range
focusedIndexAtom: number | null       // keyboard focus position in visibleNodes
renamingPathAtom: string | null       // path currently being renamed inline

// New -- drag-drop (UI-only, transient)
dragStateAtom: DragState | null       // replaces sharedDragState prop drilling (see DragState interface above)

// New -- lazy loading (UI-only, transient)
loadingDirsAtom: Set<string>          // directories currently being fetched

// New -- gitignore (persisted to workspace state)
showGitignoredAtom: boolean           // toggle for showing ignored files (default: false)

// New -- type-ahead find (UI-only, transient)
typeAheadBufferAtom: string           // accumulated keystrokes, resets after 500ms

// New -- action atoms
mergeChildrenAtom: write-only         // merges lazily-loaded children into fileTreeAtom at a given path

// New derived atom (the core innovation)
visibleNodesAtom: FlatTreeNode[]
// Derived from: fileTreeAtom, expandedDirsAtom, loadingDirsAtom, showGitignoredAtom,
//   activeFilePathAtom, selectedFolderPathAtom, selectedPathsAtom, dragStateAtom, renamingPathAtom
// Computed by walking fileTreeAtom, skipping:
//   - children of collapsed dirs
//   - children: undefined (not yet loaded)
//   - gitignored items (unless showGitignoredAtom is true)
// Annotates each node with depth/isExpanded/isLoading/isActive/isSelected/isGitignored/isDragOver/isRenaming
// Each node also gets index (position in flat list) and parentPath (for ArrowLeft navigation)
```

### The `visibleNodesAtom` Derivation

```typescript
export const visibleNodesAtom = atom((get) => {
  const tree = get(fileTreeAtom);
  const expanded = get(expandedDirsAtom);
  const loadingDirs = get(loadingDirsAtom);
  const showGitignored = get(showGitignoredAtom);
  const activeFile = get(activeFilePathAtom);
  const selectedFolder = get(selectedFolderPathAtom);
  const selectedPaths = get(selectedPathsAtom);
  const dragState = get(dragStateAtom);
  const renamingPath = get(renamingPathAtom);

  const result: FlatTreeNode[] = [];

  function walk(items: FileTreeItem[], depth: number, parentPath: string | null) {
    for (const item of items) {
      if (item.isGitignored && !showGitignored) continue;

      const isDir = item.type === 'directory';
      const isExpanded = isDir && expanded.has(item.path);
      const childrenLoaded = item.children !== undefined;
      const isLoading = isDir && loadingDirs.has(item.path);

      result.push({
        path: item.path,
        name: item.name,
        type: item.type,
        depth,
        index: result.length,
        parentPath,
        hasChildren: isDir && (!childrenLoaded || (item.children?.length ?? 0) > 0),
        isExpanded,
        isLoading,
        isActive: item.path === activeFile,
        isSelected: item.path === selectedFolder,
        isMultiSelected: selectedPaths.has(item.path),
        isGitignored: item.isGitignored ?? false,
        isDragOver: dragState?.dropTargetPath === item.path,
        isRenaming: renamingPath === item.path,
      });

      if (isExpanded && item.children) {
        walk(item.children, depth + 1, item.path);
      }
    }
  }

  walk(tree, 0, null);
  return result;
});
```

### Reveal Implementation

With lazy loading, reveal needs to fetch missing directory contents before scrolling:

```typescript
export const revealFileAtom = atom(null, async (get, set, filePath: string) => {
  const dirs = getParentDirPaths(filePath); // ['/root/a', '/root/a/b', ...]

  // 1. Expand all parent dirs, fetching contents for any that aren't loaded yet
  const expanded = new Set(get(expandedDirsAtom));
  for (const dir of dirs) {
    expanded.add(dir);
    const tree = get(fileTreeAtom);
    const node = findNodeByPath(tree, dir);
    if (node && node.children === undefined) {
      // Lazy load this directory's contents before proceeding
      const contents = await window.electronAPI.getFolderContents(dir);
      set(mergeChildrenAtom, { parentPath: dir, children: contents });
    }
  }
  set(expandedDirsAtom, expanded);

  // 2. visibleNodesAtom recomputes synchronously
  // 3. Find the index
  const nodes = get(visibleNodesAtom);
  const index = nodes.findIndex(n => n.path === filePath);

  // 4. Set reveal request with index for Virtuoso scrollToIndex
  set(revealRequestAtom, { path: filePath, type: 'file', index, ts: Date.now() });
});
```

For the common case (parents already expanded/loaded), this is still synchronous. The async path only fires when revealing into unexplored directories.

The component just calls `virtuosoRef.current?.scrollToIndex({ index, behavior: 'smooth' })`. No DOM querying, no retries, no timeouts.

### Rendering

```tsx
function FlatFileTree({ items, ... }) {
  const visibleNodes = useAtomValue(visibleNodesAtom);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const revealRequest = useAtomValue(revealRequestAtom);
  const [focusedIndex, setFocusedIndex] = useAtom(focusedIndexAtom);
  const autoScrollSpeed = useRef(0);

  // Scroll on reveal
  useEffect(() => {
    if (revealRequest?.index != null) {
      virtuosoRef.current?.scrollToIndex({
        index: revealRequest.index,
        behavior: 'smooth',
        align: 'center',
      });
    }
  }, [revealRequest]);

  // Keep focused row visible when navigating via keyboard
  useEffect(() => {
    if (focusedIndex != null) {
      virtuosoRef.current?.scrollToIndex({ index: focusedIndex, align: 'auto' });
    }
  }, [focusedIndex]);

  // Auto-scroll during drag (rAF loop)
  useEffect(() => {
    let animFrame: number;
    const tick = () => {
      if (autoScrollSpeed.current !== 0) {
        virtuosoRef.current?.scrollBy({ top: autoScrollSpeed.current });
      }
      animFrame = requestAnimationFrame(tick);
    };
    animFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrame);
  }, []);

  return (
    <div
      ref={containerRef}
      role="tree"
      aria-label="File Explorer"
      tabIndex={0}
      onKeyDown={(e) => handleTreeKeyDown(e, visibleNodes, focusedIndex, ...actions)}
      onDragOver={(e) => handleContainerDragOver(e, containerRef, autoScrollSpeed)}
      onDragLeave={() => { autoScrollSpeed.current = 0; }}
      onDrop={(e) => handleContainerDrop(e, autoScrollSpeed)}
    >
      <Virtuoso
        ref={virtuosoRef}
        totalCount={visibleNodes.length}
        fixedItemHeight={28}
        itemContent={(index) => {
          const node = visibleNodes[index];
          return (
            <FileTreeRow
              node={node}
              isFocused={index === focusedIndex}
              onFocus={() => setFocusedIndex(index)}
            />
          );
        }}
      />
    </div>
  );
}
```

No recursion. One component. One list. One keyboard handler.

### Row Component

```tsx
const FileTreeRow = memo(({ node, isFocused, onFocus, ... }) => {
  const indent = node.depth * 16;

  // Inline rename mode
  if (node.isRenaming) {
    return (
      <div className="file-tree-row renaming" style={{ paddingLeft: indent + 8 }}>
        <InlineRenameInput path={node.path} name={node.name} type={node.type} />
      </div>
    );
  }

  return (
    <div
      role="treeitem"
      aria-expanded={node.type === 'directory' ? node.isExpanded : undefined}
      aria-selected={node.isMultiSelected || node.isActive}
      aria-level={node.depth + 1}
      data-focused={isFocused || undefined}
      className={cn(
        'file-tree-row',
        node.isActive && 'active',
        node.isSelected && 'selected',
        node.isMultiSelected && 'multi-selected',
        node.isDragOver && 'drag-over',
        node.isGitignored && 'gitignored',
        isFocused && 'focused',
      )}
      style={{ paddingLeft: indent + 8 }}
      onClick={(e) => handleRowClick(e, node, onFocus)}
      onContextMenu={...}
      draggable
      onDragStart={(e) => handleDragStart(e, node)}
      onDragOver={(e) => handleRowDragOver(e, node)}
      onDragLeave={...}
      onDrop={(e) => handleRowDrop(e, node)}
    >
      {node.type === 'directory' ? (
        <span className="file-tree-chevron">
          {node.isLoading ? (
            <Spinner size={14} />
          ) : (
            <MaterialSymbol icon={node.isExpanded ? "keyboard_arrow_down" : "keyboard_arrow_right"} size={16} />
          )}
        </span>
      ) : (
        <span className="file-tree-spacer" />
      )}
      <FileIcon name={node.name} type={node.type} />
      <span className="file-tree-name">{node.name}</span>
      <GitStatusIndicator path={node.path} />
    </div>
  );
});
```

### Keyboard Handler

```typescript
function handleTreeKeyDown(
  e: React.KeyboardEvent,
  nodes: FlatTreeNode[],
  focusedIndex: number | null,
  actions: TreeActions, // expand, collapse, open, rename, delete, setFocused, ...
) {
  if (focusedIndex == null && nodes.length > 0) {
    // First keypress focuses the first item
    actions.setFocused(0);
    return;
  }

  const node = nodes[focusedIndex!];
  if (!node) return;

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      if (e.shiftKey) actions.extendSelection(focusedIndex! + 1);
      actions.setFocused(Math.min(focusedIndex! + 1, nodes.length - 1));
      break;

    case 'ArrowUp':
      e.preventDefault();
      if (e.shiftKey) actions.extendSelection(focusedIndex! - 1);
      actions.setFocused(Math.max(focusedIndex! - 1, 0));
      break;

    case 'ArrowRight':
      e.preventDefault();
      if (node.type === 'directory') {
        if (!node.isExpanded) {
          actions.expand(node.path);
        } else if (focusedIndex! + 1 < nodes.length) {
          actions.setFocused(focusedIndex! + 1); // move to first child
        }
      }
      break;

    case 'ArrowLeft':
      e.preventDefault();
      if (node.type === 'directory' && node.isExpanded) {
        actions.collapse(node.path);
      } else if (node.parentPath) {
        // Jump to parent directory
        const parentIdx = nodes.findIndex(n => n.path === node.parentPath);
        if (parentIdx >= 0) actions.setFocused(parentIdx);
      }
      break;

    case 'Enter':
      e.preventDefault();
      if (node.type === 'directory') actions.toggleExpand(node.path);
      else actions.openFile(node.path);
      break;

    case ' ':
      e.preventDefault();
      if (node.type === 'file') actions.previewFile(node.path);
      break;

    case 'F2':
      e.preventDefault();
      actions.startRename(node.path);
      break;

    case 'Delete':
    case 'Backspace':
      e.preventDefault();
      actions.deleteItems(getSelectedOrFocused(nodes, focusedIndex!));
      break;

    case 'Home':
      e.preventDefault();
      actions.setFocused(0);
      break;

    case 'End':
      e.preventDefault();
      actions.setFocused(nodes.length - 1);
      break;

    case 'Escape':
      actions.clearSelection();
      break;

    case 'a':
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        actions.selectAll();
      } else {
        actions.typeAhead(e.key);
      }
      break;

    default:
      // Type-ahead find: printable single characters
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
        actions.typeAhead(e.key);
      }
      break;
  }
}
```

## Implementation Steps

### Step 1: WorkspaceIgnore + Gitignore Integration

**Files**: New `main/utils/WorkspaceIgnore.ts`, modify `main/utils/FileTree.ts`, `main/utils/fileFilters.ts`

- Add `ignore@^7` dependency to `packages/electron`
- Create `WorkspaceIgnore` class: reads `.gitignore`, provides `isIgnored(path): boolean`
- Integrate into `getFolderContents`: mark items with `isGitignored: true` instead of filtering them out
- Integrate into `OptimizedWorkspaceWatcher`: skip gitignored directories in the watcher's `ignored` callback (the EMFILE fix)
- Watch `.gitignore` itself for changes, reload filter + rebuild tree
- Fall back to `EXCLUDED_DIRS` for non-git workspaces
- Clean up unused formats in `fileFilters.ts` (`FIND_PRUNE_ARGS`, `RIPGREP_EXCLUDE_ARGS` string version)

### Step 2: Lazy Loading IPC

**Files**: `main/utils/FileTree.ts`, `main/file/WorkspaceHandlers.ts`, `preload/index.ts`

- Change `getFolderContents` to accept a `depth` parameter (default: 1). Depth 1 = only immediate children, directories have `children: undefined`.
- On workspace open, load root at depth 1 only
- `get-folder-contents` IPC handler returns a single directory's children (already exists, just needs to return depth-1 results)
- Add `folder-contents-loaded` IPC event from main to renderer (for watcher-triggered refreshes of a single directory)
- The watcher's `workspace-file-tree-updated` event changes from "here's the entire tree" to "directory X changed, here are its new children"

### Step 3: Tree Model Atoms

**Files**: `store/atoms/fileTree.ts`

- **Selection & focus** (UI-only): `selectedPathsAtom`, `lastSelectedPathAtom`, `focusedIndexAtom`, `renamingPathAtom`
- **Drag-drop** (UI-only): `dragStateAtom` (replaces prop-drilled `sharedDragState`)
- **Lazy loading** (UI-only): `loadingDirsAtom`
- **Gitignore** (persisted to workspace state): `showGitignoredAtom`
- **Type-ahead** (UI-only): `typeAheadBufferAtom`
- **Action atoms**: `mergeChildrenAtom` (write-only, merges lazily-loaded children into `fileTreeAtom` at a given path)
- **Derived atom**: `visibleNodesAtom` (the core innovation -- flat list derived from tree + all UI state atoms)
- Update `revealFileAtom` / `revealFolderAtom` to async-load missing parent directories before computing index
- Keep existing atoms consumed elsewhere (git status, etc.)

### Step 4: FlatFileTree Component + Row Renderer

**Files**: New `components/FlatFileTree.tsx`, new `components/FileTreeRow.tsx`

- Single non-recursive component using `react-virtuoso` `<Virtuoso>`
- `fixedItemHeight={28}` matching existing CSS
- Container gets `role="tree"`, `tabIndex={0}`, single `onKeyDown` handler
- Row renderer component (`FileTreeRow`) with `role="treeitem"`, `aria-expanded`, `aria-selected`, `aria-level`
- Expand/collapse: on expand, if `children === undefined`, fetch via IPC, set `loadingDirsAtom`, then merge results into tree
- Collapse: just removes from `expandedDirsAtom`, no IPC needed
- Context menu: reuse existing `FileContextMenu`
- IPC sync for folder expansion (file watcher registration)
- Gitignored items: dimmed text (`text-faint`), only visible when `showGitignoredAtom` is true

### Step 5: Keyboard Navigation

**Files**: New `utils/treeKeyboardHandler.ts`, modify `components/FlatFileTree.tsx`

- `focusedIndexAtom` tracks which row has keyboard focus
- Single `onKeyDown` on the tree container handles all keys (see Keyboard Handler section)
- Arrow up/down: move focus, with shift for range selection
- Arrow left/right: collapse/expand dirs, or navigate to parent/first child
- Enter: open file or toggle directory
- Space: preview file (open without replacing current tab)
- F2: start inline rename (`renamingPathAtom`)
- Delete/Backspace: delete focused or selected items with confirmation
- Home/End: jump to first/last row
- PageUp/PageDown: move focus by viewport height
- Cmd+A: select all visible items
- Escape: clear selection, cancel rename
- Type-ahead find: letter keys jump to matching item, 500ms reset timer (`typeAheadBufferAtom`)
- Scroll follows focus: `scrollToIndex` keeps focused row visible
- Focus persistence: when `visibleNodes` recomputes (expand/collapse), find the previously focused path's new index

### Step 6: Inline Rename

**Files**: New `components/InlineRenameInput.tsx`, modify `components/FileTreeRow.tsx`

- `renamingPathAtom` set by F2 key or context menu "Rename"
- Row renders `<InlineRenameInput>` instead of name label when `isRenaming` is true
- Auto-selects filename without extension (files) or full name (directories)
- Enter: confirm rename via IPC
- Escape: cancel rename, clear `renamingPathAtom`
- Blur: confirm rename (same as Enter)
- Validation: prevent empty names, illegal characters, duplicate names in same directory

### Step 7: Drag-Drop (Internal)

**Files**: Modify `components/FlatFileTree.tsx`, `components/FileTreeRow.tsx`

Port existing drag-move logic to flat rows, plus improvements:
- `dragStateAtom` tracks source paths, drop target, copy mode, external flag
- `onDragStart`: set drag state, create custom drag image (shows item count for multi-select)
- `onDragOver` on rows: highlight drop target directory, show copy indicator when Alt/Cmd held
- `onDrop`: move or copy files via IPC
- Alt/Cmd modifier tracking via keydown/keyup on container
- Prevent dropping into own children
- **Auto-scroll**: rAF loop during drag, scroll speed proportional to distance from edge (40px zones)
- **Expand on hover**: collapsed directories expand after 500ms hover during drag, timer resets on target change

### Step 8: Drag-Drop (Native / External)

**Files**: Modify `components/FlatFileTree.tsx`, new IPC handlers in `main/file/WorkspaceHandlers.ts`, `preload/index.ts`

**Drag out to Finder/desktop:**
- `onDragStart` calls `window.electronAPI.startNativeDrag(path)` which invokes `webContents.startDrag({ file, icon })`
- Multi-file: `startDrag({ files: [...paths] })` when multiple items selected
- New IPC handler: `start-native-drag` in main process

**Drag in from Finder/desktop:**
- Container `onDrop` checks `e.dataTransfer.files` for external files
- Copies dropped files into the target directory via IPC (`copy-file-into`)
- New IPC handler: `copy-file-into` in main process (copies file to target dir, watcher picks up the change)
- Shows drop target highlight when external files are hovering over the tree

### Step 9: Reveal + Scroll

- `revealFileAtom` expands parents + lazy loads missing dirs + computes index + sets `revealRequestAtom`
- Component watches `revealRequestAtom` and calls `virtuosoRef.scrollToIndex`
- Auto-scroll on active file change (when not recently interacted)
- Sets `focusedIndexAtom` to the revealed item's index

### Step 10: Show Ignored Files Toggle

**Files**: `components/WorkspaceSidebar.tsx` (header area)

- Add a toggle button/icon in the file tree header: "Show Ignored Files" (eye icon or similar)
- Writes to `showGitignoredAtom`
- When on, gitignored files appear in the tree with dimmed styling
- Persist preference in workspace settings

### Step 11: Central IPC Listener + Wire Up in WorkspaceSidebar

**Files**: New `store/listeners/fileTreeListeners.ts`, modify `components/WorkspaceSidebar.tsx`

Central listener (follows `docs/IPC_LISTENERS.md` pattern -- components NEVER subscribe to IPC directly):
- `fileTreeListeners.ts` subscribes ONCE at startup to `folder-contents-loaded` and `workspace-file-tree-updated`
- On `folder-contents-loaded`: calls `store.set(mergeChildrenAtom, { parentPath, children })`
- On `workspace-file-tree-updated` (legacy, kept for initial load): calls `store.set(fileTreeAtom, data.fileTree)`
- Register in `store/listeners/index.ts` alongside existing listeners

WorkspaceSidebar changes:
- Replace `<FileTree>` with `<FlatFileTree>`
- Initial load: call `getFolderContents(workspacePath, { depth: 1 })` and set `fileTreeAtom` directly (one-time init)
- Remove `onWorkspaceFileTreeUpdated` subscription from component (moved to central listener)
- Remove callbacks that were only needed for recursive state threading (`sharedExpandedDirs`, `sharedSelectionState`, `sharedDragState`)

### Step 12: CSS

**Files**: `index.css`

- Add `.file-tree-row` styles (similar to existing `.file-tree-file` / `.file-tree-directory`)
- Add `.file-tree-row.focused` style: subtle focus ring (1px outline, `--nim-primary` color)
- Add `.file-tree-row.drag-over` style: blue outline / background highlight for drop target
- Add `.file-tree-row.gitignored` style: dimmed text, reduced opacity
- Add `.file-tree-row.loading` style: spinner or pulse animation on chevron
- Add `.file-tree-row.renaming` style: input field styling
- Keep existing class names (`.file-tree-file`, `.file-tree-directory`) on rows for E2E compat
- Indentation via `style={{ paddingLeft }}` instead of nested `<ul>` padding

### Step 13: Remove Old FileTree

- Delete `FileTree.tsx` (old recursive component)
- Remove `sharedExpandedDirs`, `sharedSelectionState`, `sharedDragState` prop types
- Clean up dead atoms and helper functions
- Update E2E tests that select `.file-tree-file`, `.file-tree-directory` etc.

## Open Questions

1. **`items`**** prop vs atom**: Currently WorkspaceSidebar filters the tree and passes `filteredFileTree` as a prop. Should we move the filtered tree into an atom so `visibleNodesAtom` can derive from it without props? Or keep it as a prop and have the component write it to a local atom on change?

   **Recommendation**: Keep as prop for now. The component can use `useMemo` to compute flat nodes from `items` + atom state, or write items into a ref that the derived atom reads. Moving filtering into atoms is a separate concern.

   **Pragmatic approach**: `visibleNodes` can be a `useMemo` inside the component rather than a Jotai atom, since it depends on both props (`items`) and atoms (`expandedDirs`, etc.). This is simpler and avoids the prop-to-atom sync issue.

2. **E2E test selectors**: The 16 E2E test files that reference `file-tree` classes will need updating. Should we keep the old class names on the new elements for backward compatibility, or update all tests?

   **Recommendation**: Keep the same class names (`.file-tree-file`, `.file-tree-directory`) on the flat rows. They're just CSS classes, not tied to the component structure. Add `data-testid` attributes where needed.

3. **Native drag icon**: `webContents.startDrag()` requires an `icon` parameter (NativeImage). Should we generate file-type-specific icons, or use a generic document icon?

   **Recommendation**: Use a generic document icon for now. Electron provides `nativeImage.createFromPath()` but generating per-file-type icons is complex. A single semi-transparent file icon works fine (VS Code does the same).

3. **Nested \****`.gitignore`**\*\* files**: Git supports `.gitignore` in subdirectories. Should `WorkspaceIgnore` handle nested gitignores on initial implementation?

   **Recommendation**: Start with root `.gitignore` only. Nested support can be added later -- when lazy loading a subdirectory, check for a local `.gitignore` and layer it on. Most projects only use root-level gitignore.

5. **Expand animation with lazy load**: When expanding a directory that hasn't been loaded yet, there's a network round-trip. Should we show a loading spinner on the chevron, or just delay the expand?

   **Recommendation**: Show a small spinner replacing the chevron. The IPC call is local so it should be fast (<50ms), but the spinner prevents any perceived jank. Set `isLoading: true` in `loadingDirsAtom` during the fetch.

6. **Relationship to gitignore-aware-file-watching plan**: The existing `plans/gitignore-aware-file-watching.md` overlaps with the gitignore work here. Should they be merged?

   **Recommendation**: This plan supersedes `gitignore-aware-file-watching.md` for the file tree and watcher integration. That plan can be marked as absorbed into this one. The `WorkspaceIgnore` class design from that plan is reused here directly.

7. **Focus vs selection**: VS Code distinguishes focus (keyboard cursor, single ring) from selection (highlighted rows, can be multiple). Should we maintain this distinction?

   **Recommendation**: Yes. `focusedIndexAtom` is the keyboard cursor (single row, subtle ring). `selectedPathsAtom` is the selection (highlighted rows, used for bulk operations). They're independent -- you can have focus on one row and selection on others. Click sets both focus and selection. Keyboard nav moves focus; shift+arrow extends selection.

8. **Space for preview**: VS Code uses space to "preview" a file (opens in a temporary tab that gets replaced by the next preview). Do we have preview tab support?

   **Recommendation**: If preview tabs aren't implemented yet, Space can just open the file normally (same as Enter). Add proper preview tab behavior as a separate enhancement later.

9. **Drag-in file conflicts**: What happens when dragging in a file from Finder and a file with the same name already exists in the target directory?

   **Recommendation**: Show a confirmation dialog: "Replace existing file?" / "Keep both" (append number) / "Cancel". Same pattern as Finder. Implement in the `copy-file-into` IPC handler.

## Performance Expectations

- **Current**: ~N DOM nodes for N visible tree items (all rendered), full 10k-item tree loaded upfront
- **After**: ~20-30 DOM nodes regardless of tree size (only viewport rows rendered)
- **Initial load**: Only root directory contents (tens of items, not thousands)
- **Expand/collapse**: O(n) flat array recomputation, single React render pass. Expand of unloaded dir adds one IPC round-trip (<50ms local).
- **Reveal**: O(n) to find index + potential async loads for collapsed parents, then `scrollToIndex`
- **Memory**: Sparse tree in memory (only explored paths loaded), flat array of lightweight objects for rendering
- **File watchers**: Dramatically fewer watchers -- gitignored directories (node_modules, dist, build, etc.) are never watched
- **IPC payload**: Per-directory payloads instead of full-tree serialization on every change

## Dependencies

- `react-virtuoso` (already installed, already used in SessionHistory)
- `ignore@^7` (new -- `.gitignore` parser, 10M+ weekly downloads, lightweight)
