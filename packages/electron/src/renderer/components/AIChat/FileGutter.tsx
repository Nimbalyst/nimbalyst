import React, { useState, useEffect, useMemo } from 'react';
import { getFileName } from '../../utils/pathUtils';
import './FileGutter.css';

interface FileGutterProps {
  sessionId: string | null;
  workspacePath?: string;
  type: 'referenced' | 'edited';
  onFileClick?: (filePath: string) => void;
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

export function FileGutter({ sessionId, workspacePath, type, onFileClick }: FileGutterProps) {
  const [files, setFiles] = useState<FileData[]>([]);
  const [isExpanded, setIsExpanded] = useState(true);
  const [gitStatus, setGitStatus] = useState<Record<string, FileGitStatus>>({});

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
        return (
          <svg className="file-gutter__icon file-gutter__icon--create" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        );
      case 'edit':
        return (
          <svg className="file-gutter__icon file-gutter__icon--edit" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        );
      case 'delete':
        return (
          <svg className="file-gutter__icon file-gutter__icon--delete" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        );
      case 'rename':
        return (
          <svg className="file-gutter__icon file-gutter__icon--rename" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        );
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
      return (
        <svg className="file-gutter__section-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
        </svg>
      );
    }
    return (
      <svg className="file-gutter__section-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    );
  };

  const label = type === 'referenced' ? 'Referenced' : 'Edited';

  return (
    <div className={`file-gutter file-gutter--${type}`}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="file-gutter__header"
      >
        <div className="file-gutter__header-content">
          {getSectionIcon()}
          <span>{label}</span>
          <span className="file-gutter__count">{groupedFiles.length}</span>
        </div>
        <svg
          className={`file-gutter__chevron ${isExpanded ? '' : 'file-gutter__chevron--collapsed'}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isExpanded && (
        <div className="file-gutter__files">
          {groupedFiles.map((file) => {
            const fileName = getFileName(file.filePath);
            const hasStats = type === 'edited' && (file.linesAdded || file.linesRemoved);

            return (
              <button
                key={file.filePath}
                onClick={() => handleFileClick(file.filePath)}
                className="file-gutter__file"
                title={getRelativePath(file.filePath)}
              >
                <div className="file-gutter__file-content">
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
}
