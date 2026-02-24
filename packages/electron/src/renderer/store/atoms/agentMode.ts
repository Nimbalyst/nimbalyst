/**
 * Agent Mode State Atoms
 *
 * Centralized state management for agent mode layout and UI state.
 * This replaces useState variables in AgenticPanel that were causing
 * unnecessary re-renders and prop drilling.
 *
 * Pattern: "blob atom" - single atom for related state, derived atoms for slices.
 *
 * @example
 * // Read layout values
 * const width = useAtomValue(sessionHistoryWidthAtom);
 *
 * // Update layout
 * const updateLayout = useSetAtom(setAgentModeLayoutAtom);
 * updateLayout({ sessionHistoryWidth: 300 });
 */

import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import { store } from '@nimbalyst/runtime/store';
import { selectedWorkstreamAtom, type WorkstreamType } from './sessions';
import { sessionStoreAtom } from './sessions';
import type { TeammateInfo } from '../../components/AgentMode/TeammatePanel';

// ============================================================
// Types
// ============================================================

/**
 * Layout state for agent mode session history panel.
 * This shape is used both at runtime and for persistence.
 */
export interface SessionHistoryLayout {
  width: number;
  collapsed: boolean;
  preCollapseWidth?: number;
  collapsedGroups: string[];
  sortOrder: 'updated' | 'created';
  viewMode: 'list' | 'card';
}

/**
 * Full agent mode layout state.
 * This shape is used both at runtime and for persistence.
 */
export interface AgentModeLayout {
  sessionHistoryLayout: SessionHistoryLayout;
  filesEditedWidth: number;
  todoPanelCollapsed: boolean;
  teammatePanelCollapsed: boolean;
  agentPanelCollapsed: boolean;
}

// ============================================================
// Main Layout Atom
// ============================================================

const DEFAULT_SESSION_HISTORY_LAYOUT: SessionHistoryLayout = {
  width: 240,
  collapsed: false,
  preCollapseWidth: undefined,
  collapsedGroups: [],
  sortOrder: 'updated',
  viewMode: 'list',
};

const DEFAULT_LAYOUT: AgentModeLayout = {
  sessionHistoryLayout: DEFAULT_SESSION_HISTORY_LAYOUT,
  filesEditedWidth: 256,
  todoPanelCollapsed: false,
  teammatePanelCollapsed: false,
  agentPanelCollapsed: false,
};

/**
 * Deep merge persisted state with defaults.
 * Handles missing fields from old persisted data.
 */
function mergeWithDefaults(persisted: Partial<AgentModeLayout> | undefined): AgentModeLayout {
  const sessionHistoryLayout = {
    ...DEFAULT_SESSION_HISTORY_LAYOUT,
    ...persisted?.sessionHistoryLayout,
  };
  return {
    ...DEFAULT_LAYOUT,
    ...persisted,
    sessionHistoryLayout,
    // Ensure panel collapse states have defaults if missing from old persisted data
    todoPanelCollapsed: persisted?.todoPanelCollapsed ?? DEFAULT_LAYOUT.todoPanelCollapsed,
    teammatePanelCollapsed: persisted?.teammatePanelCollapsed ?? DEFAULT_LAYOUT.teammatePanelCollapsed,
    agentPanelCollapsed: persisted?.agentPanelCollapsed ?? DEFAULT_LAYOUT.agentPanelCollapsed,
  };
}

/**
 * Main atom for agent mode layout state.
 * Contains all layout-related state in a single object.
 */
export const agentModeLayoutAtom = atom<AgentModeLayout>(DEFAULT_LAYOUT);

// Track workspace path for persistence
// IMPORTANT: Use module-level variable, not atom, so it persists across HMR
let currentWorkspacePath: string | null = null;

// ============================================================
// Derived Atoms (read-only slices)
// ============================================================

/** Session history panel width */
export const sessionHistoryWidthAtom = atom(
  (get) => get(agentModeLayoutAtom).sessionHistoryLayout.width
);

/** Whether session history is collapsed */
export const sessionHistoryCollapsedAtom = atom(
  (get) => get(agentModeLayoutAtom).sessionHistoryLayout.collapsed
);

/** Files edited sidebar width */
export const filesEditedWidthAtom = atom(
  (get) => get(agentModeLayoutAtom).filesEditedWidth
);

/** Collapsed group keys */
export const collapsedGroupsAtom = atom(
  (get) => get(agentModeLayoutAtom).sessionHistoryLayout.collapsedGroups
);

