/**
 * File Tree Atoms
 *
 * State for the file tree sidebar, including git status, expanded directories,
 * and selection. Uses file paths as keys (not EditorKey) because git status
 * and file existence are properties of the file on disk, not per-editor.
 *
 * Key principle: File watcher service WRITES git status/structure changes,
 * FileTreeNode components subscribe to only their own path's state.
 */

import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import { activeTabIdAtom, getFilePathFromKey } from '@nimbalyst/runtime/store';

/**
 * Git status codes matching what `simple-git` provides.
 */
export type GitStatusCode =
  | 'M' // Modified
  | 'A' // Added
  | 'D' // Deleted
  | 'R' // Renamed
  | 'C' // Copied
  | 'U' // Unmerged/Conflicted
  | '?' // Untracked
  | '!'; // Ignored

/**
 * Git status for a file.
 */
export interface FileGitStatus {
  index: GitStatusCode | ' '; // Staging area status
  workingTree: GitStatusCode | ' '; // Working tree status
}

/**
 * File tree item representing a file or directory.
 */
export interface FileTreeItem {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileTreeItem[];
}

/**
 * The complete file tree structure.
 * WorkspaceSidebar subscribes to this for the tree structure.
 */
export const fileTreeAtom = atom<FileTreeItem[]>([]);

/**
 * Git status map for all tracked files.
 * This is the source of truth - per-file atoms derive from this.
 */
export const gitStatusMapAtom = atom<Map<string, FileGitStatus>>(new Map());

/**
 * Per-file git status.
 * FileTreeNode subscribes to get its own status.
 * Derives from gitStatusMapAtom so updates are efficient.
 */
export const fileGitStatusAtom = atomFamily((filePath: string) =>
  atom((get) => {
    const statusMap = get(gitStatusMapAtom);
    return statusMap.get(filePath);
  })
);

/**
 * Expanded directories set.
 * Used to track which directories are expanded in the tree.
 */
export const expandedDirsAtom = atom<Set<string>>(new Set<string>());

/**
 * Per-directory expanded state.
 * FileTreeNode subscribes to know if it should show children.
 */
export const isDirExpandedAtom = atomFamily((dirPath: string) =>
  atom(
    (get) => get(expandedDirsAtom).has(dirPath),
    (get, set, expanded: boolean) => {
      const current = get(expandedDirsAtom);
      const next = new Set(current);
      if (expanded) {
        next.add(dirPath);
      } else {
        next.delete(dirPath);
      }
      set(expandedDirsAtom, next);
    }
  )
);

/**
 * Currently selected file path in the tree.
 */
export const selectedFilePathAtom = atom<string | null>(null);

/**
 * Derived: Active file path from the main editor context.
 * WorkspaceSidebar subscribes to this for auto-scroll functionality.
 * This allows the file tree to react to tab switches without requiring
 * the parent component to re-render.
 */
export const activeFilePathAtom = atom((get) => {
  const activeTabKey = get(activeTabIdAtom('main'));
  if (!activeTabKey) return null;
  return getFilePathFromKey(activeTabKey);
});

/**
 * Active filter for file tree (e.g., "modified", "untracked").
 */
export const fileTreeFilterAtom = atom<string | null>(null);

/**
 * Compute aggregate git status for a directory.
 * Shows the "most important" status of any child.
 */
function computeDirectoryStatus(
  dirPath: string,
  statusMap: Map<string, FileGitStatus>
): FileGitStatus | undefined {
  // Priority order: Unmerged > Modified > Added > Untracked > Deleted > none
  const priority: Record<GitStatusCode | ' ', number> = {
    U: 6,
    M: 5,
    A: 4,
    '?': 3,
    D: 2,
    R: 1,
    C: 1,
    '!': 0,
    ' ': 0,
  };

  let highestIndex: GitStatusCode | ' ' = ' ';
  let highestWorking: GitStatusCode | ' ' = ' ';
  let hasAny = false;

  for (const [path, status] of statusMap) {
    if (path.startsWith(dirPath + '/')) {
      hasAny = true;
      if (priority[status.index] > priority[highestIndex]) {
        highestIndex = status.index;
      }
      if (priority[status.workingTree] > priority[highestWorking]) {
        highestWorking = status.workingTree;
      }
    }
  }

  if (!hasAny) return undefined;

  return {
    index: highestIndex,
    workingTree: highestWorking,
  };
}

/**
 * Per-directory aggregate git status.
 * Shows the "most important" status among all files in the directory.
 */
export const directoryGitStatusAtom = atomFamily((dirPath: string) =>
  atom((get) => {
    const statusMap = get(gitStatusMapAtom);
    return computeDirectoryStatus(dirPath, statusMap);
  })
);

/**
 * Derived: count of modified files (for badge/indicator).
 */
export const modifiedFileCountAtom = atom((get) => {
  const statusMap = get(gitStatusMapAtom);
  let count = 0;
  for (const status of statusMap.values()) {
    if (
      status.workingTree === 'M' ||
      status.workingTree === 'A' ||
      status.workingTree === '?'
    ) {
      count++;
    }
  }
  return count;
});

/**
 * Actions for managing file tree state.
 */

/**
 * Update git status for multiple files at once.
 * More efficient than updating one at a time.
 */
export const updateGitStatusAtom = atom(
  null,
  (_get, set, updates: Map<string, FileGitStatus>) => {
    set(gitStatusMapAtom, updates);
  }
);

/**
 * Toggle directory expansion.
 */
export const toggleDirExpandedAtom = atom(null, (get, set, dirPath: string) => {
  const current = get(expandedDirsAtom).has(dirPath);
  set(isDirExpandedAtom(dirPath), !current);
});

/**
 * Expand all directories to reveal a file path.
 * Useful when opening a file from search or navigation.
 */
export const revealFileAtom = atom(null, (get, set, filePath: string) => {
  const parts = filePath.split('/');
  const dirs: string[] = [];

  // Build list of parent directories
  for (let i = 1; i < parts.length - 1; i++) {
    dirs.push(parts.slice(0, i + 1).join('/'));
  }

  // Expand all parent directories
  const current = get(expandedDirsAtom);
  const next = new Set(current);
  for (const dir of dirs) {
    next.add(dir);
  }
  set(expandedDirsAtom, next);

  // Select the file
  set(selectedFilePathAtom, filePath);
});
