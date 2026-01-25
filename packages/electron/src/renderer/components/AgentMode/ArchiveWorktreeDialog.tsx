import React, { useEffect, useRef } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import './ArchiveWorktreeDialog.css';

interface ArchiveWorktreeDialogProps {
  worktreeName: string;
  onArchive: () => void;
  onKeep: () => void;
}

export function ArchiveWorktreeDialog({
  worktreeName,
  onArchive,
  onKeep,
}: ArchiveWorktreeDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onKeep();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onKeep]);

  // Focus trap
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div className="archive-worktree-dialog-overlay" onClick={onKeep}>
      <div
        className="archive-worktree-dialog"
        ref={dialogRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="archive-worktree-dialog-header">
          <MaterialSymbol icon="archive" size={24} />
          <h2>Archive Worktree</h2>
        </div>

        <div className="archive-worktree-dialog-body">
          <p>
            Merge successful! Would you like to archive <strong>{worktreeName}</strong>?
          </p>
          <p className="archive-worktree-dialog-info">
            Archiving will remove the worktree from disk and mark all associated sessions as archived.
          </p>
        </div>

        <div className="archive-worktree-dialog-footer">
          <button
            type="button"
            className="archive-worktree-dialog-button archive-worktree-dialog-button--secondary"
            onClick={onKeep}
          >
            Keep Worktree
          </button>
          <button
            type="button"
            className="archive-worktree-dialog-button archive-worktree-dialog-button--primary"
            onClick={onArchive}
          >
            <MaterialSymbol icon="archive" size={16} />
            <span>Archive</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default ArchiveWorktreeDialog;
