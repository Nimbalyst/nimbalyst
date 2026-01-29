import React, { useState, useCallback, useRef, useEffect, memo } from 'react';
import { useAtomValue } from 'jotai';
import { MaterialSymbol, getFileIcon } from '@nimbalyst/runtime';
import { FileContextMenu } from './FileContextMenu';
import type { NewFileType, ExtensionFileType } from './NewFileMenu';
import { fileGitStatusAtom, directoryGitStatusAtom, selectedFolderPathAtom, type FileGitStatus as AtomFileGitStatus } from '../store';

interface FileTreeItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeItem[];
}

export type FileGitStatus = 'modified' | 'staged' | 'untracked' | 'deleted';

interface FileTreeProps {
  items: FileTreeItem[];
  currentFilePath: string | null;
  onFileSelect: (filePath: string) => void;
  level: number;
  showIcons?: boolean;
  enableAutoScroll?: boolean;
  onNewFile?: (folderPath: string, fileType: NewFileType) => void;
  onNewFolder?: (folderPath: string) => void;
  onRefreshFileTree?: () => void;
  onFolderContentsLoaded?: (folderPath: string, contents: FileTreeItem[]) => void;
  onViewHistory?: (filePath: string) => void;
  onViewWorkspaceHistory?: (folderPath: string) => void;
  selectedFolder?: string | null;
  onFolderSelect?: (folderPath: string | null) => void;
  gitStatusMap?: Map<string, FileGitStatus>;
  /** Extension-contributed file types */
  extensionFileTypes?: ExtensionFileType[];
  sharedDragState?: {
    draggedItem: FileTreeItem | null;
    setDraggedItem: (item: FileTreeItem | null) => void;
    dragOverItem: string | null;
    setDragOverItem: (path: string | null) => void;
    isDragCopy: boolean;
    setIsDragCopy: (copy: boolean) => void;
  };
  sharedExpandedDirs?: {
    expandedDirs: Set<string>;
    setExpandedDirs: React.Dispatch<React.SetStateAction<Set<string>>>;
  };
  // Multi-select support
  selectedPaths?: Set<string>;
  onSelectionChange?: (paths: Set<string>) => void;
  sharedSelectionState?: {
    selectedPaths: Set<string>;
    setSelectedPaths: React.Dispatch<React.SetStateAction<Set<string>>>;
    lastSelectedPath: string | null;
    setLastSelectedPath: React.Dispatch<React.SetStateAction<string | null>>;
  };
  // Root items for range selection (only set at root level)
  rootItems?: FileTreeItem[];
}

// Special directories that should always appear first with distinct styling
const SPECIAL_DIRECTORIES = ['nimbalyst-local'];

function isSpecialDirectory(name: string): boolean {
  return SPECIAL_DIRECTORIES.includes(name);
}

/**
 * Helper to convert atom git status to display string.
 * The atom uses {index, workingTree} format from simple-git.
 */
function getStatusDisplay(status: AtomFileGitStatus | undefined): { code: string; className: string; title: string } | null {
  if (!status) return null;

  // Check working tree first (unstaged changes), then index (staged)
  const code = status.workingTree !== ' ' ? status.workingTree : status.index;
  if (code === ' ') return null;

  switch (code) {
    case 'M':
      return { code: 'M', className: 'modified', title: 'Modified - Changes not staged for commit' };
    case 'A':
      return { code: 'S', className: 'staged', title: 'Staged - Changes ready to commit' };
    case '?':
      return { code: '?', className: 'untracked', title: 'Untracked - New file not yet added to git' };
    case 'D':
      return { code: 'D', className: 'deleted', title: 'Deleted - File removed' };
    default:
      return null;
  }
}

/**
 * Git status indicator for a file.
 * Each instance subscribes only to its own file's git status atom.
 * Memoized to prevent re-renders when parent re-renders.
 */
