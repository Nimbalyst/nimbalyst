/**
 * TeammatePanel - Collapsible panel showing the agent's current teammates.
 *
 * Displays teammates from the active session's metadata (currentTeammates).
 * Shows teammate name, agent type, and status (running, completed, errored).
 * Collapse state is persisted at the project level.
 */

import React, { useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime';
import { teammatePanelCollapsedAtom, toggleTeammatePanelCollapsedAtom, sessionTeammatesAtom } from '../../store/atoms/agentMode';

export interface TeammateInfo {
  name: string;
  agentId: string;
  teamName: string;
  agentType: string;
  status: 'running' | 'completed' | 'errored' | 'idle';
  model?: string;
}

interface TeammatePanelProps {
  /** The session ID to get teammates from */
  sessionId: string;
}

export const TeammatePanel: React.FC<TeammatePanelProps> = React.memo(({
  sessionId,
}) => {
  const isCollapsed = useAtomValue(teammatePanelCollapsedAtom);
  const toggleCollapsed = useSetAtom(toggleTeammatePanelCollapsedAtom);
  const teammates = useAtomValue(sessionTeammatesAtom(sessionId));

  // Must call all hooks before any early return
  const handleToggle = useCallback(() => {
    toggleCollapsed();
  }, [toggleCollapsed]);

  // Don't render if no teammates
  if (teammates.length === 0) {
    return null;
  }

  const runningCount = teammates.filter(t => t.status === 'running' || t.status === 'idle').length;
  const totalCount = teammates.length;

  return (
    <div className="teammate-panel border-t border-[var(--nim-border)] bg-[var(--nim-bg-secondary)]">
      {/* Header */}
      <button
        className="teammate-panel-header w-full flex items-center gap-2 px-3 py-2 bg-transparent border-none cursor-pointer text-left hover:bg-[var(--nim-bg-hover)]"
        onClick={handleToggle}
      >
        <MaterialSymbol
          icon={isCollapsed ? 'chevron_right' : 'expand_more'}
          size={16}
          className="text-[var(--nim-text-muted)] shrink-0"
        />
        <MaterialSymbol
          icon="group"
          size={16}
          className="text-[var(--nim-text-muted)] shrink-0"
        />
        <span className="teammate-panel-title text-xs font-medium text-[var(--nim-text)]">
          Teammates
        </span>
        <span className="teammate-panel-count ml-auto text-[11px] text-[var(--nim-text-muted)] font-mono">
          {runningCount}/{totalCount}
        </span>
      </button>

      {/* Content */}
      {!isCollapsed && (
        <div className="teammate-panel-content px-3 pb-2 max-h-[200px] overflow-y-auto">
          <div className="flex flex-col gap-1">
            {teammates.map((teammate) => (
              <TeammateItem key={teammate.agentId} teammate={teammate} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

TeammatePanel.displayName = 'TeammatePanel';

interface TeammateItemProps {
  teammate: TeammateInfo;
}

const TeammateItem: React.FC<TeammateItemProps> = React.memo(({ teammate }) => {
  return (
    <div
      className={`teammate-item flex items-start gap-2 py-1 px-1 rounded text-xs ${
        teammate.status === 'running' ? 'bg-[var(--nim-bg-hover)]' : ''
      } ${teammate.status === 'completed' || teammate.status === 'errored' ? 'opacity-60' : ''}`}
      data-status={teammate.status}
    >
      <div className="teammate-item-icon shrink-0 w-4 h-4 flex items-center justify-center mt-0.5">
        {teammate.status === 'running' && (
          <span className="inline-block w-3 h-3 border-2 border-[var(--nim-bg-tertiary)] border-t-[var(--nim-primary)] rounded-full animate-spin" />
        )}
        {teammate.status === 'idle' && (
          <span className="text-[var(--nim-primary)] text-[10px]">○</span>
        )}
        {teammate.status === 'completed' && (
          <span className="text-[var(--nim-success)] text-[10px]">●</span>
        )}
        {teammate.status === 'errored' && (
          <span className="text-[var(--nim-error)] text-[10px]">●</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className={`teammate-item-name leading-[1.4] break-words ${
          teammate.status === 'completed'
            ? 'line-through text-[var(--nim-text-muted)]'
            : 'text-[var(--nim-text)]'
        }`}>
          {teammate.name}
        </div>
        <div className="text-[10px] text-[var(--nim-text-faint)] truncate">
          {teammate.agentType}{teammate.status === 'idle' ? ' (idle)' : ''}
        </div>
      </div>
    </div>
  );
});

TeammateItem.displayName = 'TeammateItem';
