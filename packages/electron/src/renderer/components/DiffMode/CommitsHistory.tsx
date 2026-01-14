import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import type { CommitInfo } from './DiffModeView';
import './CommitsHistory.css';

interface CommitsHistoryProps {
  commits: CommitInfo[];
  selectedCommits?: Set<string>;
  selectableCommits?: Set<string>;
  onToggleCommit?: (hash: string) => void;
  selectionMode?: boolean;
}

function formatDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) {
    return 'just now';
  }
  if (diffMins < 60) {
    return `${diffMins}m ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function CommitsHistory({ commits, selectedCommits = new Set(), selectableCommits, onToggleCommit, selectionMode = false }: CommitsHistoryProps) {
  if (commits.length === 0) {
    return (
      <div className="commits-history commits-history--empty">
        <p>No commits in this branch</p>
      </div>
    );
  }

  const handleClick = (hash: string, isSelectable: boolean) => {
    if (selectionMode && onToggleCommit && isSelectable) {
      onToggleCommit(hash);
    }
  };

  return (
    <div className="commits-history">
      {commits.map(commit => {
        const isSelected = selectedCommits.has(commit.hash);
        const isSelectable = !selectableCommits || selectableCommits.has(commit.hash);
        const itemClass = `commits-history-item ${selectionMode ? 'commits-history-item--selectable' : ''} ${isSelected ? 'commits-history-item--selected' : ''} ${!isSelectable ? 'commits-history-item--disabled' : ''}`;

        return (
          <div
            key={commit.hash}
            className={itemClass}
            title={commit.hash}
            onClick={() => handleClick(commit.hash, isSelectable)}
          >
            {selectionMode && (
              <div className="commits-history-checkbox">
                <input
                  type="checkbox"
                  checked={isSelected}
                  disabled={!isSelectable}
                  onChange={() => handleClick(commit.hash, isSelectable)}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            )}
            <div className="commits-history-icon">
              <MaterialSymbol icon="commit" size={14} />
            </div>
            <div className="commits-history-content">
              <div className="commits-history-message">{commit.message}</div>
              <div className="commits-history-meta">
                <span className="commits-history-hash">{commit.shortHash}</span>
                <span className="commits-history-separator">-</span>
                <span className="commits-history-date">{formatDate(commit.date)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default CommitsHistory;
