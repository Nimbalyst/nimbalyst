/**
 * CustomEditorAIEditedBar
 *
 * A simple notification bar for custom editors that don't support diff mode.
 * Shows that the file was AI-edited with a button to view the diff in history.
 */

import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import type { SessionInfo } from './DiffCapabilities';
import './UnifiedDiffHeader.css';

export interface CustomEditorAIEditedBarProps {
  fileName: string;
  sessionInfo?: SessionInfo;
  onGoToSession?: (sessionId: string) => void;
  onViewHistory?: () => void;
}

/**
 * Format a timestamp as a relative time string
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

export const CustomEditorAIEditedBar: React.FC<CustomEditorAIEditedBarProps> = ({
  fileName,
  sessionInfo,
  onGoToSession,
  onViewHistory,
}) => {
  const handleGoToSession = () => {
    if (sessionInfo?.sessionId && onGoToSession) {
      onGoToSession(sessionInfo.sessionId);
    }
  };

  return (
    <div className="unified-diff-header">
      <div className="unified-diff-header-content">
        {/* Left section: AI edited info */}
        <div className="unified-diff-header-info">
          {sessionInfo?.sessionTitle ? (
            <div className="unified-diff-header-session">
              <MaterialSymbol icon="smart_toy" size={18} className="unified-diff-header-session-icon" />
              <div className="unified-diff-header-session-details">
                <span className="unified-diff-header-label">
                  <span className="unified-diff-header-session-name">{sessionInfo.sessionTitle}</span>
                  {' '}edited {fileName || 'file'}
                </span>
                {sessionInfo.editedAt && (
                  <span className="unified-diff-header-timestamp">
                    {formatRelativeTime(sessionInfo.editedAt)}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <span className="unified-diff-header-label">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="unified-diff-header-sparkle">
                <path d="M8 1L9 5L13 6L9 7L8 11L7 7L3 6L7 5L8 1Z" fill="currentColor"/>
              </svg>
              AI edited {fileName || 'file'}
            </span>
          )}
          {sessionInfo?.sessionId && onGoToSession && (
            <button
              className="unified-diff-header-goto"
              onClick={handleGoToSession}
              type="button"
              title="Open the AI session that made these changes"
            >
              <MaterialSymbol icon="open_in_new" size={14} />
              Go to Session
            </button>
          )}
        </div>

        {/* Right section: View History button */}
        <div className="unified-diff-header-actions">
          {onViewHistory && (
            <button
              className="unified-diff-header-button unified-diff-header-button-accept"
              onClick={onViewHistory}
              type="button"
              title="View changes in history"
            >
              <MaterialSymbol icon="history" size={16} />
              View History
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
