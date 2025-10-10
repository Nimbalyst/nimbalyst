import React, { useMemo, useState } from 'react';
import type { FileEditSummary } from '../types';
import { formatTimeAgo } from '../../../utils/dateUtils';

interface FileEditsSidebarProps {
  fileEdits: FileEditSummary[];
  onFileClick?: (filePath: string) => void;
  workspacePath?: string;
}

export const FileEditsSidebar: React.FC<FileEditsSidebarProps> = ({
  fileEdits,
  onFileClick,
  workspacePath
}) => {
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

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
          <svg className="w-3.5 h-3.5 text-status-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        );
      case 'edit':
        return (
          <svg className="w-3.5 h-3.5 text-interactive" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        );
      case 'delete':
        return (
          <svg className="w-3.5 h-3.5 text-status-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        );
      case 'rename':
        return (
          <svg className="w-3.5 h-3.5 text-status-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        );
      default:
        return null;
    }
  };

  const formatFileName = (filePath: string) => {
    const parts = filePath.split('/');
    return parts[parts.length - 1];
  };

  const getLinkTypeIcon = (linkType: 'edited' | 'referenced' | 'read') => {
    switch (linkType) {
      case 'edited':
        return (
          <svg style={{ width: '1rem', height: '1rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        );
      case 'referenced':
        return (
          <svg style={{ width: '1rem', height: '1rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
          </svg>
        );
      case 'read':
        return (
          <svg style={{ width: '1rem', height: '1rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
      <div key={linkType} style={{ marginBottom: '0.5rem' }}>
        <button
          onClick={() => toggleSection(linkType)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0.5rem 0.75rem',
            fontSize: '0.75rem',
            fontWeight: 600,
            color: 'var(--text-primary)',
            backgroundColor: 'var(--surface-tertiary)',
            borderRadius: '0.375rem',
            transition: 'all 0.2s'
          }}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--surface-hover)'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--surface-tertiary)'}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {getLinkTypeIcon(linkType)}
            <span>{title}</span>
            <span style={{
              padding: '0.125rem 0.375rem',
              backgroundColor: 'var(--surface-secondary)',
              borderRadius: '0.25rem',
              fontSize: '10px'
            }}>
              {files.length}
            </span>
          </div>
          <svg
            style={{
              width: '1rem',
              height: '1rem',
              transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s'
            }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {!isCollapsed && (
          <div style={{ marginTop: '0.25rem', paddingLeft: '0.5rem' }}>
            {files.map(({ filePath, totalAdded, totalRemoved, operation, timestamp, edits }) => (
              <button
                key={filePath}
                onClick={() => onFileClick?.(filePath)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '0.75rem',
                  borderRadius: '0.5rem',
                  border: '1px solid transparent',
                  transition: 'all 0.2s',
                  marginBottom: '0.25rem'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--surface-hover)';
                  e.currentTarget.style.borderColor = 'var(--border-primary)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.borderColor = 'transparent';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'start', gap: '0.5rem' }}>
                  {operation && (
                    <div style={{ flexShrink: 0, marginTop: '0.125rem' }}>
                      {getOperationIcon(operation)}
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: '0.875rem',
                      color: 'var(--text-primary)',
                      fontWeight: 500,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }} title={filePath}>
                      {formatFileName(filePath)}
                    </div>
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-tertiary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      marginTop: '0.125rem'
                    }} title={getRelativePath(filePath)}>
                      {getRelativePath(filePath)}
                    </div>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      marginTop: '0.25rem',
                      fontSize: '0.75rem'
                    }}>
                      {linkType === 'edited' && totalAdded > 0 && (
                        <span style={{ color: 'var(--status-success)' }}>+{totalAdded}</span>
                      )}
                      {linkType === 'edited' && totalRemoved > 0 && (
                        <span style={{ color: 'var(--status-error)' }}>-{totalRemoved}</span>
                      )}
                      {edits.length > 1 && (
                        <>
                          <span style={{ color: 'var(--text-tertiary)' }}>•</span>
                          <span style={{ color: 'var(--text-tertiary)' }}>{edits.length} times</span>
                        </>
                      )}
                      {timestamp && (
                        <>
                          <span style={{ color: 'var(--text-tertiary)' }}>•</span>
                          <span style={{ color: 'var(--text-tertiary)' }}>{formatTimeAgo(timestamp)}</span>
                        </>
                      )}
                    </div>
                  </div>
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--surface-secondary)', borderRight: '1px solid var(--border-primary)' }}>
      <div style={{ padding: '1rem', borderBottom: '1px solid var(--border-primary)' }}>
        <h3 style={{ fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <svg style={{ width: '1rem', height: '1rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Files
        </h3>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '0.25rem' }}>
          {totalFiles} file{totalFiles !== 1 ? 's' : ''}
        </p>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
        {totalFiles === 0 ? (
          <div style={{ padding: '1rem', color: 'var(--text-tertiary)', fontSize: '0.875rem', textAlign: 'center' }}>
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
