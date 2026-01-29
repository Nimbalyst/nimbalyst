/**
 * FilesEditedSidebar - Shows files edited by AI in the current workstream.
 *
 * Uses the FileEditsSidebar component from runtime with all its features:
 * - Smart folder collapse
 * - Git status indicators
 * - Pending review indicators
 * - Group by directory toggle
 * - Expand/collapse all controls
 *
 * Fetches file edits from the database for ALL sessions in the workstream.
 * Optionally allows filtering by a specific child session.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { FileEditsSidebar as FileEditsSidebarComponent, MaterialSymbol } from '@nimbalyst/runtime';
import type { FileEditSummary } from '@nimbalyst/runtime';
import { diffTreeGroupByDirectoryAtom, setDiffTreeGroupByDirectoryAtom } from '../../store/atoms/projectState';
import { workstreamSessionsAtom, sessionTitleAtom } from '../../store/atoms/sessions';
import {
  workstreamStagedFilesAtom,
  setWorkstreamStagedFilesAtom,
} from '../../store/atoms/workstreamState';
import {
  sessionOtherFilesExpandedAtom,
  toggleSessionOtherFilesExpandedAtom,
} from '../../store/atoms/sessionEditors';
import { GitOperationsPanel } from './GitOperationsPanel';
import { TodoPanel } from './TodoPanel';

interface FilesEditedSidebarProps {
  /** The workstream ID (parent session ID) - files from all child sessions will be shown */
  workstreamId: string;
  /** The currently active session ID within the workstream - used for AI commit requests */
  activeSessionId: string | null;
  workspacePath: string;
  onFileClick: (filePath: string) => void;
  /** Callback to open file in Files mode (switches to Files mode and opens the file) */
  onOpenInFilesMode?: (filePath: string) => void;
  width?: number;
  /** The worktree ID if this is a worktree session */
  worktreeId?: string | null;
  /** The worktree path if this is a worktree session */
  worktreePath?: string | null;
  /** Callback when worktree is archived */
  onWorktreeArchived?: () => void;
}

// Extended FileEditSummary to track which session the edit came from
interface FileEditWithSession extends FileEditSummary {
  sessionId: string;
}

// Helper component to display session title in dropdown option
const SessionFilterOption: React.FC<{ sessionId: string }> = ({ sessionId }) => {
  const title = useAtomValue(sessionTitleAtom(sessionId));
  return <option value={sessionId}>{title || `Session ${sessionId.slice(0, 8)}`}</option>;
};

