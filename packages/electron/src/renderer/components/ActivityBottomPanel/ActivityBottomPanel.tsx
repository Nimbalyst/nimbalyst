import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime';
import {
  isActivityPanelOpenAtom,
  activityPanelHeightAtom,
  setActivityPanelHeightAtom,
  closeActivityPanelAtom,
} from '../../store/atoms/activityPanel';
import { setSelectedWorkstreamAtom } from '../../store/atoms/sessions';
import { getRelativeTimeString } from '../../utils/dateFormatting';

interface ActivityEvent {
  id: string;
  type: 'session_created' | 'worktree_created' | 'prompt_sent' | 'git_commit';
  timestamp: number;
  sessionId?: string;
  sessionTitle?: string;
  provider?: string;
  worktreeId?: string;
  worktreeName?: string;
  worktreeBranch?: string;
  promptPreview?: string;
  commitHash?: string;
  commitMessage?: string;
  commitAuthor?: string;
}

interface ActivityBottomPanelProps {
  workspacePath?: string;
  minHeight?: number;
  maxHeight?: number;
  onSwitchToAgentMode?: () => void;
}

const EVENT_CONFIG: Record<ActivityEvent['type'], { icon: string; label: string; color: string }> = {
  session_created: { icon: 'add_circle', label: 'Session created', color: 'var(--nim-primary)' },
  worktree_created: { icon: 'fork_right', label: 'Worktree created', color: 'var(--nim-success, #22c55e)' },
  prompt_sent: { icon: 'chat', label: 'Prompt sent', color: 'var(--nim-text-muted)' },
  git_commit: { icon: 'commit', label: 'Git commit', color: 'var(--nim-warning, #f59e0b)' },
};

function ActivityEventRow({ event, onClick }: { event: ActivityEvent; onClick?: () => void }) {
  const config = EVENT_CONFIG[event.type];
  const isClickable = !!onClick;

  let primaryText = '';
  let secondaryText = '';
  let detailText = '';

  switch (event.type) {
    case 'session_created':
      primaryText = event.sessionTitle || 'Untitled session';
      secondaryText = event.provider || '';
      break;
    case 'worktree_created':
      primaryText = event.worktreeName || 'Unnamed worktree';
      secondaryText = event.worktreeBranch || '';
      break;
    case 'prompt_sent':
      primaryText = `Sent message to ${event.sessionTitle || 'Session'}`;
      detailText = event.promptPreview || '';
      break;
    case 'git_commit':
      primaryText = event.commitMessage || '';
      secondaryText = event.commitAuthor || '';
      if (event.commitHash) {
        secondaryText += secondaryText ? ` \u00b7 ${event.commitHash.slice(0, 7)}` : event.commitHash.slice(0, 7);
      }
      break;
  }

  return (
    <div
      className={`flex items-start gap-2.5 px-3 py-2 border-b border-[var(--nim-border)] transition-colors duration-100 ${
        isClickable
          ? 'cursor-pointer hover:bg-[var(--nim-bg-hover)]'
          : 'hover:bg-[var(--nim-bg-hover)]'
      }`}
      onClick={onClick}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={isClickable ? (e) => { if (e.key === 'Enter') onClick?.(); } : undefined}
    >
      <div className="shrink-0 mt-0.5">
        <MaterialSymbol icon={config.icon} size={16} style={{ color: config.color }} />
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className={`text-xs font-medium truncate shrink-0 max-w-[240px] ${
            isClickable ? 'text-[var(--nim-primary)]' : 'text-[var(--nim-text)]'
          }`}>
            {primaryText}
          </span>
          {secondaryText && (
            <span className="text-[11px] text-[var(--nim-text-muted)] truncate shrink-0 max-w-[200px]">
              {secondaryText}
            </span>
          )}
          {detailText && (
            <span className="text-[11px] text-[var(--nim-text-faint)] truncate flex-1 min-w-0">
              {detailText}
            </span>
          )}
          <span className="text-[10px] text-[var(--nim-text-faint)] whitespace-nowrap shrink-0 ml-auto">
            {getRelativeTimeString(event.timestamp)}
          </span>
        </div>
      </div>
    </div>
  );
}

