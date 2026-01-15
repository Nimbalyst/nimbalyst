import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime';
import { getFileName } from '../../utils/pathUtils';
import { diffTreeGroupByDirectoryAtom, setDiffTreeGroupByDirectoryAtom } from '../../store/atoms/projectState';
import './FileGutter.css';

interface FileGutterProps {
  sessionId: string | null;
  workspacePath?: string;
  type: 'referenced' | 'edited';
  onFileClick?: (filePath: string) => void;
  /** Optional: Set of file paths that have pending AI edits awaiting review */
  pendingReviewFiles?: Set<string>;
}

interface FileData {
  filePath: string;
  operation?: 'create' | 'edit' | 'delete' | 'rename';
  linesAdded?: number;
  linesRemoved?: number;
}

interface FileGitStatus {
  status: 'modified' | 'staged' | 'untracked' | 'unchanged' | 'deleted';
  gitStatusCode?: string;
}

interface DirectoryNode {
  path: string;
  displayPath: string;
  files: FileData[];
  subdirectories: Map<string, DirectoryNode>;
  fileCount: number;
}

export function FileGutter({ sessionId, workspacePath, type, onFileClick, pendingReviewFiles }: FileGutterProps) {
  const [files, setFiles] = useState<FileData[]>([]);
  const [isExpanded, setIsExpanded] = useState(true);
  const [gitStatus, setGitStatus] = useState<Record<string, FileGitStatus>>({});
  const [groupByDirectory] = useAtom(diffTreeGroupByDirectoryAtom);
  const setDiffTreeGroupByDirectory = useSetAtom(setDiffTreeGroupByDirectoryAtom);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Wrapper to pass workspacePath to the setter atom
  const setGroupByDirectory = useCallback((value: boolean) => {
    if (workspacePath) {
      setDiffTreeGroupByDirectory({ groupByDirectory: value, workspacePath });
    }
  }, [workspacePath, setDiffTreeGroupByDirectory]);

  // Note: groupByDirectory is hydrated from workspace state once at app init (in App.tsx)
  // No need to load it here - just use the Jotai atom value

  // Convert absolute path to relative path from workspace root
  const getRelativePath = (filePath: string): string => {
    if (!workspacePath || !filePath.startsWith(workspacePath)) {
      return filePath;
    }
    const relativePath = filePath.slice(workspacePath.length);
    return relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
  };

  // Group files by path and aggregate stats
  const groupedFiles = useMemo(() => {
    const groups = new Map<string, FileData>();
    files.forEach(file => {
      const existing = groups.get(file.filePath);
      if (existing) {
        // Aggregate stats
        groups.set(file.filePath, {
          filePath: file.filePath,
          operation: file.operation || existing.operation,
          linesAdded: (existing.linesAdded || 0) + (file.linesAdded || 0),
          linesRemoved: (existing.linesRemoved || 0) + (file.linesRemoved || 0)
        });
      } else {
        groups.set(file.filePath, { ...file });
      }
    });
    return Array.from(groups.values());
  }, [files]);

  // Build directory tree from file list
  const buildDirectoryTree = (fileList: FileData[]): DirectoryNode => {
    const root: DirectoryNode = {
      path: '',
      displayPath: '',
      files: [],
      subdirectories: new Map(),
      fileCount: 0
    };

    fileList.forEach(file => {
      const relativePath = getRelativePath(file.filePath);
      const parts = relativePath.split('/');

      if (parts.length === 1) {
        root.files.push(file);
        root.fileCount++;
        return;
      }

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
      currentNode.fileCount++;
    });

    return collapseDirectoryTree(root);
  };

  const collapseDirectoryTree = (node: DirectoryNode): DirectoryNode => {
    node.subdirectories.forEach((subdir, key) => {
      node.subdirectories.set(key, collapseDirectoryTree(subdir));
    });

    if (node.subdirectories.size === 1 && node.files.length === 0) {
      const [childKey, childNode] = Array.from(node.subdirectories.entries())[0];
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
    if (groupedFiles.length > 0) {
      const tree = buildDirectoryTree(groupedFiles);
      const allPaths = getAllFolderPaths(tree);
      setExpandedFolders(new Set(allPaths));
    }
  };

  const collapseAll = () => {
    setExpandedFolders(new Set());
  };

  // Auto-expand all folders when groupByDirectory is enabled or files change
  useEffect(() => {
    if (groupByDirectory && groupedFiles.length > 0) {
      const tree = buildDirectoryTree(groupedFiles);
      const allPaths = getAllFolderPaths(tree);
      setExpandedFolders(new Set(allPaths));
    }
  }, [groupByDirectory, groupedFiles]);

  useEffect(() => {
    if (!sessionId) {
      setFiles([]);
      return;
    }

    const fetchFiles = async () => {
      try {
        if (typeof window !== 'undefined' && (window as any).electronAPI) {
          const result = await (window as any).electronAPI.invoke(
            'session-files:get-by-session',
            sessionId,
            type
          );
          if (result.success && result.files) {
            // Keep full file data including metadata
            const fileData: FileData[] = result.files.map((f: any) => ({
              filePath: f.filePath,
              operation: f.metadata?.operation,
              linesAdded: f.metadata?.linesAdded,
              linesRemoved: f.metadata?.linesRemoved
            }));
            setFiles(fileData);
          }
        }
      } catch (error) {
        console.error('[FileGutter] Failed to fetch file links:', error);
      }
    };

    fetchFiles();
  }, [sessionId, type]);

  // Listen for file tracking updates and refresh
  useEffect(() => {
    if (!sessionId || typeof window === 'undefined' || !(window as any).electronAPI) {
      return;
    }

    const handleFileUpdate = async (updatedSessionId: string) => {
      if (updatedSessionId === sessionId) {
        try {
          const result = await (window as any).electronAPI.invoke(
            'session-files:get-by-session',
            sessionId,
            type
          );
          if (result.success && result.files) {
            const fileData: FileData[] = result.files.map((f: any) => ({
              filePath: f.filePath,
              operation: f.metadata?.operation,
              linesAdded: f.metadata?.linesAdded,
              linesRemoved: f.metadata?.linesRemoved
            }));
            setFiles(fileData);
          }
        } catch (error) {
          console.error('[FileGutter] Failed to refresh file links:', error);
        }
      }
    };

    (window as any).electronAPI.on('session-files:updated', handleFileUpdate);

    return () => {
      if ((window as any).electronAPI?.off) {
        (window as any).electronAPI.off('session-files:updated', handleFileUpdate);
      }
    };
  }, [sessionId, type]);

  // Fetch git status for edited files
  useEffect(() => {
    if (!workspacePath || type !== 'edited' || groupedFiles.length === 0) {
      setGitStatus({});
      return;
    }

    const fetchGitStatus = async () => {
      try {
        const filePaths = groupedFiles.map(f => getRelativePath(f.filePath));

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
        console.error('[FileGutter] Failed to fetch git status:', error);
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
  }, [groupedFiles, workspacePath, type]);

  if (groupedFiles.length === 0) {
    return null;
  }

  const handleFileClick = (filePath: string) => {
    if (onFileClick) {
      onFileClick(filePath);
    } else if (window.electronAPI && workspacePath) {
      window.electronAPI.invoke('workspace:open-file', { workspacePath, filePath });
    }
  };

  const getOperationIcon = (operation?: string) => {
    switch (operation) {
      case 'create':
        return <MaterialSymbol icon="add" size={14} className="file-gutter__icon file-gutter__icon--create" />;
      case 'edit':
        return <MaterialSymbol icon="edit" size={14} className="file-gutter__icon file-gutter__icon--edit" />;
      case 'delete':
        return <MaterialSymbol icon="delete" size={14} className="file-gutter__icon file-gutter__icon--delete" />;
      case 'rename':
        return <MaterialSymbol icon="drive_file_rename_outline" size={14} className="file-gutter__icon file-gutter__icon--rename" />;
      default:
        return null;
    }
  };

  const renderGitStatus = (filePath: string) => {
    if (type !== 'edited') return null;

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

    return (
      <span
        className={`file-gutter__git-status file-gutter__git-status--${status.status}`}
        title={`Git status: ${status.status}`}
      >
        {statusChar}
      </span>
    );
  };

  const getSectionIcon = () => {
    if (type === 'referenced') {
      return <MaterialSymbol icon="tag" size={14} className="file-gutter__section-icon" />;
    }
    return <MaterialSymbol icon="edit_document" size={14} className="file-gutter__section-icon" />;
  };

  const renderDirectoryNode = (node: DirectoryNode, isNested: boolean = false): React.ReactNode => {
    const isExpanded = expandedFolders.has(node.path);
    const hasContent = node.files.length > 0 || node.subdirectories.size > 0;

    return (
      <div key={node.path} className={`file-gutter__directory-node ${isNested ? 'file-gutter__directory-node--nested' : ''}`}>
        {node.displayPath && (
          <button
            onClick={() => toggleFolder(node.path)}
            className="file-gutter__directory-header"
          >
            <MaterialSymbol
              icon={isExpanded ? "expand_more" : "chevron_right"}
              size={14}
              className="file-gutter__directory-chevron"
            />
            <MaterialSymbol
              icon={isExpanded ? "folder_open" : "folder"}
              size={14}
              className="file-gutter__directory-icon"
            />
            <span className="file-gutter__directory-path">{node.displayPath}</span>
            <span className="file-gutter__directory-count">{node.fileCount}</span>
          </button>
        )}

        {(isExpanded || !node.displayPath) && hasContent && (
          <div className="file-gutter__directory-children">
            {Array.from(node.subdirectories.values()).map(subdir =>
              renderDirectoryNode(subdir, true)
            )}

            {node.files.map((file) => {
              const fileName = getFileName(file.filePath);
              const hasStats = type === 'edited' && (file.linesAdded || file.linesRemoved);
              const hasPendingReview = type === 'edited' && pendingReviewFiles?.has(file.filePath);

              return (
                <button
                  key={file.filePath}
                  onClick={() => handleFileClick(file.filePath)}
                  className={`file-gutter__file ${hasPendingReview ? 'file-gutter__file--pending' : ''}`}
                  title={getRelativePath(file.filePath)}
                >
                  <div className="file-gutter__file-content">
                    {hasPendingReview && (
                      <MaterialSymbol
                        icon="rate_review"
                        size={14}
                        className="file-gutter__pending-icon"
                        title="Pending review"
                      />
                    )}
                    {file.operation && (
                      <div className="file-gutter__file-operation-icon">
                        {getOperationIcon(file.operation)}
                      </div>
                    )}
                    {renderGitStatus(file.filePath)}
                    <div className="file-gutter__file-info">
                      <div className="file-gutter__file-name">
                        {fileName}
                      </div>
                    </div>
                    {hasStats && (
                      <div className="file-gutter__file-stats">
                        {file.linesAdded ? (
                          <span className="file-gutter__file-stats-added">+{file.linesAdded}</span>
                        ) : null}
                        {file.linesRemoved ? (
                          <span className="file-gutter__file-stats-removed">-{file.linesRemoved}</span>
                        ) : null}
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

  const label = type === 'referenced' ? 'Referenced' : 'Edited';

  return (
    <div className={`file-gutter file-gutter--${type}`}>
      <div className="file-gutter__header-container">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="file-gutter__header"
        >
          <div className="file-gutter__header-content">
            {getSectionIcon()}
            <span>{label}</span>
            <span className="file-gutter__count">{groupedFiles.length}</span>
          </div>
          <MaterialSymbol
            icon="expand_more"
            size={16}
            className={`file-gutter__chevron ${isExpanded ? '' : 'file-gutter__chevron--collapsed'}`}
          />
        </button>

        {groupedFiles.length > 0 && (
          <div className="file-gutter__controls">
            <button
              onClick={() => setGroupByDirectory(!groupByDirectory)}
              className={`file-gutter__control-button ${groupByDirectory ? 'file-gutter__control-button--active' : ''}`}
              title="Group by directory"
            >
              <MaterialSymbol icon="folder" size={16} />
            </button>
            <button
              onClick={expandAll}
              disabled={!groupByDirectory}
              className="file-gutter__control-button"
              title="Expand all"
            >
              <MaterialSymbol icon="unfold_more" size={16} />
            </button>
            <button
              onClick={collapseAll}
              disabled={!groupByDirectory}
              className="file-gutter__control-button"
              title="Collapse all"
            >
              <MaterialSymbol icon="unfold_less" size={16} />
            </button>
          </div>
        )}
      </div>

      {isExpanded && (
        <div className="file-gutter__files">
          {groupByDirectory ? (
            renderDirectoryNode(buildDirectoryTree(groupedFiles))
          ) : (
            groupedFiles.map((file) => {
              const fileName = getFileName(file.filePath);
              const hasStats = type === 'edited' && (file.linesAdded || file.linesRemoved);
              const hasPendingReview = type === 'edited' && pendingReviewFiles?.has(file.filePath);

              return (
                <button
                  key={file.filePath}
                  onClick={() => handleFileClick(file.filePath)}
                  className={`file-gutter__file ${hasPendingReview ? 'file-gutter__file--pending' : ''}`}
                  title={getRelativePath(file.filePath)}
                >
                  <div className="file-gutter__file-content">
                    {hasPendingReview && (
                      <MaterialSymbol
                        icon="rate_review"
                        size={14}
                        className="file-gutter__pending-icon"
                        title="Pending review"
                      />
                    )}
                    {file.operation && (
                      <div className="file-gutter__file-operation-icon">
                        {getOperationIcon(file.operation)}
                      </div>
                    )}
                    {renderGitStatus(file.filePath)}
                    <div className="file-gutter__file-info">
                      <div className="file-gutter__file-name">
                        {fileName}
                      </div>
                    </div>
                    {hasStats && (
                      <div className="file-gutter__file-stats">
                        {file.linesAdded ? (
                          <span className="file-gutter__file-stats-added">+{file.linesAdded}</span>
                        ) : null}
                        {file.linesRemoved ? (
                          <span className="file-gutter__file-stats-removed">-{file.linesRemoved}</span>
                        ) : null}
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
}
