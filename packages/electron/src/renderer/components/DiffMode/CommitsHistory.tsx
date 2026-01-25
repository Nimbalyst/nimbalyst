import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import type { CommitInfo } from './DiffModeView';

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
      <div className="commits-history commits-history--empty flex-1 flex flex-col overflow-y-auto min-h-0 px-3 py-4 text-[var(--nim-text-faint)] text-xs text-center">
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
    <div className="commits-history flex-1 flex flex-col overflow-y-auto min-h-0">
      {commits.map(commit => {
        const isSelected = selectedCommits.has(commit.hash);
        const isSelectable = !selectableCommits || selectableCommits.has(commit.hash);

        return (
          <div
            key={commit.hash}
            className={`commits-history-item flex gap-2 px-3 py-2 border-b border-[var(--nim-border)] last:border-b-0 transition-colors duration-150 hover:bg-[var(--nim-bg-hover)] ${selectionMode ? 'commits-history-item--selectable cursor-pointer select-none' : ''} ${isSelected ? 'commits-history-item--selected bg-[var(--nim-accent-subtle)] border-l-2 border-l-[var(--nim-primary)] hover:bg-[var(--nim-bg-selected-hover)]' : ''} ${!isSelectable ? 'commits-history-item--disabled opacity-50 !cursor-not-allowed' : ''}`}
            title={commit.hash}
            onClick={() => handleClick(commit.hash, isSelectable)}
          >
            {selectionMode && (
              <div className="commits-history-checkbox flex items-start justify-center pt-0.5">
                <input
                  type="checkbox"
                  checked={isSelected}
                  disabled={!isSelectable}
                  onChange={() => handleClick(commit.hash, isSelectable)}
                  onClick={(e) => e.stopPropagation()}
                  className={`cursor-pointer ${!isSelectable ? 'cursor-not-allowed' : ''}`}
                />
              </div>
            )}
            <div className="commits-history-icon flex items-start justify-center w-5 h-5 mt-0.5 text-[var(--nim-text-faint)]">
              <MaterialSymbol icon="commit" size={14} />
            </div>
            <div className="commits-history-content flex-1 min-w-0 flex flex-col gap-0.5">
              <div className="commits-history-message text-[0.8125rem] text-[var(--nim-text)] leading-[1.4] overflow-hidden text-ellipsis line-clamp-2">{commit.message}</div>
              <div className="commits-history-meta flex items-center gap-1 text-[0.6875rem] text-[var(--nim-text-faint)]">
                <span className="commits-history-hash font-[var(--nim-font-mono)]">{commit.shortHash}</span>
                <span className="commits-history-separator opacity-50">-</span>
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
