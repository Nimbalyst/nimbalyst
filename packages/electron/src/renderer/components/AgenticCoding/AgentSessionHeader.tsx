import React, { useEffect, useState, useCallback, useRef } from 'react';
import { ProviderIcon } from '@nimbalyst/runtime';
import type { SessionData } from '@nimbalyst/runtime/ai/server/types';
import './AgentSessionHeader.css';

interface WorktreeWithStatus {
  id: string;
  name: string;
  path: string;
  branch: string;
  base_branch?: string;
  gitStatus?: {
    ahead?: number;
    behind?: number;
    uncommitted?: boolean;
  };
}

// Module-level cache for worktree data to avoid refetching on every render
const worktreeCache = new Map<string, WorktreeWithStatus>();

interface AgentSessionHeaderProps {
  sessionData: SessionData | null;
  isProcessing?: boolean;
}

export const AgentSessionHeader: React.FC<AgentSessionHeaderProps> = ({
  sessionData,
  isProcessing = false
}) => {
  // Use cached data immediately if available
  const cachedData = sessionData?.worktreeId ? worktreeCache.get(sessionData.worktreeId) : null;
  const [worktreeData, setWorktreeData] = useState<WorktreeWithStatus | null>(cachedData);
  const fetchingRef = useRef<string | null>(null);

  // Fetch worktree data if this is a worktree session
  const fetchWorktreeData = useCallback(async (worktreeId: string) => {
    // Check cache first
    if (worktreeCache.has(worktreeId)) {
      return worktreeCache.get(worktreeId)!;
    }

    try {
      const result = await window.electronAPI.invoke('worktree:get', worktreeId);
      if (!result.success || !result.worktree) {
        return null;
      }

      const worktree = result.worktree;

      // Fetch git status for the worktree
      let gitStatus: { ahead?: number; behind?: number; uncommitted?: boolean } | undefined;
      try {
        const statusResult = await window.electronAPI.invoke('worktree:get-status', worktree.path);
        if (statusResult.success && statusResult.status) {
          gitStatus = {
            ahead: statusResult.status.ahead,
            behind: statusResult.status.behind,
            uncommitted: statusResult.status.hasUncommittedChanges,
          };
        }
      } catch (err) {
        // Continue without git status
      }

      const data: WorktreeWithStatus = {
        ...worktree,
        gitStatus,
      };

      // Cache the result
      worktreeCache.set(worktreeId, data);
      return data;
    } catch (err) {
      console.error('[AgentSessionHeader] Failed to fetch worktree data:', err);
      return null;
    }
  }, []);

  useEffect(() => {
    const worktreeId = sessionData?.worktreeId;

    if (!worktreeId) {
      setWorktreeData(null);
      return;
    }

    // If we have cached data, use it immediately
    if (worktreeCache.has(worktreeId)) {
      setWorktreeData(worktreeCache.get(worktreeId)!);
      return;
    }

    // Prevent duplicate fetches
    if (fetchingRef.current === worktreeId) {
      return;
    }

    fetchingRef.current = worktreeId;
    fetchWorktreeData(worktreeId).then(data => {
      if (fetchingRef.current === worktreeId) {
        setWorktreeData(data);
        fetchingRef.current = null;
      }
    });
  }, [sessionData?.worktreeId, fetchWorktreeData]);

  if (!sessionData) {
    return null;
  }

  const displayTitle = sessionData.title || sessionData.name || 'Untitled Session';
  const displayModel = sessionData.model?.includes(':')
    ? sessionData.model.split(':')[1]
    : sessionData.model;

  // Determine if this is a worktree session immediately from sessionData (no async needed)
  const isWorktreeSession = !!sessionData.worktreeId;

  return (
    <div className="agent-session-header">
      <div className="agent-session-header-main">
        {/* Icon renders immediately - worktree icon if worktreeId exists, otherwise provider icon */}
        {isWorktreeSession ? (
          <div className="agent-session-header-icon-wrapper">
            <div className="agent-session-header-wt-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 21v-4a2 2 0 0 1 2-2h4"/>
                <path d="M14 15V7"/>
                <circle cx="8" cy="7" r="2"/>
                <circle cx="14" cy="7" r="2"/>
                <path d="M8 9v4a2 2 0 0 0 2 2"/>
              </svg>
            </div>
            <div className="agent-session-header-ai-badge">
              <ProviderIcon provider={sessionData.provider || 'claude'} size={12} />
            </div>
          </div>
        ) : (
          <div className="agent-session-header-icon">
            <ProviderIcon provider={sessionData.provider || 'claude'} size={24} />
          </div>
        )}

        <div className="agent-session-header-content">
          <h1 className="agent-session-header-title">{displayTitle}</h1>

          <div className="agent-session-header-meta">
            {/* Meta info: worktree details load async, but we show model immediately for non-worktree */}
            {isWorktreeSession ? (
              worktreeData ? (
                <>
                  <span className="agent-session-header-worktree-name">{worktreeData.name}</span>
                  {worktreeData.gitStatus?.ahead && worktreeData.gitStatus.ahead > 0 && (
                    <span className="agent-session-header-badge ahead">
                      {worktreeData.gitStatus.ahead} ahead
                    </span>
                  )}
                  {worktreeData.gitStatus?.behind && worktreeData.gitStatus.behind > 0 && (
                    <span className="agent-session-header-badge behind">
                      {worktreeData.gitStatus.behind} behind
                    </span>
                  )}
                  {worktreeData.gitStatus?.uncommitted && (
                    <span className="agent-session-header-badge uncommitted">
                      uncommitted
                    </span>
                  )}
                </>
              ) : (
                <span className="agent-session-header-worktree-name agent-session-header-loading">Loading...</span>
              )
            ) : (
              displayModel && <span className="agent-session-header-model">{displayModel}</span>
            )}
          </div>
        </div>

        {isProcessing && (
          <div className="agent-session-header-processing">
            <div className="agent-session-header-spinner" />
          </div>
        )}
      </div>
    </div>
  );
};
