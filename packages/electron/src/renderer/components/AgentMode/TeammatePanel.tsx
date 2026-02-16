/**
 * TeammatePanel - Collapsible panel showing the agent's current teammates and sub-agents.
 *
 * Displays entries from the active session's metadata (currentTeammates),
 * split into two sections:
 * - "Teammates" for team members (real team names)
 * - "Agents" for background agents (_background) and sub-agents (_subagent)
 *
 * Each section is independently collapsible. Sections only render when they have entries.
 * Collapse state is persisted at the project level.
 */

import React, { useCallback, useMemo } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime';
import { teammatePanelCollapsedAtom, toggleTeammatePanelCollapsedAtom, agentPanelCollapsedAtom, toggleAgentPanelCollapsedAtom, sessionTeammatesAtom } from '../../store/atoms/agentMode';

export interface TeammateInfo {
  name: string;
  agentId: string;
  teamName: string;
  agentType: string;
  status: 'running' | 'completed' | 'errored' | 'idle';
  model?: string;
}

const AGENT_TEAM_NAMES = new Set(['_background', '_subagent']);

interface TeammatePanelProps {
  /** The session ID to get teammates from */
  sessionId: string;
}

export const TeammatePanel: React.FC<TeammatePanelProps> = React.memo(({
  sessionId,
}) => {
  const isTeammatesCollapsed = useAtomValue(teammatePanelCollapsedAtom);
  const toggleTeammatesCollapsed = useSetAtom(toggleTeammatePanelCollapsedAtom);
  const isAgentsCollapsed = useAtomValue(agentPanelCollapsedAtom);
  const toggleAgentsCollapsed = useSetAtom(toggleAgentPanelCollapsedAtom);
  const allEntries = useAtomValue(sessionTeammatesAtom(sessionId));

  const handleToggleTeammates = useCallback(() => {
    toggleTeammatesCollapsed();
  }, [toggleTeammatesCollapsed]);

  const handleToggleAgents = useCallback(() => {
    toggleAgentsCollapsed();
  }, [toggleAgentsCollapsed]);

  const { teammates, agents } = useMemo(() => {
    const tm: TeammateInfo[] = [];
    const ag: TeammateInfo[] = [];
    for (const entry of allEntries) {
      if (AGENT_TEAM_NAMES.has(entry.teamName)) {
        ag.push(entry);
      } else {
        tm.push(entry);
      }
    }
    return { teammates: tm, agents: ag };
  }, [allEntries]);

  if (allEntries.length === 0) {
    return null;
  }

  return (
    <div className="teammate-panel border-t border-[var(--nim-border)] bg-[var(--nim-bg-secondary)]">
      {teammates.length > 0 && (
        <PanelSection
          title="Teammates"
          icon="group"
          entries={teammates}
          isCollapsed={isTeammatesCollapsed}
          onToggle={handleToggleTeammates}
        />
      )}
      {agents.length > 0 && (
        <PanelSection
          title="Agents"
          icon="swap_horiz"
          entries={agents}
          isCollapsed={isAgentsCollapsed}
          onToggle={handleToggleAgents}
          className={teammates.length > 0 ? 'border-t border-[var(--nim-border)]' : undefined}
        />
      )}
    </div>
  );
});

TeammatePanel.displayName = 'TeammatePanel';

interface PanelSectionProps {
  title: string;
  icon: string;
  entries: TeammateInfo[];
  isCollapsed: boolean;
  onToggle: () => void;
  className?: string;
}

const PanelSection: React.FC<PanelSectionProps> = React.memo(({
  title,
  icon,
  entries,
  isCollapsed,
  onToggle,
  className,
}) => {
  const runningCount = entries.filter(t => t.status === 'running' || t.status === 'idle').length;
  const totalCount = entries.length;

  return (
    <div className={className}>
      <button
        className="w-full flex items-center gap-2 px-3 py-2 bg-transparent border-none cursor-pointer text-left hover:bg-[var(--nim-bg-hover)]"
        onClick={onToggle}
      >
        <MaterialSymbol
          icon={isCollapsed ? 'chevron_right' : 'expand_more'}
          size={16}
          className="text-[var(--nim-text-muted)] shrink-0"
        />
        <MaterialSymbol
          icon={icon}
          size={16}
          className="text-[var(--nim-text-muted)] shrink-0"
        />
        <span className="text-xs font-medium text-[var(--nim-text)]">
          {title}
        </span>
        <span className="ml-auto text-[11px] text-[var(--nim-text-muted)] font-mono">
          {runningCount}/{totalCount}
        </span>
      </button>

      {!isCollapsed && (
        <div className="px-3 pb-2 max-h-[200px] overflow-y-auto">
          <div className="flex flex-col gap-1">
            {entries.map((entry) => (
              <TeammateItem key={entry.agentId} teammate={entry} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

PanelSection.displayName = 'PanelSection';

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
