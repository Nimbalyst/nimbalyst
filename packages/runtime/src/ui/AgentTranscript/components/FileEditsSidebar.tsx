import React, { useMemo, useState, useEffect, useCallback } from 'react';
import type { FileEditSummary } from '../types';
import { MaterialSymbol } from '../../icons/MaterialSymbol';

interface FileEditsSidebarProps {
  fileEdits: FileEditSummary[];
  onFileClick?: (filePath: string) => void;
  workspacePath?: string;
  /** Set of file paths that have pending AI edits awaiting review */
  pendingReviewFiles?: Set<string>;
  /** Whether to group files by directory (controlled externally) */
  groupByDirectory?: boolean;
  /** Callback when groupByDirectory changes */
  onGroupByDirectoryChange?: (value: boolean) => void;
  /** If true, hide the internal controls (for when controls are rendered externally) */
  hideControls?: boolean;
  /** Callback to open file in Files mode (main editor) */
  onOpenInFiles?: (filePath: string) => void;
  /** Callback to view diff for a file */
  onViewDiff?: (filePath: string) => void;
  /** Callback to copy file path */
  onCopyPath?: (filePath: string) => void;
  /** Callback to reveal file in system file browser */
  onRevealInFinder?: (filePath: string) => void;
  /** Callback to open file in external editor */
  onOpenInExternalEditor?: (filePath: string) => void;
  /** Display name for the external editor (e.g., "VS Code") */
  externalEditorName?: string;
  /** Whether to show checkboxes for file selection (Manual/Worktree mode) */
  showCheckboxes?: boolean;
  /** Set of selected file paths (for checkbox state) */
  selectedFiles?: Set<string>;
  /** Callback when file selection changes */
  onSelectionChange?: (filePath: string, selected: boolean) => void;
  /** Callback to select/deselect all files */
  onSelectAll?: (selected: boolean) => void;
  /** Callback for bulk selection changes (add/remove multiple files at once) */
  onBulkSelectionChange?: (filePaths: string[], selected: boolean) => void;
  /** Whether to show a root-level "Select All" checkbox (defaults to true when showCheckboxes is true) */
  showRootCheckbox?: boolean;
}

interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  filePath: string;
}

interface FileGitStatus {
  status: 'modified' | 'staged' | 'untracked' | 'unchanged' | 'deleted';
  gitStatusCode?: string;
}

interface DirectoryNode {
  path: string;
  displayPath: string;
  files: Array<{ filePath: string; edits: FileEditSummary[]; totalAdded: number; totalRemoved: number; operation?: string; timestamp: string }>;
  subdirectories: Map<string, DirectoryNode>;
  fileCount: number;
}

