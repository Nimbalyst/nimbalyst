import React, { useEffect, useRef } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import './MergeConflictDialog.css';

interface MergeConflictDialogProps {
  workspacePath: string;
  conflictedFiles: string[];
  onResolveWithAgent: () => void;
  onCancel: () => void;
}

export function MergeConflictDialog({
  workspacePath,
  conflictedFiles,
  onResolveWithAgent,
  onCancel,
}: MergeConflictDialogProps) {
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

  const projectName = workspacePath.split('/').pop() || 'project';

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
          <h2>Merge Conflict Detected</h2>
        </div>

        <div className="merge-conflict-dialog-body">
          <p>
            Cannot merge worktree to <strong>{projectName}</strong> because there are unresolved merge conflicts in the main repository.
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

          <div className="merge-conflict-dialog-info">
            <MaterialSymbol icon="info" size={16} />
            <p>
              You must resolve these conflicts in the main repository before the worktree can be merged.
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
              Main repository location:
            </p>
            <code className="merge-conflict-dialog-path">{workspacePath}</code>
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

export default MergeConflictDialog;
