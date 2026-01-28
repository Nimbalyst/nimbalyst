import { useState, useCallback } from 'react';

export interface ArchiveWorktreeDialogState {
  worktreeId: string;
  worktreeName: string;
  worktreePath: string;
  hasUncommittedChanges: boolean;
  uncommittedFileCount: number;
}

export interface UseArchiveWorktreeDialogResult {
  /** Current dialog state, or null if dialog is not shown */
  dialogState: ArchiveWorktreeDialogState | null;
  /** Show the archive confirmation dialog for a worktree */
  showDialog: (params: {
    worktreeId: string;
    worktreeName: string;
    worktreePath: string;
  }) => Promise<void>;
  /** Close the dialog without archiving */
  closeDialog: () => void;
  /** Confirm archive and perform the operation */
  confirmArchive: (workspacePath: string, onSuccess?: () => void) => Promise<void>;
}

/**
 * Hook to manage the archive worktree confirmation dialog.
 * Handles fetching worktree status, showing the dialog, and performing the archive.
 */
export function useArchiveWorktreeDialog(): UseArchiveWorktreeDialogResult {
  const [dialogState, setDialogState] = useState<ArchiveWorktreeDialogState | null>(null);

  const showDialog = useCallback(async (params: {
    worktreeId: string;
    worktreeName: string;
    worktreePath: string;
  }) => {
    const { worktreeId, worktreeName, worktreePath } = params;

    // Fetch worktree status to check for uncommitted changes
    let hasUncommittedChanges = false;
    let uncommittedFileCount = 0;

    if (worktreePath) {
      try {
        const result = await window.electronAPI.worktreeGetStatus(worktreePath);
        if (result.success && result.status) {
          hasUncommittedChanges = result.status.hasUncommittedChanges;
          uncommittedFileCount = result.status.modifiedFileCount;
        }
      } catch (error) {
        console.error('[useArchiveWorktreeDialog] Failed to get worktree status:', error);
      }
    }

    setDialogState({
      worktreeId,
      worktreeName,
      worktreePath,
      hasUncommittedChanges,
      uncommittedFileCount,
    });
  }, []);

  const closeDialog = useCallback(() => {
    setDialogState(null);
  }, []);

  const confirmArchive = useCallback(async (workspacePath: string, onSuccess?: () => void) => {
    if (!dialogState) return;

    try {
      const result = await window.electronAPI.worktreeArchive(dialogState.worktreeId, workspacePath);

      if (result.success) {
        onSuccess?.();
      } else {
        console.error('[useArchiveWorktreeDialog] Failed to archive worktree:', result.error);
      }
    } catch (error) {
      console.error('[useArchiveWorktreeDialog] Failed to archive worktree:', error);
    } finally {
      setDialogState(null);
    }
  }, [dialogState]);

  return {
    dialogState,
    showDialog,
    closeDialog,
    confirmArchive,
  };
}
