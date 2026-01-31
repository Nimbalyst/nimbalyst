/**
 * WorkstreamSessionTabs - Manages session tabs + displays active session panel.
 *
 * This component sits at the bottom of the workstream panel (below editor tabs).
 * It contains:
 * - SessionTabBar: horizontal tabs for all sessions in the workstream (always visible)
 * - AgentSessionPanel: the active session's content
 *
 * The tab bar is always shown - even for single sessions - so the user can see
 * which session is active and use the "+" button to add more sessions.
 */

import React, { useCallback, useState, useRef, useEffect } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { MaterialSymbol, ProviderIcon } from '@nimbalyst/runtime';
import { sessionArchivedAtom } from '../../store/atoms/sessions';
import { AgentSessionPanel } from './AgentSessionPanel';
import {
  sessionTitleAtom,
  sessionProviderAtom,
  sessionProcessingAtom,
  sessionUnreadAtom,
  createChildSessionAtom,
} from '../../store';
import { convertToWorkstreamAtom } from '../../store/atoms/sessions';
import { workstreamHasChildrenAtom } from '../../store/atoms/workstreamState';

export interface WorkstreamSessionTabsProps {
  workspacePath: string;
  workstreamId: string;
  sessions: string[]; // Array of session IDs
  activeSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
  onFileClick?: (filePath: string) => void;
  worktreeId?: string | null; // If set, this is a worktree session (add sessions to worktree, not convert to workstream)
  onAddSessionToWorktree?: (worktreeId: string) => Promise<void>; // Callback to add session to worktree
  onSessionArchive?: (sessionId: string) => void; // Callback to archive a session
  onSessionUnarchive?: (sessionId: string) => void; // Callback to unarchive a session
}

/**
 * Individual session tab - subscribes to atoms for isolated re-renders.
 */
