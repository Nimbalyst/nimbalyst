import React, { useMemo } from 'react';
import type { FileEditSummary } from '../types';
import { formatTimeAgo } from '../../../utils/dateUtils';

interface FileEditsSidebarProps {
  fileEdits: FileEditSummary[];
  onFileClick?: (filePath: string) => void;
}

export const FileEditsSidebar: React.FC<FileEditsSidebarProps> = ({
  fileEdits,
  onFileClick
}) => {
  // Group edits by file path
  const groupedEdits = useMemo(() => {
    const groups = new Map<string, FileEditSummary[]>();

    fileEdits.forEach(edit => {
      const existing = groups.get(edit.filePath) || [];
      existing.push(edit);
      groups.set(edit.filePath, existing);
    });

    return Array.from(groups.entries()).map(([filePath, edits]) => {
      // Calculate total changes for this file
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

  return (
    <div className="flex flex-col h-full bg-surface-secondary border-r border-border-primary">
      <div className="p-4 border-b border-border-primary">
        <h3 className="font-semibold text-text-primary flex items-center gap-2">
          <svg className="w-4 h-4" style={{ width: '1rem', height: '1rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          File Changes
        </h3>
        <p className="text-xs text-text-tertiary mt-1">
          {groupedEdits.length} file{groupedEdits.length !== 1 ? 's' : ''} modified
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {groupedEdits.length === 0 ? (
          <div className="p-4 text-text-tertiary text-sm text-center">
            No file changes yet
          </div>
        ) : (
          <div className="space-y-1 p-2">
            {groupedEdits.map(({ filePath, totalAdded, totalRemoved, operation, timestamp, edits }) => (
              <button
                key={filePath}
                onClick={() => onFileClick?.(filePath)}
                className="w-full text-left p-3 rounded-lg hover:bg-bg-hover border border-transparent hover:border-border-primary transition-colors"
              >
                <div className="flex items-start gap-2">
                  <div className="flex-shrink-0 mt-0.5">
                    {getOperationIcon(operation)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-text-primary font-medium truncate" title={filePath}>
                      {formatFileName(filePath)}
                    </div>
                    <div className="text-xs text-text-tertiary truncate mt-0.5" title={filePath}>
                      {filePath}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs">
                      {totalAdded > 0 && (
                        <span className="text-status-success">+{totalAdded}</span>
                      )}
                      {totalRemoved > 0 && (
                        <span className="text-status-error">-{totalRemoved}</span>
                      )}
                      {edits.length > 1 && (
                        <>
                          <span className="text-text-tertiary">•</span>
                          <span className="text-text-tertiary">{edits.length} edits</span>
                        </>
                      )}
                      <span className="text-text-tertiary">•</span>
                      <span className="text-text-tertiary">{formatTimeAgo(timestamp)}</span>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