export const FilesEditedSidebar: React.FC<FilesEditedSidebarProps> = React.memo(({
  workstreamId,
  activeSessionId,
  workspacePath,
  onFileClick,
  onOpenInFilesMode,
  width = 256,
  worktreeId,
  worktreePath,
  onWorktreeArchived,
}) => {
  const [allFileEdits, setAllFileEdits] = useState<FileEditWithSession[]>([]);
  const [pendingReviewFiles, setPendingReviewFiles] = useState<Set<string>>(new Set());
  const [filterSessionId, setFilterSessionId] = useState<string | null>(null);
  const [isClearing, setIsClearing] = useState(false);
  const [otherUncommittedFiles, setOtherUncommittedFiles] = useState<string[]>([]);
  const [otherFilesGitStatus, setOtherFilesGitStatus] = useState<Record<string, { status: string; gitStatusCode?: string }>>({});

  // Persisted UI state for "Other Uncommitted Files" section
  const isOtherFilesExpanded = useAtomValue(sessionOtherFilesExpandedAtom(workstreamId));
  const toggleOtherFilesExpanded = useSetAtom(toggleSessionOtherFilesExpandedAtom);

  // Worktree-specific state for uncommitted changes
  const [worktreeChangedFiles, setWorktreeChangedFiles] = useState<Array<{
    path: string;
    status: 'added' | 'modified' | 'deleted';
    staged: boolean;
  }>>([]);

  // Get all session IDs in this workstream
  const workstreamSessions = useAtomValue(workstreamSessionsAtom(workstreamId));
  // Show dropdown if there are multiple sessions in the workstream
  const hasMultipleSessions = workstreamSessions.length > 1;

  // Group by directory state from Jotai
  const [groupByDirectory] = useAtom(diffTreeGroupByDirectoryAtom);
  const setDiffTreeGroupByDirectory = useSetAtom(setDiffTreeGroupByDirectoryAtom);

  // Staged files - used for checkbox state (per-workstream)
  // Checkboxes are always shown in the new unified design
  const stagedFilesArr = useAtomValue(workstreamStagedFilesAtom(workstreamId));
  const stagedFiles = useMemo(() => new Set(stagedFilesArr), [stagedFilesArr]);
  const setStagedFilesAction = useSetAtom(setWorkstreamStagedFilesAtom);

  const setGroupByDirectory = useCallback((value: boolean) => {
    if (workspacePath) {
      setDiffTreeGroupByDirectory({ groupByDirectory: value, workspacePath });
    }
  }, [workspacePath, setDiffTreeGroupByDirectory]);

  // Filter file edits based on selected session
  const fileEdits = useMemo(() => {
    if (!filterSessionId) {
      // Show all files, deduplicated by filePath (most recent edit wins)
      const fileMap = new Map<string, FileEditWithSession>();
      for (const edit of allFileEdits) {
        const existing = fileMap.get(edit.filePath);
        if (!existing || new Date(edit.timestamp) > new Date(existing.timestamp)) {
          fileMap.set(edit.filePath, edit);
        }
      }
      return Array.from(fileMap.values());
    }
    // Filter to specific session
    return allFileEdits.filter(edit => edit.sessionId === filterSessionId);
  }, [allFileEdits, filterSessionId]);

  // Memoize editedFiles array for GitOperationsPanel to prevent unnecessary re-renders
  // Includes AI-edited files + other uncommitted files (for regular sessions)
  // Or worktree changed files (for worktree sessions)
  const editedFilePaths = useMemo(() => {
    if (worktreeId) {
      // For worktrees, include worktree changed files
      return [...fileEdits.map((f) => f.filePath), ...worktreeChangedFiles.map(f => f.path)];
    }
    // For regular sessions, include other uncommitted files
    return [...fileEdits.map((f) => f.filePath), ...otherUncommittedFiles];
  }, [fileEdits, otherUncommittedFiles, worktreeId, worktreeChangedFiles]);

  // Helper to convert absolute path to relative path for worktree comparisons
  const toRelativePath = useCallback((absolutePath: string) => {
    if (worktreePath && absolutePath.startsWith(worktreePath)) {
      return absolutePath.slice(worktreePath.length + 1);
    }
    return absolutePath;
  }, [worktreePath]);

  // For worktrees: compute the set of staged files from worktreeChangedFiles
  // Convert relative paths to absolute for matching with fileEdits
  const worktreeStagedFiles = useMemo(() => {
    if (!worktreeId || !worktreePath) return new Set<string>();
    // Return absolute paths so they match the selectedFiles expected by FileEditsSidebarComponent
    return new Set(worktreeChangedFiles.filter(f => f.staged).map(f => `${worktreePath}/${f.path}`));
  }, [worktreeId, worktreePath, worktreeChangedFiles]);

  // For worktrees: filter out files that are already in the AI-edited list
  const worktreeOnlyChangedFiles = useMemo(() => {
    if (!worktreeId) return [];
    // Convert AI-edited file paths to relative for comparison
    const editedRelativePaths = new Set(fileEdits.map(f => toRelativePath(f.filePath)));
    return worktreeChangedFiles.filter(f => !editedRelativePaths.has(f.path));
  }, [worktreeId, worktreeChangedFiles, fileEdits, toRelativePath]);

  // Handle worktree file staging toggle
  const handleWorktreeToggleStaged = useCallback(async (filePath: string) => {
    if (!worktreePath) return;

    try {
      // Convert to relative path if absolute
      const relativePath = toRelativePath(filePath);
      const file = worktreeChangedFiles.find(f => f.path === relativePath);
      if (!file) return;

      const newStaged = !file.staged;
      await window.electronAPI.invoke('worktree:stage-file', worktreePath, relativePath, newStaged);

      // Update local state
      setWorktreeChangedFiles(prev =>
        prev.map(f => f.path === relativePath ? { ...f, staged: newStaged } : f)
      );
    } catch (error) {
      console.error('[FilesEditedSidebar] Failed to toggle worktree file staging:', error);
    }
  }, [worktreePath, worktreeChangedFiles, toRelativePath]);

  // Handle worktree stage all / unstage all
  const handleWorktreeToggleAllStaged = useCallback(async (stage: boolean) => {
    if (!worktreePath) return;

    try {
      await window.electronAPI.invoke('worktree:stage-all', worktreePath, stage);

      // Update local state
      setWorktreeChangedFiles(prev =>
        prev.map(f => ({ ...f, staged: stage }))
      );
    } catch (error) {
      console.error('[FilesEditedSidebar] Failed to toggle all worktree file staging:', error);
    }
  }, [worktreePath]);

  // Handle staging/unstaging a subset of worktree files (for "Other Uncommitted Files" section)
  const handleWorktreeToggleSubsetStaged = useCallback(async (files: Array<{ path: string; staged: boolean }>, stage: boolean) => {
    if (!worktreePath) return;

    try {
      // Stage/unstage each file individually
      for (const file of files) {
        if (file.staged !== stage) {
          await window.electronAPI.invoke('worktree:stage-file', worktreePath, file.path, stage);
        }
      }

      // Update local state
      setWorktreeChangedFiles(prev =>
        prev.map(f => {
          const shouldUpdate = files.some(file => file.path === f.path);
          return shouldUpdate ? { ...f, staged: stage } : f;
        })
      );
    } catch (error) {
      console.error('[FilesEditedSidebar] Failed to toggle worktree file subset staging:', error);
    }
  }, [worktreePath]);

  // Handle file selection change (checkbox toggle)
  // For worktrees, this stages/unstages the file in git
  // For regular sessions, this updates the workstream staged files state
  const handleSelectionChange = useCallback((filePath: string, selected: boolean) => {
    if (worktreeId && worktreePath) {
      // For worktrees, use git staging
      handleWorktreeToggleStaged(filePath);
    } else {
      // For regular sessions, use workstream state
      const newFiles = selected
        ? [...stagedFilesArr, filePath]
        : stagedFilesArr.filter(f => f !== filePath);
      setStagedFilesAction({ workstreamId, files: newFiles });
    }
  }, [worktreeId, worktreePath, stagedFilesArr, setStagedFilesAction, workstreamId, handleWorktreeToggleStaged]);

  // Handle select all files
  const handleSelectAll = useCallback((selected: boolean) => {
    if (worktreeId && worktreePath) {
      // For worktrees, stage/unstage all files
      handleWorktreeToggleAllStaged(selected);
    } else {
      // For regular sessions, use workstream state
      if (selected) {
        setStagedFilesAction({ workstreamId, files: editedFilePaths });
      } else {
        setStagedFilesAction({ workstreamId, files: [] });
      }
    }
  }, [worktreeId, worktreePath, editedFilePaths, setStagedFilesAction, workstreamId, handleWorktreeToggleAllStaged]);

  // Handle bulk selection change (for folder checkboxes)
  const handleBulkSelectionChange = useCallback(async (filePaths: string[], selected: boolean) => {
    if (worktreeId && worktreePath) {
      // For worktrees, stage/unstage each file individually
      for (const filePath of filePaths) {
        const relativePath = toRelativePath(filePath);
        const file = worktreeChangedFiles.find(f => f.path === relativePath);
        if (file && file.staged !== selected) {
          await window.electronAPI.invoke('worktree:stage-file', worktreePath, relativePath, selected);
        }
      }
      // Refresh the worktree changed files
      const result = await window.electronAPI.invoke('worktree:get-changed-files', worktreePath);
      if (result.success && result.files) {
        setWorktreeChangedFiles(result.files);
      }
    } else {
      // For regular sessions, use workstream state
      const currentSet = new Set(stagedFilesArr);
      if (selected) {
        filePaths.forEach(fp => currentSet.add(fp));
      } else {
        filePaths.forEach(fp => currentSet.delete(fp));
      }
      setStagedFilesAction({ workstreamId, files: Array.from(currentSet) });
    }
  }, [worktreeId, worktreePath, worktreeChangedFiles, stagedFilesArr, setStagedFilesAction, workstreamId, toRelativePath]);

  // Listen for git status changes and prune committed files from staged set
  // This ensures that when files are committed (via any method), they're removed from staging
  useEffect(() => {
    if (!workspacePath || typeof window === 'undefined' || !window.electronAPI) {
      return;
    }

    const handleGitStatusChanged = async () => {
      // Re-check git status for staged files and remove any that are now committed
      if (stagedFilesArr.length === 0) return;

      try {
        // Get relative paths for checking
        const relativePaths = stagedFilesArr.map(fp => {
          if (workspacePath && fp.startsWith(workspacePath)) {
            return fp.slice(workspacePath.length + 1);
          }
          return fp;
        });

        const result = await window.electronAPI.invoke(
          'git:get-file-status',
          workspacePath,
          relativePaths
        );

        if (result.success && result.status) {
          // Filter out files that are now committed (unchanged)
          const stillUncommitted = stagedFilesArr.filter(fp => {
            const relativePath = fp.startsWith(workspacePath)
              ? fp.slice(workspacePath.length + 1)
              : fp;
            const status = result.status[relativePath];
            // Keep file if it still has uncommitted changes
            return status && status.status !== 'unchanged';
          });

          // Only update if some files were pruned
          if (stillUncommitted.length !== stagedFilesArr.length) {
            console.log('[FilesEditedSidebar] Pruning committed files from staging:',
              stagedFilesArr.length - stillUncommitted.length, 'files');
            setStagedFilesAction({ workstreamId, files: stillUncommitted });
          }
        }
      } catch (error) {
        console.error('[FilesEditedSidebar] Failed to check git status for staged files:', error);
      }
    };

    // Listen for git status changes
    const unsubscribe = window.electronAPI.on('git:status-changed', handleGitStatusChanged);

    return () => {
      unsubscribe?.();
    };
  }, [workspacePath, stagedFilesArr, workstreamId, setStagedFilesAction]);

  // Fetch file edits from database for ALL sessions in the workstream
  useEffect(() => {
    if (!workstreamId || !workspacePath || workstreamSessions.length === 0) {
      setAllFileEdits([]);
      return;
    }

    // Track if this effect is still current to prevent stale updates
    let isCurrent = true;
    // Capture workstreamId at effect start to verify on completion
    const effectWorkstreamId = workstreamId;

    const fetchFileEdits = async () => {
      try {
        if (typeof window !== 'undefined' && window.electronAPI) {
          // Use batch query instead of N individual calls
          const result = await window.electronAPI.invoke(
            'session-files:get-by-sessions',
            workstreamSessions,
            'edited'
          );

          if (result.success && result.files && isCurrent) {
            const allEdits: FileEditWithSession[] = result.files.map((f: any) => ({
              filePath: f.filePath,
              linkType: 'edited' as const,
              operation: f.metadata?.operation,
              linesAdded: f.metadata?.linesAdded,
              linesRemoved: f.metadata?.linesRemoved,
              timestamp: f.createdAt || new Date().toISOString(),
              sessionId: f.sessionId,
            }));
            setAllFileEdits(allEdits);
          }
        }
      } catch (error) {
        // Only log errors if this effect is still current
        if (isCurrent) {
          console.error('[FilesEditedSidebar] Failed to fetch file edits:', error);
        }
      }
    };

    fetchFileEdits();

    return () => {
      isCurrent = false;
    };
  }, [workstreamId, workspacePath, workstreamSessions]);

  // Fetch worktree uncommitted files (for worktree sessions)
  useEffect(() => {
    if (!worktreePath || !worktreeId) {
      setWorktreeChangedFiles([]);
      return;
    }

    let isCurrent = true;

    const fetchWorktreeChanges = async () => {
      try {
        if (typeof window !== 'undefined' && window.electronAPI) {
          const result = await window.electronAPI.invoke('worktree:get-changed-files', worktreePath);
          if (result.success && result.files && isCurrent) {
            setWorktreeChangedFiles(result.files);
          }
        }
      } catch (error) {
        if (isCurrent) {
          console.error('[FilesEditedSidebar] Failed to fetch worktree changes:', error);
        }
      }
    };

    fetchWorktreeChanges();

    // Listen for git status changes to refresh
    const handleGitStatusChanged = () => {
      fetchWorktreeChanges();
    };

    const unsubscribe = window.electronAPI?.on('git:status-changed', handleGitStatusChanged);

    return () => {
      isCurrent = false;
      unsubscribe?.();
    };
  }, [worktreePath, worktreeId]);

  // Fetch other uncommitted files (not edited by AI) - for regular sessions only
  useEffect(() => {
    if (!workspacePath || worktreeId) {
      // Skip for worktrees - they use worktreeChangedFiles instead
      setOtherUncommittedFiles([]);
      return;
    }

    let isCurrent = true;

    const fetchUncommittedFiles = async () => {
      try {
        if (typeof window !== 'undefined' && window.electronAPI) {
          const result = await window.electronAPI.invoke('git:get-uncommitted-files', workspacePath);
          if (result.success && result.files && isCurrent) {
            // Filter out files that are already in the edited files list
            const editedFilePaths = new Set(fileEdits.map(f => f.filePath));
            const otherFiles = result.files.filter((filePath: string) => !editedFilePaths.has(filePath));
            setOtherUncommittedFiles(otherFiles);

            // Fetch git status for these files
            if (otherFiles.length > 0) {
              const statusResult = await window.electronAPI.invoke('git:get-file-status', workspacePath, otherFiles);
              if (statusResult.success && isCurrent) {
                setOtherFilesGitStatus(statusResult.fileStatus || {});
              }
            } else {
              setOtherFilesGitStatus({});
            }
          }
        }
      } catch (error) {
        if (isCurrent) {
          console.error('[FilesEditedSidebar] Failed to fetch uncommitted files:', error);
        }
      }
    };

    fetchUncommittedFiles();

    // Listen for git status changes to refresh the list
    const handleGitStatusChanged = () => {
      fetchUncommittedFiles();
    };

    const unsubscribe = window.electronAPI?.on('git:status-changed', handleGitStatusChanged);

    return () => {
      isCurrent = false;
      unsubscribe?.();
    };
  }, [workspacePath, worktreeId, fileEdits]);

  // Listen for file tracking updates from any session in the workstream
  useEffect(() => {
    if (!workstreamId || workstreamSessions.length === 0 || typeof window === 'undefined' || !window.electronAPI) {
      return;
    }

    // Track if this effect is still current to prevent stale updates
    let isCurrent = true;
    // Capture workstreamSessions at effect start for consistent filtering
    const effectWorkstreamSessions = workstreamSessions;

    const handleFileUpdate = async (updatedSessionId: string) => {
      // Check if the update is from any session in our workstream
      if (effectWorkstreamSessions.includes(updatedSessionId)) {
        try {
          // Re-fetch just the updated session's files
          const result = await window.electronAPI.invoke(
            'session-files:get-by-session',
            updatedSessionId,
            'edited'
          );
          // Only update state if this effect is still current
          if (isCurrent && result.success && result.files) {
            const newEdits: FileEditWithSession[] = result.files.map((f: any) => ({
              filePath: f.filePath,
              linkType: 'edited' as const,
              operation: f.metadata?.operation,
              linesAdded: f.metadata?.linesAdded,
              linesRemoved: f.metadata?.linesRemoved,
              timestamp: f.createdAt || new Date().toISOString(),
              sessionId: updatedSessionId,
            }));

            // Merge with existing edits: replace edits from the updated session
            setAllFileEdits(prev => {
              const otherEdits = prev.filter(e => e.sessionId !== updatedSessionId);
              return [...otherEdits, ...newEdits];
            });
          }
        } catch (error) {
          if (isCurrent) {
            console.error('[FilesEditedSidebar] Failed to refresh file edits:', error);
          }
        }
      }
    };

    window.electronAPI.on('session-files:updated', handleFileUpdate);

    return () => {
      isCurrent = false;
      if (window.electronAPI?.off) {
        window.electronAPI.off('session-files:updated', handleFileUpdate);
      }
    };
  }, [workstreamId, workstreamSessions]);

  // Fetch pending review files from all sessions in the workstream
  useEffect(() => {
    if (!workstreamId || !workspacePath || workstreamSessions.length === 0) {
      setPendingReviewFiles(new Set());
      return;
    }

    // Track if this effect is still current to prevent stale updates
    let isCurrent = true;

    const fetchPendingReviewFiles = async () => {
      try {
        if (typeof window !== 'undefined' && window.electronAPI) {
          const allPendingFiles = new Set<string>();

          // Fetch pending files from all sessions
          await Promise.all(
            workstreamSessions.map(async (sessionId) => {
              const pendingFiles: string[] = await window.electronAPI.invoke(
                'history:get-pending-files-for-session',
                workspacePath,
                sessionId
              );
              pendingFiles.forEach(f => allPendingFiles.add(f));
            })
          );

          // Only update state if this effect is still current
          if (isCurrent) {
            setPendingReviewFiles(allPendingFiles);
          }
        }
      } catch (error) {
        if (isCurrent) {
          console.error('[FilesEditedSidebar] Failed to fetch pending review files:', error);
        }
      }
    };

    fetchPendingReviewFiles();

    return () => {
      isCurrent = false;
    };
  }, [workstreamId, workspacePath, workstreamSessions]);

  // Listen for pending diff updates
  useEffect(() => {
    if (!workstreamId || !workspacePath || workstreamSessions.length === 0 || typeof window === 'undefined' || !window.electronAPI) {
      return;
    }

    // Track if this effect is still current to prevent stale updates
    let isCurrent = true;
    // Capture dependencies at effect start for consistent use in async handler
    const effectWorkspacePath = workspacePath;
    const effectWorkstreamSessions = workstreamSessions;

    const handlePendingDiffUpdate = async () => {
      try {
        const allPendingFiles = new Set<string>();

        await Promise.all(
          effectWorkstreamSessions.map(async (sessionId) => {
            const pendingFiles: string[] = await window.electronAPI.invoke(
              'history:get-pending-files-for-session',
              effectWorkspacePath,
              sessionId
            );
            pendingFiles.forEach(f => allPendingFiles.add(f));
          })
        );

        // Only update state if this effect is still current
        if (isCurrent) {
          setPendingReviewFiles(allPendingFiles);
        }
      } catch (error) {
        if (isCurrent) {
          console.error('[FilesEditedSidebar] Failed to refresh pending review files:', error);
        }
      }
    };

    // Listen for pending count changes in this workspace
    window.electronAPI.on('history:pending-count-changed', handlePendingDiffUpdate);

    return () => {
      isCurrent = false;
      if (window.electronAPI?.off) {
        window.electronAPI.off('history:pending-count-changed', handlePendingDiffUpdate);
      }
    };
  }, [workstreamId, workspacePath, workstreamSessions]);

  // Handle "Keep All" button click - clear pending for all sessions in workstream
  const handleKeepAll = useCallback(async () => {
    if (!workspacePath || isClearing || workstreamSessions.length === 0) return;

    setIsClearing(true);
    try {
      if (typeof window !== 'undefined' && (window as any).electronAPI) {
        // Clear pending for all sessions in the workstream
        await Promise.all(
          workstreamSessions.map(async (sessionId) => {
            await (window as any).electronAPI.history.clearPendingForSession(workspacePath, sessionId);
          })
        );
        // Pending files state will be updated via the event listener
      }
    } catch (error) {
      console.error('[FilesEditedSidebar] Failed to clear pending for workstream:', error);
    } finally {
      setIsClearing(false);
    }
  }, [workspacePath, workstreamSessions, isClearing]);

  // Context menu handlers
  const handleOpenInFiles = useCallback((filePath: string) => {
    // Navigate to the file in Files mode (main editor)
    if (onOpenInFilesMode) {
      onOpenInFilesMode(filePath);
    } else {
      // Fallback to opening in agent mode if no Files mode handler provided
      onFileClick(filePath);
    }
  }, [onOpenInFilesMode, onFileClick]);

  const handleViewDiff = useCallback(async (filePath: string) => {
    // Open diff view for the file
    if (typeof window !== 'undefined' && window.electronAPI) {
      try {
        await window.electronAPI.invoke('file:open-diff', filePath, workspacePath);
      } catch (error) {
        console.error('[FilesEditedSidebar] Failed to open diff:', error);
      }
    }
  }, [workspacePath]);

  const handleCopyPath = useCallback((filePath: string) => {
    // Copy file path to clipboard
    navigator.clipboard.writeText(filePath).catch(error => {
      console.error('[FilesEditedSidebar] Failed to copy path:', error);
    });
  }, []);

  const handleRevealInFinder = useCallback(async (filePath: string) => {
    // Reveal file in system file browser
    if (typeof window !== 'undefined' && window.electronAPI) {
      try {
        await window.electronAPI.invoke('show-in-finder', filePath);
      } catch (error) {
        console.error('[FilesEditedSidebar] Failed to reveal in finder:', error);
      }
    }
  }, []);

  return (
    <div className="files-edited-sidebar shrink-0 flex flex-col h-full bg-[var(--nim-bg-secondary)]" style={{ width }}>
      {/* Header with Files label and controls */}
      <div className="files-edited-sidebar__header flex items-center gap-2 px-3 py-2 border-b border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] shrink-0">
        <MaterialSymbol icon="description" size={16} />
        <span className="files-edited-sidebar__title font-medium text-[var(--nim-text)]">
          {worktreeId ? 'Files Edited in Worktree' : hasMultipleSessions ? 'Files Edited in Workstream' : 'Files Edited in AI Session'}
        </span>
        {/* Controls */}
        <div className="files-edited-sidebar__controls ml-auto flex gap-1">
          <button
            onClick={() => setGroupByDirectory(!groupByDirectory)}
            className={`files-edited-sidebar__control-btn flex items-center justify-center w-6 h-6 border-none rounded bg-transparent text-[var(--nim-text-muted)] cursor-pointer hover:enabled:bg-[var(--nim-bg-tertiary)] ${groupByDirectory ? 'bg-[var(--nim-bg-tertiary)]' : ''}`}
            title="Group by directory"
          >
            <MaterialSymbol icon="folder" size={16} />
          </button>
          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent('file-edits-sidebar:expand-all'));
            }}
            disabled={!groupByDirectory}
            className="files-edited-sidebar__control-btn flex items-center justify-center w-6 h-6 border-none rounded bg-transparent text-[var(--nim-text-muted)] cursor-pointer hover:enabled:bg-[var(--nim-bg-tertiary)] disabled:text-[var(--nim-text-disabled)] disabled:cursor-default disabled:opacity-50"
            title="Expand all"
          >
            <MaterialSymbol icon="unfold_more" size={16} />
          </button>
          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent('file-edits-sidebar:collapse-all'));
            }}
            disabled={!groupByDirectory}
            className="files-edited-sidebar__control-btn flex items-center justify-center w-6 h-6 border-none rounded bg-transparent text-[var(--nim-text-muted)] cursor-pointer hover:enabled:bg-[var(--nim-bg-tertiary)] disabled:text-[var(--nim-text-disabled)] disabled:cursor-default disabled:opacity-50"
            title="Collapse all"
          >
            <MaterialSymbol icon="unfold_less" size={16} />
          </button>
        </div>
      </div>

      {/* Session filter dropdown - only show if there are multiple sessions */}
      {hasMultipleSessions && (
        <div className="files-edited-sidebar__filter px-2 py-1 border-b border-[var(--nim-border)] shrink-0">
          <select
            value={filterSessionId || ''}
            onChange={(e) => setFilterSessionId(e.target.value || null)}
            className="files-edited-sidebar__filter-select w-full px-2 py-1 text-xs border border-[var(--nim-border)] rounded bg-[var(--nim-bg)] text-[var(--nim-text)] cursor-pointer focus:outline-none focus:border-[var(--nim-border-focus)]"
          >
            <option value="">All Sessions</option>
            {workstreamSessions.map((sessionId) => (
              <SessionFilterOption key={sessionId} sessionId={sessionId} />
            ))}
          </select>
        </div>
      )}

      {/* Keep All button - show when there are pending files */}
      {pendingReviewFiles.size > 0 && (
        <div className="files-edited-sidebar__keep-all-banner flex items-center justify-between px-3 py-2 bg-[color-mix(in_srgb,var(--nim-warning)_10%,var(--nim-bg))] border-b border-[color-mix(in_srgb,var(--nim-warning)_30%,transparent)] shrink-0">
          <div className="files-edited-sidebar__keep-all-info flex items-center gap-2">
            <MaterialSymbol icon="rate_review" size={16} className="files-edited-sidebar__keep-all-icon text-[var(--nim-warning)]" />
            <span className="files-edited-sidebar__keep-all-text text-xs text-[var(--nim-warning)] font-medium">
              <span className="files-edited-sidebar__keep-all-count font-semibold">{pendingReviewFiles.size}</span>
              {' '}file{pendingReviewFiles.size !== 1 ? 's' : ''} pending review
            </span>
          </div>
          <button
            className="files-edited-sidebar__keep-all-btn flex items-center gap-1 px-2.5 py-1 bg-transparent border border-[var(--nim-warning)] rounded text-[var(--nim-warning)] text-[11px] font-medium cursor-pointer transition-all duration-200 font-inherit hover:enabled:bg-[color-mix(in_srgb,var(--nim-warning)_15%,transparent)] disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleKeepAll}
            disabled={isClearing}
            title="Accept all pending AI changes"
          >
            <MaterialSymbol icon="check_circle" size={14} />
            {isClearing ? 'Keeping...' : 'Keep All'}
          </button>
        </div>
      )}

      {/* Files Content */}
      <div className="files-edited-sidebar__content flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-auto">
          <FileEditsSidebarComponent
            fileEdits={fileEdits}
            onFileClick={onFileClick}
            workspacePath={worktreePath || workspacePath}
            pendingReviewFiles={pendingReviewFiles}
            groupByDirectory={groupByDirectory}
            onGroupByDirectoryChange={setGroupByDirectory}
            hideControls
            onOpenInFiles={handleOpenInFiles}
            onCopyPath={handleCopyPath}
            onRevealInFinder={handleRevealInFinder}
            showCheckboxes={true}
            selectedFiles={worktreeId ? worktreeStagedFiles : stagedFiles}
            onSelectionChange={handleSelectionChange}
            onSelectAll={handleSelectAll}
            onBulkSelectionChange={handleBulkSelectionChange}
          />
        </div>

        {/* Other Uncommitted Files Section */}
        {!worktreeId && otherUncommittedFiles.length > 0 && (
          <div className="border-t border-[var(--nim-border)] bg-[var(--nim-bg-secondary)]">
            <button
              onClick={() => toggleOtherFilesExpanded(workstreamId)}
              className="w-full flex items-center gap-2 px-3 py-2 bg-transparent border-none cursor-pointer hover:bg-[var(--nim-bg-hover)]"
            >
              <MaterialSymbol
                icon={isOtherFilesExpanded ? 'expand_more' : 'chevron_right'}
                size={16}
                className="text-[var(--nim-text-muted)]"
              />
              <span className="text-[11px] font-semibold text-[var(--nim-text-muted)] uppercase tracking-wide">
                Other Uncommitted Files ({otherUncommittedFiles.length})
              </span>
            </button>
            {isOtherFilesExpanded && (
              <div className="max-h-[200px] overflow-y-auto">
                {otherUncommittedFiles.map((filePath) => {
                  const gitStatus = otherFilesGitStatus[filePath];
                  const statusCode = gitStatus?.gitStatusCode || '?';
                  const statusColor =
                    statusCode.includes('M') ? 'text-[var(--nim-warning)]' :
                    statusCode.includes('A') ? 'text-[var(--nim-success)]' :
                    statusCode.includes('D') ? 'text-[var(--nim-error)]' :
                    'text-[var(--nim-text-muted)]';

                  return (
                    <div
                      key={filePath}
                      className="flex items-center gap-2 px-3 py-1.5 text-[11px] hover:bg-[var(--nim-bg-hover)] cursor-pointer"
                      onClick={() => onFileClick(filePath)}
                    >
                      <input
                        type="checkbox"
                        checked={stagedFiles.has(filePath)}
                        onChange={(e) => {
                          e.stopPropagation();
                          handleSelectionChange(filePath, e.target.checked);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="cursor-pointer"
                      />
                      <span className={`w-4 text-center font-[var(--nim-font-mono)] font-semibold text-[10px] ${statusColor}`}>
                        {statusCode.charAt(0)}
                      </span>
                      <span className="flex-1 text-[var(--nim-text)] overflow-hidden text-ellipsis whitespace-nowrap" title={filePath}>
                        {filePath.split('/').pop()}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Worktree Uncommitted Files Section - only shows files NOT already in Files Edited */}
        {worktreeId && worktreeOnlyChangedFiles.length > 0 && (
          <div className="border-t border-[var(--nim-border)] bg-[var(--nim-bg-secondary)]">
            <div className="flex items-center justify-between px-3 py-2">
              <button
                onClick={() => toggleOtherFilesExpanded(workstreamId)}
                className="flex items-center gap-2 bg-transparent border-none cursor-pointer p-0 hover:opacity-80"
              >
                <MaterialSymbol
                  icon={isOtherFilesExpanded ? 'expand_more' : 'chevron_right'}
                  size={16}
                  className="text-[var(--nim-text-muted)]"
                />
                <span className="text-[11px] font-semibold text-[var(--nim-text-muted)] uppercase tracking-wide">
                  Other Uncommitted Files ({worktreeOnlyChangedFiles.length})
                </span>
              </button>
              {isOtherFilesExpanded && (
                <div className="flex gap-2">
                  <button
                  onClick={() => handleWorktreeToggleSubsetStaged(worktreeOnlyChangedFiles, true)}
                    disabled={worktreeOnlyChangedFiles.length === 0 || worktreeOnlyChangedFiles.every(f => f.staged)}
                    className="bg-transparent border-none text-[var(--nim-primary)] text-[10px] font-medium cursor-pointer p-0 hover:underline disabled:text-[var(--nim-text-faint)] disabled:cursor-not-allowed disabled:no-underline"
                  >
                    Stage All
                  </button>
                  <button
                  onClick={() => handleWorktreeToggleSubsetStaged(worktreeOnlyChangedFiles, false)}
                    disabled={!worktreeOnlyChangedFiles.some(f => f.staged)}
                    className="bg-transparent border-none text-[var(--nim-primary)] text-[10px] font-medium cursor-pointer p-0 hover:underline disabled:text-[var(--nim-text-faint)] disabled:cursor-not-allowed disabled:no-underline"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
            {isOtherFilesExpanded && (
              <div className="max-h-[200px] overflow-y-auto">
                {worktreeOnlyChangedFiles.map((file) => {
                  const statusColor =
                    file.status === 'added' ? 'text-[var(--nim-success)]' :
                    file.status === 'modified' ? 'text-[var(--nim-warning)]' :
                    'text-[var(--nim-error)]';
                  const statusChar = file.status === 'added' ? 'A' : file.status === 'modified' ? 'M' : 'D';

                  return (
                    <div
                      key={file.path}
                      className="flex items-center gap-2 px-3 py-1.5 text-[11px] hover:bg-[var(--nim-bg-hover)] cursor-pointer"
                    onClick={() => onFileClick(`${worktreePath}/${file.path}`)}
                    >
                      <input
                        type="checkbox"
                        checked={file.staged}
                        onChange={(e) => {
                          e.stopPropagation();
                          handleWorktreeToggleStaged(file.path);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="cursor-pointer"
                      />
                      <span className={`w-4 text-center font-[var(--nim-font-mono)] font-semibold text-[10px] ${statusColor}`}>
                        {statusChar}
                      </span>
                      <span className="flex-1 text-[var(--nim-text)] overflow-hidden text-ellipsis whitespace-nowrap" title={file.path}>
                        {file.path.split('/').pop()}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Git Operations Panel */}
      <GitOperationsPanel
        workspacePath={workspacePath}
        workstreamId={workstreamId}
        sessionId={activeSessionId || workstreamId}
        editedFiles={editedFilePaths}
        worktreeId={worktreeId}
        worktreePath={worktreePath}
        onWorktreeArchived={onWorktreeArchived}
      />

      {/* Todo Panel - shows agent's current tasks */}
      {activeSessionId && (
        <TodoPanel sessionId={activeSessionId} />
      )}
    </div>
  );
});

FilesEditedSidebar.displayName = 'FilesEditedSidebar';
