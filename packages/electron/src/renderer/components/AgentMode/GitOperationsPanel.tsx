/**
 * GitOperationsPanel - Context-aware git operations UI
 *
 * Provides a unified interface that adapts based on context:
 * - Commit Section (manual or AI-assisted) - for regular workspaces
 * - Worktree Operations Section - for worktree sessions (uncommitted changes, rebase, merge, squash)
 * - History Section (always visible, collapsible)
 *
 * Note: File selection (uncommitted changes) is now handled in FilesEditedSidebar
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime';
import {
  gitStatusAtom,
  gitCommitsAtom,
  isCommittingAtom,
  pendingProposalForWorkstreamAtom,
  removePendingGitCommitProposalAtom,
} from '../../store/atoms/gitOperations';
import {
  workstreamStagedFilesAtom,
  workstreamCommitMessageAtom,
  workstreamActiveProposalIdAtom,
  workstreamChildrenAtom,
  setWorkstreamStagedFilesAtom,
  setWorkstreamCommitMessageAtom,
  setWorkstreamActiveProposalIdAtom,
  clearWorkstreamGitStateAtom,
} from '../../store/atoms/workstreamState';
import { RebaseConflictDialog } from './RebaseConflictDialog';
import { MergeConflictDialog } from './MergeConflictDialog';
import { MergeConfirmDialog } from './MergeConfirmDialog';
import { UntrackedFilesConflictDialog } from './UntrackedFilesConflictDialog';
import { ArchiveWorktreeDialog } from './ArchiveWorktreeDialog';
import { SquashCommitModal } from './SquashCommitModal';

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
  /** The workstream ID (parent session) - used for persisted git state */
  workstreamId: string;
  /** The active session ID - used for AI commit requests */
  sessionId: string;
  editedFiles: string[];
  /** The worktree ID if this is a worktree session */
  worktreeId?: string | null;
  /** The worktree path if this is a worktree session */
  worktreePath?: string | null;
  /** Callback when worktree is archived */
  onWorktreeArchived?: () => void;
}

