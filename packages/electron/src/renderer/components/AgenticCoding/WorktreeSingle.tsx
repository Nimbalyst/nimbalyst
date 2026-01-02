import React from 'react';
import { ProviderIcon } from '@nimbalyst/runtime';
import './WorktreeSingle.css';

interface SessionListItemData {
  id: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  provider: string;
  model?: string;
  sessionType?: 'chat' | 'planning' | 'coding';
  messageCount: number;
  isProcessing?: boolean;
  hasUnread?: boolean;
  isArchived?: boolean;
}

interface GitStatus {
  ahead?: number;
  behind?: number;
  uncommitted?: boolean;
}

interface WorktreeSingleProps {
  session: SessionListItemData;
  worktreeName: string;
  worktreePath: string;
  gitStatus?: GitStatus;
  isActive: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export const WorktreeSingle: React.FC<WorktreeSingleProps> = ({
  session,
  worktreeName,
  worktreePath,
  gitStatus,
  isActive,
  onClick,
  onContextMenu
}) => {
  return (
    <div
      className={`worktree-single ${isActive ? 'active' : ''}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      aria-label={`Worktree: ${worktreeName}`}
      aria-current={isActive ? 'page' : undefined}
    >
      <div className="worktree-single-icon-wrapper">
        <div className="worktree-single-wt-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 21v-4a2 2 0 0 1 2-2h4"/>
            <path d="M14 15V7"/>
            <circle cx="8" cy="7" r="2"/>
            <circle cx="14" cy="7" r="2"/>
            <path d="M8 9v4a2 2 0 0 0 2 2"/>
          </svg>
        </div>
        <div className="worktree-single-ai-badge">
          <ProviderIcon provider={session.provider || 'claude'} size={10} />
        </div>
      </div>

      <div className="worktree-single-content">
        <div className="worktree-single-name-row">{worktreeName}</div>
        <div className="worktree-single-meta-row">
          {gitStatus?.ahead && gitStatus.ahead > 0 && (
            <span className="worktree-single-badge ahead">
              {gitStatus.ahead} ahead
            </span>
          )}
          {gitStatus?.behind && gitStatus.behind > 0 && (
            <span className="worktree-single-badge behind">
              {gitStatus.behind} behind
            </span>
          )}
          {gitStatus?.uncommitted && (
            <span className="worktree-single-badge uncommitted">
              uncommitted
            </span>
          )}
        </div>
      </div>

      {session.messageCount > 0 && (
        <span className="worktree-single-message-count">{session.messageCount}</span>
      )}
    </div>
  );
};
