import React, { useEffect, useRef } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import './MergeConfirmDialog.css';

interface MergeConfirmDialogProps {
  worktreePath: string;
  workspacePath: string;
  hasUncommittedChanges: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function getWorktreeName(worktreePath: string): string {
  return worktreePath.split('/').pop() || 'worktree';
}

function getProjectName(workspacePath: string): string {
  return workspacePath.split('/').pop() || 'main';
}

export function MergeConfirmDialog({
  worktreePath,
  workspacePath,
  hasUncommittedChanges,
  onConfirm,
  onCancel,
}: MergeConfirmDialogProps) {
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

  const worktreeName = getWorktreeName(worktreePath);
  const projectName = getProjectName(workspacePath);

  return (
    <div className="merge-confirm-dialog-overlay" onClick={onCancel}>
      <div
        className="merge-confirm-dialog"
        ref={dialogRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="merge-confirm-dialog-header">
          <MaterialSymbol icon="merge" size={24} />
          <h2>Merge to Main</h2>
        </div>

        <div className="merge-confirm-dialog-body">
          <p>
            Are you sure you want to merge <strong>{worktreeName}</strong> into the main branch of <strong>{projectName}</strong>?
          </p>

          {hasUncommittedChanges && (
            <div className="merge-confirm-dialog-warning">
              <MaterialSymbol icon="warning" size={18} />
              <span>
                You have uncommitted changes. Please commit all changes before merging.
              </span>
            </div>
          )}

          <div className="merge-confirm-dialog-info">
            <div className="merge-confirm-dialog-info-row">
              <span className="merge-confirm-dialog-info-label">Source:</span>
              <span className="merge-confirm-dialog-info-value">{worktreeName}</span>
            </div>
            <div className="merge-confirm-dialog-info-row">
              <span className="merge-confirm-dialog-info-label">Target:</span>
              <span className="merge-confirm-dialog-info-value">main ({projectName})</span>
            </div>
          </div>
        </div>

        <div className="merge-confirm-dialog-footer">
          <button
            type="button"
            className="merge-confirm-dialog-button merge-confirm-dialog-button--secondary"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="merge-confirm-dialog-button merge-confirm-dialog-button--primary"
            onClick={onConfirm}
            disabled={hasUncommittedChanges}
          >
            <MaterialSymbol icon="merge" size={16} />
            <span>Merge</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default MergeConfirmDialog;
