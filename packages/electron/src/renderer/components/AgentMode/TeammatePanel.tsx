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
 *
 * Clicking a teammate item scrolls the transcript to its spawn point via scrollToTeammateAtom.
 */

import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime';
import { teammatePanelCollapsedAtom, toggleTeammatePanelCollapsedAtom, agentPanelCollapsedAtom, toggleAgentPanelCollapsedAtom, sessionTeammatesAtom, scrollToTeammateAtom } from '../../store/atoms/agentMode';

export interface TeammateInfo {
  name: string;
  agentId: string;
  teamName: string;
  agentType: string;
  status: 'running' | 'completed' | 'errored' | 'idle';
  model?: string;
  startedAt?: number;
  lastActiveAt?: number;
  toolCallCount?: number;
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
  const setScrollTarget = useSetAtom(scrollToTeammateAtom);

  const handleToggleTeammates = useCallback(() => {
    toggleTeammatesCollapsed();
  }, [toggleTeammatesCollapsed]);

  const handleToggleAgents = useCallback(() => {
    toggleAgentsCollapsed();
  }, [toggleAgentsCollapsed]);

  const handleTeammateClick = useCallback((agentId: string) => {
    setScrollTarget({ sessionId, agentId });
  }, [sessionId, setScrollTarget]);

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
          onTeammateClick={handleTeammateClick}
        />
      )}
      {agents.length > 0 && (
        <PanelSection
          title="Agents"
          icon="swap_horiz"
          entries={agents}
          isCollapsed={isAgentsCollapsed}
          onToggle={handleToggleAgents}
          onTeammateClick={handleTeammateClick}
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
  onTeammateClick: (agentId: string) => void;
  className?: string;
}

const PanelSection: React.FC<PanelSectionProps> = React.memo(({
  title,
  icon,
  entries,
  isCollapsed,
  onToggle,
  onTeammateClick,
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
              <TeammateItem key={entry.agentId} teammate={entry} onClick={onTeammateClick} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

PanelSection.displayName = 'PanelSection';

// ─── Elapsed time formatting ──────────────────────────────────────────────

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function formatAgo(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

// ─── Live clock hook ──────────────────────────────────────────────────────

/** Ticks every second so relative times stay fresh. Returns current epoch ms. */
function useNow(enabled: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [enabled]);
  return now;
}

// ─── TeammateItem ─────────────────────────────────────────────────────────

interface TeammateItemProps {
  teammate: TeammateInfo;
  onClick: (agentId: string) => void;
}

const TeammateItem: React.FC<TeammateItemProps> = React.memo(({ teammate, onClick }) => {
  const isActive = teammate.status === 'running' || teammate.status === 'idle';
  const now = useNow(isActive);

  const handleClick = useCallback(() => {
    onClick(teammate.agentId);
  }, [onClick, teammate.agentId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick(teammate.agentId);
    }
  }, [onClick, teammate.agentId]);

  // Build stats line
  const stats: string[] = [];
  if (teammate.startedAt) {
    stats.push(formatElapsed(now - teammate.startedAt));
  }
  // Only show "last active" when idle - when running, elapsed time is sufficient
  if (teammate.status === 'idle' && teammate.lastActiveAt) {
    stats.push(formatAgo(now - teammate.lastActiveAt));
  }
  if (typeof teammate.toolCallCount === 'number' && teammate.toolCallCount > 0) {
    stats.push(`${teammate.toolCallCount} tool${teammate.toolCallCount !== 1 ? 's' : ''}`);
  }

  return (
    <div
      className={`teammate-item flex items-start gap-2 py-1 px-1 rounded text-xs cursor-pointer hover:bg-[var(--nim-bg-hover)] ${
        teammate.status === 'running' ? 'bg-[var(--nim-bg-hover)]' : ''
      } ${teammate.status === 'completed' || teammate.status === 'errored' ? 'opacity-60' : ''}`}
      data-status={teammate.status}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
    >
      <div className="teammate-item-icon shrink-0 w-4 h-4 flex items-center justify-center mt-0.5">
        {teammate.status === 'running' && (
          <span className="inline-block w-3 h-3 border-2 border-[var(--nim-bg-tertiary)] border-t-[var(--nim-primary)] rounded-full animate-spin" />
        )}
        {teammate.status === 'idle' && (
          <span className="text-[var(--nim-primary)] text-[10px]">&#x25CB;</span>
        )}
        {teammate.status === 'completed' && (
          <span className="text-[var(--nim-success)] text-[10px]">&#x25CF;</span>
        )}
        {teammate.status === 'errored' && (
          <span className="text-[var(--nim-error)] text-[10px]">&#x25CF;</span>
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
        {stats.length > 0 && (
          <div className="text-[10px] text-[var(--nim-text-faint)] truncate font-mono">
            {stats.join(' \u00B7 ')}
          </div>
        )}
      </div>
    </div>
  );
});

TeammateItem.displayName = 'TeammateItem';