const FileGitStatusIndicator = memo<{ filePath: string }>(({ filePath }) => {
  const status = useAtomValue(fileGitStatusAtom(filePath));
  const display = getStatusDisplay(status);

  if (!display) return null;

  return (
    <span
      className={`file-tree-git-status file-tree-git-status--${display.className}`}
      title={display.title}
    >
      {display.code}
    </span>
  );
});

/**
 * Git status indicator for a directory.
 * Shows aggregate status of all files within the directory.
 * Each instance subscribes only to its own directory's git status atom.
 */
const DirectoryGitStatusIndicator = memo<{ dirPath: string }>(({ dirPath }) => {
  const status = useAtomValue(directoryGitStatusAtom(dirPath));
  const display = getStatusDisplay(status);

  if (!display) return null;

  return (
    <span
      className={`file-tree-git-status file-tree-git-status--${display.className} file-tree-git-status--inherited`}
      title={
        display.className === 'modified' ? 'Contains modified files' :
        display.className === 'staged' ? 'Contains staged files' :
        display.className === 'untracked' ? 'Contains untracked files' :
        display.className === 'deleted' ? 'Contains deleted files' : ''
      }
    >
      {display.code}
    </span>
  );
});

// Check if a directory contains any files with git status changes
// NOTE: This is the legacy prop-based approach. Use DirectoryGitStatusIndicator for atom-based.
function getDirectoryGitStatus(
  dirPath: string,
  gitStatusMap: Map<string, FileGitStatus> | undefined
): FileGitStatus | null {
  if (!gitStatusMap || gitStatusMap.size === 0) {
    return null;
  }

  // Check if any file in the status map starts with this directory path
  const dirPrefix = dirPath + '/';
  let hasModified = false;
  let hasStaged = false;
  let hasUntracked = false;

  for (const [filePath, status] of gitStatusMap.entries()) {
    if (filePath.startsWith(dirPrefix)) {
      if (status === 'modified') hasModified = true;
      else if (status === 'staged') hasStaged = true;
      else if (status === 'untracked') hasUntracked = true;
    }
  }

  // Priority: modified > staged > untracked
  if (hasModified) return 'modified';
  if (hasStaged) return 'staged';
  if (hasUntracked) return 'untracked';
  return null;
}

