/**
 * GitOperationsPanel - Unified git operations UI
 *
 * Provides both manual and smart (AI-assisted) commit modes.
 * Shows git status, staging area, commit history, and commit controls.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
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
import './GitOperationsPanel.css';

interface GitOperationsPanelProps {
  workspacePath: string;
  sessionId: string;
  editedFiles: string[];
}

export const GitOperationsPanel: React.FC<GitOperationsPanelProps> = React.memo(
  ({ workspacePath, sessionId, editedFiles }) => {
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
      </div>
    );
  }
);

GitOperationsPanel.displayName = 'GitOperationsPanel';
