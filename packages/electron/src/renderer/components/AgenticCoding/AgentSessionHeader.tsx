import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { ProviderIcon, MaterialSymbol } from '@nimbalyst/runtime';
import type { SessionData } from '@nimbalyst/runtime/ai/server/types';
import {
  sessionOrChildProcessingAtom,
  sessionEditorStateAtom,
  setSessionLayoutModeAtom,
  sessionHasTabsAtom,
} from '../../store';
import { LayoutControls } from '../UnifiedAI/LayoutControls';
import { useAlphaFeature } from '../../hooks/useAlphaFeature';
import { errorNotificationService } from '../../services/ErrorNotificationService';

interface WorktreeWithStatus {
  id: string;
  name: string;
  displayName?: string;
  path: string;
  branch: string;
  base_branch?: string;
  isArchived?: boolean;
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
  workspacePath: string;
  /** @deprecated - Now uses Jotai atom subscription. This prop is ignored. */
  isProcessing?: boolean;
}

export const AgentSessionHeader: React.FC<AgentSessionHeaderProps> = ({
  sessionData,
  workspacePath,
}) => {
  const sessionId = sessionData?.id ?? '';

  // Subscribe to processing atom - uses aggregated atom that includes child sessions
  // This ensures the header shows processing when ANY child in a workstream is running
  const isProcessing = useAtomValue(sessionOrChildProcessingAtom(sessionId));

  // Layout state for non-worktree sessions
  const sessionEditorState = useAtomValue(sessionEditorStateAtom(sessionId));
  const setSessionLayoutMode = useSetAtom(setSessionLayoutModeAtom);
  const hasTabs = useAtomValue(sessionHasTabsAtom(sessionId));

  // Determine if this is a worktree session (layout controls only for non-worktree)
  const isWorktreeSession = !!sessionData?.worktreeId;
  // Determine if this is a workstream child session (has a parent)
  const isWorkstreamSession = !!sessionData?.parentSessionId;
  const showLayoutControls = sessionData && !isWorktreeSession;
  // Use cached data immediately if available
  const cachedData = sessionData?.worktreeId ? worktreeCache.get(sessionData.worktreeId) ?? null : null;
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

      // Fetch git status for the worktree (skip for archived worktrees since they don't exist on disk)
      let gitStatus: { ahead?: number; behind?: number; uncommitted?: boolean } | undefined;
      if (!worktree.isArchived) {
        try {
          // TODO GH: RE-ENABLE
          // const statusResult = await window.electronAPI.invoke('worktree:get-status', worktree.path);
          // if (statusResult.success && statusResult.status) {
          //   gitStatus = {
          //     ahead: statusResult.status.ahead,
          //     behind: statusResult.status.behind,
          //     uncommitted: statusResult.status.hasUncommittedChanges,
          //   };
          // }
        } catch (err) {
          // Continue without git status
        }
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

  // Listen for worktree display name updates from main process
  // This handles automatic worktree naming when first session in worktree is named
  useEffect(() => {
    if (!sessionData?.worktreeId) return;

    const unsubscribe = window.electronAPI?.on?.('worktree:display-name-updated',
      (data: { worktreeId: string; displayName: string }) => {
        if (data.worktreeId === sessionData.worktreeId) {
          // Update local state
          setWorktreeData(prev => prev ? {
            ...prev,
            displayName: data.displayName
          } : null);

          // Update module-level cache
          if (worktreeCache.has(data.worktreeId)) {
            const cached = worktreeCache.get(data.worktreeId)!;
            worktreeCache.set(data.worktreeId, {
              ...cached,
              displayName: data.displayName
            });
          }
        }
      }
    );

    return () => unsubscribe?.();
  }, [sessionData?.worktreeId]);

  const isSyncEnabled = useAlphaFeature('sync');
  const [isSharing, setIsSharing] = useState(false);

  const handleShareLink = useCallback(async () => {
    if (!sessionData || isSharing) return;
    setIsSharing(true);
    try {
      const result = await (window as any).electronAPI?.shareSessionAsLink({ sessionId: sessionData.id });
      if (result?.success) {
        errorNotificationService.showInfo(
          result.isUpdate ? 'Share link updated' : 'Share link copied',
          result.isUpdate ? 'The shared session has been updated. Link copied to clipboard.' : 'The share link has been copied to your clipboard.',
          { duration: 3000 }
        );
      } else if (result?.error) {
        errorNotificationService.showError('Share failed', result.error);
      }
    } catch (error) {
      errorNotificationService.showError('Share failed', error instanceof Error ? error.message : 'An unexpected error occurred');
    } finally {
      setIsSharing(false);
    }
  }, [sessionData, isSharing]);

  if (!sessionData) {
    return null;
  }

  const displayTitle = sessionData.title || sessionData.name || 'Untitled Session';

  return (
    <div className="agent-session-header shrink-0 px-4 py-2 border-b border-[var(--nim-border)] bg-[var(--nim-bg)]">
      <div className="agent-session-header-main flex items-center gap-3">
        {/* Icon renders immediately - worktree icon if worktreeId exists, workstream icon if parentSessionId exists, otherwise provider icon */}
        {isWorktreeSession ? (
          <div className="agent-session-header-icon-wrapper relative shrink-0 w-6 h-6">
            <div className="agent-session-header-wt-icon w-6 h-6 text-[var(--nim-text-muted)] [&_svg]:w-full [&_svg]:h-full">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 21v-4a2 2 0 0 1 2-2h4"/>
                <path d="M14 15V7"/>
                <circle cx="8" cy="7" r="2"/>
                <circle cx="14" cy="7" r="2"/>
                <path d="M8 9v4a2 2 0 0 0 2 2"/>
              </svg>
            </div>
            <div className="agent-session-header-ai-badge absolute -bottom-0.5 -right-1 bg-[var(--nim-bg)] rounded-full p-0.5 flex items-center justify-center">
              <ProviderIcon provider={sessionData.provider || 'claude'} size={12} />
            </div>
          </div>
        ) : isWorkstreamSession ? (
          <div className="agent-session-header-icon workstream-header-icon shrink-0 text-[var(--nim-text-muted)]">
            <MaterialSymbol icon="account_tree" size={20} />
          </div>
        ) : (
          <div className="agent-session-header-icon shrink-0 text-[var(--nim-text-muted)]">
            <ProviderIcon provider={sessionData.provider || 'claude'} size={20} />
          </div>
        )}

        <div className="agent-session-header-content flex-1 min-w-0">
          <h1 className="agent-session-header-title m-0 text-base font-semibold text-[var(--nim-text)] whitespace-nowrap overflow-hidden text-ellipsis leading-tight">{displayTitle}</h1>

          <div className="agent-session-header-meta flex items-center gap-2 mt-0.5 text-xs text-[var(--nim-text-muted)]">
            {/* Meta info: worktree details load async, but we show model immediately for non-worktree */}
            {isWorktreeSession ? (
              worktreeData ? (
                <>
                  <span className="agent-session-header-worktree-name text-[var(--nim-text-muted)] font-medium">{worktreeData.name}</span>
                  {worktreeData.gitStatus?.ahead && worktreeData.gitStatus.ahead > 0 && (
                    <span className="agent-session-header-badge ahead inline-flex items-center px-1.5 py-0.5 rounded text-[0.625rem] font-medium uppercase tracking-wide bg-green-500/15 text-green-500">
                      {worktreeData.gitStatus.ahead} ahead
                    </span>
                  )}
                  {worktreeData.gitStatus?.behind && worktreeData.gitStatus.behind > 0 && (
                    <span className="agent-session-header-badge behind inline-flex items-center px-1.5 py-0.5 rounded text-[0.625rem] font-medium uppercase tracking-wide bg-orange-500/15 text-orange-500">
                      {worktreeData.gitStatus.behind} behind
                    </span>
                  )}
                  {worktreeData.gitStatus?.uncommitted && (
                    <span className="agent-session-header-badge uncommitted inline-flex items-center px-1.5 py-0.5 rounded text-[0.625rem] font-medium uppercase tracking-wide bg-violet-500/15 text-violet-500">
                      uncommitted
                    </span>
                  )}
                </>
              ) : (
                <span className="agent-session-header-worktree-name agent-session-header-loading text-[var(--nim-text-faint)] italic">Loading...</span>
              )
            ) : null}
          </div>
        </div>

        {isProcessing && (
          <div className="agent-session-header-processing shrink-0 flex items-center justify-center">
            <div className="agent-session-header-spinner w-4 h-4 border-2 border-[var(--nim-border)] border-t-[var(--nim-primary)] rounded-full animate-spin" />
          </div>
        )}

        {/* Share button */}
        <button
          className="agent-session-header-share shrink-0 flex items-center justify-center w-7 h-7 rounded-md bg-transparent border-none text-[var(--nim-text-faint)] cursor-pointer transition-colors duration-150 hover:text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)] disabled:opacity-50 disabled:cursor-default"
          title={!isSyncEnabled ? 'Enable Account & Sync in Settings to share sessions' : isSharing ? 'Sharing...' : 'Share session link'}
          onClick={handleShareLink}
          disabled={isSharing || !isSyncEnabled}
        >
          <MaterialSymbol icon={isSharing ? 'progress_activity' : 'link'} size={16} className={isSharing ? 'animate-spin' : ''} />
        </button>

        {/* Export button */}
        <button
          className="agent-session-header-export shrink-0 flex items-center justify-center w-7 h-7 rounded-md bg-transparent border-none text-[var(--nim-text-faint)] cursor-pointer transition-colors duration-150 hover:text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)]"
          title="Export session as HTML"
          onClick={() => (window as any).electronAPI?.exportSessionToHtml({ sessionId: sessionData.id })}
        >
          <MaterialSymbol icon="download" size={16} />
        </button>

        {/* Layout controls for non-worktree sessions */}
        {showLayoutControls && (
          <div className="agent-session-header-layout-controls shrink-0 ml-auto pl-3 border-l border-[var(--nim-border)]">
            <LayoutControls
              mode={sessionEditorState.layoutMode}
              hasTabs={hasTabs}
              onModeChange={(mode) => setSessionLayoutMode({ sessionId: sessionData.id, mode })}
            />
          </div>
        )}
      </div>

    </div>
  );
};
