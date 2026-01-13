import React, { useState, useCallback } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import './CommitSection.css';

interface CommitSectionProps {
  stagedCount: number;
  onCommit: (message: string) => void;
  onMerge: () => void;
  onRebase: () => void;
  isCommitting: boolean;
  isMerging: boolean;
  isRebasing: boolean;
  hasCommits: boolean;
  hasUncommittedChanges: boolean;
  commitsBehind: number;
  isMerged: boolean;
  baseBranch?: string;
}

export function CommitSection({
  stagedCount,
  onCommit,
  onMerge,
  onRebase,
  isCommitting,
  isMerging,
  isRebasing,
  hasCommits,
  hasUncommittedChanges,
  commitsBehind,
  isMerged,
  baseBranch,
}: CommitSectionProps) {
  const [message, setMessage] = useState('');

  const handleCommit = useCallback(() => {
    if (!message.trim() || stagedCount === 0) return;
    onCommit(message.trim());
    setMessage('');
  }, [message, stagedCount, onCommit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleCommit();
    }
  }, [handleCommit]);

  const canCommit = stagedCount > 0 && message.trim().length > 0 && !isCommitting;
  // If merged, ignore commitsBehind (the merge commit doesn't need to be rebased)
  const effectiveCommitsBehind = isMerged ? 0 : commitsBehind;
  const canMerge = hasCommits && !hasUncommittedChanges && !isMerging && !isMerged && effectiveCommitsBehind === 0;
  const canRebase = effectiveCommitsBehind > 0 && !hasUncommittedChanges && !isRebasing;

  return (
    <div className="commit-section">
      <textarea
        className="commit-section-message"
        placeholder="Commit message..."
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isCommitting}
        rows={3}
      />
      <div className="commit-section-actions">
        <button
          type="button"
          className="commit-section-button commit-section-button--primary"
          onClick={handleCommit}
          disabled={!canCommit}
          title={stagedCount === 0 ? 'Stage files to commit' : !message.trim() ? 'Enter commit message' : 'Commit staged changes'}
        >
          {isCommitting ? (
            <>
              <MaterialSymbol icon="progress_activity" size={16} />
              <span>Committing...</span>
            </>
          ) : (
            <>
              <MaterialSymbol icon="check" size={16} />
              <span>Commit ({stagedCount})</span>
            </>
          )}
        </button>
        <button
          type="button"
          className={`commit-section-button ${effectiveCommitsBehind > 0 ? 'commit-section-button--warning' : 'commit-section-button--secondary'}`}
          onClick={onRebase}
          disabled={!canRebase}
          title={
            hasUncommittedChanges
              ? 'Commit all changes before rebasing'
              : effectiveCommitsBehind === 0
                ? 'Already up to date with base branch'
                : `Bring in ${effectiveCommitsBehind} commit${effectiveCommitsBehind === 1 ? '' : 's'} from ${baseBranch || 'base branch'}`
          }
        >
          {isRebasing ? (
            <>
              <MaterialSymbol icon="progress_activity" size={16} />
              <span>Rebasing...</span>
            </>
          ) : (
            <>
              <MaterialSymbol icon="sync" size={16} />
              <span>Rebase from {baseBranch || 'base'}{effectiveCommitsBehind > 0 ? ` (${effectiveCommitsBehind})` : ''}</span>
            </>
          )}
        </button>
        <button
          type="button"
          className="commit-section-button commit-section-button--secondary"
          onClick={onMerge}
          disabled={!canMerge}
          title={
            isMerged
              ? 'Already merged to base branch'
              : effectiveCommitsBehind > 0
                ? `Rebase first to bring in ${effectiveCommitsBehind} commit${effectiveCommitsBehind === 1 ? '' : 's'} from ${baseBranch || 'base branch'}`
                : hasUncommittedChanges
                  ? 'Commit all changes before merging'
                  : !hasCommits
                    ? 'No commits to merge'
                    : `Merge commits into ${baseBranch || 'base branch'}`
          }
        >
          {isMerging ? (
            <>
              <MaterialSymbol icon="progress_activity" size={16} />
              <span>Merging...</span>
            </>
          ) : (
            <>
              <MaterialSymbol icon="merge" size={16} />
              <span>Merge to {baseBranch || 'base'}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default CommitSection;
