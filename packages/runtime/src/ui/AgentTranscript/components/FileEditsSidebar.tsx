import React, { useMemo, useState, useEffect } from 'react';
import type { FileEditSummary } from '../types';
import { formatTimeAgo } from '../../../utils/dateUtils';
import { MaterialSymbol } from '../../icons/MaterialSymbol';
import './FileEditsSidebar.css';

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
  onGroupByDirectoryChange
}) => {
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
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
      const fileName = parts[parts.length - 1];
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
      const [childKey, childNode] = Array.from(node.subdirectories.entries())[0];

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

  // Group edits by link type, then by file path
  const groupedByType = useMemo(() => {
    const editedFiles: FileEditSummary[] = [];
    const referencedFiles: FileEditSummary[] = [];
    const readFiles: FileEditSummary[] = [];

    fileEdits.forEach(edit => {
      if (edit.linkType === 'edited') {
        editedFiles.push(edit);
      } else if (edit.linkType === 'referenced') {
        referencedFiles.push(edit);
      } else if (edit.linkType === 'read') {
        readFiles.push(edit);
      }
    });

    // Group by file path within each type
    const groupByPath = (files: FileEditSummary[]) => {
      const groups = new Map<string, FileEditSummary[]>();
      files.forEach(file => {
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
    };

    return {
      edited: groupByPath(editedFiles),
      referenced: groupByPath(referencedFiles),
      read: groupByPath(readFiles)
    };
  }, [fileEdits]);

  // Fetch git status for edited files
  useEffect(() => {
    if (!workspacePath || groupedByType.edited.length === 0) {
      setGitStatus({});
      return;
    }

    const fetchGitStatus = async () => {
      try {
        // Get list of edited file paths
        const filePaths = groupedByType.edited.map(f => getRelativePath(f.filePath));

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
  }, [groupedByType.edited, workspacePath]);

  const toggleSection = (sectionName: string) => {
    setCollapsedSections(prev => ({
      ...prev,
      [sectionName]: !prev[sectionName]
    }));
  };

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

  const expandAll = () => {
    const allPaths: string[] = [];
    if (groupedByType.edited.length > 0) {
      const tree = buildDirectoryTree(groupedByType.edited);
      getAllFolderPaths(tree, allPaths);
    }
    if (groupedByType.referenced.length > 0) {
      const tree = buildDirectoryTree(groupedByType.referenced);
      getAllFolderPaths(tree, allPaths);
    }
    if (groupedByType.read.length > 0) {
      const tree = buildDirectoryTree(groupedByType.read);
      getAllFolderPaths(tree, allPaths);
    }
    setExpandedFolders(new Set(allPaths));
  };

  const collapseAll = () => {
    setExpandedFolders(new Set());
  };

  // Auto-expand all folders when groupByDirectory is enabled
  useEffect(() => {
    if (groupByDirectory) {
      const allPaths: string[] = [];
      if (groupedByType.edited.length > 0) {
        const tree = buildDirectoryTree(groupedByType.edited);
        getAllFolderPaths(tree, allPaths);
      }
      if (groupedByType.referenced.length > 0) {
        const tree = buildDirectoryTree(groupedByType.referenced);
        getAllFolderPaths(tree, allPaths);
      }
      if (groupedByType.read.length > 0) {
        const tree = buildDirectoryTree(groupedByType.read);
        getAllFolderPaths(tree, allPaths);
      }
      setExpandedFolders(new Set(allPaths));
    }
  }, [groupByDirectory]);

  const getOperationIcon = (operation: string) => {
    switch (operation) {
      case 'create':
        return (
          <MaterialSymbol icon="add" size={14} className="file-edits-sidebar__icon file-edits-sidebar__icon--create" />
        );
      case 'edit':
        return (
          <MaterialSymbol icon="edit" size={14} className="file-edits-sidebar__icon file-edits-sidebar__icon--edit" />
        );
      case 'delete':
        return (
          <MaterialSymbol icon="delete" size={14} className="file-edits-sidebar__icon file-edits-sidebar__icon--delete" />
        );
      case 'rename':
        return (
          <MaterialSymbol icon="drive_file_rename_outline" size={14} className="file-edits-sidebar__icon file-edits-sidebar__icon--rename" />
        );
      default:
        return null;
    }
  };

  const formatFileName = (filePath: string) => {
    const parts = filePath.split('/');
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

    const statusClassName = `file-edits-sidebar__git-status file-edits-sidebar__git-status--${status.status}`;

    return (
      <span
        className={statusClassName}
        title={`Git status: ${status.status}`}
      >
        {statusChar}
      </span>
    );
  };

  const getLinkTypeIcon = (linkType: 'edited' | 'referenced' | 'read') => {
    switch (linkType) {
      case 'edited':
        return (
          <MaterialSymbol icon="edit" size={14} className="file-edits-sidebar__section-icon" />
        );
      case 'referenced':
        return (
          <MaterialSymbol icon="tag" size={14} className="file-edits-sidebar__section-icon" />
        );
      case 'read':
        return (
          <MaterialSymbol icon="visibility" size={14} className="file-edits-sidebar__section-icon" />
        );
    }
  };

  const renderDirectoryNode = (
    node: DirectoryNode,
    linkType: 'edited' | 'referenced' | 'read',
    depth: number = 0
  ): React.ReactNode => {
    const isExpanded = expandedFolders.has(node.path);
    const hasContent = node.files.length > 0 || node.subdirectories.size > 0;

    return (
      <div key={node.path} className="file-edits-sidebar__directory-node" style={{ paddingLeft: `${depth * 12}px` }}>
        {node.displayPath && (
          <button
            onClick={() => toggleFolder(node.path)}
            className="file-edits-sidebar__directory-header"
          >
            <MaterialSymbol
              icon={isExpanded ? "expand_more" : "chevron_right"}
              size={16}
              className="file-edits-sidebar__directory-chevron"
            />
            <MaterialSymbol
              icon={isExpanded ? "folder_open" : "folder"}
              size={16}
              className="file-edits-sidebar__directory-icon"
            />
            <span className="file-edits-sidebar__directory-path">{node.displayPath}</span>
            <span className="file-edits-sidebar__directory-count">{node.fileCount}</span>
          </button>
        )}

        {(isExpanded || !node.displayPath) && hasContent && (
          <div className="file-edits-sidebar__directory-children">
            {/* Render subdirectories first */}
            {Array.from(node.subdirectories.values()).map(subdir =>
              renderDirectoryNode(subdir, linkType, node.displayPath ? depth + 1 : depth)
            )}

            {/* Render files */}
            {node.files.map(({ filePath, totalAdded, totalRemoved, operation, timestamp, edits }) => {
              const hasPendingReview = linkType === 'edited' && pendingReviewFiles?.has(filePath);
              return (
                <button
                  key={filePath}
                  onClick={() => onFileClick?.(filePath)}
                  className={`file-edits-sidebar__file ${hasPendingReview ? 'file-edits-sidebar__file--pending' : ''}`}
                  style={{ paddingLeft: `${(node.displayPath ? depth + 1 : depth) * 12 + 24}px` }}
                >
                  <div className="file-edits-sidebar__file-content">
                    {hasPendingReview && (
                      <MaterialSymbol
                        icon="rate_review"
                        size={14}
                        className="file-edits-sidebar__pending-icon"
                        title="Pending review"
                      />
                    )}
                    {operation && (
                      <div className="file-edits-sidebar__file-operation-icon">
                        {getOperationIcon(operation)}
                      </div>
                    )}
                    {linkType === 'edited' && renderGitStatus(filePath)}
                    <div className="file-edits-sidebar__file-info">
                      <div className="file-edits-sidebar__file-name" title={getRelativePath(filePath)}>
                        {formatFileName(filePath)}
                      </div>
                    </div>
                    {linkType === 'edited' && (totalAdded > 0 || totalRemoved > 0) && (
                      <div className="file-edits-sidebar__file-stats">
                        {totalAdded > 0 && (
                          <span className="file-edits-sidebar__file-stats-added">+{totalAdded}</span>
                        )}
                        {totalRemoved > 0 && (
                          <span className="file-edits-sidebar__file-stats-removed">-{totalRemoved}</span>
                        )}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderSection = (
    title: string,
    linkType: 'edited' | 'referenced' | 'read',
    files: Array<{ filePath: string; edits: FileEditSummary[]; totalAdded: number; totalRemoved: number; operation?: string; timestamp: string }>
  ) => {
    if (files.length === 0) return null;

    const isCollapsed = collapsedSections[linkType];

    return (
      <div key={linkType} className="file-edits-sidebar__section">
        <button
          onClick={() => toggleSection(linkType)}
          className="file-edits-sidebar__section-header"
        >
          <div className="file-edits-sidebar__section-header-content">
            {getLinkTypeIcon(linkType)}
            <span>{title}</span>
            <span className="file-edits-sidebar__section-count">
              {files.length}
            </span>
          </div>
          <MaterialSymbol
            icon={isCollapsed ? "chevron_right" : "expand_more"}
            size={16}
            className={`file-edits-sidebar__section-chevron ${isCollapsed ? 'file-edits-sidebar__section-chevron--collapsed' : ''}`}
          />
        </button>

        {!isCollapsed && (
          <div className="file-edits-sidebar__section-files">
            {groupByDirectory ? (
              // Directory mode: render directory tree
              renderDirectoryNode(buildDirectoryTree(files), linkType)
            ) : (
              // Flat mode: render files directly
              files.map(({ filePath, totalAdded, totalRemoved, operation, timestamp, edits }) => {
                const hasPendingReview = linkType === 'edited' && pendingReviewFiles?.has(filePath);
                return (
                  <button
                    key={filePath}
                    onClick={() => onFileClick?.(filePath)}
                    className={`file-edits-sidebar__file ${hasPendingReview ? 'file-edits-sidebar__file--pending' : ''}`}
                  >
                    <div className="file-edits-sidebar__file-content">
                      {hasPendingReview && (
                        <MaterialSymbol
                          icon="rate_review"
                          size={14}
                          className="file-edits-sidebar__pending-icon"
                          title="Pending review"
                        />
                      )}
                      {operation && (
                        <div className="file-edits-sidebar__file-operation-icon">
                          {getOperationIcon(operation)}
                        </div>
                      )}
                      {linkType === 'edited' && renderGitStatus(filePath)}
                      <div className="file-edits-sidebar__file-info">
                        <div className="file-edits-sidebar__file-name" title={getRelativePath(filePath)}>
                          {formatFileName(filePath)}
                        </div>
                      </div>
                      {linkType === 'edited' && (totalAdded > 0 || totalRemoved > 0) && (
                        <div className="file-edits-sidebar__file-stats">
                          {totalAdded > 0 && (
                            <span className="file-edits-sidebar__file-stats-added">+{totalAdded}</span>
                          )}
                          {totalRemoved > 0 && (
                            <span className="file-edits-sidebar__file-stats-removed">-{totalRemoved}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
    );
  };

  const totalFiles = groupedByType.edited.length + groupedByType.referenced.length + groupedByType.read.length;

  return (
    <div className="file-edits-sidebar">
      {totalFiles > 0 && (
        <div className="file-edits-sidebar__controls">
          <button
            onClick={() => setGroupByDirectory(!groupByDirectory)}
            className={`file-edits-sidebar__control-button ${groupByDirectory ? 'file-edits-sidebar__control-button--active' : ''}`}
            title="Group by directory"
          >
            <MaterialSymbol icon="folder" size={18} />
          </button>
          <button
            onClick={expandAll}
            disabled={!groupByDirectory}
            className="file-edits-sidebar__control-button"
            title="Expand all"
          >
            <MaterialSymbol icon="unfold_more" size={18} />
          </button>
          <button
            onClick={collapseAll}
            disabled={!groupByDirectory}
            className="file-edits-sidebar__control-button"
            title="Collapse all"
          >
            <MaterialSymbol icon="unfold_less" size={18} />
          </button>
        </div>
      )}
      <div className="file-edits-sidebar__content">
        {totalFiles === 0 ? (
          <div className="file-edits-sidebar__empty">
            No file interactions yet
          </div>
        ) : (
          <>
            {renderSection('Edited', 'edited', groupedByType.edited)}
            {renderSection('Referenced', 'referenced', groupedByType.referenced)}
            {renderSection('Read', 'read', groupedByType.read)}
          </>
        )}
      </div>
    </div>
  );
};