/** Sort order for sessions */
export const sortOrderAtom = atom(
  (get) => get(agentModeLayoutAtom).sessionHistoryLayout.sortOrder
);

/** View mode for session history (list or card) */
export const viewModeAtom = atom(
  (get) => get(agentModeLayoutAtom).sessionHistoryLayout.viewMode
);

/** Whether the todo panel is collapsed */
export const todoPanelCollapsedAtom = atom(
  (get) => get(agentModeLayoutAtom).todoPanelCollapsed
);

/** Whether the teammate panel is collapsed */
export const teammatePanelCollapsedAtom = atom(
  (get) => get(agentModeLayoutAtom).teammatePanelCollapsed
);

/** Whether the agent panel is collapsed */
export const agentPanelCollapsedAtom = atom(
  (get) => get(agentModeLayoutAtom).agentPanelCollapsed
);

/** Per-session derived atom for current teammates from session metadata */
export const sessionTeammatesAtom = atomFamily((sessionId: string) =>
  atom((get) => {
    const session = get(sessionStoreAtom(sessionId));
    const raw = session?.metadata?.currentTeammates;
    return Array.isArray(raw) ? raw as TeammateInfo[] : [];
  })
);

/** Write-only atom to request scrolling to a teammate's spawn point in the transcript.
 *  Set by TeammatePanel on click, consumed by RichTranscriptView.  */
export const scrollToTeammateAtom = atom<{ sessionId: string; agentId: string } | null>(null);

// ============================================================
// Debounced Persistence
// ============================================================

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(workspacePath: string, layout: AgentModeLayout): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
  }

  persistTimer = setTimeout(async () => {
    try {
      // Persist directly - runtime shape matches persisted shape
      const state = { agenticCodingWindowState: layout };
      // console.log('[agentMode] Persisting layout:', JSON.stringify(state, null, 2));
      const result = await window.electronAPI.invoke('workspace:update-state', workspacePath, state);
      // console.log('[agentMode] Persist result:', result);
    } catch (err) {
      console.error('[agentMode] Failed to persist layout:', err);
    }
  }, 500);
}

// ============================================================
// Setter Atoms
// ============================================================

/**
 * Update session history layout with partial values.
 */
export const setSessionHistoryLayoutAtom = atom(
  null,
  (get, set, updates: Partial<SessionHistoryLayout>) => {
    const current = get(agentModeLayoutAtom);
    const newLayout: AgentModeLayout = {
      ...current,
      sessionHistoryLayout: { ...current.sessionHistoryLayout, ...updates },
    };

    set(agentModeLayoutAtom, newLayout);

    if (!currentWorkspacePath) {
      throw new Error('[agentMode] Cannot persist layout - initAgentModeLayout not called');
    }
    schedulePersist(currentWorkspacePath, newLayout);
  }
);

/**
 * Update agent mode layout (top-level fields only).
 * For sessionHistoryLayout updates, use setSessionHistoryLayoutAtom.
 */
export const setAgentModeLayoutAtom = atom(
  null,
  (get, set, updates: { filesEditedWidth?: number }) => {
    const current = get(agentModeLayoutAtom);
    const newLayout = { ...current, ...updates };

    set(agentModeLayoutAtom, newLayout);

    if (!currentWorkspacePath) {
      throw new Error('[agentMode] Cannot persist layout - initAgentModeLayout not called');
    }
    schedulePersist(currentWorkspacePath, newLayout);
  }
);

/**
 * Set session history width.
 */
export const setSessionHistoryWidthAtom = atom(
  null,
  (get, set, width: number) => {
    set(setSessionHistoryLayoutAtom, { width });
  }
);

/**
 * Set files edited sidebar width.
 */
export const setFilesEditedWidthAtom = atom(
  null,
  (get, set, width: number) => {
    const clampedWidth = Math.max(150, Math.min(500, width));
    set(setAgentModeLayoutAtom, { filesEditedWidth: clampedWidth });
  }
);

/**
 * Toggle a collapsed group.
 */
export const toggleCollapsedGroupAtom = atom(
  null,
  (get, set, groupKey: string) => {
    const current = get(collapsedGroupsAtom);
    const isCollapsed = current.includes(groupKey);
    const newGroups = isCollapsed
      ? current.filter((g) => g !== groupKey)
      : [...current, groupKey];
    set(setSessionHistoryLayoutAtom, { collapsedGroups: newGroups });
  }
);

/**
 * Set collapsed groups directly.
 */
