import React, { useState } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import { ChangedFilesTree } from './ChangedFilesTree';
import { CommitSection } from './CommitSection';
import { CommitsHistory } from './CommitsHistory';
import { MergeConfirmDialog } from './MergeConfirmDialog';
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
  isRebasing,
}: ChangesPanelProps) {
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isMerging, setIsMerging] = useState(false);

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

  const hasUncommittedChanges = files.length > 0;
  const allStaged = files.length > 0 && stagedFiles.length === files.length;

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
          <CommitsHistory commits={commits} />
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
    </div>
  );
}

export default ChangesPanel;
