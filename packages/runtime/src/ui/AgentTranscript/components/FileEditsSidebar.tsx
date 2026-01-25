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
  hideControls = false
}) => {
  const [gitStatus, setGitStatus] = useState<Record<string, FileGitStatus>>({});
  // Use prop if provided, otherwise use local state
  const [localGroupByDirectory, setLocalGroupByDirectory] = useState(false);
  const groupByDirectory = groupByDirectoryProp ?? localGroupByDirectory;
  const setGroupByDirectory = onGroupByDirectoryChange ?? setLocalGroupByDirectory;
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Convert absolute path to relative path from workspace root
  const getRelativePath = (filePath: string): string => {
    if (!workspacePath || !filePath.startsWith(workspacePath)) {
      return filePath;
    }
    const relativePath = filePath.slice(workspacePath.length);
    // Remove leading slash if present
    return relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
  };

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

  const getOperationIcon = (operation: string) => {
    const iconClasses: Record<string, string> = {
      create: 'text-[var(--nim-success)]',
      edit: 'text-[var(--nim-primary)]',
      delete: 'text-[var(--nim-error)]',
      rename: 'text-[var(--nim-warning)]'
    };
    const iconNames: Record<string, string> = {
      create: 'add',
      edit: 'edit',
      delete: 'delete',
      rename: 'drive_file_rename_outline'
    };
    if (!iconNames[operation]) return null;
    return (
      <MaterialSymbol icon={iconNames[operation]} size={14} className={`file-edits-sidebar__icon w-3.5 h-3.5 ${iconClasses[operation] || ''}`} />
    );
  };

  const formatFileName = (filePath: string) => {
    // Handle both Windows (\) and Unix (/) path separators
    const parts = filePath.split(/[/\\]/);
    return parts[parts.length - 1];
  };

  // Render git status indicator
  const renderGitStatus = (filePath: string) => {
    const relativePath = getRelativePath(filePath);
    const status = gitStatus[relativePath];
    if (!status || status.status === 'unchanged') {
      return null;
    }

    const statusChar = {
      modified: 'M',
      staged: 'S',
      untracked: '?',
      deleted: 'D',
      unchanged: ''
    }[status.status];

    const statusBgColors: Record<string, string> = {
      modified: 'bg-[var(--nim-warning)]',
      staged: 'bg-[var(--nim-success)]',
      untracked: 'bg-[var(--nim-text-faint)]',
      deleted: 'bg-[var(--nim-error)]'
    };

    return (
      <span
        className={`file-edits-sidebar__git-status inline-flex items-center justify-center w-3.5 h-3.5 text-[0.65rem] font-semibold rounded-sm shrink-0 text-white ${statusBgColors[status.status] || ''} ${status.status === 'untracked' ? 'text-[var(--nim-bg)]' : ''}`}
        title={`Git status: ${status.status}`}
      >
        {statusChar}
      </span>
    );
  };

  const renderFile = ({ filePath, totalAdded, totalRemoved, operation }: { filePath: string; totalAdded: number; totalRemoved: number; operation?: string }) => {
    const hasPendingReview = pendingReviewFiles?.has(filePath);
    return (
      <button
        key={filePath}
        onClick={() => onFileClick?.(filePath)}
        className={`file-edits-sidebar__file w-full text-left px-2 py-1 rounded border border-transparent transition-all bg-transparent hover:bg-[var(--nim-bg-hover)] hover:border-[var(--nim-border)] ${hasPendingReview ? 'bg-[rgba(251,191,36,0.08)] border-[rgba(251,191,36,0.2)] hover:bg-[rgba(251,191,36,0.12)] hover:border-[rgba(251,191,36,0.3)]' : ''}`}
      >
        <div className="file-edits-sidebar__file-content flex items-center gap-1.5">
          {hasPendingReview && (
            <MaterialSymbol
              icon="rate_review"
              size={14}
              className="file-edits-sidebar__pending-icon text-[var(--nim-warning)] shrink-0"
              title="Pending review"
            />
          )}
          {operation && (
            <div className="file-edits-sidebar__file-operation-icon shrink-0">
              {getOperationIcon(operation)}
            </div>
          )}
          {renderGitStatus(filePath)}
          <div className="file-edits-sidebar__file-info flex-1 min-w-0">
            <div className="file-edits-sidebar__file-name text-[0.8125rem] text-[var(--nim-text)] font-medium overflow-hidden text-ellipsis whitespace-nowrap" title={getRelativePath(filePath)}>
              {formatFileName(filePath)}
            </div>
          </div>
          {(totalAdded > 0 || totalRemoved > 0) && (
            <div className="file-edits-sidebar__file-stats flex items-center gap-1 text-[0.6875rem] shrink-0">
              {totalAdded > 0 && (
                <span className="file-edits-sidebar__file-stats-added text-[var(--nim-success)]">+{totalAdded}</span>
              )}
              {totalRemoved > 0 && (
                <span className="file-edits-sidebar__file-stats-removed text-[var(--nim-error)]">-{totalRemoved}</span>
              )}
            </div>
          )}
        </div>
      </button>
    );
  };

  const renderDirectoryNode = (node: DirectoryNode): React.ReactNode => {
    const isExpanded = expandedFolders.has(node.path);
    const hasContent = node.files.length > 0 || node.subdirectories.size > 0;

    return (
      <div key={node.path || 'root'} className="file-edits-sidebar__directory-node mb-0.5">
        {node.displayPath && (
          <button
            onClick={() => toggleFolder(node.path)}
            className="file-edits-sidebar__directory-header w-full flex items-center gap-1 px-2 py-1 text-[0.8125rem] font-medium text-[var(--nim-text-muted)] bg-transparent border border-transparent rounded transition-all cursor-pointer text-left hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)]"
          >
            <MaterialSymbol
              icon={isExpanded ? "expand_more" : "chevron_right"}
              size={16}
              className="file-edits-sidebar__directory-chevron shrink-0 transition-transform text-[var(--nim-text-faint)]"
            />
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
            {node.files.map(file => renderFile(file))}
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
    </div>
  );
};
