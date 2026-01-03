/**
 * UnifiedDiffHeader - Unified diff approval UI for all editor types
 *
 * This component provides a consistent diff approval experience across
 * Monaco, Lexical, and custom editors. It adapts its UI based on the
 * capabilities provided by each editor type.
 *
 * Features:
 * - Keep All / Revert All (all editors)
 * - Session info display with "Go to Session" (when available)
 * - Change navigation (prev/next) when supported
 * - Per-change keep/revert when supported
 *
 * Note: We use "Keep" / "Revert" terminology because AI changes are already
 * written to disk - we're reviewing changes that have been made, not approving
 * changes that are pending.
 */

import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import { usePostHog } from 'posthog-js/react';
import type { UnifiedDiffHeaderProps } from './DiffCapabilities';
import './UnifiedDiffHeader.css';

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

export const UnifiedDiffHeader: React.FC<UnifiedDiffHeaderProps> = ({
  fileName,
  sessionInfo,
  onGoToSession,
  capabilities,
  editorType,
}) => {
  const posthog = usePostHog();
  const { changeGroups } = capabilities;
  const hasChangeGroups = changeGroups && changeGroups.count > 0;
  const hasSelection = changeGroups && changeGroups.currentIndex !== null && changeGroups.currentIndex >= 0;
  // Per-change actions are supported if explicitly set, or if the callbacks exist
  const supportsPerChangeActions = changeGroups?.supportsPerChangeActions ??
    (changeGroups?.onAcceptCurrent !== undefined && changeGroups?.onRejectCurrent !== undefined);

  const handleAcceptAll = () => {
    posthog?.capture('ai_diff_accepted', {
      acceptType: 'all',
      editorType,
    });
    capabilities.onAcceptAll();
  };

  const handleRejectAll = () => {
    posthog?.capture('ai_diff_rejected', {
      rejectType: 'all',
      editorType,
    });
    capabilities.onRejectAll();
  };

  const handleAcceptCurrent = () => {
    if (!changeGroups?.onAcceptCurrent) return;
    posthog?.capture('ai_diff_accepted', {
      acceptType: 'partial',
      editorType,
    });
    changeGroups.onAcceptCurrent();
  };

  const handleRejectCurrent = () => {
    if (!changeGroups?.onRejectCurrent) return;
    posthog?.capture('ai_diff_rejected', {
      rejectType: 'partial',
      editorType,
    });
    changeGroups.onRejectCurrent();
  };

  const handleGoToSession = () => {
    if (sessionInfo?.sessionId && onGoToSession) {
      onGoToSession(sessionInfo.sessionId);
    }
  };

  const renderSessionInfo = () => {
    if (sessionInfo?.sessionTitle) {
      // Use provider icon if available, otherwise fallback to smart_toy
      const iconName = sessionInfo.provider || 'smart_toy';
      const canNavigate = sessionInfo.sessionId && onGoToSession;

      const sessionLink = (
        <button
          className={`unified-diff-header-session-link ${canNavigate ? 'unified-diff-header-session-link--clickable' : ''}`}
          onClick={canNavigate ? handleGoToSession : undefined}
          type="button"
          disabled={!canNavigate}
          title={canNavigate ? `Open "${sessionInfo.sessionTitle}" session` : undefined}
        >
          <MaterialSymbol icon={iconName} size={18} className="unified-diff-header-session-icon" />
          <span className="unified-diff-header-session-name">{sessionInfo.sessionTitle}</span>
          {canNavigate && (
            <MaterialSymbol icon="open_in_new" size={14} className="unified-diff-header-session-open-icon" />
          )}
        </button>
      );

      return (
        <div className="unified-diff-header-session">
          {sessionLink}
          {/*<span className="unified-diff-header-edit-text">*/}
          {/*  edited {fileName || 'file'}*/}
          {/*</span>*/}
          {sessionInfo.editedAt && (
            <span className="unified-diff-header-timestamp">
              edited {formatRelativeTime(sessionInfo.editedAt)}
            </span>
          )}
        </div>
      );
    }

    // Fallback to simple label with sparkle icon
    return (
      <span className="unified-diff-header-label">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="unified-diff-header-sparkle">
          <path d="M8 1L9 5L13 6L9 7L8 11L7 7L3 6L7 5L8 1Z" fill="currentColor"/>
        </svg>
        AI changes to {fileName || 'file'}
      </span>
    );
  };

  return (
    <div className="unified-diff-header">
      <div className="unified-diff-header-content">
        {/* Left section: Session info */}
        <div className="unified-diff-header-info">
          {renderSessionInfo()}
        </div>

        {/* Middle section: Navigation (only if change groups supported) */}
        {hasChangeGroups && (
          <div className="unified-diff-header-navigation">
            <button
              onClick={changeGroups.onNavigatePrevious}
              aria-label="Previous change"
              className="unified-diff-header-nav-button"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M6 9L3 6L6 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <span className="unified-diff-header-change-counter">
              {hasSelection
                ? `${changeGroups.currentIndex! + 1} of ${changeGroups.count}`
                : `${changeGroups.count} changes`}
            </span>
            <button
              onClick={changeGroups.onNavigateNext}
              aria-label="Next change"
              className="unified-diff-header-nav-button"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M6 3L9 6L6 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        )}

        {/* Right section: Actions */}
        <div className="unified-diff-header-actions">
          {/* Per-change buttons (only if change groups AND per-change actions supported) */}
          {hasChangeGroups && supportsPerChangeActions && (
            <>
              <button
                className="unified-diff-header-button unified-diff-header-button-reject-single"
                onClick={handleRejectCurrent}
                title="Revert this change"
                disabled={!hasSelection}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M10 4L4 10M4 4L10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                Revert
              </button>
              <button
                className="unified-diff-header-button unified-diff-header-button-accept-single"
                onClick={handleAcceptCurrent}
                title="Keep this change"
                disabled={!hasSelection}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M12 3L5 10L2 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Keep
              </button>
            </>
          )}
          {/* All buttons (always shown) */}
          <button
            className="unified-diff-header-button unified-diff-header-button-reject"
            onClick={handleRejectAll}
            type="button"
          >
            {hasChangeGroups && supportsPerChangeActions && (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M10 4L4 10M4 4L10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            )}
            Revert{hasChangeGroups && supportsPerChangeActions ? ' All' : ''}
          </button>
          <button
            className="unified-diff-header-button unified-diff-header-button-accept"
            onClick={handleAcceptAll}
            type="button"
          >
            {hasChangeGroups && supportsPerChangeActions && (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M12 3L5 10L2 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
            Keep{hasChangeGroups && supportsPerChangeActions ? ' All' : ''}
          </button>
        </div>
      </div>
    </div>
  );
};
