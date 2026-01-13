/**
 * MonacoDiffApprovalBar - Approval UI for Monaco diff mode
 *
 * This component provides Accept All / Reject All buttons when
 * Monaco editor is in diff mode, showing AI-generated changes.
 *
 * Kept separate from the Lexical DiffApprovalBar to avoid coupling.
 */

import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import { HelpTooltip } from '../../help';
import './MonacoDiffApprovalBar.css';

export interface SessionInfo {
  sessionId: string;
  sessionTitle?: string;
  editedAt?: number;
}

export interface MonacoDiffApprovalBarProps {
  onAcceptAll: () => void;
  onRejectAll: () => void;
  fileName?: string;
  sessionInfo?: SessionInfo;
  onGoToSession?: (sessionId: string) => void;
}

/**
 * Format a timestamp as a relative time string (e.g., "2 hours ago")
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return days === 1 ? '1 day ago' : `${days} days ago`;
  }
  if (hours > 0) {
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  }
  if (minutes > 0) {
    return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
  }
  return 'just now';
}

export const MonacoDiffApprovalBar: React.FC<MonacoDiffApprovalBarProps> = ({
  onAcceptAll,
  onRejectAll,
  fileName,
  sessionInfo,
  onGoToSession,
}) => {
  const handleAcceptClick = () => {
    try {
      onAcceptAll();
    } catch (error) {
      console.error('[MonacoDiffApprovalBar] Error calling onAcceptAll:', error);
    }
  };

  const handleRejectClick = () => {
    onRejectAll();
  };

  const handleGoToSession = () => {
    if (sessionInfo?.sessionId && onGoToSession) {
      onGoToSession(sessionInfo.sessionId);
    }
  };

  // Render session-aware label if session info is provided
  const renderLabel = () => {
    if (sessionInfo?.sessionTitle) {
      return (
        <div className="monaco-diff-approval-bar-session">
          <MaterialSymbol icon="smart_toy" size={18} className="monaco-diff-approval-bar-session-icon" />
          <div className="monaco-diff-approval-bar-session-details">
            <span className="monaco-diff-approval-bar-label">
              <span className="monaco-diff-approval-bar-session-name">{sessionInfo.sessionTitle}</span>
              {' '}edited {fileName || 'file'}
            </span>
            {sessionInfo.editedAt && (
              <span className="monaco-diff-approval-bar-timestamp">
                {formatRelativeTime(sessionInfo.editedAt)}
              </span>
            )}
          </div>
        </div>
      );
    }

    // Fallback to original simple label
    return (
      <span className="monaco-diff-approval-bar-label">
        AI changes to {fileName || 'file'}
      </span>
    );
  };

  return (
    <div className="monaco-diff-approval-bar">
      <div className="monaco-diff-approval-bar-content">
        <div className="monaco-diff-approval-bar-info">
          {renderLabel()}
          {sessionInfo?.sessionId && onGoToSession && (
            <button
              className="monaco-diff-approval-bar-goto"
              onClick={handleGoToSession}
              type="button"
              title="Open the AI session that made these changes"
            >
              <MaterialSymbol icon="open_in_new" size={14} />
              Go to Session
            </button>
          )}
        </div>
        <div className="monaco-diff-approval-bar-actions">
          <HelpTooltip testId="diff-revert-all-button">
            <button
              className="monaco-diff-approval-bar-button monaco-diff-approval-bar-button-reject"
              onClick={handleRejectClick}
              type="button"
              data-testid="diff-revert-all-button"
            >
              Reject All
            </button>
          </HelpTooltip>
          <HelpTooltip testId="diff-keep-all-button">
            <button
              className="monaco-diff-approval-bar-button monaco-diff-approval-bar-button-accept"
              onClick={handleAcceptClick}
              type="button"
              data-testid="diff-keep-all-button"
            >
              Accept All
            </button>
          </HelpTooltip>
        </div>
      </div>
    </div>
  );
};
