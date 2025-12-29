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
}

interface FileGitStatus {
  status: 'modified' | 'staged' | 'untracked' | 'unchanged' | 'deleted';
  gitStatusCode?: string;
}

export const FileEditsSidebar: React.FC<FileEditsSidebarProps> = ({
  fileEdits,
  onFileClick,
  workspacePath,
  pendingReviewFiles
}) => {
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [gitStatus, setGitStatus] = useState<Record<string, FileGitStatus>>({});

  // Convert absolute path to relative path from workspace root
  const getRelativePath = (filePath: string): string => {
    if (!workspacePath || !filePath.startsWith(workspacePath)) {
      return filePath;
    }
    const relativePath = filePath.slice(workspacePath.length);
    // Remove leading slash if present
    return relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
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
            {files.map(({ filePath, totalAdded, totalRemoved, operation, timestamp, edits }) => {
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
            })}
          </div>
        )}
      </div>
    );
  };

  const totalFiles = groupedByType.edited.length + groupedByType.referenced.length + groupedByType.read.length;

  return (
    <div className="file-edits-sidebar">
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