export const ActivityBottomPanel: React.FC<ActivityBottomPanelProps> = ({
  workspacePath,
  minHeight = 200,
  maxHeight = 800,
  onSwitchToAgentMode,
}) => {
  const isOpen = useAtomValue(isActivityPanelOpenAtom);
  const height = useAtomValue(activityPanelHeightAtom);
  const setHeight = useSetAtom(setActivityPanelHeightAtom);
  const closePanel = useSetAtom(closeActivityPanelAtom);
  const setSelectedWorkstream = useSetAtom(setSelectedWorkstreamAtom);

  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [isResizing, setIsResizing] = useState(false);

  const resizeStartY = useRef<number>(0);
  const resizeStartHeight = useRef<number>(0);

  // Load events when panel opens or workspace changes
  useEffect(() => {
    if (!isOpen || !workspacePath) {
      return;
    }

    let mounted = true;

    async function loadEvents() {
      setIsLoading(true);
      try {
        const result = await window.electronAPI.invoke('activity:list', workspacePath, { page: 0, pageSize: 100 });
        if (!mounted) return;
        if (result.success) {
          setEvents(result.events);
          setHasMore(result.hasMore);
          setPage(0);
        }
      } catch (error) {
        console.error('[ActivityBottomPanel] Failed to load events:', error);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    loadEvents();

    return () => { mounted = false; };
  }, [isOpen, workspacePath]);

  const handleLoadMore = useCallback(async () => {
    if (!workspacePath || isLoading) return;

    const nextPage = page + 1;
    setIsLoading(true);
    try {
      const result = await window.electronAPI.invoke('activity:list', workspacePath, { page: nextPage, pageSize: 100 });
      if (result.success) {
        setEvents(prev => [...prev, ...result.events]);
        setHasMore(result.hasMore);
        setPage(nextPage);
      }
    } catch (error) {
      console.error('[ActivityBottomPanel] Failed to load more events:', error);
    } finally {
      setIsLoading(false);
    }
  }, [workspacePath, page, isLoading]);

  const navigateToSession = useCallback((sessionId: string) => {
    if (!workspacePath) return;
    onSwitchToAgentMode?.();
    setSelectedWorkstream({
      workspacePath,
      selection: { type: 'session', id: sessionId },
    });
  }, [workspacePath, onSwitchToAgentMode, setSelectedWorkstream]);

  const handleEventClick = useCallback((event: ActivityEvent) => {
    switch (event.type) {
      case 'session_created':
      case 'prompt_sent':
        if (event.sessionId) {
          navigateToSession(event.sessionId);
        }
        break;
      case 'worktree_created':
      case 'git_commit':
        break;
    }
  }, [navigateToSession]);

  // Resize handling
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeStartY.current = e.clientY;
    resizeStartHeight.current = height;
  }, [height]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;
    const deltaY = resizeStartY.current - e.clientY;
    const newHeight = Math.min(
      Math.max(resizeStartHeight.current + deltaY, minHeight),
      maxHeight
    );
    setHeight(newHeight);
  }, [isResizing, minHeight, maxHeight, setHeight]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
    }
    return undefined;
  }, [isResizing, handleMouseMove, handleMouseUp]);

  if (!isOpen) return null;

  return (
    <div
      className="bottom-panel-container relative shrink-0 flex flex-col"
      style={{ height: `${height}px` }}
    >
      <div
        className="bottom-panel-resize-handle absolute top-0 left-0 right-0 h-1 cursor-ns-resize z-10 bg-transparent hover:bg-[var(--nim-primary)]"
        onMouseDown={handleMouseDown}
      />
      <div className="bottom-panel flex flex-col bg-[var(--nim-bg)] border-t-2 border-[var(--nim-border)] overflow-hidden" style={{ height: '100%' }}>
        <div className="bottom-panel-header flex items-center justify-between h-7 px-3 bg-[var(--nim-bg-secondary)] border-b border-[var(--nim-border)] shrink-0">
          <div className="flex items-center gap-2">
            <MaterialSymbol icon="history" size={14} className="text-[var(--nim-text-muted)]" />
            <span className="text-[12px] font-medium text-[var(--nim-text)]">Activity History</span>
            <span className="text-[10px] text-[var(--nim-text-faint)]">
              {events.length > 0 ? `${events.length}${hasMore ? '+' : ''} events` : ''}
            </span>
          </div>
          <button
            className="bottom-panel-close flex items-center justify-center w-6 h-6 p-0 bg-transparent border-none text-[var(--nim-text-muted)] cursor-pointer rounded transition-colors duration-150 hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)]"
            onClick={() => closePanel()}
            title="Close panel"
          >
            <MaterialSymbol icon="close" size={18} />
          </button>
        </div>
        <div className="bottom-panel-content flex-1 overflow-auto">
          {isLoading && events.length === 0 ? (
            <div className="flex items-center justify-center h-full text-[var(--nim-text-faint)] text-sm">
              Loading activity...
            </div>
          ) : events.length === 0 ? (
            <div className="flex items-center justify-center h-full text-[var(--nim-text-faint)] text-sm">
              No activity yet
            </div>
          ) : (
            <>
              {events.map((event) => (
                <ActivityEventRow
                  key={event.id}
                  event={event}
                  onClick={
                    (event.type === 'session_created' || event.type === 'prompt_sent') && event.sessionId
                      ? () => handleEventClick(event)
                      : undefined
                  }
                />
              ))}
              {hasMore && (
                <div className="flex items-center justify-center py-3">
                  <button
                    className="px-4 py-1.5 text-xs font-medium text-[var(--nim-text-muted)] bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)] transition-colors cursor-pointer disabled:opacity-50"
                    onClick={handleLoadMore}
                    disabled={isLoading}
                  >
                    {isLoading ? 'Loading...' : 'Load more'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