const SessionTab: React.FC<{
  sessionId: string;
  isActive: boolean;
  onClick: () => void;
  onArchive?: () => void;
  onUnarchive?: () => void;
}> = React.memo(({ sessionId, isActive, onClick, onArchive, onUnarchive }) => {
  const title = useAtomValue(sessionTitleAtom(sessionId));
  const provider = useAtomValue(sessionProviderAtom(sessionId));
  const isProcessing = useAtomValue(sessionProcessingAtom(sessionId));
  const hasUnread = useAtomValue(sessionUnreadAtom(sessionId));
  const isArchived = useAtomValue(sessionArchivedAtom(sessionId));

  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  }, []);

  const handleArchive = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowContextMenu(false);
    onArchive?.();
  }, [onArchive]);

  const handleUnarchive = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowContextMenu(false);
    onUnarchive?.();
  }, [onUnarchive]);

  // Close context menu when clicking outside
  useEffect(() => {
    if (!showContextMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setShowContextMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showContextMenu]);

  return (
    <div className="relative" onMouseLeave={() => setShowContextMenu(false)}>
      <button
        className={`session-tab flex items-center gap-1.5 px-2.5 py-[5px] border-none rounded text-xs font-medium cursor-pointer whitespace-nowrap transition-colors duration-150 ${
          isActive
            ? 'active bg-[var(--nim-bg-tertiary)] text-[var(--nim-text)]'
            : 'bg-transparent text-[var(--nim-text-muted)] hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)]'
        } ${hasUnread ? 'unread' : ''} ${isArchived ? 'opacity-60' : ''}`}
        onClick={onClick}
        onContextMenu={handleContextMenu}
        title={title || 'Untitled'}
      >
        {isProcessing && (
          <span className="session-tab-processing-dot w-1.5 h-1.5 rounded-full bg-[var(--nim-primary)] animate-pulse" />
        )}
        <ProviderIcon
          provider={provider}
          size={14}
          className={`session-tab-icon shrink-0 ${isActive ? 'opacity-100' : 'opacity-80'}`}
        />
        <span className={`session-tab-title max-w-[150px] overflow-hidden text-ellipsis ${hasUnread ? 'font-semibold' : ''}`}>
          {title || 'Untitled'}
        </span>
        {hasUnread && (
          <span className="session-tab-unread-dot w-1.5 h-1.5 rounded-full bg-[var(--nim-warning)]" />
        )}
      </button>

      {/* Context Menu */}
      {showContextMenu && (onArchive || onUnarchive) && (
        <div
          ref={contextMenuRef}
          className="fixed z-[1000] min-w-[140px] bg-[var(--nim-bg)] border border-[var(--nim-border)] rounded-md shadow-[0_4px_12px_rgba(0,0,0,0.15)] p-1"
          style={{
            left: contextMenuPosition.x,
            top: contextMenuPosition.y
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="flex items-center gap-2 w-full py-2 px-3 bg-transparent border-none cursor-pointer text-[0.8125rem] text-[var(--nim-text)] text-left rounded transition-colors duration-150 hover:bg-[var(--nim-bg-hover)]"
            onClick={isArchived ? handleUnarchive : handleArchive}
          >
            <MaterialSymbol icon={isArchived ? "unarchive" : "archive"} size={14} />
            {isArchived ? 'Unarchive' : 'Archive'}
          </button>
        </div>
      )}
    </div>
  );
});

SessionTab.displayName = 'SessionTab';

/**
 * Session tab bar - always shows session tabs + "+" button.
 * For single sessions, shows the session tab (so user can see what's selected).
 * For multi-session workstreams, shows all tabs.
 */
const SessionTabBar: React.FC<{
  sessions: string[];
  activeSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
  onNewSession: () => void;
  onSessionArchive?: (sessionId: string) => void;
  onSessionUnarchive?: (sessionId: string) => void;
}> = React.memo(({ sessions, activeSessionId, onSessionSelect, onNewSession, onSessionArchive, onSessionUnarchive }) => {
  // Always show the tab bar - even for single sessions, the user should see their session tab
  return (
    <div className="session-tab-bar flex flex-wrap items-center gap-0.5 px-3 pt-1 pb-1.5 bg-[var(--nim-bg-secondary)] border-t-[3px] border-b border-[var(--nim-border)] shrink-0">
      {sessions.map((sessionId) => (
        <SessionTab
          key={sessionId}
          sessionId={sessionId}
          isActive={sessionId === activeSessionId}
          onClick={() => onSessionSelect(sessionId)}
          onArchive={onSessionArchive ? () => onSessionArchive(sessionId) : undefined}
          onUnarchive={onSessionUnarchive ? () => onSessionUnarchive(sessionId) : undefined}
        />
      ))}
      <button
        className="session-tab-new nim-btn-icon-sm text-[var(--nim-text-faint)] hover:text-[var(--nim-text-muted)] active:bg-[var(--nim-bg-tertiary)]"
        onClick={onNewSession}
        title="New session in workstream"
      >
        <MaterialSymbol icon="add" size={16} />
      </button>
    </div>
  );
});

SessionTabBar.displayName = 'SessionTabBar';

/**
 * WorkstreamSessionTabs manages both the tab bar and the active session panel.
 */
export const WorkstreamSessionTabs: React.FC<WorkstreamSessionTabsProps> = React.memo(({
  workspacePath,
  workstreamId,
  sessions,
  activeSessionId,
  onSessionSelect,
  onFileClick,
  worktreeId,
  onAddSessionToWorktree,
  onSessionArchive,
  onSessionUnarchive,
}) => {
  const hasChildren = useAtomValue(workstreamHasChildrenAtom(workstreamId));
  const createChildSession = useSetAtom(createChildSessionAtom);
  const convertToWorkstream = useSetAtom(convertToWorkstreamAtom);

  // Handle creating a new child session
  const handleNewSession = useCallback(async () => {
    // If this is a worktree, use the callback to add a session to it
    if (worktreeId && onAddSessionToWorktree) {
      await onAddSessionToWorktree(worktreeId);
      return;
    }

    // Regular workstream logic
    if (hasChildren) {
      // Already a workstream - just create a child
      await createChildSession({
        parentSessionId: workstreamId,
        workspacePath,
      });
    } else {
      // Single session - convert to workstream first
      await convertToWorkstream({
        sessionId: workstreamId,
        workspacePath,
      });
    }
  }, [workstreamId, workspacePath, hasChildren, worktreeId, onAddSessionToWorktree, createChildSession, convertToWorkstream]);

  if (!activeSessionId) {
    return (
      <div className="workstream-session-tabs-empty flex items-center justify-center h-full text-[var(--nim-text-muted)] text-sm">
        <p>Loading sessions...</p>
      </div>
    );
  }

  return (
    <div className="workstream-session-tabs flex flex-col h-full overflow-hidden">
      <SessionTabBar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSessionSelect={onSessionSelect}
        onNewSession={handleNewSession}
        onSessionArchive={onSessionArchive}
        onSessionUnarchive={onSessionUnarchive}
      />

      <div className="workstream-session-tabs-content flex-1 min-h-0 overflow-hidden">
        <AgentSessionPanel
          key={activeSessionId}
          sessionId={activeSessionId}
          workspacePath={workspacePath}
          onFileClick={onFileClick}
          onClearAgentSession={handleNewSession}
        />
      </div>
    </div>
  );
});

WorkstreamSessionTabs.displayName = 'WorkstreamSessionTabs';
