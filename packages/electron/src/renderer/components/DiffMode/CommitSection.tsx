import React, { useState, useCallback } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';

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
    <div className="commit-section flex flex-col gap-2 p-3 border-b border-[var(--nim-border)]">
      <textarea
        className="commit-section-message w-full px-2.5 py-2 font-inherit text-[0.8125rem] leading-[1.4] text-[var(--nim-text)] bg-[var(--nim-bg)] border border-[var(--nim-border-secondary)] rounded-md resize-y min-h-[60px] transition-[border-color,box-shadow] duration-150 ease-out placeholder:text-[var(--nim-text-faint)] focus:outline-none focus:border-[var(--nim-primary)] focus:shadow-[0_0_0_2px_var(--nim-accent-muted)] disabled:opacity-70 disabled:cursor-not-allowed"
        placeholder="Commit message..."
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isCommitting}
        rows={3}
      />
      <div className="commit-section-actions flex gap-2">
        <button
          type="button"
          className="commit-section-button commit-section-button--primary flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-[0.8125rem] font-medium border-none rounded-md cursor-pointer transition-[background-color,opacity] duration-150 ease-out bg-[var(--nim-primary)] text-[var(--nim-accent-contrast)] hover:enabled:bg-[var(--nim-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
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
          className={`commit-section-button flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-[0.8125rem] font-medium border-none rounded-md cursor-pointer transition-[background-color,opacity] duration-150 ease-out disabled:opacity-50 disabled:cursor-not-allowed ${
            effectiveCommitsBehind > 0
              ? 'commit-section-button--warning bg-[var(--nim-warning)] text-white hover:enabled:bg-[var(--nim-warning-hover)]'
              : 'commit-section-button--secondary bg-[var(--nim-bg-tertiary)] text-[var(--nim-text)] hover:enabled:bg-[var(--nim-bg-hover)]'
          }`}
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
          className="commit-section-button commit-section-button--secondary flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-[0.8125rem] font-medium border-none rounded-md cursor-pointer transition-[background-color,opacity] duration-150 ease-out bg-[var(--nim-bg-tertiary)] text-[var(--nim-text)] hover:enabled:bg-[var(--nim-bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
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
                    : `Merge commits into ${baseBranch || 'base branch'}. Will fast-forward if possible, otherwise creates a merge commit. All individual commits are preserved.`
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
