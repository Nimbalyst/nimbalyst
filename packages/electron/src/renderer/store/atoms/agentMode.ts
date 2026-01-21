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
import { store } from '@nimbalyst/runtime/store';
import { selectedWorkstreamAtom, type WorkstreamType } from './sessions';

// ============================================================
// Types
// ============================================================

export interface AgentModeLayout {
  /** Width of the session history panel in pixels */
  sessionHistoryWidth: number;
  /** Whether session history is collapsed (always false in agent mode) */
  sessionHistoryCollapsed: boolean;
  /** Array of collapsed group keys (time groups like 'today', 'yesterday') */
  collapsedGroups: string[];
  /** Sort order for sessions */
  sortOrder: 'updated' | 'created';
}

// ============================================================
// Main Layout Atom
// ============================================================

const DEFAULT_LAYOUT: AgentModeLayout = {
  sessionHistoryWidth: 240,
  sessionHistoryCollapsed: false,
  collapsedGroups: [],
  sortOrder: 'updated',
};

/**
 * Main atom for agent mode layout state.
 * Contains all layout-related state in a single object.
 */
export const agentModeLayoutAtom = atom<AgentModeLayout>(DEFAULT_LAYOUT);

// Track workspace path for persistence
const agentModeWorkspaceAtom = atom<string | null>(null);

// ============================================================
// Derived Atoms (read-only slices)
// ============================================================

/** Session history panel width */
export const sessionHistoryWidthAtom = atom(
  (get) => get(agentModeLayoutAtom).sessionHistoryWidth
);

/** Whether session history is collapsed */
export const sessionHistoryCollapsedAtom = atom(
  (get) => get(agentModeLayoutAtom).sessionHistoryCollapsed
);

/** Collapsed group keys */
export const collapsedGroupsAtom = atom(
  (get) => get(agentModeLayoutAtom).collapsedGroups
);

/** Sort order for sessions */
export const sortOrderAtom = atom(
  (get) => get(agentModeLayoutAtom).sortOrder
);

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
      await window.electronAPI.invoke('workspace:update-state', workspacePath, {
        agenticCodingWindowState: {
          sessionHistoryLayout: {
            width: layout.sessionHistoryWidth,
            // Never save collapsed=true for agent mode - panel must always be visible
            collapsed: false,
            collapsedGroups: layout.collapsedGroups,
            sortOrder: layout.sortOrder,
          },
        },
      });
    } catch (err) {
      console.error('[agentMode] Failed to persist layout:', err);
    }
  }, 500);
}

// ============================================================
// Setter Atoms
// ============================================================

/**
 * Update agent mode layout with partial values.
 * Automatically persists to workspace state (debounced).
 */
export const setAgentModeLayoutAtom = atom(
  null,
  (get, set, updates: Partial<AgentModeLayout>) => {
    const current = get(agentModeLayoutAtom);
    const newLayout = { ...current, ...updates };

    // Enforce: session history can never be collapsed in agent mode
    if (newLayout.sessionHistoryCollapsed) {
      newLayout.sessionHistoryCollapsed = false;
    }

    set(agentModeLayoutAtom, newLayout);

    // Schedule persistence
    const workspacePath = get(agentModeWorkspaceAtom);
    if (workspacePath) {
      schedulePersist(workspacePath, newLayout);
    }
  }
);

/**
 * Set session history width.
 */
export const setSessionHistoryWidthAtom = atom(
  null,
  (get, set, width: number) => {
    set(setAgentModeLayoutAtom, { sessionHistoryWidth: width });
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
    set(setAgentModeLayoutAtom, { collapsedGroups: newGroups });
  }
);

/**
 * Set collapsed groups directly.
 */
export const setCollapsedGroupsAtom = atom(
  null,
  (get, set, groups: string[]) => {
    set(setAgentModeLayoutAtom, { collapsedGroups: groups });
  }
);

/**
 * Set sort order.
 */
export const setSortOrderAtom = atom(
  null,
  (get, set, sortOrder: 'updated' | 'created') => {
    set(setAgentModeLayoutAtom, { sortOrder });
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
  store.set(agentModeWorkspaceAtom, workspacePath);

  try {
    const workspaceState = await window.electronAPI.invoke(
      'workspace:get-state',
      workspacePath
    );
    const result = workspaceState?.agenticCodingWindowState;

    if (result?.sessionHistoryLayout) {
      const layout = result.sessionHistoryLayout;
      store.set(agentModeLayoutAtom, {
        sessionHistoryWidth: layout.width ?? DEFAULT_LAYOUT.sessionHistoryWidth,
        // CRITICAL: Never collapse SessionHistory in agent mode
        sessionHistoryCollapsed: false,
        collapsedGroups: layout.collapsedGroups ?? DEFAULT_LAYOUT.collapsedGroups,
        sortOrder: layout.sortOrder ?? DEFAULT_LAYOUT.sortOrder,
      });
    }

    // Restore selected workstream if saved
    if (result?.selectedWorkstream) {
      const selection = result.selectedWorkstream as { type: WorkstreamType; id: string };
      store.set(selectedWorkstreamAtom(workspacePath), selection);
    }
  } catch (err) {
    console.error('[agentMode] Failed to load layout:', err);
  }
}
