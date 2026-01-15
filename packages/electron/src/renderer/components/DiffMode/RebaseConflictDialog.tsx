import React, { useEffect, useRef } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import './MergeConflictDialog.css';

interface RebaseConflictDialogProps {
  worktreePath: string;
  conflictedFiles: string[];
  conflictingCommits?: { ours: string[]; theirs: string[] };
  onResolveWithAgent: () => void;
  onCancel: () => void;
}

export function RebaseConflictDialog({
  worktreePath,
  conflictedFiles,
  conflictingCommits,
  onResolveWithAgent,
  onCancel,
}: RebaseConflictDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  // Focus trap
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const worktreeName = worktreePath.split('/').pop() || 'worktree';

  // Limit commits to show (max 5 each)
  const ourCommits = conflictingCommits?.ours?.slice(0, 5) || [];
  const theirCommits = conflictingCommits?.theirs?.slice(0, 5) || [];
  const hasMoreOurCommits = (conflictingCommits?.ours?.length || 0) > 5;
  const hasMoreTheirCommits = (conflictingCommits?.theirs?.length || 0) > 5;

  return (
    <div className="merge-conflict-dialog-overlay" onClick={onCancel}>
      <div
        className="merge-conflict-dialog"
        ref={dialogRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="merge-conflict-dialog-header">
          <MaterialSymbol icon="warning" size={24} className="merge-conflict-dialog-icon-warning" />
          <h2>Rebase Conflicts Detected</h2>
        </div>

        <div className="merge-conflict-dialog-body">
          <p>
            Cannot rebase <strong>{worktreeName}</strong> because there are conflicts between the worktree branch and the base branch.
          </p>

          <div className="merge-conflict-dialog-files">
            <div className="merge-conflict-dialog-files-header">
              <MaterialSymbol icon="description" size={16} />
              <span>Conflicted Files:</span>
            </div>
            <ul className="merge-conflict-dialog-files-list">
              {conflictedFiles.map((file) => (
                <li key={file} className="merge-conflict-dialog-file">
                  <MaterialSymbol icon="error" size={14} className="merge-conflict-dialog-file-icon" />
                  <code>{file}</code>
                </li>
              ))}
            </ul>
          </div>

          {conflictingCommits && (ourCommits.length > 0 || theirCommits.length > 0) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              {ourCommits.length > 0 && (
                <div className="merge-conflict-dialog-files">
                  <div className="merge-conflict-dialog-files-header" style={{ color: 'var(--color-interactive)' }}>
                    <MaterialSymbol icon="commit" size={16} />
                    <span>Your Commits:</span>
                  </div>
                  <ul className="merge-conflict-dialog-files-list" style={{ maxHeight: '150px', overflowY: 'auto' }}>
                    {ourCommits.map((commit, idx) => (
                      <li key={idx} className="merge-conflict-dialog-file">
                        <MaterialSymbol icon="arrow_forward" size={14} />
                        <span style={{ fontSize: '0.75rem' }}>{commit}</span>
                      </li>
                    ))}
                    {hasMoreOurCommits && (
                      <li className="merge-conflict-dialog-file" style={{ fontStyle: 'italic', opacity: 0.7 }}>
                        <MaterialSymbol icon="more_horiz" size={14} />
                        <span style={{ fontSize: '0.75rem' }}>
                          {(conflictingCommits?.ours?.length || 0) - 5} more commit(s)
                        </span>
                      </li>
                    )}
                  </ul>
                </div>
              )}

              {theirCommits.length > 0 && (
                <div className="merge-conflict-dialog-files">
                  <div className="merge-conflict-dialog-files-header" style={{ color: 'var(--color-success)' }}>
                    <MaterialSymbol icon="commit" size={16} />
                    <span>Incoming Commits:</span>
                  </div>
                  <ul className="merge-conflict-dialog-files-list" style={{ maxHeight: '150px', overflowY: 'auto' }}>
                    {theirCommits.map((commit, idx) => (
                      <li key={idx} className="merge-conflict-dialog-file">
                        <MaterialSymbol icon="arrow_forward" size={14} />
                        <span style={{ fontSize: '0.75rem' }}>{commit}</span>
                      </li>
                    ))}
                    {hasMoreTheirCommits && (
                      <li className="merge-conflict-dialog-file" style={{ fontStyle: 'italic', opacity: 0.7 }}>
                        <MaterialSymbol icon="more_horiz" size={14} />
                        <span style={{ fontSize: '0.75rem' }}>
                          {(conflictingCommits?.theirs?.length || 0) - 5} more commit(s)
                        </span>
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="merge-conflict-dialog-info">
            <MaterialSymbol icon="info" size={16} />
            <p>
              Conflicts were detected before starting the rebase. You must resolve these conflicts before the rebase can complete.
            </p>
          </div>

          <div className="merge-conflict-dialog-suggestion">
            <MaterialSymbol icon="smart_toy" size={16} />
            <p>
              Claude Agent can help you resolve these conflicts automatically, or you can resolve them manually.
            </p>
          </div>

          <div className="merge-conflict-dialog-manual">
            <MaterialSymbol icon="terminal" size={16} />
            <p>
              Worktree location:
            </p>
            <code className="merge-conflict-dialog-path">{worktreePath}</code>
          </div>
        </div>

        <div className="merge-conflict-dialog-footer">
          <button
            type="button"
            className="merge-conflict-dialog-button merge-conflict-dialog-button--secondary"
            onClick={onCancel}
          >
            Close
          </button>
          <button
            type="button"
            className="merge-conflict-dialog-button merge-conflict-dialog-button--primary"
            onClick={onResolveWithAgent}
          >
            <MaterialSymbol icon="smart_toy" size={16} />
            <span>Resolve with Claude Agent</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default RebaseConflictDialog;
