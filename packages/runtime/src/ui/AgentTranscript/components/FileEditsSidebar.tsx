import React, { useMemo, useState, useEffect } from 'react';
import type { FileEditSummary } from '../types';
import { formatTimeAgo } from '../../../utils/dateUtils';
import './FileEditsSidebar.css';
import path from "path";

interface FileEditsSidebarProps {
  fileEdits: FileEditSummary[];
  onFileClick?: (filePath: string) => void;
  workspacePath?: string;
}

interface FileGitStatus {
  status: 'modified' | 'staged' | 'untracked' | 'unchanged' | 'deleted';
  gitStatusCode?: string;
}

export const FileEditsSidebar: React.FC<FileEditsSidebarProps> = ({
  fileEdits,
  onFileClick,
  workspacePath
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
          <svg className="file-edits-sidebar__icon file-edits-sidebar__icon--create" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        );
      case 'edit':
        return (
          <svg className="file-edits-sidebar__icon file-edits-sidebar__icon--edit" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        );
      case 'delete':
        return (
          <svg className="file-edits-sidebar__icon file-edits-sidebar__icon--delete" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        );
      case 'rename':
        return (
          <svg className="file-edits-sidebar__icon file-edits-sidebar__icon--rename" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        );
      default:
        return null;
    }
  };

  const formatFileName = (filePath: string) => {
    const parts = filePath.split(path.sep);
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
          <svg className="file-edits-sidebar__section-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        );
      case 'referenced':
        return (
          <svg className="file-edits-sidebar__section-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
          </svg>
        );
      case 'read':
        return (
          <svg className="file-edits-sidebar__section-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
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
          <svg
            className={`file-edits-sidebar__section-chevron ${isCollapsed ? 'file-edits-sidebar__section-chevron--collapsed' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {!isCollapsed && (
          <div className="file-edits-sidebar__section-files">
            {files.map(({ filePath, totalAdded, totalRemoved, operation, timestamp, edits }) => (
              <button
                key={filePath}
                onClick={() => onFileClick?.(filePath)}
                className="file-edits-sidebar__file"
              >
                <div className="file-edits-sidebar__file-content">
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
            ))}
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
