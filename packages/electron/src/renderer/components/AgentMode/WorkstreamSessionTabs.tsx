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

import React, { useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { MaterialSymbol, ProviderIcon } from '@nimbalyst/runtime';
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
import './WorkstreamSessionTabs.css';

export interface WorkstreamSessionTabsProps {
  workspacePath: string;
  workstreamId: string;
  sessions: string[]; // Array of session IDs
  activeSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
  onFileClick?: (filePath: string) => void;
  worktreeId?: string | null; // If set, this is a worktree session (add sessions to worktree, not convert to workstream)
  onAddSessionToWorktree?: (worktreeId: string) => Promise<void>; // Callback to add session to worktree
}

/**
 * Individual session tab - subscribes to atoms for isolated re-renders.
 */
const SessionTab: React.FC<{
  sessionId: string;
  isActive: boolean;
  onClick: () => void;
}> = React.memo(({ sessionId, isActive, onClick }) => {
  const title = useAtomValue(sessionTitleAtom(sessionId));
  const provider = useAtomValue(sessionProviderAtom(sessionId));
  const isProcessing = useAtomValue(sessionProcessingAtom(sessionId));
  const hasUnread = useAtomValue(sessionUnreadAtom(sessionId));

  return (
    <button
      className={`session-tab ${isActive ? 'active' : ''} ${hasUnread ? 'unread' : ''}`}
      onClick={onClick}
      title={title || 'Untitled'}
    >
      {isProcessing && <span className="session-tab-processing-dot" />}
      <ProviderIcon provider={provider} size={14} className="session-tab-icon" />
      <span className="session-tab-title">{title || 'Untitled'}</span>
      {hasUnread && <span className="session-tab-unread-dot" />}
    </button>
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
}> = React.memo(({ sessions, activeSessionId, onSessionSelect, onNewSession }) => {
  // Always show the tab bar - even for single sessions, the user should see their session tab
  return (
    <div className="session-tab-bar">
      {sessions.map((sessionId) => (
        <SessionTab
          key={sessionId}
          sessionId={sessionId}
          isActive={sessionId === activeSessionId}
          onClick={() => onSessionSelect(sessionId)}
        />
      ))}
      <button
        className="session-tab-new"
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
      <div className="workstream-session-tabs-empty">
        <p>Loading sessions...</p>
      </div>
    );
  }

  return (
    <div className="workstream-session-tabs">
      <SessionTabBar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSessionSelect={onSessionSelect}
        onNewSession={handleNewSession}
      />

      <div className="workstream-session-tabs-content">
        <AgentSessionPanel
          key={activeSessionId}
          sessionId={activeSessionId}
          workspacePath={workspacePath}
          onFileClick={onFileClick}
        />
      </div>
    </div>
  );
});

WorkstreamSessionTabs.displayName = 'WorkstreamSessionTabs';