export const GitOperationsPanel: React.FC<GitOperationsPanelProps> = React.memo(
  ({ workspacePath, workstreamId, sessionId, editedFiles, worktreeId, worktreePath, onWorktreeArchived }) => {
    // Use useAtomValue for read-only, useSetAtom for write-only to minimize re-renders
    const gitStatus = useAtomValue(gitStatusAtom);
    const setGitStatus = useSetAtom(gitStatusAtom);
    const gitCommits = useAtomValue(gitCommitsAtom);
    const setGitCommits = useSetAtom(gitCommitsAtom);
    const isCommitting = useAtomValue(isCommittingAtom);
    const setIsCommitting = useSetAtom(isCommittingAtom);

    // Local state for commit workflow mode (manual vs smart)
    const [commitMode, setCommitMode] = useState<'manual' | 'smart'>('smart');

    // Per-workstream git state (persisted)
    const stagedFilesArr = useAtomValue(workstreamStagedFilesAtom(workstreamId));
    const stagedFiles = new Set(stagedFilesArr); // Convert to Set for compatibility
    const setStagedFilesAction = useSetAtom(setWorkstreamStagedFilesAtom);
    const commitMessage = useAtomValue(workstreamCommitMessageAtom(workstreamId));
    const setCommitMessageAction = useSetAtom(setWorkstreamCommitMessageAtom);
    const activeProposalId = useAtomValue(workstreamActiveProposalIdAtom(workstreamId));
    const setActiveProposalIdAction = useSetAtom(setWorkstreamActiveProposalIdAtom);
    const clearGitState = useSetAtom(clearWorkstreamGitStateAtom);

    // Helper functions to wrap atom actions with workstreamId
    const setStagedFiles = useCallback((files: Set<string>) => {
      setStagedFilesAction({ workstreamId, files: Array.from(files) });
    }, [workstreamId, setStagedFilesAction]);

    const setCommitMessage = useCallback((message: string) => {
      setCommitMessageAction({ workstreamId, message });
    }, [workstreamId, setCommitMessageAction]);

    const setActiveProposalId = useCallback((proposalId: string | null) => {
      setActiveProposalIdAction({ workstreamId, proposalId });
    }, [workstreamId, setActiveProposalIdAction]);

    const stageAll = useCallback((files: string[]) => {
      setStagedFilesAction({ workstreamId, files });
    }, [workstreamId, setStagedFilesAction]);

    const clearStaging = useCallback(() => {
      setStagedFilesAction({ workstreamId, files: [] });
    }, [workstreamId, setStagedFilesAction]);

    // Get child session IDs for workstream-scoped proposal lookup
    const childSessionIds = useAtomValue(workstreamChildrenAtom(workstreamId));

    // Pending AI commit proposal - when AI proposes a commit via git_commit_proposal
    // Use workstreamId + childSessionIds to scope proposals to this specific workstream
    const pendingProposal = useAtomValue(pendingProposalForWorkstreamAtom({ workstreamId, childSessionIds }));
    const removePendingProposal = useSetAtom(removePendingGitCommitProposalAtom);

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
    const [mergeConflictFiles, setMergeConflictFiles] = useState<string[] | null>(null);
    const [untrackedFilesConflict, setUntrackedFilesConflict] = useState<string[] | null>(null);
    const [worktreeName, setWorktreeName] = useState<string>('');
    const [showArchiveDialog, setShowArchiveDialog] = useState(false);
    const [showMergeConfirmDialog, setShowMergeConfirmDialog] = useState(false);
    const [showSquashModal, setShowSquashModal] = useState(false);
    const [selectedCommits, setSelectedCommits] = useState<Set<string>>(new Set());
    const [squashWarning, setSquashWarning] = useState<string | undefined>();
    const [isSquashing, setIsSquashing] = useState(false);
    const [isCheckingCommits, setIsCheckingCommits] = useState(false);

    // Track if worktree data has been loaded for the current worktreePath
    // This prevents redundant fetches when switching between manual/smart modes
    const worktreeDataLoadedForPath = useRef<string | null>(null);

    // Track previous proposal ID to detect new proposals
    const prevProposalIdRef = useRef<string | null>(null);

    // When AI proposes a commit, populate the UI (but stay in current mode)
    useEffect(() => {
      if (!pendingProposal) return;

      // Only process if this is a new proposal
      if (prevProposalIdRef.current === pendingProposal.proposalId) return;
      prevProposalIdRef.current = pendingProposal.proposalId;

      // Store the proposal ID so we can send response when user commits
      setActiveProposalId(pendingProposal.proposalId);

      // Populate commit message
      setCommitMessage(pendingProposal.commitMessage);

      // Stage the proposed files
      setStagedFiles(new Set(pendingProposal.filesToStage));

      // Don't switch modes - stay in smart mode but show proposal UI
      // The smart mode section will detect activeProposalId and show the commit form

      // Expand the panel if collapsed
      setIsExpanded(true);
    }, [pendingProposal, setCommitMessage, setStagedFiles, setActiveProposalId]);

    // When pending proposal disappears but we still have activeProposalId,
    // it means the commit was completed via the transcript widget - clear our state
    useEffect(() => {
      if (!pendingProposal && activeProposalId) {
        clearGitState(workstreamId);
      }
    }, [pendingProposal, activeProposalId, clearGitState, workstreamId]);

    // Clear git state when there are no more uncommitted changes
    // This is the authoritative cleanup - if nothing to commit, reset the UI
    useEffect(() => {
      if (gitStatus && !gitStatus.hasUncommitted) {
        clearGitState(workstreamId);
      }
    }, [gitStatus, clearGitState, workstreamId]);

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
      if (!commitMessage?.trim() || stagedFiles.size === 0) {
        return;
      }

      setIsCommitting(true);
      try {
        if (window.electronAPI) {
          const filesToCommit = Array.from(stagedFiles);
          const result = (await window.electronAPI.invoke(
            'git:commit',
            workspacePath,
            commitMessage,
            filesToCommit
          )) as { success: boolean; commitHash?: string; error?: string };

          if (result.success) {
            // If this was an AI-proposed commit, send response back to the MCP tool
            if (activeProposalId) {
              window.electronAPI.sendMcpGitCommitProposalResult(activeProposalId, {
                action: 'committed',
                commitHash: result.commitHash,
                filesCommitted: filesToCommit,
                commitMessage: commitMessage,
              });
              removePendingProposal(activeProposalId);
            }

            // Clear all git state (commit message, staged files, active proposal ID)
            clearGitState(workstreamId);
            // Refresh git status and commits
            const [newStatus, newCommits] = await Promise.all([
              window.electronAPI.invoke('git:status', workspacePath),
              window.electronAPI.invoke('git:log', workspacePath, 10),
            ]);
            setGitStatus(newStatus as any);
            setGitCommits(newCommits as any);
          } else {
            console.error('[GitOperationsPanel] Commit failed:', result.error);
            // If this was an AI-proposed commit, send error response
            if (activeProposalId) {
              window.electronAPI.sendMcpGitCommitProposalResult(activeProposalId, {
                action: 'cancelled',
                error: result.error,
              });
              removePendingProposal(activeProposalId);
            }
            // Clear git state even on failure so user can retry
            clearGitState(workstreamId);
          }
        }
      } catch (error) {
        console.error('[GitOperationsPanel] Commit failed:', error);
        // If this was an AI-proposed commit, send error response
        if (activeProposalId) {
          window.electronAPI.sendMcpGitCommitProposalResult(activeProposalId, {
            action: 'cancelled',
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          removePendingProposal(activeProposalId);
        }
        // Clear git state even on failure so user can retry
        clearGitState(workstreamId);
      } finally {
        setIsCommitting(false);
      }
    }, [
      commitMessage,
      stagedFiles,
      workspacePath,
      workstreamId,
      setIsCommitting,
      clearGitState,
      setGitStatus,
      setGitCommits,
      activeProposalId,
      removePendingProposal,
    ]);

    // Handle smart commit (AI-assisted)
    const handleSmartCommit = useCallback(async () => {
      // Send message to AI session to propose commit based on session work
      if (window.electronAPI && sessionId && workspacePath) {
        try {
          const message = 'Use git_commit_proposal to create a commit for the work done in this session. Include all session-edited files that have uncommitted changes.';
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

    // Load worktree name for archive dialog
    const loadWorktreeName = useCallback(async () => {
      if (!worktreePath) return;

      try {
        const result = await window.electronAPI.worktreeGetByPath(worktreePath);
        if (result?.success && result.worktree) {
          setWorktreeName(result.worktree.displayName || result.worktree.name);
        }
      } catch (err) {
        console.error('[GitOperationsPanel] Failed to load worktree name:', err);
      }
    }, [worktreePath]);

    // Initial load for worktree data - fetch when worktreePath exists
    // and data hasn't been loaded for this worktreePath yet
    useEffect(() => {
      if (!worktreePath) return;

      // Skip if we've already loaded data for this worktreePath
      if (worktreeDataLoadedForPath.current === worktreePath) return;

      const load = async () => {
        await Promise.all([
          loadWorktreeName(),
          loadWorktreeChangedFiles(),
          loadWorktreeCommits(),
          loadWorktreeRepoRootBranch(),
          loadWorktreeStatus(),
        ]);
        // Mark data as loaded for this path
        worktreeDataLoadedForPath.current = worktreePath;
      };
      load();
    }, [worktreePath, loadWorktreeName, loadWorktreeChangedFiles, loadWorktreeCommits, loadWorktreeRepoRootBranch, loadWorktreeStatus]);

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

    // Merge to main (actual merge operation)
    const performWorktreeMerge = useCallback(async () => {
      if (!worktreePath) return;

      setShowMergeConfirmDialog(false);
      setWorktreeIsMerging(true);
      try {
        const result = await window.electronAPI.invoke('worktree:merge', worktreePath, workspacePath);
        if (result?.success) {
          // Reload files, commits, and status
          await Promise.all([loadWorktreeChangedFiles(), loadWorktreeCommits(), loadWorktreeStatus()]);
          // Show archive dialog after successful merge
          setShowArchiveDialog(true);
        } else {
          // Check if this is a merge conflict error (detected before merge started)
          if ((result?.message === 'merge-conflict-detected' || result?.message === 'merge-conflict-in-main') && result?.conflictedFiles) {
            // Show merge conflict dialog
            setMergeConflictFiles(result.conflictedFiles);
          } else {
            console.error('[GitOperationsPanel] Worktree merge failed:', result?.error || result?.message);
          }
        }
      } catch (err) {
        console.error('[GitOperationsPanel] Failed to merge worktree:', err);
      } finally {
        setWorktreeIsMerging(false);
      }
    }, [worktreePath, workspacePath, loadWorktreeChangedFiles, loadWorktreeCommits, loadWorktreeStatus]);

    // Show merge confirmation dialog
    const handleWorktreeMerge = useCallback(() => {
      setShowMergeConfirmDialog(true);
    }, []);

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
          } else if (result?.message === 'untracked-files-conflict' && result?.untrackedFiles) {
            // Show untracked files conflict dialog
            setUntrackedFilesConflict(result.untrackedFiles);
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
        // Get the base branch from repo root and worktree info
        const baseBranch = worktreeRepoRootBranch || 'main';
        const wtName = worktreePath?.split('/').pop() || 'unknown';
        const worktreeBranch = `worktree/${wtName}`;

        // Create a detailed prompt with specific instructions
        const conflictFilesList = rebaseConflictData.files.map(f => `  - ${f}`).join('\n');
        const draftMessage = `I need to rebase this worktree branch onto the latest changes from ${baseBranch}.

**Context:**
- Main repository: ${workspacePath}
- Base branch: ${baseBranch}
- Worktree location: ${worktreePath}
- Worktree branch: ${worktreeBranch}

**The Situation:**
I'm trying to rebase ${worktreeBranch} onto the local ${baseBranch} branch (from the main repository at ${workspacePath}, NOT origin/${baseBranch}). These files have conflicts:
${conflictFilesList}
${rebaseConflictData.commits ? `
**Conflicting Commits:**
${rebaseConflictData.commits.ours && rebaseConflictData.commits.ours.length > 0 ? `Your commits:\n${rebaseConflictData.commits.ours.slice(0, 5).map(c => `  - ${c}`).join('\n')}` : ''}
${rebaseConflictData.commits.theirs && rebaseConflictData.commits.theirs.length > 0 ? `\nIncoming commits from ${baseBranch}:\n${rebaseConflictData.commits.theirs.slice(0, 5).map(c => `  - ${c}`).join('\n')}` : ''}
` : ''}
**Important Notes:**
- If there are any uncommitted changes (staged or unstaged), they have been auto-stashed before the rebase attempt
- After completing the rebase, you'll need to restore the stash with \`git stash pop\`
- Handle any conflicts that arise when restoring the stash

**What you need to do:**
1. Start the rebase: \`git rebase ${baseBranch}\`
2. Resolve all conflicts in the files listed above
3. After resolving each conflict, stage the file: \`git add <file>\`
4. Continue the rebase: \`git rebase --continue\`
5. Repeat steps 2-4 until the rebase is complete
6. After the rebase succeeds, restore uncommitted changes: \`git stash pop\`
7. If there are conflicts when popping the stash, resolve them as well

Make sure to preserve the intent of both the worktree changes and the incoming changes from ${baseBranch}.`;

        console.log('[GitOperationsPanel] Creating AI session in main repo workspace...');
        // Create the session in the MAIN REPO workspace (so it appears in main session list)
        // but associate it with the worktree via worktreeId (so Claude runs in worktree directory)
        const sessionResult = await window.electronAPI.aiCreateSession(
          'claude-code',
          undefined, // documentContext
          workspacePath, // workspacePath (main repo - so session appears in main session list)
          undefined, // modelId (use default)
          'coding', // sessionType
          worktreeId ?? undefined  // worktreeId (associate with the worktree - Claude will run in worktree directory)
        );

        console.log('[GitOperationsPanel] Session result:', sessionResult);

        if (sessionResult?.id) {
          const rebaseSessionId = sessionResult.id;

          // Load the session data first (use workspacePath since session was created in main repo workspace)
          console.log('[GitOperationsPanel] Loading session...', rebaseSessionId);
          const sessionData = await window.electronAPI.aiLoadSession(rebaseSessionId, workspacePath);
          console.log('[GitOperationsPanel] Session data:', sessionData);

          if (sessionData) {
            // Save the draft input so it appears in the text box but isn't sent yet
            console.log('[GitOperationsPanel] Saving draft input...');
            await window.electronAPI.aiSaveDraftInput(
              rebaseSessionId,
              draftMessage,
              workspacePath
            );

            // Dispatch a custom event to notify the AgenticPanel to open this session
            // Use workspacePath since that's where the session was created
            console.log('[GitOperationsPanel] Dispatching event...');
            window.dispatchEvent(new CustomEvent('open-ai-session', {
              detail: {
                sessionId: rebaseSessionId,
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

    // Resolve untracked files conflict with Claude Agent
    const handleResolveUntrackedFilesWithAgent = useCallback(async () => {
      if (!untrackedFilesConflict || untrackedFilesConflict.length === 0) return;

      console.log('[GitOperationsPanel] Resolving untracked files conflict with agent', { untrackedFilesConflict, worktreePath });

      // Close the dialog
      setUntrackedFilesConflict(null);

      try {
        // Get the base branch from repo root and worktree info
        const baseBranch = worktreeRepoRootBranch || 'main';
        const wtName = worktreePath?.split('/').pop() || 'unknown';
        const worktreeBranch = `worktree/${wtName}`;

        // Create a detailed prompt with specific instructions
        const untrackedFilesList = untrackedFilesConflict.map(f => `  - ${f}`).join('\n');
        const draftMessage = `I need to rebase this worktree branch onto the latest changes from ${baseBranch}, but there are untracked files blocking the rebase.

**Context:**
- Main repository: ${workspacePath}
- Base branch: ${baseBranch}
- Worktree location: ${worktreePath}
- Worktree branch: ${worktreeBranch}

**The Problem:**
The rebase cannot proceed because these untracked files in the worktree would be overwritten by incoming changes from ${baseBranch}:
${untrackedFilesList}

**What you need to do:**
1. First, examine each untracked file to understand what it contains
2. Decide what to do with each file:
   - If it's important and should be kept: \`git add <file>\` to track it, then commit
   - If it's generated/temp and can be deleted: \`rm <file>\`
   - If you're unsure, you can stash it: \`git stash -u\` (stashes untracked files too)
3. After handling the untracked files, retry the rebase: \`git rebase ${baseBranch}\`
4. If you stashed, remember to restore with \`git stash pop\` after the rebase

Please analyze these files and recommend the best approach before taking action.`;

        console.log('[GitOperationsPanel] Creating AI session for untracked files resolution...');
        const sessionResult = await window.electronAPI.aiCreateSession(
          'claude-code',
          undefined, // documentContext
          workspacePath, // workspacePath (main repo - so session appears in main session list)
          undefined, // modelId (use default)
          'coding', // sessionType
          worktreeId ?? undefined  // worktreeId (associate with the worktree - Claude will run in worktree directory)
        );

        console.log('[GitOperationsPanel] Session result:', sessionResult);

        if (sessionResult?.id) {
          const sessionId = sessionResult.id;

          // Load the session data first
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
            console.log('[GitOperationsPanel] Dispatching event...');
            window.dispatchEvent(new CustomEvent('open-ai-session', {
              detail: {
                sessionId: sessionId,
                workspacePath: workspacePath,
                draftInput: draftMessage
              }
            }));
            console.log('[GitOperationsPanel] Event dispatched successfully');
          }
        }
      } catch (err) {
        console.error('[GitOperationsPanel] Failed to create agent session for untracked files resolution:', err);
      }
    }, [workspacePath, worktreePath, worktreeId, worktreeRepoRootBranch, untrackedFilesConflict]);

    // Resolve merge conflicts with Claude Agent
    const handleResolveConflictsWithAgent = useCallback(async () => {
      if (!mergeConflictFiles || mergeConflictFiles.length === 0) return;

      console.log('[GitOperationsPanel] Resolving conflicts with agent', { mergeConflictFiles, workspacePath });

      // Close the dialog
      setMergeConflictFiles(null);

      try {
        // Get the worktree branch name from the path
        const wtName = worktreePath?.split('/').pop() || 'unknown';
        const worktreeBranch = `worktree/${wtName}`;
        const mainBranch = worktreeRepoRootBranch || 'main';

        // Create a very specific prompt for resolving the merge conflicts
        const conflictFilesList = mergeConflictFiles.map(f => `  - ${f}`).join('\n');
        const draftMessage = `I need to merge the worktree branch into main, preserving both committed and uncommitted changes.

**Context:**
- Main repository: ${workspacePath}
- Main branch: ${mainBranch}
- Worktree location: ${worktreePath}
- Worktree branch: ${worktreeBranch}

**The Situation:**
I'm trying to merge commits from ${worktreeBranch} into ${mainBranch}. These files have both uncommitted changes in main AND committed changes in the worktree:
${conflictFilesList}

**IMPORTANT - The desired end state:**
For each file, the final result should have:
1. The committed changes from ${worktreeBranch} (merged and committed)
2. The uncommitted changes from ${mainBranch} (still unstaged, on top of the merged version)

**What you need to do:**

**Step 1: Stash the uncommitted changes**
\`\`\`bash
cd ${workspacePath}
git stash push -m "Uncommitted changes before worktree merge"
\`\`\`

**Step 2: Merge the worktree branch**
\`\`\`bash
git merge --no-ff ${worktreeBranch}
\`\`\`
This applies the committed changes from the worktree.

**Step 3: Reapply the uncommitted changes**
\`\`\`bash
git stash pop
\`\`\`

**Step 4: Resolve conflicts from stash pop**
The \`git stash pop\` will likely create conflicts in ${mergeConflictFiles.join(', ')} because both the merge and the stash modified these files.

For each conflicted file:
- Open the file and look for conflict markers (\`<<<<<<< Updated upstream\`, \`=======\`, \`>>>>>>> Stashed changes\`)
- Between \`<<<<<<< Updated upstream\` and \`=======\` is the newly merged version (this is what we want to keep as the base)
- Between \`=======\` and \`>>>>>>> Stashed changes\` is the uncommitted changes (this is what we want on top)
- **Merge both sections**: Keep the merged version as the base, then apply the uncommitted changes on top
- Remove all conflict markers
- The file should now have both the merged changes AND the uncommitted changes

**Step 5: Verify the result**
\`\`\`bash
git status
\`\`\`
Should show the files as modified (uncommitted). The working directory should have:
- The committed changes from ${worktreeBranch} (in the last commit)
- The uncommitted changes (as unstaged modifications)

**DO NOT** stage or commit these changes - they should remain uncommitted.

Please proceed with this strategy.`;

        console.log('[GitOperationsPanel] Creating AI session in main repo workspace...');
        // Create the session in the MAIN REPO workspace (so it appears in session list)
        // but associate it with the worktree via worktreeId
        const sessionResult = await window.electronAPI.aiCreateSession(
          'claude-code',
          undefined, // documentContext
          workspacePath, // workspacePath (main repo - so session appears in main session list)
          undefined, // modelId (use default)
          'coding', // sessionType
          worktreeId ?? undefined  // worktreeId (associate with the worktree)
        );

        console.log('[GitOperationsPanel] Session result:', sessionResult);

        // The session result uses 'id' not 'sessionId'
        if (sessionResult?.id) {
          const newSessionId = sessionResult.id;

          // Load the session data first (use workspacePath since session was created in main repo workspace)
          console.log('[GitOperationsPanel] Loading session...', newSessionId);
          const sessionData = await window.electronAPI.aiLoadSession(newSessionId, workspacePath);
          console.log('[GitOperationsPanel] Session data:', sessionData);

          if (sessionData) {
            // Save the draft input so it appears in the text box but isn't sent yet
            console.log('[GitOperationsPanel] Saving draft input...');
            await window.electronAPI.aiSaveDraftInput(
              newSessionId,
              draftMessage,
              workspacePath
            );

            // Dispatch a custom event to notify the AgenticPanel to open this session
            // Use workspacePath since that's where the session was created
            console.log('[GitOperationsPanel] Dispatching event...');
            window.dispatchEvent(new CustomEvent('open-ai-session', {
              detail: {
                sessionId: newSessionId,
                workspacePath: workspacePath,
                draftInput: draftMessage
              }
            }));
            console.log('[GitOperationsPanel] Event dispatched successfully');
          }
        }
      } catch (err) {
        console.error('[GitOperationsPanel] Failed to create agent session for conflict resolution:', err);
      }
    }, [workspacePath, worktreePath, worktreeId, worktreeRepoRootBranch, mergeConflictFiles]);

    // Handle archive worktree
    const handleArchiveWorktree = useCallback(async () => {
      if (!worktreeId) {
        console.error('[GitOperationsPanel] Cannot archive: worktreeId not available');
        return;
      }

      console.log('[GitOperationsPanel] Archiving worktree:', { worktreeId, hasCallback: !!onWorktreeArchived });

      try {
        await window.electronAPI.worktreeArchive(worktreeId, workspacePath);
        console.log('[GitOperationsPanel] Archive complete, closing dialog and calling onWorktreeArchived');
        setShowArchiveDialog(false);
        // Notify parent that worktree was archived
        if (onWorktreeArchived) {
          console.log('[GitOperationsPanel] Calling onWorktreeArchived callback');
          onWorktreeArchived();
        } else {
          console.warn('[GitOperationsPanel] No onWorktreeArchived callback provided');
        }
      } catch (err) {
        console.error('[GitOperationsPanel] Failed to archive worktree:', err);
      }
    }, [worktreeId, workspacePath, onWorktreeArchived]);

    // Handle keep worktree (dismiss dialog)
    const handleKeepWorktree = useCallback(() => {
      setShowArchiveDialog(false);
    }, []);

    // Squash commits
    const handleWorktreeSquash = useCallback(async (commitHashes: string[], message: string) => {
      if (!worktreePath) return;

      setIsSquashing(true);
      try {
        const result = await window.electronAPI.invoke('worktree:squash-commits', worktreePath, commitHashes, message);
        if (result?.success) {
          // Reload commits, files, and status
          await Promise.all([loadWorktreeCommits(), loadWorktreeChangedFiles(), loadWorktreeStatus()]);
          setSelectedCommits(new Set());
          setSquashWarning(undefined);
        } else {
          console.error('[GitOperationsPanel] Failed to squash commits:', result?.error);
        }
      } catch (err) {
        console.error('[GitOperationsPanel] Failed to squash commits:', err);
      } finally {
        setIsSquashing(false);
      }
    }, [worktreePath, loadWorktreeCommits, loadWorktreeChangedFiles, loadWorktreeStatus]);

    // Handle commit selection for squashing
    const handleToggleCommit = useCallback((hash: string) => {
      setSelectedCommits(prev => {
        const next = new Set(prev);

        if (next.has(hash)) {
          // Always allow deselection
          next.delete(hash);
          return next;
        }

        // For selection, check if it would create a consecutive range
        const commitIndex = worktreeCommits.findIndex(c => c.hash === hash);
        if (commitIndex === -1) return prev;

        if (next.size === 0) {
          // First selection, always allowed
          next.add(hash);
          return next;
        }

        // Find indices of currently selected commits
        const selectedIndices = Array.from(next)
          .map(h => worktreeCommits.findIndex(c => c.hash === h))
          .filter(idx => idx !== -1)
          .sort((a, b) => a - b);

        if (selectedIndices.length === 0) {
          next.add(hash);
          return next;
        }

        const minIndex = selectedIndices[0];
        const maxIndex = selectedIndices[selectedIndices.length - 1];

        // Only allow selection if it's adjacent to the current range
        if (commitIndex === minIndex - 1 || commitIndex === maxIndex + 1) {
          next.add(hash);
          return next;
        }

        // Also allow if it fills a gap in the current range
        if (commitIndex > minIndex && commitIndex < maxIndex) {
          next.add(hash);
          return next;
        }

        // Otherwise, don't allow the selection (non-consecutive)
        return prev;
      });
    }, [worktreeCommits]);

    // Clear commit selection
    const handleClearSelection = useCallback(() => {
      setSelectedCommits(new Set());
    }, []);

    // Handle squash button click
    const handleSquashClick = useCallback(() => {
      if (selectedCommits.size < 2) {
        return;
      }
      // Show modal immediately - we'll check existence when confirming
      setShowSquashModal(true);
    }, [selectedCommits.size]);

    // Handle squash confirmation
    const handleSquashConfirm = useCallback(async (message: string) => {
      // Capture the current selection at confirmation time
      const commitsToSquash = Array.from(selectedCommits);

      // If we haven't checked yet, check now before squashing
      if (!squashWarning) {
        setIsCheckingCommits(true);
        let warningToShow: string | undefined;
        try {
          const result = await window.electronAPI.invoke(
            'worktree:check-commits-existence',
            worktreePath,
            commitsToSquash
          );

          if (result?.success && result.existsElsewhere) {
            warningToShow = 'Warning: Some of these commits exist on other branches. Squashing will rewrite history and may cause issues when merging.';
          }
        } catch (err) {
          console.error('Failed to check commit existence:', err);
        } finally {
          setIsCheckingCommits(false);
        }

        // If there's a warning, show it and wait for re-confirmation
        if (warningToShow) {
          setSquashWarning(warningToShow);
          return; // Stay in modal with warning displayed
        }
      }

      // Proceed with squash
      setShowSquashModal(false);
      await handleWorktreeSquash(commitsToSquash, message);
    }, [selectedCommits, squashWarning, worktreePath, handleWorktreeSquash]);

    // Calculate which commits can be selected (for disabling checkboxes)
    const getSelectableCommits = useCallback((): Set<string> => {
      if (selectedCommits.size === 0) {
        // All commits can be selected when nothing is selected
        return new Set(worktreeCommits.map(c => c.hash));
      }

      const selectedIndices = Array.from(selectedCommits)
        .map(h => worktreeCommits.findIndex(c => c.hash === h))
        .filter(idx => idx !== -1)
        .sort((a, b) => a - b);

      if (selectedIndices.length === 0) {
        return new Set(worktreeCommits.map(c => c.hash));
      }

      const minIndex = selectedIndices[0];
      const maxIndex = selectedIndices[selectedIndices.length - 1];

      const selectable = new Set<string>();

      worktreeCommits.forEach((commit, index) => {
        // Already selected commits are selectable (for deselection)
        if (selectedCommits.has(commit.hash)) {
          selectable.add(commit.hash);
          return;
        }

        // Adjacent commits can be selected
        if (index === minIndex - 1 || index === maxIndex + 1) {
          selectable.add(commit.hash);
          return;
        }

        // Commits within the range can be selected (filling gaps)
        if (index > minIndex && index < maxIndex) {
          selectable.add(commit.hash);
        }
      });

      return selectable;
    }, [selectedCommits, worktreeCommits]);

    const selectableCommits = getSelectableCommits();

    // Derived state for worktree mode
    const worktreeStagedFiles = worktreeChangedFiles.filter(f => f.staged);
    const worktreeStagedCount = worktreeStagedFiles.length;
    const worktreeHasCommits = worktreeCommits.length > 0;
    const worktreeHasUncommittedChanges = worktreeChangedFiles.length > 0;
    // If merged, ignore commitsBehind (the merge commit doesn't need to be rebased)
    const effectiveWorktreeCommitsBehind = worktreeIsMerged ? 0 : worktreeCommitsBehind;
    const worktreeCanCommit = worktreeStagedCount > 0 && worktreeCommitMessage.trim().length > 0 && !worktreeIsCommitting;
    const worktreeCanMerge = worktreeHasCommits && !worktreeHasUncommittedChanges && !worktreeIsMerging && !worktreeIsMerged && effectiveWorktreeCommitsBehind === 0;
    const worktreeCanRebase = effectiveWorktreeCommitsBehind > 0 && !worktreeIsRebasing;

    // Debug: Log current state values on each render
    // console.log('[GitOperationsPanel] Render state:', {
    //   workstreamId,
    //   activeProposalId,
    //   commitMessage: commitMessage?.substring(0, 50) + (commitMessage?.length > 50 ? '...' : ''),
    //   stagedFilesCount: stagedFiles.size,
    //   mode,
    // });

    if (!gitStatus) {
      return null;
    }

    const hasChanges = editedFiles.length > 0 || gitStatus.hasUncommitted;

    return (
      <div className="git-operations-panel min-w-[200px] border-t border-[var(--nim-border)] bg-[var(--nim-bg-secondary)]">
        {/* Header */}
        <div className="git-operations-panel__header flex items-center justify-between py-2 px-3 select-none text-xs font-medium text-[var(--nim-text)] border-b border-[var(--nim-border)]">
          <div
            className="git-operations-panel__header-left flex items-center gap-1.5 flex-1 cursor-pointer hover:opacity-80"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <MaterialSymbol icon={isExpanded ? 'expand_more' : 'chevron_right'} size={16} />
            <MaterialSymbol icon="account_tree" size={14} />
            <span className="git-operations-panel__branch font-semibold text-[var(--nim-text)]">
              {worktreeId && worktreeName ? `worktree/${worktreeName}` : gitStatus.branch}
            </span>
            {!worktreeId && (gitStatus.ahead > 0 || gitStatus.behind > 0) && (
              <span className="git-operations-panel__sync-status text-[11px] text-[var(--nim-text-faint)] font-[var(--nim-font-mono)]">
                {gitStatus.ahead > 0 && `↑${gitStatus.ahead}`}
                {gitStatus.behind > 0 && ` ↓${gitStatus.behind}`}
              </span>
            )}
          </div>
        </div>

        {isExpanded && (
          <div className="git-operations-panel__content px-3 pb-3 flex flex-col gap-3">

            {/* Commit Section (always visible when not in worktree) */}
            {!worktreeId && (
              <div className="flex flex-col gap-2 pt-3">
                {/* Commit mode toggle and header */}
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-[var(--nim-text)]">Commit</span>
                  <div className="flex rounded-[3px] overflow-hidden border border-[var(--nim-border)]">
                    <button
                      className={`px-1.5 py-0.5 border-none bg-transparent text-[var(--nim-text-muted)] text-[10px] font-medium cursor-pointer transition-all duration-150 border-r border-[var(--nim-border)] ${
                        commitMode === 'manual' ? 'bg-[var(--nim-bg-tertiary)] text-[var(--nim-text)]' : 'hover:bg-[var(--nim-bg-tertiary)] hover:opacity-60'
                      }`}
                      onClick={() => setCommitMode('manual')}
                      title="Manual commit message"
                    >
                      Manual
                    </button>
                    <button
                      className={`px-1.5 py-0.5 border-none bg-transparent text-[var(--nim-text-muted)] text-[10px] font-medium cursor-pointer transition-all duration-150 ${
                        commitMode === 'smart' ? 'bg-[var(--nim-bg-tertiary)] text-[var(--nim-text)]' : 'hover:bg-[var(--nim-bg-tertiary)] hover:opacity-60'
                      }`}
                      onClick={() => setCommitMode('smart')}
                      title="AI-assisted commit"
                    >
                      Smart
                    </button>
                  </div>
                </div>

                {/* Manual commit workflow */}
                {commitMode === 'manual' && (
                  <div className="flex flex-col gap-2" data-testid="git-operations-manual-mode">
                    <textarea
                      className="w-full p-2 border border-[var(--nim-border)] rounded bg-[var(--nim-bg)] text-[var(--nim-text)] text-[11px] font-[var(--nim-font-mono)] resize-y focus:outline-none focus:border-[var(--nim-primary)]"
                      value={commitMessage}
                      onChange={(e) => setCommitMessage(e.target.value)}
                      placeholder="Enter commit message..."
                      rows={3}
                    />
                    <button
                      className="w-full p-2 border-none rounded bg-[var(--nim-primary)] text-white text-xs font-semibold cursor-pointer flex items-center justify-center gap-1.5 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={handleManualCommit}
                      disabled={isCommitting || !commitMessage?.trim() || stagedFiles.size === 0}
                    >
                      {isCommitting ? 'Committing...' : `Commit (${stagedFiles.size})`}
                    </button>
                  </div>
                )}

                {/* Smart commit workflow */}
                {commitMode === 'smart' && (
                  <div className="flex flex-col gap-2" data-testid="git-operations-smart-mode">
                    {activeProposalId ? (
                      <>
                        {/* AI Proposal indicator with dismiss button */}
                        <div className="flex items-center gap-1.5 p-1.5 bg-[rgba(139,92,246,0.1)] border border-[rgba(139,92,246,0.3)] rounded text-[10px] text-[var(--nim-text-muted)]">
                          <MaterialSymbol icon="auto_awesome" size={14} className="text-[rgb(139,92,246)]" />
                          <span className="flex-1">AI proposed commit - review and edit</span>
                          <button
                            onClick={() => {
                              window.electronAPI.sendMcpGitCommitProposalResult(activeProposalId, {
                                action: 'cancelled',
                                error: 'User dismissed the commit',
                              });
                              removePendingProposal(activeProposalId);
                              clearGitState(workstreamId);
                            }}
                            className="text-[var(--nim-text-faint)] hover:text-[var(--nim-text)] cursor-pointer"
                            title="Dismiss AI proposal"
                          >
                            <MaterialSymbol icon="close" size={14} />
                          </button>
                        </div>
                        <textarea
                          className="w-full p-2 border border-[var(--nim-border)] rounded bg-[var(--nim-bg)] text-[var(--nim-text)] text-[11px] font-[var(--nim-font-mono)] resize-y focus:outline-none focus:border-[var(--nim-primary)]"
                          value={commitMessage}
                          onChange={(e) => setCommitMessage(e.target.value)}
                          placeholder="Enter commit message..."
                          rows={3}
                          data-testid="git-operations-commit-message"
                        />
                        <button
                          className="w-full p-2 border-none rounded bg-[var(--nim-primary)] text-white text-xs font-semibold cursor-pointer flex items-center justify-center gap-1.5 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                          onClick={handleManualCommit}
                          disabled={isCommitting || !commitMessage?.trim() || stagedFiles.size === 0}
                          data-testid="git-operations-commit-button"
                        >
                          {isCommitting ? 'Committing...' : `Commit (${stagedFiles.size})`}
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="text-xs text-[var(--nim-text-muted)] m-0 leading-normal">
                          Let AI analyze your changes and propose a commit message.
                        </p>
                        <button
                          className="w-full p-2 border-none rounded text-white text-xs font-semibold cursor-pointer flex items-center justify-center gap-1.5 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed bg-gradient-to-br from-[var(--nim-primary)] to-[var(--nim-primary-hover)]"
                          onClick={handleSmartCommit}
                          disabled={!hasChanges}
                          data-testid="git-operations-commit-with-ai-button"
                        >
                          <MaterialSymbol icon="auto_awesome" size={16} />
                          Commit with AI
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Worktree Operations Section (only when worktreeId exists) */}
            {worktreeId && (
              <div className="flex flex-col gap-3 pt-3">
                {/* Section header with refresh button */}
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-[var(--nim-text)]">Commit & Sync</span>
                  <button
                    onClick={async () => {
                      await Promise.all([
                        loadWorktreeChangedFiles(),
                        loadWorktreeCommits(),
                        loadWorktreeStatus(),
                      ]);
                    }}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] text-[var(--nim-primary)] hover:bg-[var(--nim-bg-hover)] rounded transition-colors"
                    title="Refresh worktree status"
                  >
                    <MaterialSymbol icon="refresh" size={14} />
                    <span>Refresh</span>
                  </button>
                </div>

                {/* Worktree Status Info */}
                {(effectiveWorktreeCommitsBehind > 0 || worktreeIsMerged) && (
                  <div className="flex flex-col gap-1 text-[11px]">
                    {effectiveWorktreeCommitsBehind > 0 && (
                      <span className="flex items-center gap-1.5 text-[var(--nim-warning)] font-medium">
                        <MaterialSymbol icon="warning" size={14} />
                        {effectiveWorktreeCommitsBehind} commit{effectiveWorktreeCommitsBehind !== 1 ? 's' : ''} behind {worktreeRepoRootBranch || 'base'}
                      </span>
                    )}
                    {worktreeIsMerged && (
                      <span className="flex items-center gap-1.5 text-[var(--nim-success)] font-medium">
                        <MaterialSymbol icon="check_circle" size={14} />
                        Merged to {worktreeRepoRootBranch || 'base'}
                      </span>
                    )}
                  </div>
                )}

                {/* Commit Message */}
                <div className="flex flex-col gap-2">
                  <textarea
                    className="w-full p-2 border border-[var(--nim-border)] rounded bg-[var(--nim-bg)] text-[var(--nim-text)] text-[11px] font-[var(--nim-font-mono)] resize-y focus:outline-none focus:border-[var(--nim-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
                    placeholder="Commit message..."
                    value={worktreeCommitMessage}
                    onChange={(e) => setWorktreeCommitMessage(e.target.value)}
                    disabled={worktreeIsCommitting}
                    rows={3}
                  />
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    className="w-full p-2 border-none rounded bg-[var(--nim-primary)] text-white text-xs font-semibold cursor-pointer flex items-center justify-center gap-1.5 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
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
                    className={`w-full p-2 border-none rounded text-white text-xs font-semibold cursor-pointer flex items-center justify-center gap-1.5 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed ${
                      effectiveWorktreeCommitsBehind > 0
                        ? 'bg-[var(--nim-warning)]'
                        : 'bg-[var(--nim-bg-tertiary)] text-[var(--nim-text)]'
                    }`}
                    onClick={handleWorktreeRebase}
                    disabled={!worktreeCanRebase}
                    title={
                      effectiveWorktreeCommitsBehind === 0
                        ? 'Already up to date with base branch'
                        : worktreeHasUncommittedChanges
                          ? `Bring in ${effectiveWorktreeCommitsBehind} commit${effectiveWorktreeCommitsBehind === 1 ? '' : 's'} from ${worktreeRepoRootBranch || 'base branch'} (uncommitted changes will be auto-stashed)`
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
                    className="w-full p-2 border-none rounded bg-[var(--nim-bg-tertiary)] text-[var(--nim-text)] text-xs font-semibold cursor-pointer flex items-center justify-center gap-1.5 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
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
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between text-[11px] font-semibold text-[var(--nim-text)]">
                      <span>Commits ({worktreeCommits.length})</span>
                    </div>
                    {/* Squash actions - only show when commits are selected */}
                    {worktreeCommits.length > 1 && selectedCommits.size > 0 && (
                      <div className="flex items-center justify-between gap-2 p-2 bg-[var(--nim-bg-tertiary)] rounded border border-[var(--nim-border)]">
                        <div className="text-[11px] text-[var(--nim-text-muted)]">
                          {selectedCommits.size === 1 ? (
                            <span>Select at least one more commit</span>
                          ) : (
                            <span>{selectedCommits.size} commits selected</span>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="bg-transparent border-none text-[var(--nim-primary)] text-[10px] font-medium cursor-pointer p-0 hover:underline"
                            onClick={handleClearSelection}
                          >
                            Clear
                          </button>
                          <button
                            type="button"
                            className="px-2 py-1 border-none rounded bg-[var(--nim-primary)] text-white text-[10px] font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={handleSquashClick}
                            disabled={selectedCommits.size < 2 || isSquashing}
                          >
                            {isSquashing ? 'Squashing...' : `Squash ${selectedCommits.size} Commits`}
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="flex flex-col gap-1 max-h-[200px] overflow-y-auto border border-[var(--nim-border)] rounded p-1 bg-[var(--nim-bg)]">
                      {worktreeCommits.map((commit) => {
                        const isSelected = selectedCommits.has(commit.hash);
                        const canSelect = selectableCommits.has(commit.hash);
                        return (
                          <div
                            key={commit.hash}
                            className={`flex items-center gap-2 p-2 rounded text-[11px] ${
                              isSelected ? 'bg-[var(--nim-bg-selected)] border border-[var(--nim-primary)]' : 'hover:bg-[var(--nim-bg-tertiary)]'
                            }`}
                          >
                            {worktreeCommits.length > 1 && (
                              <input
                                type="checkbox"
                                checked={isSelected}
                                disabled={!canSelect && !isSelected}
                                onChange={() => handleToggleCommit(commit.hash)}
                                className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                                title={!canSelect && !isSelected ? 'Only consecutive commits can be squashed' : 'Select for squashing'}
                              />
                            )}
                            <div className="font-[var(--nim-font-mono)] text-[var(--nim-primary)] text-[10px] font-semibold">
                              {commit.shortHash}
                            </div>
                            <div className="flex-1 text-[var(--nim-text)] overflow-hidden text-ellipsis whitespace-nowrap">
                              {commit.message}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* History Toggle */}
            <div className="git-operations-panel__history-toggle text-center pt-2 border-t border-[var(--nim-border)]">
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="git-operations-panel__btn-text bg-transparent border-none text-[var(--nim-primary)] text-[10px] font-medium cursor-pointer p-0 hover:underline"
              >
                {showHistory ? 'Hide' : 'Show'} Recent Commits
              </button>
            </div>

            {/* Commit History */}
            {showHistory && (
              <div className="git-operations-panel__history flex flex-col gap-2 max-h-[300px] overflow-y-auto border border-[var(--nim-border)] rounded p-2 bg-[var(--nim-bg)]">
                {gitCommits.map((commit) => (
                  <div key={commit.hash} className="git-operations-panel__commit p-2 bg-[var(--nim-bg)] rounded text-[11px]">
                    <div className="git-operations-panel__commit-hash font-[var(--nim-font-mono)] text-[var(--nim-primary)] text-[10px] mb-1">
                      {commit.hash.slice(0, 7)}
                    </div>
                    <div className="git-operations-panel__commit-msg text-[var(--nim-text)] mb-1 font-medium">
                      {commit.message}
                    </div>
                    <div className="git-operations-panel__commit-meta text-[var(--nim-text-faint)] text-[10px]">
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

        {/* Merge conflict dialog */}
        {mergeConflictFiles && mergeConflictFiles.length > 0 && (
          <MergeConflictDialog
            workspacePath={workspacePath}
            conflictedFiles={mergeConflictFiles}
            onResolveWithAgent={handleResolveConflictsWithAgent}
            onCancel={() => setMergeConflictFiles(null)}
          />
        )}

        {/* Untracked files conflict dialog */}
        {untrackedFilesConflict && untrackedFilesConflict.length > 0 && (
          <UntrackedFilesConflictDialog
            worktreePath={worktreePath || ''}
            untrackedFiles={untrackedFilesConflict}
            onResolveWithAgent={handleResolveUntrackedFilesWithAgent}
            onCancel={() => setUntrackedFilesConflict(null)}
          />
        )}

        {/* Merge confirmation dialog */}
        {showMergeConfirmDialog && (
          <MergeConfirmDialog
            worktreePath={worktreePath || ''}
            workspacePath={workspacePath}
            hasUncommittedChanges={worktreeHasUncommittedChanges}
            onConfirm={performWorktreeMerge}
            onCancel={() => setShowMergeConfirmDialog(false)}
          />
        )}

        {/* Archive dialog */}
        {showArchiveDialog && (
          <ArchiveWorktreeDialog
            worktreeName={worktreeName}
            onArchive={handleArchiveWorktree}
            onKeep={handleKeepWorktree}
            contextMessage="Merge successful!"
          />
        )}

        {/* Squash commit modal */}
        {showSquashModal && (
          <SquashCommitModal
            isOpen={showSquashModal}
            commitCount={selectedCommits.size}
            warningMessage={squashWarning}
            isChecking={isCheckingCommits}
            onConfirm={handleSquashConfirm}
            onCancel={() => {
              setShowSquashModal(false);
              setSquashWarning(undefined);
            }}
          />
        )}
      </div>
    );
  }
);

GitOperationsPanel.displayName = 'GitOperationsPanel';