export const FileEditsSidebar: React.FC<FileEditsSidebarProps> = ({
  fileEdits,
  onFileClick,
  workspacePath,
  pendingReviewFiles,
  groupByDirectory: groupByDirectoryProp,
  onGroupByDirectoryChange,
  hideControls = false,
  onOpenInFiles,
  onViewDiff,
  onCopyPath,
  onRevealInFinder,
  onOpenInExternalEditor,
  externalEditorName,
  showCheckboxes = false,
  selectedFiles,
  onSelectionChange,
  onSelectAll,
  onBulkSelectionChange,
  showRootCheckbox
}) => {
  // Default showRootCheckbox to true when showCheckboxes is true
  const shouldShowRootCheckbox = showRootCheckbox ?? showCheckboxes;
  const [gitStatus, setGitStatus] = useState<Record<string, FileGitStatus>>({});
  // Use prop if provided, otherwise use local state
  const [localGroupByDirectory, setLocalGroupByDirectory] = useState(false);
  const groupByDirectory = groupByDirectoryProp ?? localGroupByDirectory;
  const setGroupByDirectory = onGroupByDirectoryChange ?? setLocalGroupByDirectory;
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ isOpen: false, x: 0, y: 0, filePath: '' });

  // Convert absolute path to relative path from workspace root
  const getRelativePath = useCallback((filePath: string): string => {
    if (!workspacePath || !filePath.startsWith(workspacePath)) {
      return filePath;
    }
    const relativePath = filePath.slice(workspacePath.length);
    // Remove leading slash if present
    return relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
  }, [workspacePath]);

  // Build directory tree from file list
  const buildDirectoryTree = (files: Array<{ filePath: string; edits: FileEditSummary[]; totalAdded: number; totalRemoved: number; operation?: string; timestamp: string }>): DirectoryNode => {
    const root: DirectoryNode = {
      path: '',
      displayPath: '',
      files: [],
      subdirectories: new Map(),
      fileCount: 0
    };

    files.forEach(file => {
      const relativePath = getRelativePath(file.filePath);
      const parts = relativePath.split('/');

      // If file is at root level (no directory)
      if (parts.length === 1) {
        root.files.push(file);
        root.fileCount++;
        return;
      }

      // Build directory tree
      let currentNode = root;
      const dirParts = parts.slice(0, -1);

      dirParts.forEach((part, index) => {
        const pathSoFar = dirParts.slice(0, index + 1).join('/');

        if (!currentNode.subdirectories.has(part)) {
          currentNode.subdirectories.set(part, {
            path: pathSoFar,
            displayPath: part,
            files: [],
            subdirectories: new Map(),
            fileCount: 0
          });
        }

        currentNode = currentNode.subdirectories.get(part)!;
      });

      currentNode.files.push(file);

      // Update file counts up the tree
      let node: DirectoryNode | undefined = currentNode;
      while (node) {
        node.fileCount++;
        // Walk back up to parent
        const parentPath = node.path.split('/').slice(0, -1).join('/');
        if (!parentPath && node.path) {
          // Reached root's child
          node = root;
        } else if (!node.path) {
          // At root
          node = undefined;
        } else {
          // Find parent
          node = findNodeByPath(root, parentPath);
        }
      }
    });

    return collapseDirectoryTree(root);
  };

  // Helper to find a node by path
  const findNodeByPath = (root: DirectoryNode, path: string): DirectoryNode | undefined => {
    if (!path) return root;

    const parts = path.split('/');
    let current = root;

    for (const part of parts) {
      const next = current.subdirectories.get(part);
      if (!next) return undefined;
      current = next;
    }

    return current;
  };

  // Collapse single-child directory paths
  const collapseDirectoryTree = (node: DirectoryNode): DirectoryNode => {
    // First, recursively collapse all subdirectories
    node.subdirectories.forEach((subdir, key) => {
      node.subdirectories.set(key, collapseDirectoryTree(subdir));
    });

    // If this node has exactly one subdirectory and no files, collapse it
    if (node.subdirectories.size === 1 && node.files.length === 0) {
      const [, childNode] = Array.from(node.subdirectories.entries())[0];

      // Merge the paths
      const newDisplayPath = node.displayPath
        ? `${node.displayPath}/${childNode.displayPath}`
        : childNode.displayPath;

      return {
        ...childNode,
        displayPath: newDisplayPath
      };
    }

    return node;
  };

  // Group edited files by file path
  const editedFiles = useMemo(() => {
    const edited = fileEdits.filter(edit => edit.linkType === 'edited');

    // Group by file path
    const groups = new Map<string, FileEditSummary[]>();
    edited.forEach(file => {
      const existing = groups.get(file.filePath) || [];
      existing.push(file);
      groups.set(file.filePath, existing);
    });

    return Array.from(groups.entries()).map(([filePath, edits]) => {
      const totalAdded = edits.reduce((sum, e) => sum + (e.linesAdded || 0), 0);
      const totalRemoved = edits.reduce((sum, e) => sum + (e.linesRemoved || 0), 0);
      const lastEdit = edits[edits.length - 1];

      return {
        filePath,
        edits,
        totalAdded,
        totalRemoved,
        operation: lastEdit.operation,
        timestamp: lastEdit.timestamp
      };
    });
  }, [fileEdits]);

  // Fetch git status for edited files
  useEffect(() => {
    if (!workspacePath || editedFiles.length === 0) {
      setGitStatus({});
      return;
    }

    const fetchGitStatus = async () => {
      try {
        const filePaths = editedFiles.map(f => getRelativePath(f.filePath));

        if (typeof window !== 'undefined' && (window as any).electronAPI) {
          const result = await (window as any).electronAPI.invoke(
            'git:get-file-status',
            workspacePath,
            filePaths
          );
          if (result.success && result.status) {
            setGitStatus(result.status);
          }
        }
      } catch (error) {
        console.error('[FileEditsSidebar] Failed to fetch git status:', error);
      }
    };

    fetchGitStatus();

    // Refresh on window focus
    const handleFocus = () => {
      fetchGitStatus();
    };

    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [editedFiles, workspacePath]);

  const toggleFolder = (folderPath: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return next;
    });
  };

  const getAllFolderPaths = (node: DirectoryNode, paths: string[] = []): string[] => {
    if (node.path) {
      paths.push(node.path);
    }
    node.subdirectories.forEach(subdir => {
      getAllFolderPaths(subdir, paths);
    });
    return paths;
  };

  const expandAll = useCallback(() => {
    if (editedFiles.length > 0) {
      const tree = buildDirectoryTree(editedFiles);
      const allPaths = getAllFolderPaths(tree);
      setExpandedFolders(new Set(allPaths));
    }
  }, [editedFiles]);

  const collapseAll = useCallback(() => {
    setExpandedFolders(new Set());
  }, []);

  // Auto-expand all folders when groupByDirectory is enabled or files change
  useEffect(() => {
    if (groupByDirectory && editedFiles.length > 0) {
      const tree = buildDirectoryTree(editedFiles);
      const allPaths = getAllFolderPaths(tree);
      setExpandedFolders(new Set(allPaths));
    }
  }, [groupByDirectory, editedFiles]);

  // Listen for external expand/collapse events (when hideControls is true)
  useEffect(() => {
    if (!hideControls) return;

    const handleExpandAll = () => expandAll();
    const handleCollapseAll = () => collapseAll();

    window.addEventListener('file-edits-sidebar:expand-all', handleExpandAll);
    window.addEventListener('file-edits-sidebar:collapse-all', handleCollapseAll);

    return () => {
      window.removeEventListener('file-edits-sidebar:expand-all', handleExpandAll);
      window.removeEventListener('file-edits-sidebar:collapse-all', handleCollapseAll);
    };
  }, [hideControls, expandAll, collapseAll]);

  // Check if file has uncommitted changes (is selectable for commit)
  const isFileCommitted = useCallback((filePath: string): boolean => {
    const relativePath = getRelativePath(filePath);
    const status = gitStatus[relativePath];
    return !status || status.status === 'unchanged';
  }, [gitStatus, getRelativePath]);

  // Calculate root-level selection state for "Select All" checkbox
  const rootSelectionInfo = useMemo(() => {
    const allFilePaths = editedFiles.map(f => f.filePath);
    const uncommittedPaths = allFilePaths.filter(p => !isFileCommitted(p));
    const uncommittedCount = uncommittedPaths.length;

    if (uncommittedCount === 0) {
      return { state: 'none' as const, uncommittedCount: 0 };
    }

    const selectedCount = uncommittedPaths.filter(p => selectedFiles?.has(p)).length;
    if (selectedCount === 0) {
      return { state: 'none' as const, uncommittedCount };
    }
    if (selectedCount === uncommittedCount) {
      return { state: 'all' as const, uncommittedCount };
    }
    return { state: 'some' as const, uncommittedCount };
  }, [editedFiles, selectedFiles, isFileCommitted]);

  // Get file status color class based on operation and git status
  const getFileStatusColor = (filePath: string, operation?: string): string => {
    const relativePath = getRelativePath(filePath);
    const status = gitStatus[relativePath];

    // If file has no git changes (committed/unchanged), use committed color
    const isCommitted = !status || status.status === 'unchanged';

    if (isCommitted) {
      return 'text-[var(--nim-file-committed)]';
    }

    // File has uncommitted changes - color by operation type
    if (operation === 'delete') {
      return 'text-[var(--nim-file-deleted)]';
    }
    if (operation === 'create') {
      return 'text-[var(--nim-file-new)]';
    }
    // edit, rename, or unknown operation
    return 'text-[var(--nim-file-edited)]';
  };

  // Get tooltip text for file status
  const getFileStatusTooltip = (filePath: string, operation?: string): string => {
    const relativePath = getRelativePath(filePath);
    const status = gitStatus[relativePath];

    const isCommitted = !status || status.status === 'unchanged';

    if (isCommitted) {
      if (operation === 'delete') {
        return `${relativePath} - Deleted and committed`;
      }
      return `${relativePath} - Committed`;
    }

    // Build tooltip based on operation and git status
    const operationText = {
      create: 'Created',
      edit: 'Edited',
      delete: 'Deleted',
      rename: 'Renamed'
    }[operation || 'edit'] || 'Modified';

    const gitStatusText = status ? ` (${status.status})` : '';
    return `${relativePath} - ${operationText}${gitStatusText}`;
  };

  const formatFileName = (filePath: string) => {
    // Handle both Windows (\) and Unix (/) path separators
    const parts = filePath.split(/[/\\]/);
    return parts[parts.length - 1];
  };

  // Context menu handlers
  const handleContextMenu = (e: React.MouseEvent, filePath: string) => {
    e.preventDefault();
    setContextMenu({
      isOpen: true,
      x: e.clientX,
      y: e.clientY,
      filePath
    });
  };

  const closeContextMenu = () => {
    setContextMenu({ isOpen: false, x: 0, y: 0, filePath: '' });
  };

  // Close context menu when clicking outside
  useEffect(() => {
    if (contextMenu.isOpen) {
      const handleClick = () => closeContextMenu();
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
    return undefined;
  }, [contextMenu.isOpen]);

  const renderContextMenu = () => {
    if (!contextMenu.isOpen) return null;

    const hasContextActions = onOpenInFiles || onViewDiff || onCopyPath || onRevealInFinder || onOpenInExternalEditor;
    if (!hasContextActions) return null;

    return (
      <div
        className="file-edits-sidebar__context-menu fixed z-50 bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded-md shadow-lg py-1 min-w-[180px]"
        style={{ left: contextMenu.x, top: contextMenu.y }}
        onClick={(e) => e.stopPropagation()}
      >
        {onOpenInFiles && (
          <button
            className="file-edits-sidebar__context-menu-item w-full flex items-center gap-2 px-3 py-1.5 text-[0.8125rem] text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)] text-left"
            onClick={() => {
              onOpenInFiles(contextMenu.filePath);
              closeContextMenu();
            }}
          >
            <MaterialSymbol icon="open_in_new" size={16} className="text-[var(--nim-text-muted)]" />
            Open in Files
          </button>
        )}
        {onViewDiff && (
          <button
            className="file-edits-sidebar__context-menu-item w-full flex items-center gap-2 px-3 py-1.5 text-[0.8125rem] text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)] text-left"
            onClick={() => {
              onViewDiff(contextMenu.filePath);
              closeContextMenu();
            }}
          >
            <MaterialSymbol icon="difference" size={16} className="text-[var(--nim-text-muted)]" />
            View Diff
          </button>
        )}
        {onOpenInExternalEditor && externalEditorName && (
          <button
            className="file-edits-sidebar__context-menu-item w-full flex items-center gap-2 px-3 py-1.5 text-[0.8125rem] text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)] text-left"
            onClick={() => {
              onOpenInExternalEditor(contextMenu.filePath);
              closeContextMenu();
            }}
          >
            <MaterialSymbol icon="open_in_new" size={16} className="text-[var(--nim-text-muted)]" />
            Open in {externalEditorName}
          </button>
        )}
        {(onOpenInFiles || onViewDiff || onOpenInExternalEditor) && (onCopyPath || onRevealInFinder) && (
          <div className="file-edits-sidebar__context-menu-divider h-px bg-[var(--nim-border)] my-1" />
        )}
        {onCopyPath && (
          <button
            className="file-edits-sidebar__context-menu-item w-full flex items-center gap-2 px-3 py-1.5 text-[0.8125rem] text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)] text-left"
            onClick={() => {
              onCopyPath(contextMenu.filePath);
              closeContextMenu();
            }}
          >
            <MaterialSymbol icon="content_copy" size={16} className="text-[var(--nim-text-muted)]" />
            Copy Path
          </button>
        )}
        {onRevealInFinder && (
          <button
            className="file-edits-sidebar__context-menu-item w-full flex items-center gap-2 px-3 py-1.5 text-[0.8125rem] text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)] text-left"
            onClick={() => {
              onRevealInFinder(contextMenu.filePath);
              closeContextMenu();
            }}
          >
            <MaterialSymbol icon="folder_open" size={16} className="text-[var(--nim-text-muted)]" />
            Reveal in Finder
          </button>
        )}
      </div>
    );
  };

  const renderFile = ({ filePath, operation }: { filePath: string; totalAdded: number; totalRemoved: number; operation?: string }, isInDirectory = false) => {
    const hasPendingReview = pendingReviewFiles?.has(filePath);
    const fileColorClass = getFileStatusColor(filePath, operation);
    const isDeleted = operation === 'delete';
    const tooltip = getFileStatusTooltip(filePath, operation);
    const committed = isFileCommitted(filePath);
    const isSelected = selectedFiles?.has(filePath) ?? false;

    // Handler to toggle file selection without triggering file click
    const handleCheckboxClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelectionChange?.(filePath, !isSelected);
    };

    return (
      <button
        key={filePath}
        onClick={() => onFileClick?.(filePath)}
        onContextMenu={(e) => handleContextMenu(e, filePath)}
        className={`file-edits-sidebar__file w-full text-left px-2 py-0.5 rounded border border-transparent transition-all bg-transparent hover:bg-[var(--nim-bg-hover)] hover:border-[var(--nim-border)] ${hasPendingReview ? 'bg-[rgba(251,191,36,0.08)] border-[rgba(251,191,36,0.2)] hover:bg-[rgba(251,191,36,0.12)] hover:border-[rgba(251,191,36,0.3)]' : ''}`}
        title={tooltip}
      >
        <div className="file-edits-sidebar__file-content flex items-center gap-1">
          {/* Placeholder for expand caret (to align with folder rows) - only in directory tree */}
          {isInDirectory && (
            <div className="file-edits-sidebar__caret-placeholder w-4 h-4 shrink-0" />
          )}
          {/* Checkbox for commit selection - only show when in checkbox mode */}
          {showCheckboxes && (
            committed ? (
              // Placeholder for committed files (no checkbox)
              <div className="file-edits-sidebar__checkbox-placeholder w-4 h-4 shrink-0" />
            ) : (
              // Checkbox for uncommitted files
              <div
                onClick={handleCheckboxClick}
                className={`file-edits-sidebar__checkbox w-4 h-4 shrink-0 rounded-[3px] border-[1.5px] cursor-pointer flex items-center justify-center transition-all ${
                  isSelected
                    ? 'bg-[var(--nim-file-edited)] border-[var(--nim-file-edited)]'
                    : 'border-[var(--nim-text-faint)] bg-transparent hover:border-[var(--nim-text-muted)]'
                }`}
              >
                {isSelected && (
                  <svg width="8" height="6" viewBox="0 0 8 6" fill="none" className="text-white">
                    <path d="M1 3L3 5L7 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
            )
          )}
          <div className="file-edits-sidebar__file-info flex-1 min-w-0">
            <div
              className={`file-edits-sidebar__file-name text-[0.8125rem] font-medium overflow-hidden text-ellipsis whitespace-nowrap ${fileColorClass} ${isDeleted ? 'line-through' : ''}`}
            >
              {formatFileName(filePath)}
            </div>
          </div>
        </div>
      </button>
    );
  };

  // Helper to collect all file paths from a directory node recursively
  const collectFilePaths = (node: DirectoryNode): string[] => {
    const paths: string[] = [];
    node.files.forEach(f => paths.push(f.filePath));
    node.subdirectories.forEach(subdir => {
      paths.push(...collectFilePaths(subdir));
    });
    return paths;
  };

  // Helper to check if all uncommitted files in a directory are selected
  const getDirectorySelectionState = (node: DirectoryNode): 'none' | 'some' | 'all' => {
    const allPaths = collectFilePaths(node);
    const uncommittedPaths = allPaths.filter(p => !isFileCommitted(p));

    if (uncommittedPaths.length === 0) return 'none'; // All files are committed

    const selectedCount = uncommittedPaths.filter(p => selectedFiles?.has(p)).length;
    if (selectedCount === 0) return 'none';
    if (selectedCount === uncommittedPaths.length) return 'all';
    return 'some';
  };

  // Toggle selection for all uncommitted files in a directory
  const handleDirectoryCheckboxClick = (e: React.MouseEvent, node: DirectoryNode) => {
    e.stopPropagation();
    const allPaths = collectFilePaths(node);
    const uncommittedPaths = allPaths.filter(p => !isFileCommitted(p));
    const selectionState = getDirectorySelectionState(node);

    // If none or some are selected, select all. If all are selected, deselect all.
    const shouldSelect = selectionState !== 'all';

    // Use bulk selection if available (handles multiple files atomically)
    if (onBulkSelectionChange) {
      onBulkSelectionChange(uncommittedPaths, shouldSelect);
    } else {
      // Fallback to individual calls (may have race condition issues)
      uncommittedPaths.forEach(p => {
        onSelectionChange?.(p, shouldSelect);
      });
    }
  };

  const renderDirectoryNode = (node: DirectoryNode): React.ReactNode => {
    const isExpanded = expandedFolders.has(node.path);
    const hasContent = node.files.length > 0 || node.subdirectories.size > 0;

    // Check if directory has any uncommitted files (for checkbox visibility)
    const allPaths = collectFilePaths(node);
    const hasUncommittedFiles = allPaths.some(p => !isFileCommitted(p));
    const selectionState = getDirectorySelectionState(node);

    return (
      <div key={node.path || 'root'} className="file-edits-sidebar__directory-node mb-0.5">
        {node.displayPath && (
          <button
            onClick={() => toggleFolder(node.path)}
            className="file-edits-sidebar__directory-header w-full flex items-center gap-1 px-2 py-0.5 text-[0.8125rem] font-medium text-[var(--nim-text-muted)] bg-transparent border border-transparent rounded transition-all cursor-pointer text-left hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)]"
          >
            <MaterialSymbol
              icon={isExpanded ? "expand_more" : "chevron_right"}
              size={16}
              className="file-edits-sidebar__directory-chevron shrink-0 transition-transform text-[var(--nim-text-faint)]"
            />
            {/* Directory checkbox - between caret and folder icon */}
            {showCheckboxes && (
              hasUncommittedFiles ? (
                <div
                  onClick={(e) => handleDirectoryCheckboxClick(e, node)}
                  className={`file-edits-sidebar__checkbox w-4 h-4 shrink-0 rounded-[3px] border-[1.5px] cursor-pointer flex items-center justify-center transition-all ${
                    selectionState === 'all'
                      ? 'bg-[var(--nim-file-edited)] border-[var(--nim-file-edited)]'
                      : selectionState === 'some'
                        ? 'bg-[var(--nim-file-edited)] border-[var(--nim-file-edited)] opacity-60'
                        : 'border-[var(--nim-text-faint)] bg-transparent hover:border-[var(--nim-text-muted)]'
                  }`}
                >
                  {selectionState !== 'none' && (
                    selectionState === 'all' ? (
                      <svg width="8" height="6" viewBox="0 0 8 6" fill="none" className="text-white">
                        <path d="M1 3L3 5L7 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    ) : (
                      // Indeterminate state (dash)
                      <div className="w-2 h-0.5 bg-white rounded-full" />
                    )
                  )}
                </div>
              ) : (
                // Placeholder when no uncommitted files
                <div className="file-edits-sidebar__checkbox-placeholder w-4 h-4 shrink-0" />
              )
            )}
            <MaterialSymbol
              icon={isExpanded ? "folder_open" : "folder"}
              size={16}
              className="file-edits-sidebar__directory-icon shrink-0 text-[var(--nim-text-muted)]"
            />
            <span className="file-edits-sidebar__directory-path flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{node.displayPath}</span>
            <span className="file-edits-sidebar__directory-count shrink-0 px-1 py-0.5 bg-[var(--nim-bg-tertiary)] rounded text-[9px] text-[var(--nim-text-faint)]">{node.fileCount}</span>
          </button>
        )}

        {(isExpanded || !node.displayPath) && hasContent && (
          <div className={node.displayPath ? "file-edits-sidebar__directory-children mt-0.5 pl-4" : undefined}>
            {/* Render subdirectories first */}
            {Array.from(node.subdirectories.values()).map(subdir =>
              renderDirectoryNode(subdir)
            )}

            {/* Render files */}
            {node.files.map(file => renderFile(file, true))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="file-edits-sidebar flex flex-col h-full bg-[var(--nim-bg-secondary)]">
      {!hideControls && editedFiles.length > 0 && (
        <div className="file-edits-sidebar__controls flex items-center gap-1 p-2 border-b border-[var(--nim-border)] bg-[var(--nim-bg-secondary)]">
          <button
            onClick={() => setGroupByDirectory(!groupByDirectory)}
            className={`file-edits-sidebar__control-button flex items-center justify-center w-7 h-7 p-0 border border-[var(--nim-border)] rounded bg-[var(--nim-bg)] text-[var(--nim-text-muted)] cursor-pointer transition-all hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)] disabled:opacity-40 disabled:cursor-not-allowed ${groupByDirectory ? 'bg-[var(--nim-primary)] text-white border-[var(--nim-primary)]' : ''}`}
            title="Group by directory"
          >
            <MaterialSymbol icon="folder" size={18} />
          </button>
          <button
            onClick={expandAll}
            disabled={!groupByDirectory}
            className="file-edits-sidebar__control-button flex items-center justify-center w-7 h-7 p-0 border border-[var(--nim-border)] rounded bg-[var(--nim-bg)] text-[var(--nim-text-muted)] cursor-pointer transition-all hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)] disabled:opacity-40 disabled:cursor-not-allowed"
            title="Expand all"
          >
            <MaterialSymbol icon="unfold_more" size={18} />
          </button>
          <button
            onClick={collapseAll}
            disabled={!groupByDirectory}
            className="file-edits-sidebar__control-button flex items-center justify-center w-7 h-7 p-0 border border-[var(--nim-border)] rounded bg-[var(--nim-bg)] text-[var(--nim-text-muted)] cursor-pointer transition-all hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)] disabled:opacity-40 disabled:cursor-not-allowed"
            title="Collapse all"
          >
            <MaterialSymbol icon="unfold_less" size={18} />
          </button>
        </div>
      )}
      <div className="file-edits-sidebar__files flex-1 overflow-y-auto p-1">
        {/* Root "Select All" checkbox */}
        {shouldShowRootCheckbox && editedFiles.length > 0 && rootSelectionInfo.uncommittedCount > 0 && (
          <div className="file-edits-sidebar__root-checkbox flex items-center gap-2 px-2 py-1.5 mb-1 border-b border-[var(--nim-border)]">
            <div
              onClick={() => onSelectAll?.(rootSelectionInfo.state !== 'all')}
              className={`w-4 h-4 shrink-0 rounded-[3px] border-[1.5px] cursor-pointer flex items-center justify-center transition-all ${
                rootSelectionInfo.state === 'all'
                  ? 'bg-[var(--nim-file-edited)] border-[var(--nim-file-edited)]'
                  : rootSelectionInfo.state === 'some'
                    ? 'bg-[var(--nim-file-edited)] border-[var(--nim-file-edited)] opacity-60'
                    : 'border-[var(--nim-text-faint)] bg-transparent hover:border-[var(--nim-text-muted)]'
              }`}
            >
              {rootSelectionInfo.state !== 'none' && (
                rootSelectionInfo.state === 'all' ? (
                  <svg width="8" height="6" viewBox="0 0 8 6" fill="none" className="text-white">
                    <path d="M1 3L3 5L7 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : (
                  <div className="w-2 h-0.5 bg-white rounded-full" />
                )
              )}
            </div>
            <span className="text-[0.8125rem] text-[var(--nim-text-muted)]">
              Select all ({rootSelectionInfo.uncommittedCount} uncommitted)
            </span>
          </div>
        )}
        {editedFiles.length === 0 ? (
          <div className="file-edits-sidebar__empty p-4 text-[var(--nim-text-faint)] text-sm text-center">
            No files edited yet
          </div>
        ) : groupByDirectory ? (
          renderDirectoryNode(buildDirectoryTree(editedFiles))
        ) : (
          editedFiles.map(file => renderFile(file))
        )}
      </div>
      {renderContextMenu()}
    </div>
  );
};
