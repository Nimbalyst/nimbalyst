import React, { useState } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import { ChangedFilesTree } from './ChangedFilesTree';
import { CommitSection } from './CommitSection';
import { CommitsHistory } from './CommitsHistory';
import { MergeConfirmDialog } from './MergeConfirmDialog';
import { SquashCommitModal } from './SquashCommitModal';
import type { ChangedFile, CommitInfo } from './DiffModeView';
import './ChangesPanel.css';

interface ChangesPanelProps {
  files: ChangedFile[];
  stagedFiles: ChangedFile[];
  commits: CommitInfo[];
  onToggleStaged: (filePath: string) => void;
  onToggleAllStaged: (staged: boolean) => void;
  onCommit: (message: string) => void;
  onMerge: () => void;
  onRebase: () => void;
  onSquash: (commitHashes: string[], message: string) => Promise<void>;
  onSelectFile: (filePath: string) => void;
  onRefresh: () => void;
  onCollapse: () => void;
  collapsed: boolean;
  error: string | null;
  onDismissError: () => void;
  workspacePath: string;
  worktreePath: string;
  repoRootBranch?: string; // Current branch of the repo root (what worktree is compared against)
  commitsBehind: number;
  isMerged: boolean;
  isRebasing: boolean;
}

export function ChangesPanel({
  files,
  stagedFiles,
  commits,
  onToggleStaged,
  onToggleAllStaged,
  onCommit,
  onMerge,
  onRebase,
  onSquash,
  onSelectFile,
  onRefresh,
  onCollapse,
  collapsed,
  error,
  onDismissError,
  workspacePath,
  worktreePath,
  repoRootBranch,
  commitsBehind,
  isMerged,
  isRebasing,
}: ChangesPanelProps) {
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [selectedCommits, setSelectedCommits] = useState<Set<string>>(new Set());
  const [showSquashModal, setShowSquashModal] = useState(false);
  const [squashWarning, setSquashWarning] = useState<string | undefined>();
  const [isSquashing, setIsSquashing] = useState(false);
  const [isCheckingCommits, setIsCheckingCommits] = useState(false);

  const handleCommit = async (message: string) => {
    setIsCommitting(true);
    try {
      await onCommit(message);
    } finally {
      setIsCommitting(false);
    }
  };

  const handleMergeConfirm = async () => {
    setShowMergeDialog(false);
    setIsMerging(true);
    try {
      await onMerge();
    } finally {
      setIsMerging(false);
    }
  };

  const handleToggleCommit = (hash: string) => {
    setSelectedCommits(prev => {
      const next = new Set(prev);

      if (next.has(hash)) {
        // Always allow deselection
        next.delete(hash);
        return next;
      }

      // For selection, check if it would create a consecutive range
      const commitIndex = commits.findIndex(c => c.hash === hash);
      if (commitIndex === -1) return prev;

      if (next.size === 0) {
        // First selection, always allowed
        next.add(hash);
        return next;
      }

      // Find indices of currently selected commits
      const selectedIndices = Array.from(next)
        .map(h => commits.findIndex(c => c.hash === h))
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
  };

  const handleClearSelection = () => {
    setSelectedCommits(new Set());
  };

  const handleSquashClick = () => {
    if (selectedCommits.size < 2) {
      return;
    }

    // Show modal immediately - we'll check existence when confirming
    setShowSquashModal(true);
  };

  const handleSquashConfirm = async (message: string) => {
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
    setIsSquashing(true);
    try {
      await onSquash(commitsToSquash, message);
      setSelectedCommits(new Set());
      setSquashWarning(undefined);
    } finally {
      setIsSquashing(false);
    }
  };

  const hasUncommittedChanges = files.length > 0;
  const allStaged = files.length > 0 && stagedFiles.length === files.length;

  // Calculate which commits can be selected (for disabling checkboxes)
  const getSelectableCommits = (): Set<string> => {
    if (selectedCommits.size === 0) {
      // All commits can be selected when nothing is selected
      return new Set(commits.map(c => c.hash));
    }

    const selectedIndices = Array.from(selectedCommits)
      .map(h => commits.findIndex(c => c.hash === h))
      .filter(idx => idx !== -1)
      .sort((a, b) => a - b);

    if (selectedIndices.length === 0) {
      return new Set(commits.map(c => c.hash));
    }

    const minIndex = selectedIndices[0];
    const maxIndex = selectedIndices[selectedIndices.length - 1];

    const selectable = new Set<string>();

    commits.forEach((commit, index) => {
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
  };

  const selectableCommits = getSelectableCommits();

  if (collapsed) {
    return (
      <div className="changes-panel changes-panel--collapsed">
        <button
          type="button"
          className="changes-panel-expand-button"
          onClick={onCollapse}
          title="Expand panel"
        >
          <MaterialSymbol icon="chevron_left" size={18} />
        </button>
      </div>
    );
  }

  return (
    <div className="changes-panel">
      {/* Header */}
      <div className="changes-panel-header">
        <div className="changes-panel-title-group">
          <div className="changes-panel-title">
            <span>Changes</span>
            {files.length > 0 && (
              <span className="changes-panel-count">{files.length}</span>
            )}
          </div>
          {repoRootBranch && (
            <div className="changes-panel-base-branch" title="Comparing against repo root branch">
              <MaterialSymbol icon="compare_arrows" size={14} />
              <span>{repoRootBranch}</span>
            </div>
          )}
        </div>
        <div className="changes-panel-actions">
          <button
            type="button"
            title="Refresh"
            onClick={onRefresh}
          >
            <MaterialSymbol icon="refresh" size={18} />
          </button>
          <button
            type="button"
            title="Collapse panel"
            onClick={onCollapse}
          >
            <MaterialSymbol icon="chevron_right" size={18} />
          </button>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="changes-panel-error">
          <span>{error}</span>
          <button type="button" onClick={onDismissError}>
            <MaterialSymbol icon="close" size={14} />
          </button>
        </div>
      )}

      {/* Main content */}
      <div className="changes-panel-body">
        {/* Changed files tree */}
        <div className="changes-panel-section">
          <div className="changes-panel-section-header">
            <span>Changed Files</span>
            {files.length > 0 && (
              <button
                type="button"
                className="changes-panel-toggle-all"
                onClick={() => onToggleAllStaged(!allStaged)}
                title={allStaged ? 'Unstage all' : 'Stage all'}
              >
                {allStaged ? 'Unstage all' : 'Stage all'}
              </button>
            )}
          </div>
          <ChangedFilesTree
            files={files}
            onToggleStaged={onToggleStaged}
            onSelectFile={onSelectFile}
          />
        </div>

        {/* Commit section */}
        <CommitSection
          stagedCount={stagedFiles.length}
          onCommit={handleCommit}
          onMerge={() => setShowMergeDialog(true)}
          onRebase={onRebase}
          isCommitting={isCommitting}
          isMerging={isMerging}
          isRebasing={isRebasing}
          hasCommits={commits.length > 0}
          hasUncommittedChanges={hasUncommittedChanges}
          commitsBehind={commitsBehind}
          isMerged={isMerged}
          baseBranch={repoRootBranch}
        />

        {/* Commits history */}
        <div className="changes-panel-section changes-panel-section--commits">
          <div className="changes-panel-section-header">
            <span>Commits</span>
            {commits.length > 0 && (
              <span className="changes-panel-section-count">{commits.length}</span>
            )}
          </div>
          {commits.length > 1 && selectedCommits.size > 0 && (
            <div className="changes-panel-squash-actions changes-panel-squash-actions--active">
              <div className="changes-panel-squash-info">
                {selectedCommits.size === 1 ? (
                  <span>Select at least one more commit</span>
                ) : (
                  <span>{selectedCommits.size} commits selected</span>
                )}
              </div>
              <div className="changes-panel-squash-buttons">
                <button
                  type="button"
                  className="changes-panel-squash-cancel"
                  onClick={handleClearSelection}
                >
                  Clear
                </button>
                <button
                  type="button"
                  className="changes-panel-squash-confirm"
                  onClick={handleSquashClick}
                  disabled={selectedCommits.size < 2 || isSquashing}
                >
                  {isSquashing ? 'Squashing...' : `Squash ${selectedCommits.size} Commits`}
                </button>
              </div>
            </div>
          )}
          <CommitsHistory
            commits={commits}
            selectedCommits={selectedCommits}
            selectableCommits={selectableCommits}
            onToggleCommit={handleToggleCommit}
            selectionMode={commits.length > 1}
          />
        </div>
      </div>

      {/* Merge confirmation dialog */}
      {showMergeDialog && (
        <MergeConfirmDialog
          worktreePath={worktreePath}
          workspacePath={workspacePath}
          hasUncommittedChanges={hasUncommittedChanges}
          onConfirm={handleMergeConfirm}
          onCancel={() => setShowMergeDialog(false)}
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

export default ChangesPanel;