export function FileTree({ items, currentFilePath, onFileSelect, level, showIcons = true, enableAutoScroll = true, onNewFile, onNewFolder, onRefreshFileTree, onFolderContentsLoaded, onViewHistory, onViewWorkspaceHistory, selectedFolder: selectedFolderProp, onFolderSelect, gitStatusMap, extensionFileTypes = [], sharedDragState, sharedExpandedDirs, selectedPaths: selectedPathsProp, onSelectionChange, sharedSelectionState, rootItems: rootItemsProp }: FileTreeProps) {
  // Subscribe to the Jotai atom for folder selection (from breadcrumb navigation)
  const selectedFolderFromAtom = useAtomValue(selectedFolderPathAtom);
  // Use atom value if set, otherwise use prop (for backward compatibility)
  const selectedFolder = selectedFolderFromAtom ?? selectedFolderProp ?? null;
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    filePath: string;
    fileName: string;
    fileType: 'file' | 'directory';
  } | null>(null);

  // Create local drag state for root level, or use shared state for nested levels
  const [localDraggedItem, setLocalDraggedItem] = useState<FileTreeItem | null>(null);
  const [localDragOverItem, setLocalDragOverItem] = useState<string | null>(null);
  const [localIsDragCopy, setLocalIsDragCopy] = useState(false);

  // Use shared state if provided (nested), otherwise use local state (root)
  const draggedItem = sharedDragState?.draggedItem ?? localDraggedItem;
  const setDraggedItem = sharedDragState?.setDraggedItem ?? setLocalDraggedItem;
  const dragOverItem = sharedDragState?.dragOverItem ?? localDragOverItem;
  const setDragOverItem = sharedDragState?.setDragOverItem ?? setLocalDragOverItem;
  const isDragCopy = sharedDragState?.isDragCopy ?? localIsDragCopy;
  const setIsDragCopy = sharedDragState?.setIsDragCopy ?? setLocalIsDragCopy;

  // Create local selection state for root level, or use shared state for nested levels
  const [localSelectedPaths, setLocalSelectedPaths] = useState<Set<string>>(new Set());
  const [localLastSelectedPath, setLocalLastSelectedPath] = useState<string | null>(null);

  // Use shared state if provided (nested), otherwise use local state (root)
  const selectedPaths = sharedSelectionState?.selectedPaths ?? selectedPathsProp ?? localSelectedPaths;
  const setSelectedPaths = sharedSelectionState?.setSelectedPaths ?? setLocalSelectedPaths;
  const lastSelectedPath = sharedSelectionState?.lastSelectedPath ?? localLastSelectedPath;
  const setLastSelectedPath = sharedSelectionState?.setLastSelectedPath ?? setLocalLastSelectedPath;

  // Helper function to find parent directories of a file
  const findParentDirs = useCallback((items: FileTreeItem[], targetPath: string, parents: string[] = []): string[] | null => {
    for (const item of items) {
      if (item.type === 'file' && item.path === targetPath) {
        return parents;
      } else if (item.type === 'directory' && item.children) {
        const result = findParentDirs(item.children, targetPath, [...parents, item.path]);
        if (result) return result;
      }
    }
    return null;
  }, []);

  // Helper function to flatten all visible items for range selection
  const flattenVisibleItems = useCallback((treeItems: FileTreeItem[], expanded: Set<string>): FileTreeItem[] => {
    const result: FileTreeItem[] = [];
    for (const item of treeItems) {
      result.push(item);
      if (item.type === 'directory' && item.children && expanded.has(item.path)) {
        result.push(...flattenVisibleItems(item.children, expanded));
      }
    }
    return result;
  }, []);

  // Create local expanded state for root level, or use shared state for nested levels
  const [localExpandedDirs, setLocalExpandedDirs] = useState<Set<string>>(() => {
    const initialExpanded = new Set<string>();

    if (currentFilePath && level === 0) {
      const parentDirs = findParentDirs(items, currentFilePath);
      if (parentDirs) {
        parentDirs.forEach(dir => initialExpanded.add(dir));
      }
    }

    return initialExpanded;
  });

  // Use shared state if provided (nested), otherwise use local state (root)
  const expandedDirs = sharedExpandedDirs?.expandedDirs ?? localExpandedDirs;
  const setExpandedDirs = sharedExpandedDirs?.setExpandedDirs ?? setLocalExpandedDirs;

  // Track previous currentFilePath to detect actual file changes
  const prevFilePathRef = useRef<string | null>(null);

  // Track user interaction with the file tree to prevent auto-scroll during manual navigation
  // Initialize to a very old timestamp so initial auto-scroll works
  const lastUserInteractionRef = useRef<number>(0);
  const fileTreeRef = useRef<HTMLDivElement | null>(null);

  // Track if user clicked within the file tree itself to open a file
  const fileClickedInTreeRef = useRef<boolean>(false);

  // Update expanded directories when current file changes
  useEffect(() => {
    if (currentFilePath && level === 0) {
      const parentDirs = findParentDirs(items, currentFilePath);
      if (parentDirs && parentDirs.length > 0) {
        setExpandedDirs(prev => {
          const newSet = new Set(prev);
          let hasChanges = false;
          parentDirs.forEach(dir => {
            if (!newSet.has(dir)) {
              newSet.add(dir);
              hasChanges = true;
            }
          });
          // Only update state if we actually added new directories
          return hasChanges ? newSet : prev;
        });
      }
    }
  }, [currentFilePath, items, level, findParentDirs, setExpandedDirs]);

  // Track user interactions to prevent auto-scroll while navigating the tree
  useEffect(() => {
    if (level !== 0) return;

    const handleUserInteraction = () => {
      lastUserInteractionRef.current = Date.now();
    };

    const treeElement = document.querySelector('.workspace-file-tree');
    if (treeElement) {
      treeElement.addEventListener('click', handleUserInteraction);
      treeElement.addEventListener('scroll', handleUserInteraction);

      return () => {
        treeElement.removeEventListener('click', handleUserInteraction);
        treeElement.removeEventListener('scroll', handleUserInteraction);
      };
    }
    return undefined;
  }, [level]);

  // Scroll to active file only when currentFilePath actually changes
  // AND user hasn't interacted with the tree recently (within last 2 seconds)
  // AND auto-scroll is enabled
  useEffect(() => {
    if (currentFilePath && level === 0 && enableAutoScroll) {
      const filePathChanged = prevFilePathRef.current !== currentFilePath;
      if (filePathChanged) {
        prevFilePathRef.current = currentFilePath;

        // Don't auto-scroll if the user just clicked a file in the tree
        if (fileClickedInTreeRef.current) {
          fileClickedInTreeRef.current = false;
          return;
        }

        // Only auto-scroll if user hasn't interacted with the tree in the last 2 seconds
        const timeSinceLastInteraction = Date.now() - lastUserInteractionRef.current;
        const shouldAutoScroll = timeSinceLastInteraction > 2000;

        if (shouldAutoScroll) {
          // Scroll the active file into view after a brief delay to allow for expansion
          setTimeout(() => {
            const activeFileElement = document.querySelector('.file-tree-file.active');
            if (activeFileElement) {
              activeFileElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
          }, 100);
        }
      }
    }
  }, [currentFilePath, level, enableAutoScroll]);

  // Track previous selectedFolder from atom to detect external changes
  const prevSelectedFolderFromAtomRef = useRef<string | null>(null);

  // Helper to find parent directories of a folder path (not just files)
  const findParentDirsOfFolder = useCallback((treeItems: FileTreeItem[], targetFolderPath: string, parents: string[] = []): string[] | null => {
    for (const item of treeItems) {
      if (item.type === 'directory') {
        // Found the target folder - return its parents
        if (item.path === targetFolderPath) {
          return parents;
        }
        // Search children
        if (item.children) {
          const result = findParentDirsOfFolder(item.children, targetFolderPath, [...parents, item.path]);
          if (result) return result;
        }
      }
    }
    return null;
  }, []);

  // When selectedFolder changes via the atom (e.g., from breadcrumb click),
  // expand parent directories and scroll to the folder
  useEffect(() => {
    if (level !== 0) return;
    if (!selectedFolderFromAtom) {
      prevSelectedFolderFromAtomRef.current = null;
      return;
    }

    // Only act on actual changes from the atom
    if (prevSelectedFolderFromAtomRef.current === selectedFolderFromAtom) return;
    prevSelectedFolderFromAtomRef.current = selectedFolderFromAtom;

    // Expand parent directories of the selected folder
    const parentDirs = findParentDirsOfFolder(items, selectedFolderFromAtom);
    if (parentDirs && parentDirs.length > 0) {
      setExpandedDirs(prev => {
        const newSet = new Set(prev);
        let hasChanges = false;
        parentDirs.forEach(dir => {
          if (!newSet.has(dir)) {
            newSet.add(dir);
            hasChanges = true;
          }
        });
        return hasChanges ? newSet : prev;
      });
    }

    // Scroll to the selected folder after a brief delay for expansion to render
    setTimeout(() => {
      const selectedFolderElement = document.querySelector('.file-tree-directory.selected');
      if (selectedFolderElement) {
        selectedFolderElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 150);
  }, [selectedFolderFromAtom, items, level, findParentDirsOfFolder, setExpandedDirs]);

  // Clear multi-selection when a file is opened from outside the tree (e.g., keyboard shortcut)
  useEffect(() => {
    if (currentFilePath && level === 0) {
      // If current file is not in the selection, clear the selection
      // This handles the case where user opens a file via shortcut/other means
      if (selectedPaths.size > 0 && !selectedPaths.has(currentFilePath)) {
        setSelectedPaths(new Set<string>([currentFilePath]));
        setLastSelectedPath(currentFilePath);
        onSelectionChange?.(new Set<string>([currentFilePath]));
      }
    }
  }, [currentFilePath, level, selectedPaths, setSelectedPaths, setLastSelectedPath, onSelectionChange]);

  const toggleDirectory = useCallback(async (path: string) => {
    setExpandedDirs(prev => {
      const newSet = new Set(prev);
      const wasExpanded = newSet.has(path);

      if (wasExpanded) {
        newSet.delete(path);
        // Notify main process that folder was collapsed
        if (window.electronAPI) {
          window.electronAPI.invoke('workspace-folder-collapsed', path);
        }
      } else {
        newSet.add(path);
        // Notify main process that folder was expanded
        if (window.electronAPI) {
          window.electronAPI.invoke('workspace-folder-expanded', path);
        }

        // Refresh folder contents when opening (in case file watcher missed changes)
        if (window.electronAPI?.refreshFolderContents) {
          window.electronAPI.refreshFolderContents(path).then((refreshedContents) => {
            if (onFolderContentsLoaded) {
              onFolderContentsLoaded(path, Array.isArray(refreshedContents) ? refreshedContents : []);
            } else if (onRefreshFileTree) {
              onRefreshFileTree();
            }
          }).catch((error) => {
            console.error('Error refreshing folder contents:', error);
          });
        }
      }
      return newSet;
    });
  }, [onFolderContentsLoaded, onRefreshFileTree]);

  const handleFolderClick = useCallback((e: React.MouseEvent, path: string) => {
    // Toggle the folder when clicking anywhere on the row
    toggleDirectory(path);

    // Also select the folder
    if (onFolderSelect) {
      onFolderSelect(path);
    }
  }, [onFolderSelect, toggleDirectory]);

  // Handle item selection with support for shift and ctrl/cmd modifiers
  const handleItemSelect = useCallback((e: React.MouseEvent, item: FileTreeItem) => {
    const isMetaKey = e.metaKey || e.ctrlKey;
    const isShiftKey = e.shiftKey;

    // Get root level items for range selection (we need the full tree)
    // Use rootItemsProp if provided (from parent), otherwise use items if we're at root
    const rootItems = rootItemsProp ?? (level === 0 ? items : items);

    if (isShiftKey && lastSelectedPath) {
      // Range selection: select all items between lastSelectedPath and current item
      const flatItems = flattenVisibleItems(rootItems, expandedDirs);
      const lastIndex = flatItems.findIndex(i => i.path === lastSelectedPath);
      const currentIndex = flatItems.findIndex(i => i.path === item.path);

      if (lastIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        const rangeItems = flatItems.slice(start, end + 1);

        const newSelection = new Set(selectedPaths);
        rangeItems.forEach(i => newSelection.add(i.path));

        setSelectedPaths(newSelection);
        onSelectionChange?.(newSelection);
      }
    } else if (isMetaKey) {
      // Toggle selection: add or remove from selection
      const newSelection = new Set(selectedPaths);
      if (newSelection.has(item.path)) {
        newSelection.delete(item.path);
      } else {
        newSelection.add(item.path);
      }

      setSelectedPaths(newSelection);
      setLastSelectedPath(item.path);
      onSelectionChange?.(newSelection);
    } else {
      // Normal click: clear selection and select only this item
      const newSelection = new Set<string>([item.path]);
      setSelectedPaths(newSelection);
      setLastSelectedPath(item.path);
      onSelectionChange?.(newSelection);

      // For files, also open them
      if (item.type === 'file') {
        // Clear folder selection when clicking a file
        if (onFolderSelect) {
          onFolderSelect(null);
        }
        // Mark that the file was clicked in the tree to prevent auto-scroll
        fileClickedInTreeRef.current = true;
        onFileSelect(item.path);
      }
    }
  }, [items, level, rootItemsProp, lastSelectedPath, expandedDirs, selectedPaths, setSelectedPaths, setLastSelectedPath, onSelectionChange, flattenVisibleItems, onFolderSelect, onFileSelect]);

  const handleContextMenu = useCallback((e: React.MouseEvent, item: FileTreeItem) => {
    e.preventDefault();
    e.stopPropagation();

    // If right-clicking on an item that's not in the current selection,
    // clear selection and select only that item
    if (!selectedPaths.has(item.path)) {
      const newSelection = new Set<string>([item.path]);
      setSelectedPaths(newSelection);
      setLastSelectedPath(item.path);
      onSelectionChange?.(newSelection);
    }

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      filePath: item.path,
      fileName: item.name,
      fileType: item.type
    });
  }, [selectedPaths, setSelectedPaths, setLastSelectedPath, onSelectionChange]);

  const handleRename = useCallback(async (filePath: string, newName: string) => {
    const result = await window.electronAPI.renameFile(filePath, newName);
    if (!result.success) {
      console.error('Failed to rename file:', result.error);
    }
  }, []);

  const handleDelete = useCallback(async (filePath: string) => {
    const result = await window.electronAPI.deleteFile(filePath);
    if (!result.success) {
      console.error('Failed to delete file:', result.error);
    }
  }, []);

  // Handle deleting multiple selected files
  const handleDeleteMultiple = useCallback(async (filePaths: string[]) => {
    for (const path of filePaths) {
      const result = await window.electronAPI.deleteFile(path);
      if (!result.success) {
        console.error('Failed to delete file:', path, result.error);
      }
    }
    // Clear selection after delete
    setSelectedPaths(new Set());
    onSelectionChange?.(new Set());
  }, [setSelectedPaths, onSelectionChange]);

  const handleOpenInDefaultApp = useCallback(async (filePath: string) => {
    const result = await window.electronAPI.openInDefaultApp(filePath);
    if (!result.success) {
      console.error('Failed to open in default app:', result.error);
    }
  }, []);

  // Drag and drop handlers
  const handleDragStart = useCallback((e: React.DragEvent, item: FileTreeItem) => {
    // Prevent dragging by the icon
    const target = e.target as HTMLElement;
    if (target.closest('.file-tree-icon') || target.closest('.file-tree-chevron')) {
      e.preventDefault();
      return;
    }

    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', item.path);
    setDraggedItem(item);

    // Add a custom drag image with just the text
    const dragImage = document.createElement('div');
    dragImage.textContent = item.name;
    dragImage.style.position = 'absolute';
    dragImage.style.top = '-1000px';
    dragImage.style.left = '-1000px';
    dragImage.style.padding = '4px 8px';
    dragImage.style.backgroundColor = '#ffffff';
    dragImage.style.border = '1px solid #e5e7eb';
    dragImage.style.borderRadius = '4px';
    dragImage.style.fontSize = '13px';
    dragImage.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
    dragImage.style.color = '#1f2937';
    dragImage.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
    dragImage.style.zIndex = '10000';
    dragImage.style.pointerEvents = 'none';
    document.body.appendChild(dragImage);
    e.dataTransfer.setDragImage(dragImage, 10, 10);

    // Clean up the drag image after a brief delay
    setTimeout(() => {
      if (document.body.contains(dragImage)) {
        document.body.removeChild(dragImage);
      }
    }, 0);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedItem(null);
    setDragOverItem(null);
    setIsDragCopy(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, item: FileTreeItem) => {
    e.preventDefault();
    e.stopPropagation(); // Stop event from bubbling to parent folders

      // console.log("Drag over:", draggedItem?.path, item.path);

    // Only allow dropping on directories
    if (draggedItem && item.type === 'directory' && item.path !== draggedItem.path) {
      // Don't allow dropping a folder into its own descendants
      if (draggedItem.type === 'directory' && item.path.startsWith(draggedItem.path + '/')) {
        e.dataTransfer.dropEffect = 'none';
        return;
      }

      // Check if Option/Alt key is held for copy
      const isCopy = e.altKey || e.metaKey;
      setIsDragCopy(isCopy);
      e.dataTransfer.dropEffect = isCopy ? 'copy' : 'move';
      setDragOverItem(item.path);
    } else {
      e.dataTransfer.dropEffect = 'none';
    }
  }, [draggedItem]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if we're leaving the element entirely
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (!e.currentTarget.contains(relatedTarget)) {
      setDragOverItem(null);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent, targetItem: FileTreeItem) => {
    e.preventDefault();
    e.stopPropagation();

    // Only allow dropping on directories
    if (!draggedItem || targetItem.type !== 'directory' || draggedItem.path === targetItem.path) {
      setDragOverItem(null);
      return;
    }

    const isCopy = e.altKey || e.metaKey;

    try {
      const targetPath = targetItem.path;

      if (isCopy) {
        const result = await window.electronAPI.copyFile(draggedItem.path, targetPath);
        if (!result.success) {
          console.error('Failed to copy file:', result.error);
        } else {
          // Refresh the file tree if callback is provided
          if (onRefreshFileTree) {
            onRefreshFileTree();
          }
        }
      } else {
        const result = await window.electronAPI.moveFile(draggedItem.path, targetPath);
        if (!result.success) {
          console.error('Failed to move file:', result.error);
        } else {
          // Refresh the file tree if callback is provided
          if (onRefreshFileTree) {
            onRefreshFileTree();
          }
        }
      }
    } catch (error) {
      console.error('Error during drag and drop:', error);
    } finally {
      setDragOverItem(null);
      setDraggedItem(null);
      setIsDragCopy(false);
    }
  }, [draggedItem, onRefreshFileTree]);

  // Update drag effect based on keyboard modifiers
  useEffect(() => {
    const handleKeyChange = (e: KeyboardEvent) => {
      if (draggedItem) {
        setIsDragCopy(e.altKey || e.metaKey);
      }
    };

    window.addEventListener('keydown', handleKeyChange);
    window.addEventListener('keyup', handleKeyChange);

    return () => {
      window.removeEventListener('keydown', handleKeyChange);
      window.removeEventListener('keyup', handleKeyChange);
    };
  }, [draggedItem]);

  return (
    <>
      <ul className="file-tree" style={{ paddingLeft: level > 0 ? '16px' : '0' }}>
      {items.map((item) => {
        const isExpanded = expandedDirs.has(item.path);
        const isDragOver = dragOverItem === item.path;
        const isFolderSelected = selectedFolder === item.path;
        const isMultiSelected = selectedPaths.has(item.path);

        return (
          <li
            key={item.path}
            className="file-tree-item"
            {...(item.type === 'directory' ? {
              onDragOver: (e) => handleDragOver(e, item),
              onDragLeave: handleDragLeave,
              onDrop: (e) => handleDrop(e, item),
            } : {})}
          >
            {item.type === 'directory' ? (
              <>
                <div
                  className={`file-tree-directory ${isDragOver ? 'drag-over' : ''} ${isFolderSelected ? 'selected' : ''} ${isMultiSelected ? 'multi-selected' : ''} ${isSpecialDirectory(item.name) ? 'special-directory' : ''}`}
                  onClick={(e) => {
                    // If shift or meta/ctrl key is pressed, handle selection
                    if (e.shiftKey || e.metaKey || e.ctrlKey) {
                      handleItemSelect(e, item);
                    } else {
                      handleFolderClick(e, item.path);
                      // Also update selection for consistency
                      handleItemSelect(e, item);
                    }
                  }}
                  onContextMenu={(e) => handleContextMenu(e, item)}
                  draggable
                  onDragStart={(e) => handleDragStart(e, item)}
                  onDragEnd={handleDragEnd}
                  style={{
                    opacity: draggedItem?.path === item.path ? 0.5 : 1
                  }}
                >
                  <span className="file-tree-chevron">
                    <MaterialSymbol
                      icon={isExpanded ? "keyboard_arrow_down" : "keyboard_arrow_right"}
                      size={16}
                    />
                  </span>
                  {showIcons && (
                    <span className="file-tree-icon">
                      <MaterialSymbol
                        icon={isExpanded ? "folder_open" : "folder"}
                        size={18}
                      />
                    </span>
                  )}
                  <span className="file-tree-name">
                    {item.name}
                    {isDragOver && isDragCopy && <span style={{ marginLeft: '4px', fontSize: '10px', opacity: 0.7 }}>(copy)</span>}
                  </span>
                  <DirectoryGitStatusIndicator dirPath={item.path} />
                </div>
                {isExpanded && item.children && (
                  <FileTree
                    items={item.children}
                    currentFilePath={currentFilePath}
                    onFileSelect={onFileSelect}
                    level={level + 1}
                    showIcons={showIcons}
                    enableAutoScroll={enableAutoScroll}
                    onNewFile={onNewFile}
                    onNewFolder={onNewFolder}
                    onRefreshFileTree={onRefreshFileTree}
                    onFolderContentsLoaded={onFolderContentsLoaded}
                    onViewHistory={onViewHistory}
                    onViewWorkspaceHistory={onViewWorkspaceHistory}
                    selectedFolder={selectedFolder}
                    onFolderSelect={onFolderSelect}
                    gitStatusMap={gitStatusMap}
                    extensionFileTypes={extensionFileTypes}
                    onSelectionChange={onSelectionChange}
                    rootItems={rootItemsProp ?? (level === 0 ? items : undefined)}
                    sharedDragState={{
                      draggedItem,
                      setDraggedItem,
                      dragOverItem,
                      setDragOverItem,
                      isDragCopy,
                      setIsDragCopy
                    }}
                    sharedExpandedDirs={{
                      expandedDirs,
                      setExpandedDirs
                    }}
                    sharedSelectionState={{
                      selectedPaths,
                      setSelectedPaths,
                      lastSelectedPath,
                      setLastSelectedPath
                    }}
                  />
                )}
              </>
            ) : (
              <div
                className={`file-tree-file ${currentFilePath === item.path ? 'active' : ''} ${isMultiSelected ? 'multi-selected' : ''}`}
                onClick={(e) => handleItemSelect(e, item)}
                onContextMenu={(e) => handleContextMenu(e, item)}
                draggable
                onDragStart={(e) => handleDragStart(e, item)}
                onDragEnd={handleDragEnd}
                style={{
                  opacity: draggedItem?.path === item.path ? 0.5 : 1
                }}
              >
                <span className="file-tree-spacer"></span>
                {showIcons && (
                  <span className="file-tree-icon">
                    {getFileIcon(item.name)}
                  </span>
                )}
                <span className="file-tree-name">
                  {item.name}
                </span>
                <FileGitStatusIndicator filePath={item.path} />
              </div>
            )}
          </li>
        );
      })}
      </ul>
      {contextMenu && (
        <FileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          filePath={contextMenu.filePath}
          fileName={contextMenu.fileName}
          fileType={contextMenu.fileType}
          onClose={() => setContextMenu(null)}
          onRename={handleRename}
          onDelete={handleDelete}
          onDeleteMultiple={handleDeleteMultiple}
          onOpenInDefaultApp={handleOpenInDefaultApp}
          onNewFile={onNewFile}
          onNewFolder={onNewFolder}
          onViewHistory={onViewHistory}
          onViewWorkspaceHistory={onViewWorkspaceHistory}
          selectedPaths={selectedPaths}
          extensionFileTypes={extensionFileTypes}
        />
      )}
    </>
  );
}
