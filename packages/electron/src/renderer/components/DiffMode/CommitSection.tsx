import React, { useState, useCallback } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import './CommitSection.css';

interface CommitSectionProps {
  stagedCount: number;
  onCommit: (message: string) => void;
  onMerge: () => void;
  isCommitting: boolean;
  isMerging: boolean;
  hasCommits: boolean;
  hasUncommittedChanges: boolean;
}

export function CommitSection({
  stagedCount,
  onCommit,
  onMerge,
  isCommitting,
  isMerging,
  hasCommits,
  hasUncommittedChanges,
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
  const canMerge = hasCommits && !hasUncommittedChanges && !isMerging;

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
          className="commit-section-button commit-section-button--secondary"
          onClick={onMerge}
          disabled={!canMerge}
          title={
            hasUncommittedChanges
              ? 'Commit all changes before merging'
              : !hasCommits
                ? 'No commits to merge'
                : 'Merge to main branch'
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
              <span>Merge</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default CommitSection;
