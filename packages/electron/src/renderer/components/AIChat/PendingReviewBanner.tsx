import React, { useState, useEffect, useCallback } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import './PendingReviewBanner.css';

interface PendingReviewBannerProps {
  workspacePath?: string;
  sessionId?: string | null;
}

export function PendingReviewBanner({ workspacePath, sessionId }: PendingReviewBannerProps) {
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [isClearing, setIsClearing] = useState(false);

  // Fetch initial pending count for this session
  useEffect(() => {
    if (!workspacePath || !sessionId) {
      setPendingCount(0);
      return;
    }

    const fetchPendingCount = async () => {
      try {
        if (typeof window !== 'undefined' && (window as any).electronAPI) {
          const count = await (window as any).electronAPI.history.getPendingCountForSession(workspacePath, sessionId);
          setPendingCount(count);
        }
      } catch (error) {
        console.error('[PendingReviewBanner] Failed to fetch pending count:', error);
      }
    };

    fetchPendingCount();
  }, [workspacePath, sessionId]);

  // Listen for pending count changes for this session
  useEffect(() => {
    if (!workspacePath || !sessionId || typeof window === 'undefined' || !(window as any).electronAPI) {
      return;
    }

    const unsubscribe = (window as any).electronAPI.history.onPendingCountChanged(
      (data: { workspacePath: string; sessionId?: string; count: number }) => {
        // Only update if this is for our session (or workspace-wide broadcast)
        if (data.workspacePath === workspacePath && (!data.sessionId || data.sessionId === sessionId)) {
          // Re-fetch the count for our specific session since the event might be workspace-wide
          (window as any).electronAPI.history.getPendingCountForSession(workspacePath, sessionId)
            .then((count: number) => setPendingCount(count))
            .catch((err: Error) => console.error('[PendingReviewBanner] Failed to refresh count:', err));
        }
      }
    );

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [workspacePath, sessionId]);

  const handleClearAll = useCallback(async () => {
    if (!workspacePath || !sessionId || isClearing) return;

    setIsClearing(true);
    try {
      if (typeof window !== 'undefined' && (window as any).electronAPI) {
        await (window as any).electronAPI.history.clearPendingForSession(workspacePath, sessionId);
        // Count will be updated via the event listener
      }
    } catch (error) {
      console.error('[PendingReviewBanner] Failed to clear pending for session:', error);
    } finally {
      setIsClearing(false);
    }
  }, [workspacePath, sessionId, isClearing]);

  // Don't render if no pending files
  if (pendingCount === 0) {
    return null;
  }

  return (
    <div className="pending-review-banner">
      <div className="pending-review-banner__info">
        <MaterialSymbol icon="rate_review" size={16} className="pending-review-banner__icon" />
        <span className="pending-review-banner__text">
          <span className="pending-review-banner__count">{pendingCount}</span>
          {' '}file{pendingCount !== 1 ? 's' : ''} pending review
        </span>
      </div>
      <button
        className="pending-review-banner__clear-btn"
        onClick={handleClearAll}
        disabled={isClearing}
        title="Accept all pending AI changes"
      >
        <MaterialSymbol icon="check_circle" size={14} />
        {isClearing ? 'Keeping...' : 'Keep All'}
      </button>
    </div>
  );
}
