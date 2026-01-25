/**
 * GitOperationsPanel - Unified git operations UI
 *
 * Provides both manual and smart (AI-assisted) commit modes.
 * Shows git status, staging area, commit history, and commit controls.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime';
import {
  gitStatusAtom,
  gitCommitsAtom,
  stagedFilesAtom,
  commitMessageAtom,
  isCommittingAtom,
  gitOperationModeAtom,
  stageAllFilesAtom,
  clearStagingAtom,
} from '../../store/atoms/gitOperations';
import { RebaseConflictDialog } from '../DiffMode/RebaseConflictDialog';
import './GitOperationsPanel.css';

// Types for worktree mode (copied from DiffModeView)
interface WorktreeChangedFile {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  staged: boolean;
}

interface WorktreeCommitInfo {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: Date;
  files: string[];
}

interface GitOperationsPanelProps {
  workspacePath: string;
  sessionId: string;
  editedFiles: string[];
  /** The worktree ID if this is a worktree session */
  worktreeId?: string | null;
  /** The worktree path if this is a worktree session */
  worktreePath?: string | null;
}

export const GitOperationsPanel: React.FC<GitOperationsPanelProps> = React.memo(
  ({ workspacePath, sessionId, editedFiles, worktreeId, worktreePath }) => {
    // Use useAtomValue for read-only, useSetAtom for write-only to minimize re-renders
    const gitStatus = useAtomValue(gitStatusAtom);
    const setGitStatus = useSetAtom(gitStatusAtom);
    const gitCommits = useAtomValue(gitCommitsAtom);
    const setGitCommits = useSetAtom(gitCommitsAtom);
    const stagedFiles = useAtomValue(stagedFilesAtom);
    const setStagedFiles = useSetAtom(stagedFilesAtom);
    const commitMessage = useAtomValue(commitMessageAtom);
    const setCommitMessage = useSetAtom(commitMessageAtom);
    const isCommitting = useAtomValue(isCommittingAtom);
    const setIsCommitting = useSetAtom(isCommittingAtom);
    const mode = useAtomValue(gitOperationModeAtom);
    const setMode = useSetAtom(gitOperationModeAtom);
    const stageAll = useSetAtom(stageAllFilesAtom);
    const clearStaging = useSetAtom(clearStagingAtom);

    const [isExpanded, setIsExpanded] = useState(true);
    const [showHistory, setShowHistory] = useState(false);

    // ============================================================
    // Worktree Mode State (copied from DiffModeView)
    // ============================================================
    const [worktreeChangedFiles, setWorktreeChangedFiles] = useState<WorktreeChangedFile[]>([]);
    const [worktreeCommits, setWorktreeCommits] = useState<WorktreeCommitInfo[]>([]);
    const [worktreeRepoRootBranch, setWorktreeRepoRootBranch] = useState<string | undefined>(undefined);
    const [worktreeCommitsBehind, setWorktreeCommitsBehind] = useState(0);
    const [worktreeIsMerged, setWorktreeIsMerged] = useState(false);
    const [worktreeIsRebasing, setWorktreeIsRebasing] = useState(false);
    const [worktreeIsMerging, setWorktreeIsMerging] = useState(false);
    const [worktreeCommitMessage, setWorktreeCommitMessage] = useState('');
    const [worktreeIsCommitting, setWorktreeIsCommitting] = useState(false);
    const [rebaseConflictData, setRebaseConflictData] = useState<{
      files: string[];
      commits?: { ours: string[]; theirs: string[] };
    } | null>(null);

    // Track if worktree data has been loaded for the current worktreePath
    // This prevents redundant fetches when switching between manual/smart modes
    const worktreeDataLoadedForPath = useRef<string | null>(null);

    // Fetch git status
    const fetchGitStatus = useCallback(async () => {
      if (!workspacePath) return;
      try {
        if (window.electronAPI) {
          const status = await window.electronAPI.invoke('git:status', workspacePath);
          setGitStatus(status as any);
        }
      } catch (error) {
        console.error('[GitOperationsPanel] Failed to fetch git status:', error);
      }
    }, [workspacePath, setGitStatus]);

    // Initial fetch and listen for git:status-changed events
    useEffect(() => {
      if (!workspacePath) return;

      fetchGitStatus();

      // Listen for git status changes (from GitRefWatcher)
      // No polling needed - GitRefWatcher provides immediate updates
      const unsubscribe = window.electronAPI?.git?.onStatusChanged?.(
        (data: { workspacePath: string }) => {
          if (data.workspacePath === workspacePath) {
            fetchGitStatus();
          }
        }
      );

      return () => {
        unsubscribe?.();
      };
    }, [workspacePath, fetchGitStatus]);

    // Fetch recent commits
    const fetchCommits = useCallback(async () => {
      if (!workspacePath) return;
      try {
        if (window.electronAPI) {
          const result = await window.electronAPI.invoke('git:log', workspacePath, 10);
          setGitCommits(result as any);
        }
      } catch (error) {
        console.error('[GitOperationsPanel] Failed to fetch commits:', error);
      }
    }, [workspacePath, setGitCommits]);

    // Initial fetch and listen for commit detection events
    useEffect(() => {
      if (!workspacePath) return;

      fetchCommits();

      // Listen for new commits (from GitRefWatcher)
      const unsubscribe = window.electronAPI?.git?.onCommitDetected?.(
        (data: { workspacePath: string }) => {
          if (data.workspacePath === workspacePath) {
            fetchCommits();
          }
        }
      );

      return () => {
        unsubscribe?.();
      };
    }, [workspacePath, fetchCommits]);

    // Handle manual commit
    const handleManualCommit = useCallback(async () => {
      if (!commitMessage.trim() || stagedFiles.size === 0) {
        return;
      }

      setIsCommitting(true);
      try {
        if (window.electronAPI) {
          const result = (await window.electronAPI.invoke(
            'git:commit',
            workspacePath,
            commitMessage,
            Array.from(stagedFiles)
          )) as { success: boolean; commitHash?: string; error?: string };

          if (result.success) {
            setCommitMessage('');
            clearStaging();
            // Refresh git status and commits
            const [newStatus, newCommits] = await Promise.all([
              window.electronAPI.invoke('git:status', workspacePath),
              window.electronAPI.invoke('git:log', workspacePath, 10),
            ]);
            setGitStatus(newStatus as any);
            setGitCommits(newCommits as any);
          } else {
            console.error('[GitOperationsPanel] Commit failed:', result.error);
          }
        }
      } catch (error) {
        console.error('[GitOperationsPanel] Failed to commit:', error);
      } finally {
        setIsCommitting(false);
      }
    }, [
      commitMessage,
      stagedFiles,
      workspacePath,
      setIsCommitting,
      setCommitMessage,
      clearStaging,
      setGitStatus,
      setGitCommits,
    ]);

    // Handle smart commit (AI-assisted)
    const handleSmartCommit = useCallback(async () => {
      // Send message to AI session to analyze changes and propose commit
      if (window.electronAPI && sessionId && workspacePath) {
        try {
          const message = 'Please analyze the changes I made and propose a commit using git_commit_proposal.';
          const docContext = {
            filePath: undefined,
            content: undefined,
            fileType: undefined,
            attachments: undefined,
            mode: 'agent',
          };
          await window.electronAPI.invoke('ai:sendMessage', message, docContext, sessionId, workspacePath);
        } catch (error) {
          console.error('[GitOperationsPanel] Failed to send smart commit message:', error);
        }
      }
    }, [sessionId, workspacePath]);

    // Toggle file staging
    const toggleFileStaging = useCallback(
      (filePath: string) => {
        const newStaged = new Set(stagedFiles);
        if (newStaged.has(filePath)) {
          newStaged.delete(filePath);
        } else {
          newStaged.add(filePath);
        }
        setStagedFiles(newStaged);
      },
      [stagedFiles, setStagedFiles]
    );

    // ============================================================
    // Worktree Mode Callbacks (copied from DiffModeView)
    // ============================================================

    // Load changed files from the worktree
    const loadWorktreeChangedFiles = useCallback(async () => {
      if (!worktreePath) return;

      try {
        const result = await window.electronAPI.invoke('worktree:get-changed-files', worktreePath);
        if (result?.success && Array.isArray(result.files)) {
          const files: WorktreeChangedFile[] = result.files.map((f: { path: string; status: string }) => ({
            path: f.path,
            status: f.status as 'added' | 'modified' | 'deleted',
            staged: true, // Default all to staged
          }));
          setWorktreeChangedFiles(files);
        }
      } catch (err) {
        console.error('[GitOperationsPanel] Failed to load worktree changed files:', err);
      }
    }, [worktreePath]);

    // Load commits from worktree
    const loadWorktreeCommits = useCallback(async () => {
      if (!worktreePath) return;

      try {
        const result = await window.electronAPI.invoke('worktree:get-commits', worktreePath);
        if (result?.success && Array.isArray(result.commits)) {
          setWorktreeCommits(result.commits.map((c: any) => ({
            ...c,
            date: new Date(c.date),
          })));
        }
      } catch (err) {
        console.error('[GitOperationsPanel] Failed to load worktree commits:', err);
      }
    }, [worktreePath]);

    // Load repo root's current branch
    const loadWorktreeRepoRootBranch = useCallback(async () => {
      if (!workspacePath) return;

      try {
        const result = await window.electronAPI.invoke('worktree:get-repo-current-branch', workspacePath);
        if (result?.success && result.branch) {
          setWorktreeRepoRootBranch(result.branch);
        }
      } catch (err) {
        console.error('[GitOperationsPanel] Failed to load repo root branch:', err);
      }
    }, [workspacePath]);

    // Load worktree status (commits behind, isMerged)
    const loadWorktreeStatus = useCallback(async () => {
      if (!worktreePath) return;

      try {
        const result = await window.electronAPI.worktreeGetStatus(worktreePath);
        if (result?.success && result.status) {
          setWorktreeCommitsBehind(result.status.commitsBehind || 0);
          setWorktreeIsMerged(result.status.isMerged || false);
        }
      } catch (err) {
        console.error('[GitOperationsPanel] Failed to load worktree status:', err);
      }
    }, [worktreePath]);

    // Initial load for worktree mode - only fetch when entering worktree mode
    // and data hasn't been loaded for this worktreePath yet
    useEffect(() => {
      if (!worktreePath || mode !== 'worktree') return;

      // Skip if we've already loaded data for this worktreePath
      if (worktreeDataLoadedForPath.current === worktreePath) return;

      const load = async () => {
        await Promise.all([
          loadWorktreeChangedFiles(),
          loadWorktreeCommits(),
          loadWorktreeRepoRootBranch(),
          loadWorktreeStatus(),
        ]);
        // Mark data as loaded for this path
        worktreeDataLoadedForPath.current = worktreePath;
      };
      load();
    }, [worktreePath, mode, loadWorktreeChangedFiles, loadWorktreeCommits, loadWorktreeRepoRootBranch, loadWorktreeStatus]);

    // Reset the loaded flag when worktreePath changes (different worktree)
    useEffect(() => {
      if (worktreePath !== worktreeDataLoadedForPath.current) {
        worktreeDataLoadedForPath.current = null;
      }
    }, [worktreePath]);

    // Toggle worktree file staged state
    const handleWorktreeToggleStaged = useCallback((filePath: string) => {
      setWorktreeChangedFiles(prev =>
        prev.map(f =>
          f.path === filePath ? { ...f, staged: !f.staged } : f
        )
      );
    }, []);

    // Toggle all worktree files staged state
    const handleWorktreeToggleAllStaged = useCallback((staged: boolean) => {
      setWorktreeChangedFiles(prev =>
        prev.map(f => ({ ...f, staged }))
      );
    }, []);

    // Commit worktree changes
    const handleWorktreeCommit = useCallback(async () => {
      const stagedWorktreeFiles = worktreeChangedFiles.filter(f => f.staged).map(f => f.path);
      if (stagedWorktreeFiles.length === 0 || !worktreeCommitMessage.trim()) {
        return;
      }

      setWorktreeIsCommitting(true);
      try {
        const result = await window.electronAPI.invoke('worktree:commit', worktreePath, worktreeCommitMessage, stagedWorktreeFiles);
        if (result?.success) {
          setWorktreeCommitMessage('');
          // Reload files, commits, and status
          await Promise.all([loadWorktreeChangedFiles(), loadWorktreeCommits(), loadWorktreeStatus()]);
        } else {
          console.error('[GitOperationsPanel] Worktree commit failed:', result?.error);
        }
      } catch (err) {
        console.error('[GitOperationsPanel] Failed to commit worktree:', err);
      } finally {
        setWorktreeIsCommitting(false);
      }
    }, [worktreeChangedFiles, worktreeCommitMessage, worktreePath, loadWorktreeChangedFiles, loadWorktreeCommits, loadWorktreeStatus]);

    // Merge to main
    const handleWorktreeMerge = useCallback(async () => {
      if (!worktreePath) return;

      setWorktreeIsMerging(true);
      try {
        const result = await window.electronAPI.invoke('worktree:merge', worktreePath, workspacePath);
        if (result?.success) {
          // Reload files, commits, and status
          await Promise.all([loadWorktreeChangedFiles(), loadWorktreeCommits(), loadWorktreeStatus()]);
        } else {
          console.error('[GitOperationsPanel] Worktree merge failed:', result?.error || result?.message);
        }
      } catch (err) {
        console.error('[GitOperationsPanel] Failed to merge worktree:', err);
      } finally {
        setWorktreeIsMerging(false);
      }
    }, [worktreePath, workspacePath, loadWorktreeChangedFiles, loadWorktreeCommits, loadWorktreeStatus]);

    // Rebase from base branch
    const handleWorktreeRebase = useCallback(async () => {
      if (!worktreePath) return;

      setWorktreeIsRebasing(true);
      try {
        const result = await window.electronAPI.worktreeRebase(worktreePath);
        if (result?.success) {
          // Reload files, commits, and status
          await Promise.all([loadWorktreeChangedFiles(), loadWorktreeCommits(), loadWorktreeStatus()]);
        } else {
          // Check if this is a rebase conflict error (detected before rebase started)
          if (result?.message === 'rebase-conflicts-detected' && result?.conflictedFiles) {
            // Show rebase conflict dialog
            setRebaseConflictData({
              files: result.conflictedFiles,
              commits: result.conflictingCommits,
            });
          } else {
            console.error('[GitOperationsPanel] Worktree rebase failed:', result?.error || result?.message);
          }
        }
      } catch (err) {
        console.error('[GitOperationsPanel] Failed to rebase worktree:', err);
      } finally {
        setWorktreeIsRebasing(false);
      }
    }, [worktreePath, loadWorktreeChangedFiles, loadWorktreeCommits, loadWorktreeStatus]);

    // Resolve rebase conflicts with Claude Agent (using Crystal's prompt pattern)
    const handleResolveRebaseConflictsWithAgent = useCallback(async () => {
      if (!rebaseConflictData || rebaseConflictData.files.length === 0) return;

      console.log('[GitOperationsPanel] Resolving rebase conflicts with agent', { rebaseConflictData, worktreePath });

      // Close the dialog
      setRebaseConflictData(null);

      try {
        // Get the base branch from repo root
        const mainBranch = worktreeRepoRootBranch || 'main';

        // Create the prompt following Crystal's pattern
        const draftMessage = `Please rebase the local ${mainBranch} branch (not origin/${mainBranch}) into this branch and resolve all conflicts`;

        console.log('[GitOperationsPanel] Creating AI session in main repo workspace...');
        // Create the session in the MAIN REPO workspace (so it appears in main session list)
        // but associate it with the worktree via worktreeId (so Claude runs in worktree directory)
        const sessionResult = await window.electronAPI.aiCreateSession(
          'claude-code',
          undefined, // documentContext
          workspacePath, // workspacePath (main repo - so session appears in main session list)
          undefined, // modelId (use default)
          'coding', // sessionType
          worktreeId  // worktreeId (associate with the worktree - Claude will run in worktree directory)
        );

        console.log('[GitOperationsPanel] Session result:', sessionResult);

        if (sessionResult?.id) {
          const sessionId = sessionResult.id;

          // Load the session data first (use workspacePath since session was created in main repo workspace)
          console.log('[GitOperationsPanel] Loading session...', sessionId);
          const sessionData = await window.electronAPI.aiLoadSession(sessionId, workspacePath);
          console.log('[GitOperationsPanel] Session data:', sessionData);

          if (sessionData) {
            // Save the draft input so it appears in the text box but isn't sent yet
            console.log('[GitOperationsPanel] Saving draft input...');
            await window.electronAPI.aiSaveDraftInput(
              sessionId,
              draftMessage,
              workspacePath
            );

            // Dispatch a custom event to notify the AgenticPanel to open this session
            // Use workspacePath since that's where the session was created
            console.log('[GitOperationsPanel] Dispatching event...');
            window.dispatchEvent(new CustomEvent('open-ai-session', {
              detail: {
                sessionId,
                workspacePath: workspacePath,
                draftInput: draftMessage
              }
            }));
            console.log('[GitOperationsPanel] Event dispatched successfully');
          }
        }
      } catch (err) {
        console.error('[GitOperationsPanel] Failed to create agent session for rebase conflict resolution:', err);
      }
    }, [workspacePath, worktreePath, worktreeId, worktreeRepoRootBranch, rebaseConflictData]);

    // Derived state for worktree mode
    const worktreeStagedFiles = worktreeChangedFiles.filter(f => f.staged);
    const worktreeStagedCount = worktreeStagedFiles.length;
    const worktreeHasCommits = worktreeCommits.length > 0;
    const worktreeHasUncommittedChanges = worktreeChangedFiles.length > 0;
    // If merged, ignore commitsBehind (the merge commit doesn't need to be rebased)
    const effectiveWorktreeCommitsBehind = worktreeIsMerged ? 0 : worktreeCommitsBehind;
    const worktreeCanCommit = worktreeStagedCount > 0 && worktreeCommitMessage.trim().length > 0 && !worktreeIsCommitting;
    const worktreeCanMerge = worktreeHasCommits && !worktreeHasUncommittedChanges && !worktreeIsMerging && !worktreeIsMerged && effectiveWorktreeCommitsBehind === 0;
    const worktreeCanRebase = effectiveWorktreeCommitsBehind > 0 && !worktreeHasUncommittedChanges && !worktreeIsRebasing;

    if (!gitStatus) {
      return null;
    }

    const hasChanges = editedFiles.length > 0 || gitStatus.hasUncommitted;

    return (
      <div className="git-operations-panel">
        {/* Header with mode toggle */}
        <div className="git-operations-panel__header">
          <div className="git-operations-panel__header-left" onClick={() => setIsExpanded(!isExpanded)}>
            <MaterialSymbol icon={isExpanded ? 'expand_more' : 'chevron_right'} size={16} />
            <MaterialSymbol icon="account_tree" size={14} />
            <span className="git-operations-panel__branch">{gitStatus.branch}</span>
            {(gitStatus.ahead > 0 || gitStatus.behind > 0) && (
              <span className="git-operations-panel__sync-status">
                {gitStatus.ahead > 0 && `↑${gitStatus.ahead}`}
                {gitStatus.behind > 0 && ` ↓${gitStatus.behind}`}
              </span>
            )}
          </div>
          <div className="git-operations-panel__mode-toggle">
            <button
              className={mode === 'manual' ? 'active' : ''}
              onClick={() => setMode('manual')}
              title="Manual staging and commit"
            >
              Manual
            </button>
            <button
              className={mode === 'smart' ? 'active' : ''}
              onClick={() => setMode('smart')}
              title="AI-assisted commit"
            >
              Smart
            </button>
            {worktreeId && (
              <button
                className={mode === 'worktree' ? 'active' : ''}
                onClick={() => setMode('worktree')}
                title="Worktree operations"
              >
                Worktree
              </button>
            )}
          </div>
        </div>

        {isExpanded && (
          <div className="git-operations-panel__content">

            {/* Manual Mode */}
            {mode === 'manual' && (
              <div className="git-operations-panel__manual">
                {/* Staging Area */}
                <div className="git-operations-panel__section">
                  <div className="git-operations-panel__section-header">
                    <span>Changes ({editedFiles.length})</span>
                    <div className="git-operations-panel__section-actions">
                      <button
                        onClick={() => stageAll(editedFiles)}
                        disabled={editedFiles.length === 0}
                        className="git-operations-panel__btn-text"
                      >
                        Stage All
                      </button>
                      <button
                        onClick={() => clearStaging()}
                        disabled={stagedFiles.size === 0}
                        className="git-operations-panel__btn-text"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <div className="git-operations-panel__file-list">
                    {editedFiles.map((filePath) => {
                      const isStaged = stagedFiles.has(filePath);
                      return (
                        <div key={filePath} className="git-operations-panel__file-item">
                          <input
                            type="checkbox"
                            checked={isStaged}
                            onChange={() => toggleFileStaging(filePath)}
                          />
                          <span className="git-operations-panel__file-path">
                            {filePath.split('/').pop()}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Commit Message */}
                <div className="git-operations-panel__section">
                  <div className="git-operations-panel__section-header">
                    <span>Commit Message</span>
                  </div>
                  <textarea
                    className="git-operations-panel__commit-message"
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                    placeholder="Enter commit message..."
                    rows={4}
                  />
                </div>

                {/* Commit Button */}
                <button
                  className="git-operations-panel__commit-btn"
                  onClick={handleManualCommit}
                  disabled={isCommitting || !commitMessage.trim() || stagedFiles.size === 0}
                >
                  {isCommitting ? 'Committing...' : 'Commit'}
                </button>
              </div>
            )}

            {/* Smart Mode */}
            {mode === 'smart' && (
              <div className="git-operations-panel__smart">
                <p className="git-operations-panel__smart-desc">
                  Let AI analyze your changes and propose a commit message.
                </p>
                <button
                  className="git-operations-panel__commit-btn smart"
                  onClick={handleSmartCommit}
                  disabled={!hasChanges}
                >
                  <MaterialSymbol icon="auto_awesome" size={16} />
                  Commit with AI
                </button>
              </div>
            )}

            {/* Worktree Mode */}
            {mode === 'worktree' && worktreeId && (
              <div className="git-operations-panel__worktree">
                {/* Uncommitted Changes */}
                <div className="git-operations-panel__section">
                  <div className="git-operations-panel__section-header">
                    <span>Uncommitted Changes ({worktreeChangedFiles.length})</span>
                    <div className="git-operations-panel__section-actions">
                      <button
                        onClick={() => handleWorktreeToggleAllStaged(true)}
                        disabled={worktreeChangedFiles.length === 0}
                        className="git-operations-panel__btn-text"
                      >
                        Stage All
                      </button>
                      <button
                        onClick={() => handleWorktreeToggleAllStaged(false)}
                        disabled={worktreeStagedCount === 0}
                        className="git-operations-panel__btn-text"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  {worktreeChangedFiles.length > 0 && (
                    <div className="git-operations-panel__file-list">
                      {worktreeChangedFiles.map((file) => (
                        <div key={file.path} className="git-operations-panel__file-item">
                          <input
                            type="checkbox"
                            checked={file.staged}
                            onChange={() => handleWorktreeToggleStaged(file.path)}
                          />
                          <span className={`git-operations-panel__file-status git-operations-panel__file-status--${file.status}`}>
                            {file.status === 'added' ? 'A' : file.status === 'modified' ? 'M' : 'D'}
                          </span>
                          <span className="git-operations-panel__file-path">
                            {file.path.split('/').pop()}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Worktree Status Info */}
                {(effectiveWorktreeCommitsBehind > 0 || worktreeIsMerged) && (
                  <div className="git-operations-panel__worktree-status">
                    {effectiveWorktreeCommitsBehind > 0 && (
                      <span className="git-operations-panel__status-warning">
                        <MaterialSymbol icon="warning" size={14} />
                        {effectiveWorktreeCommitsBehind} commit{effectiveWorktreeCommitsBehind !== 1 ? 's' : ''} behind {worktreeRepoRootBranch || 'base'}
                      </span>
                    )}
                    {worktreeIsMerged && (
                      <span className="git-operations-panel__status-success">
                        <MaterialSymbol icon="check_circle" size={14} />
                        Merged to {worktreeRepoRootBranch || 'base'}
                      </span>
                    )}
                  </div>
                )}

                {/* Commit Message */}
                <div className="git-operations-panel__section">
                  <textarea
                    className="git-operations-panel__worktree-commit-message"
                    placeholder="Commit message..."
                    value={worktreeCommitMessage}
                    onChange={(e) => setWorktreeCommitMessage(e.target.value)}
                    disabled={worktreeIsCommitting}
                    rows={3}
                  />
                </div>

                {/* Action Buttons - styled like CommitSection */}
                <div className="git-operations-panel__worktree-actions">
                  <button
                    type="button"
                    className="git-operations-panel__worktree-button git-operations-panel__worktree-button--primary"
                    onClick={handleWorktreeCommit}
                    disabled={!worktreeCanCommit}
                    title={worktreeStagedCount === 0 ? 'Stage files to commit' : !worktreeCommitMessage.trim() ? 'Enter commit message' : 'Commit staged changes'}
                  >
                    {worktreeIsCommitting ? (
                      <>
                        <MaterialSymbol icon="progress_activity" size={16} />
                        <span>Committing...</span>
                      </>
                    ) : (
                      <>
                        <MaterialSymbol icon="check" size={16} />
                        <span>Commit ({worktreeStagedCount})</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    className={`git-operations-panel__worktree-button ${effectiveWorktreeCommitsBehind > 0 ? 'git-operations-panel__worktree-button--warning' : 'git-operations-panel__worktree-button--secondary'}`}
                    onClick={handleWorktreeRebase}
                    disabled={!worktreeCanRebase}
                    title={
                      worktreeHasUncommittedChanges
                        ? 'Commit all changes before rebasing'
                        : effectiveWorktreeCommitsBehind === 0
                          ? 'Already up to date with base branch'
                          : `Bring in ${effectiveWorktreeCommitsBehind} commit${effectiveWorktreeCommitsBehind === 1 ? '' : 's'} from ${worktreeRepoRootBranch || 'base branch'}`
                    }
                  >
                    {worktreeIsRebasing ? (
                      <>
                        <MaterialSymbol icon="progress_activity" size={16} />
                        <span>Rebasing...</span>
                      </>
                    ) : (
                      <>
                        <MaterialSymbol icon="sync" size={16} />
                        <span>Rebase{effectiveWorktreeCommitsBehind > 0 ? ` (${effectiveWorktreeCommitsBehind})` : ''}</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    className="git-operations-panel__worktree-button git-operations-panel__worktree-button--secondary"
                    onClick={handleWorktreeMerge}
                    disabled={!worktreeCanMerge}
                    title={
                      worktreeIsMerged
                        ? 'Already merged to base branch'
                        : effectiveWorktreeCommitsBehind > 0
                          ? `Rebase first to bring in ${effectiveWorktreeCommitsBehind} commit${effectiveWorktreeCommitsBehind === 1 ? '' : 's'} from ${worktreeRepoRootBranch || 'base branch'}`
                          : worktreeHasUncommittedChanges
                            ? 'Commit all changes before merging'
                            : !worktreeHasCommits
                              ? 'No commits to merge'
                              : `Merge commits into ${worktreeRepoRootBranch || 'base branch'}`
                    }
                  >
                    {worktreeIsMerging ? (
                      <>
                        <MaterialSymbol icon="progress_activity" size={16} />
                        <span>Merging...</span>
                      </>
                    ) : (
                      <>
                        <MaterialSymbol icon="merge" size={16} />
                        <span>Merge to {worktreeRepoRootBranch || 'base'}</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Worktree Commits */}
                {worktreeCommits.length > 0 && (
                  <div className="git-operations-panel__section">
                    <div className="git-operations-panel__section-header">
                      <span>Commits ({worktreeCommits.length})</span>
                    </div>
                    <div className="git-operations-panel__worktree-commits">
                      {worktreeCommits.map((commit) => (
                        <div key={commit.hash} className="git-operations-panel__worktree-commit">
                          <div className="git-operations-panel__commit-hash">
                            {commit.shortHash}
                          </div>
                          <div className="git-operations-panel__worktree-commit-message">
                            {commit.message}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* History Toggle */}
            <div className="git-operations-panel__history-toggle">
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="git-operations-panel__btn-text"
              >
                {showHistory ? 'Hide' : 'Show'} Recent Commits
              </button>
            </div>

            {/* Commit History */}
            {showHistory && (
              <div className="git-operations-panel__history">
                {gitCommits.map((commit) => (
                  <div key={commit.hash} className="git-operations-panel__commit">
                    <div className="git-operations-panel__commit-hash">
                      {commit.hash.slice(0, 7)}
                    </div>
                    <div className="git-operations-panel__commit-message">{commit.message}</div>
                    <div className="git-operations-panel__commit-meta">
                      {commit.author} • {new Date(commit.date).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Rebase conflict dialog */}
        {rebaseConflictData && rebaseConflictData.files.length > 0 && (
          <RebaseConflictDialog
            worktreePath={worktreePath || ''}
            conflictedFiles={rebaseConflictData.files}
            conflictingCommits={rebaseConflictData.commits}
            onResolveWithAgent={handleResolveRebaseConflictsWithAgent}
            onCancel={() => setRebaseConflictData(null)}
          />
        )}
      </div>
    );
  }
);

GitOperationsPanel.displayName = 'GitOperationsPanel';
