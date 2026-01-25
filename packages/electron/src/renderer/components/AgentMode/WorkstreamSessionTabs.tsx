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

export interface WorkstreamSessionTabsProps {
  workspacePath: string;
  workstreamId: string;
  sessions: string[]; // Array of session IDs
  activeSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
  onFileClick?: (filePath: string) => void;
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
      className={`session-tab flex items-center gap-1.5 px-2.5 py-[5px] border-none rounded text-xs font-medium cursor-pointer whitespace-nowrap transition-colors duration-150 ${
        isActive
          ? 'active bg-[var(--nim-bg-tertiary)] text-[var(--nim-text)]'
          : 'bg-transparent text-[var(--nim-text-muted)] hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)]'
      } ${hasUnread ? 'unread' : ''}`}
      onClick={onClick}
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
    <div className="session-tab-bar nim-scrollbar-thin flex items-center gap-0.5 px-3 pt-1 pb-1.5 bg-[var(--nim-bg-secondary)] border-t-[3px] border-b border-[var(--nim-border)] overflow-x-auto shrink-0">
      {sessions.map((sessionId) => (
        <SessionTab
          key={sessionId}
          sessionId={sessionId}
          isActive={sessionId === activeSessionId}
          onClick={() => onSessionSelect(sessionId)}
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
}) => {
  const hasChildren = useAtomValue(workstreamHasChildrenAtom(workstreamId));
  const createChildSession = useSetAtom(createChildSessionAtom);
  const convertToWorkstream = useSetAtom(convertToWorkstreamAtom);

  // Handle creating a new child session
  const handleNewSession = useCallback(async () => {
    console.log(`[WorkstreamSessionTabs] handleNewSession - workstreamId=${workstreamId}, hasChildren=${hasChildren}`);
    if (hasChildren) {
      // Already a workstream - just create a child
      console.log(`[WorkstreamSessionTabs] Calling createChildSession for parent ${workstreamId}`);
      const result = await createChildSession({
        parentSessionId: workstreamId,
        workspacePath,
      });
      console.log(`[WorkstreamSessionTabs] createChildSession result:`, result);
    } else {
      // Single session - convert to workstream first
      console.log(`[WorkstreamSessionTabs] Calling convertToWorkstream for session ${workstreamId}`);
      const result = await convertToWorkstream({
        sessionId: workstreamId,
        workspacePath,
      });
      console.log(`[WorkstreamSessionTabs] convertToWorkstream result:`, result);
    }
  }, [workstreamId, workspacePath, hasChildren, createChildSession, convertToWorkstream]);

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
      />

      <div className="workstream-session-tabs-content flex-1 min-h-0 overflow-hidden">
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
