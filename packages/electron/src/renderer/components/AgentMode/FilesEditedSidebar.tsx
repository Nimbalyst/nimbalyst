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
import { gitOperationModeAtom } from '../../store/atoms/gitOperations';
import {
  workstreamStagedFilesAtom,
  setWorkstreamStagedFilesAtom,
} from '../../store/atoms/workstreamState';
import { GitOperationsPanel } from './GitOperationsPanel';
import { TodoPanel } from './TodoPanel';

interface FilesEditedSidebarProps {
  /** The workstream ID (parent session ID) - files from all child sessions will be shown */
  workstreamId: string;
  /** The currently active session ID within the workstream - used for AI commit requests */
  activeSessionId: string | null;
  workspacePath: string;
  onFileClick: (filePath: string) => void;
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
  width = 256,
  worktreeId,
  worktreePath,
  onWorktreeArchived,
}) => {
  const [allFileEdits, setAllFileEdits] = useState<FileEditWithSession[]>([]);
  const [pendingReviewFiles, setPendingReviewFiles] = useState<Set<string>>(new Set());
  const [filterSessionId, setFilterSessionId] = useState<string | null>(null);
  const [isClearing, setIsClearing] = useState(false);

  // Get all session IDs in this workstream
  const workstreamSessions = useAtomValue(workstreamSessionsAtom(workstreamId));
  // Show dropdown if there are multiple sessions in the workstream
  const hasMultipleSessions = workstreamSessions.length > 1;

  // Group by directory state from Jotai
  const [groupByDirectory] = useAtom(diffTreeGroupByDirectoryAtom);
  const setDiffTreeGroupByDirectory = useSetAtom(setDiffTreeGroupByDirectoryAtom);

  // Git operation mode - determines if checkboxes are shown
  const gitOperationMode = useAtomValue(gitOperationModeAtom);
  const showCheckboxes = gitOperationMode === 'manual' || gitOperationMode === 'worktree';

  // Staged files - used for checkbox state (per-workstream)
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
  const editedFilePaths = useMemo(() => {
    return fileEdits.map((f) => f.filePath);
  }, [fileEdits]);

  // Handle file selection change (checkbox toggle)
  const handleSelectionChange = useCallback((filePath: string, selected: boolean) => {
    const newFiles = selected
      ? [...stagedFilesArr, filePath]
      : stagedFilesArr.filter(f => f !== filePath);
    setStagedFilesAction({ workstreamId, files: newFiles });
  }, [stagedFilesArr, setStagedFilesAction, workstreamId]);

  // Handle select all files
  const handleSelectAll = useCallback((selected: boolean) => {
    if (selected) {
      setStagedFilesAction({ workstreamId, files: editedFilePaths });
    } else {
      setStagedFilesAction({ workstreamId, files: [] });
    }
  }, [editedFilePaths, setStagedFilesAction, workstreamId]);

  // Handle bulk selection change (for folder checkboxes)
  const handleBulkSelectionChange = useCallback((filePaths: string[], selected: boolean) => {
    const currentSet = new Set(stagedFilesArr);
    if (selected) {
      filePaths.forEach(fp => currentSet.add(fp));
    } else {
      filePaths.forEach(fp => currentSet.delete(fp));
    }
    setStagedFilesAction({ workstreamId, files: Array.from(currentSet) });
  }, [stagedFilesArr, setStagedFilesAction, workstreamId]);

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
          const allEdits: FileEditWithSession[] = [];

          // Fetch edits from all sessions in the workstream
          await Promise.all(
            workstreamSessions.map(async (sessionId) => {
              const result = await window.electronAPI.invoke(
                'session-files:get-by-session',
                sessionId,
                'edited'
              );
              if (result.success && result.files) {
                const edits: FileEditWithSession[] = result.files.map((f: any) => ({
                  filePath: f.filePath,
                  linkType: 'edited' as const,
                  operation: f.metadata?.operation,
                  linesAdded: f.metadata?.linesAdded,
                  linesRemoved: f.metadata?.linesRemoved,
                  timestamp: f.createdAt || new Date().toISOString(),
                  sessionId,
                }));
                allEdits.push(...edits);
              }
            })
          );

          // Only update state if this effect is still current (workstream hasn't changed)
          if (isCurrent) {
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
    onFileClick(filePath);
  }, [onFileClick]);

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
        await window.electronAPI.invoke('shell:show-item-in-folder', filePath);
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
        <span className="files-edited-sidebar__title font-medium text-[var(--nim-text)]">Files Edited</span>
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
      <div className="files-edited-sidebar__content flex-1 overflow-hidden">
        <FileEditsSidebarComponent
          fileEdits={fileEdits}
          onFileClick={onFileClick}
          workspacePath={workspacePath}
          pendingReviewFiles={pendingReviewFiles}
          groupByDirectory={groupByDirectory}
          onGroupByDirectoryChange={setGroupByDirectory}
          hideControls
          onOpenInFiles={handleOpenInFiles}
          onCopyPath={handleCopyPath}
          onRevealInFinder={handleRevealInFinder}
          showCheckboxes={showCheckboxes}
          selectedFiles={stagedFiles}
          onSelectionChange={handleSelectionChange}
          onSelectAll={handleSelectAll}
          onBulkSelectionChange={handleBulkSelectionChange}
        />
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
