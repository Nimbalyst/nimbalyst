import React, { useEffect, useRef } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';

interface ArchiveWorktreeDialogProps {
  worktreeName: string;
  onArchive: () => void;
  onKeep: () => void;
  /** Optional message to show (e.g., "Merge successful!" after a merge) */
  contextMessage?: string;
  /** Whether the worktree has uncommitted changes that will be lost */
  hasUncommittedChanges?: boolean;
  /** Number of uncommitted files (for display) */
  uncommittedFileCount?: number;
}

export function ArchiveWorktreeDialog({
  worktreeName,
  onArchive,
  onKeep,
  contextMessage,
  hasUncommittedChanges,
  uncommittedFileCount,
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
    <div
      className="archive-worktree-dialog-overlay nim-overlay"
      onClick={onKeep}
    >
      <div
        className="archive-worktree-dialog w-full max-w-[440px] rounded-xl outline-none bg-[var(--nim-bg)] shadow-[0_8px_32px_rgba(0,0,0,0.24)]"
        ref={dialogRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="archive-worktree-dialog-header flex items-center gap-3 px-6 pt-5 pb-4 text-[var(--nim-text)]">
          <MaterialSymbol icon="archive" size={24} />
          <h2 className="m-0 text-lg font-semibold">Archive Worktree</h2>
        </div>

        <div className="archive-worktree-dialog-body px-6 pb-5">
          <p className="mb-4 text-sm leading-relaxed text-[var(--nim-text-muted)]">
            {contextMessage ? `${contextMessage} ` : ''}Are you sure you want to archive{' '}
            <strong className="font-medium text-[var(--nim-text)]">{worktreeName}</strong>?
          </p>

          {hasUncommittedChanges ? (
            <div className="archive-worktree-warning flex items-start gap-3 mb-4 p-3 rounded-lg bg-[var(--nim-warning)]/10 border border-[var(--nim-warning)]/30">
              <MaterialSymbol icon="warning" size={20} className="text-[var(--nim-warning)] shrink-0 mt-0.5" />
              <div>
                <p className="m-0 text-sm font-medium text-[var(--nim-warning)]">
                  Uncommitted changes will be lost
                </p>
                <p className="m-0 mt-1 text-[0.8125rem] text-[var(--nim-text-muted)]">
                  This worktree has {uncommittedFileCount === 1 ? '1 file' : `${uncommittedFileCount} files`} with uncommitted changes.
                  These changes will be permanently deleted.
                </p>
              </div>
            </div>
          ) : (
            <div className="archive-worktree-clean flex items-start gap-3 mb-4 p-3 rounded-lg bg-[var(--nim-success)]/10 border border-[var(--nim-success)]/30">
              <MaterialSymbol icon="check_circle" size={20} className="text-[var(--nim-success)] shrink-0 mt-0.5" />
              <p className="m-0 text-sm text-[var(--nim-text-muted)]">
                No uncommitted changes. All work has been committed.
              </p>
            </div>
          )}

          <p className="archive-worktree-dialog-info m-0 text-[0.8125rem] text-[var(--nim-text-faint)]">
            Archiving will remove the worktree from disk and mark all associated sessions as archived.
          </p>
        </div>

        <div className="archive-worktree-dialog-footer flex justify-end gap-2 px-6 pt-4 pb-5 border-t border-[var(--nim-border)]">
          <button
            type="button"
            className="nim-btn-secondary"
            onClick={onKeep}
          >
            Keep Worktree
          </button>
          <button
            type="button"
            className="nim-btn-primary"
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