export const setCollapsedGroupsAtom = atom(
  null,
  (get, set, groups: string[]) => {
    set(setSessionHistoryLayoutAtom, { collapsedGroups: groups });
  }
);

/**
 * Set sort order.
 */
export const setSortOrderAtom = atom(
  null,
  (get, set, sortOrder: 'updated' | 'created') => {
    set(setSessionHistoryLayoutAtom, { sortOrder });
  }
);

/**
 * Set view mode.
 */
export const setViewModeAtom = atom(
  null,
  (get, set, viewMode: 'list' | 'card') => {
    set(setSessionHistoryLayoutAtom, { viewMode });
  }
);

/**
 * Toggle todo panel collapsed state.
 */
export const toggleTodoPanelCollapsedAtom = atom(
  null,
  (get, set) => {
    const current = get(agentModeLayoutAtom);
    const newLayout = { ...current, todoPanelCollapsed: !current.todoPanelCollapsed };

    set(agentModeLayoutAtom, newLayout);

    if (!currentWorkspacePath) {
      throw new Error('[agentMode] Cannot persist layout - initAgentModeLayout not called');
    }
    schedulePersist(currentWorkspacePath, newLayout);
  }
);

/**
 * Toggle teammate panel collapsed state.
 */
export const toggleTeammatePanelCollapsedAtom = atom(
  null,
  (get, set) => {
    const current = get(agentModeLayoutAtom);
    const newLayout = { ...current, teammatePanelCollapsed: !current.teammatePanelCollapsed };

    set(agentModeLayoutAtom, newLayout);

    if (!currentWorkspacePath) {
      throw new Error('[agentMode] Cannot persist layout - initAgentModeLayout not called');
    }
    schedulePersist(currentWorkspacePath, newLayout);
  }
);

/**
 * Toggle agent panel collapsed state.
 */
export const toggleAgentPanelCollapsedAtom = atom(
  null,
  (get, set) => {
    const current = get(agentModeLayoutAtom);
    const newLayout = { ...current, agentPanelCollapsed: !current.agentPanelCollapsed };

    set(agentModeLayoutAtom, newLayout);

    if (!currentWorkspacePath) {
      throw new Error('[agentMode] Cannot persist layout - initAgentModeLayout not called');
    }
    schedulePersist(currentWorkspacePath, newLayout);
  }
);

/**
 * Toggle session history collapsed state.
 * Preserves the width when collapsing and restores it when expanding.
 */
export const toggleSessionHistoryCollapsedAtom = atom(
  null,
  (get, set) => {
    const layout = get(agentModeLayoutAtom).sessionHistoryLayout;
    if (layout.collapsed) {
      // Expanding - restore previous width
      set(setSessionHistoryLayoutAtom, {
        collapsed: false,
        width: layout.preCollapseWidth ?? DEFAULT_SESSION_HISTORY_LAYOUT.width,
      });
    } else {
      // Collapsing - save current width
      set(setSessionHistoryLayoutAtom, {
        collapsed: true,
        preCollapseWidth: layout.width,
      });
    }
  }
);

// ============================================================
// Initialization
// ============================================================

/**
 * Initialize agent mode layout from workspace state.
 * Call this when workspace path is known (typically in useEffect).
 * Restores layout settings and selected workstream.
 */
export async function initAgentModeLayout(workspacePath: string): Promise<void> {
  console.log('[agentMode] initAgentModeLayout called with workspacePath:', workspacePath);
  currentWorkspacePath = workspacePath;

  try {
    const workspaceState = await window.electronAPI.invoke(
      'workspace:get-state',
      workspacePath
    );
    const agenticState = workspaceState?.agenticCodingWindowState;
    const persisted = agenticState as Partial<AgentModeLayout> | undefined;
    // console.log('[agentMode] Full workspace state:', JSON.stringify(persisted, null, 2));

    // Merge persisted state with defaults - same shape, just fill in missing fields
    const restoredLayout = mergeWithDefaults(persisted);
    // console.log('[agentMode] Restored layout:', restoredLayout);
    store.set(agentModeLayoutAtom, restoredLayout);

    // Restore selected workstream if saved (stored alongside layout)
    if (agenticState?.selectedWorkstream) {
      const selection = agenticState.selectedWorkstream as { type: WorkstreamType; id: string };
      store.set(selectedWorkstreamAtom(workspacePath), selection);
    }
  } catch (err) {
    console.error('[agentMode] Failed to load layout:', err);
  }
}
