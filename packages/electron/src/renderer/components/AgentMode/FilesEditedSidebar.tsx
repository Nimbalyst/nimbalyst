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
  hasExternalEditorAtom,
  externalEditorNameAtom,
  openInExternalEditorAtom,
  revealInFinderAtom,
  copyFilePathAtom,
} from '../../store/atoms/appSettings';
import {
  workstreamStagedFilesAtom,
  setWorkstreamStagedFilesAtom,
  workstreamFileScopeModeAtom,
  setWorkstreamFileScopeModeAtom,
  type FileScopeMode,
} from '../../store/atoms/workstreamState';
import { FilesEditedOptionsDropdown } from './FilesEditedOptionsDropdown';
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

// Hook to get session info with titles for dropdown
const useSessionInfo = (sessionIds: string[]) => {
  // We need to call useAtomValue for each session, but hooks can't be conditional
  // So we use a component-based approach with a fixed maximum
  const titles = sessionIds.map(id => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const title = useAtomValue(sessionTitleAtom(id));
    return { id, title: title || `Session ${id.slice(0, 8)}` };
  });
  return titles;
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
  // Git status for session files (used to filter by current-changes scope)
  const [sessionFilesGitStatus, setSessionFilesGitStatus] = useState<Record<string, { status: string; gitStatusCode?: string }>>({});
  // All uncommitted files from the repo (for "all-uncommitted" scope)
  const [allUncommittedFiles, setAllUncommittedFiles] = useState<string[]>([]);;

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
  // Get session info with titles for the dropdown
  const sessionInfo = useSessionInfo(workstreamSessions);

  // Group by directory state from Jotai
  const [groupByDirectory] = useAtom(diffTreeGroupByDirectoryAtom);
  const setDiffTreeGroupByDirectory = useSetAtom(setDiffTreeGroupByDirectoryAtom);

  // Staged files - used for checkbox state (per-workstream)
  // Checkboxes are always shown in the new unified design
  const stagedFilesArr = useAtomValue(workstreamStagedFilesAtom(workstreamId));
  const stagedFiles = useMemo(() => new Set(stagedFilesArr), [stagedFilesArr]);
  const setStagedFilesAction = useSetAtom(setWorkstreamStagedFilesAtom);

  // File scope mode for filtering what files to show
  const fileScopeMode = useAtomValue(workstreamFileScopeModeAtom(workstreamId));
  const setFileScopeModeAction = useSetAtom(setWorkstreamFileScopeModeAtom);

  // File action atoms
  const hasExternalEditor = useAtomValue(hasExternalEditorAtom);
  const externalEditorName = useAtomValue(externalEditorNameAtom);
  const openInExternalEditor = useSetAtom(openInExternalEditorAtom);
  const revealInFinder = useSetAtom(revealInFinderAtom);
  const copyFilePath = useSetAtom(copyFilePathAtom);

  const setGroupByDirectory = useCallback((value: boolean) => {
    if (workspacePath) {
      setDiffTreeGroupByDirectory({ groupByDirectory: value, workspacePath });
    }
  }, [workspacePath, setDiffTreeGroupByDirectory]);

  const setFileScopeMode = useCallback((mode: FileScopeMode) => {
    setFileScopeModeAction({ workstreamId, mode });
  }, [workstreamId, setFileScopeModeAction]);

  // Helper to check if a file has uncommitted git changes
  const isFileUncommitted = useCallback((filePath: string): boolean => {
    const effectiveWorkspacePath = worktreePath || workspacePath;
    let relativePath = filePath;
    if (filePath.startsWith(effectiveWorkspacePath)) {
      relativePath = filePath.slice(effectiveWorkspacePath.length + 1);
    }
    const status = sessionFilesGitStatus[relativePath];
    // File has uncommitted changes if it has a status and status is not 'unchanged'
    return status !== undefined && status.status !== 'unchanged';
  }, [sessionFilesGitStatus, workspacePath, worktreePath]);

  // Filter file edits based on selected session and file scope mode
  const fileEdits = useMemo(() => {
    // First, filter by session
    let filtered: FileEditWithSession[];
    if (!filterSessionId) {
      // Show all files, deduplicated by filePath (most recent edit wins)
      const fileMap = new Map<string, FileEditWithSession>();
      for (const edit of allFileEdits) {
        const existing = fileMap.get(edit.filePath);
        if (!existing || new Date(edit.timestamp) > new Date(existing.timestamp)) {
          fileMap.set(edit.filePath, edit);
        }
      }
      filtered = Array.from(fileMap.values());
    } else {
      // Filter to specific session
      filtered = allFileEdits.filter(edit => edit.sessionId === filterSessionId);
    }

    // Then, filter by file scope mode
    switch (fileScopeMode) {
      case 'current-changes':
        // Only show files that have uncommitted changes
        return filtered.filter(edit => isFileUncommitted(edit.filePath));

      case 'session-files':
        // Default: show all files from session(s)
        return filtered;

      case 'all-uncommitted': {
        // Merge session files with all uncommitted files from repo
        const sessionFilePaths = new Set(filtered.map(f => f.filePath));
        // Add uncommitted files that aren't already in session files
        const additionalFiles: FileEditWithSession[] = allUncommittedFiles
          .filter(filePath => !sessionFilePaths.has(filePath))
          .map(filePath => ({
            filePath,
            linkType: 'edited' as const,
            timestamp: new Date().toISOString(),
            sessionId: '', // Not from a session
          }));
        return [...filtered, ...additionalFiles];
      }

      default:
        return filtered;
    }
  }, [allFileEdits, filterSessionId, fileScopeMode, isFileUncommitted, allUncommittedFiles]);

  // Memoize editedFiles array for GitOperationsPanel to prevent unnecessary re-renders
  const editedFilePaths = useMemo(() => {
    if (worktreeId) {
      // For worktrees, include worktree changed files
      return [...fileEdits.map((f) => f.filePath), ...worktreeChangedFiles.map(f => f.path)];
    }
    return fileEdits.map((f) => f.filePath);
  }, [fileEdits, worktreeId, worktreeChangedFiles]);

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

  // Fetch git status for session files (used to filter by current-changes scope)
  useEffect(() => {
    if (!workspacePath || allFileEdits.length === 0) {
      setSessionFilesGitStatus({});
      return;
    }

    let isCurrent = true;

    const fetchGitStatus = async () => {
      try {
        if (typeof window !== 'undefined' && window.electronAPI) {
          // Get relative paths for status check
          const effectiveWorkspacePath = worktreePath || workspacePath;
          const filePaths = allFileEdits.map(f => {
            if (f.filePath.startsWith(effectiveWorkspacePath)) {
              return f.filePath.slice(effectiveWorkspacePath.length + 1);
            }
            return f.filePath;
          });

          const result = await window.electronAPI.invoke('git:get-file-status', effectiveWorkspacePath, filePaths);
          if (result.success && result.status && isCurrent) {
            setSessionFilesGitStatus(result.status);
          }
        }
      } catch (error) {
        if (isCurrent) {
          console.error('[FilesEditedSidebar] Failed to fetch session files git status:', error);
        }
      }
    };

    fetchGitStatus();

    // Listen for git status changes to refresh
    const handleGitStatusChanged = () => {
      fetchGitStatus();
    };

    const unsubscribe = window.electronAPI?.on('git:status-changed', handleGitStatusChanged);

    return () => {
      isCurrent = false;
      unsubscribe?.();
    };
  }, [workspacePath, worktreePath, allFileEdits]);

  // Fetch all uncommitted files from repo (for "all-uncommitted" scope)
  useEffect(() => {
    // Only fetch when scope is all-uncommitted
    if (fileScopeMode !== 'all-uncommitted' || !workspacePath) {
      setAllUncommittedFiles([]);
      return;
    }

    let isCurrent = true;

    const fetchAllUncommitted = async () => {
      try {
        if (typeof window !== 'undefined' && window.electronAPI) {
          const effectiveWorkspacePath = worktreePath || workspacePath;
          const result = await window.electronAPI.invoke('git:get-uncommitted-files', effectiveWorkspacePath);
          if (result.success && result.files && isCurrent) {
            // Convert relative paths to absolute
            const absolutePaths = result.files.map((relativePath: string) =>
              `${effectiveWorkspacePath}/${relativePath}`
            );
            setAllUncommittedFiles(absolutePaths);
          }
        }
      } catch (error) {
        if (isCurrent) {
          console.error('[FilesEditedSidebar] Failed to fetch all uncommitted files:', error);
        }
      }
    };

    fetchAllUncommitted();

    // Listen for git status changes to refresh
    const handleGitStatusChanged = () => {
      fetchAllUncommitted();
    };

    const unsubscribe = window.electronAPI?.on('git:status-changed', handleGitStatusChanged);

    return () => {
      isCurrent = false;
      unsubscribe?.();
    };
  }, [fileScopeMode, workspacePath, worktreePath]);

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
    copyFilePath(filePath);
  }, [copyFilePath]);

  const handleRevealInFinder = useCallback((filePath: string) => {
    revealInFinder(filePath);
  }, [revealInFinder]);

  const handleOpenInExternalEditor = useCallback((filePath: string) => {
    openInExternalEditor(filePath);
  }, [openInExternalEditor]);

  return (
    <div className="files-edited-sidebar shrink-0 flex flex-col h-full bg-[var(--nim-bg-secondary)]" style={{ width }}>
      {/* Header with Files label and controls */}
      <div className="files-edited-sidebar__header flex items-center gap-2 px-3 py-2 border-b border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] shrink-0">
        <MaterialSymbol icon="description" size={16} />
        <span className="files-edited-sidebar__title font-medium text-[var(--nim-text)] text-sm">
          Files Edited
        </span>
        {/* Controls */}
        <div className="files-edited-sidebar__controls ml-auto flex gap-1">
          <FilesEditedOptionsDropdown
            groupByDirectory={groupByDirectory}
            onGroupByDirectoryChange={setGroupByDirectory}
            fileScopeMode={fileScopeMode}
            onFileScopeModeChange={setFileScopeMode}
            sessions={hasMultipleSessions ? sessionInfo : undefined}
            filterSessionId={filterSessionId}
            onFilterSessionIdChange={setFilterSessionId}
          />
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
            onOpenInExternalEditor={hasExternalEditor ? handleOpenInExternalEditor : undefined}
            externalEditorName={externalEditorName}
            showCheckboxes={true}
            selectedFiles={worktreeId ? worktreeStagedFiles : stagedFiles}
            onSelectionChange={handleSelectionChange}
            onSelectAll={handleSelectAll}
            onBulkSelectionChange={handleBulkSelectionChange}
          />
        </div>
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
