/**
 * Tracker Atoms
 *
 * State for the tracker system (bugs, plans, tasks, etc.) in the bottom panel.
 * Uses tracker type as keys for per-tracker-type state.
 *
 * Pattern: "blob atom" for layout state with persistence,
 * separate atoms for tracker data (counts, items).
 */

import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import { store } from '@nimbalyst/runtime/store';

// ============================================================
// Types
// ============================================================

/**
 * Tracker item types supported by the system.
 */
export type TrackerType = 'bug' | 'plan' | 'task' | 'idea' | 'decision';

/**
 * Status values for tracker items.
 */
export type TrackerStatus =
  | 'open'
  | 'in-progress'
  | 'in-review'
  | 'completed'
  | 'blocked'
  | 'rejected';

/**
 * Tracker item data structure.
 */
export interface TrackerItem {
  id: string;
  type: TrackerType;
  title: string;
  description?: string;
  status: TrackerStatus;
  priority: 'low' | 'medium' | 'high' | 'critical';
  filePath: string;
  createdAt: number;
  updatedAt: number;
  tags: string[];
}

/**
 * Tracker panel layout state.
 * This shape is used both at runtime and for persistence.
 */
export interface TrackerPanelLayout {
  /** Currently active tracker type, null = panel closed */
  activeType: TrackerType | null;
  /** Last active type - used to restore when panel reopens */
  lastActiveType: TrackerType;
  /** Panel height in pixels */
  height: number;
  /** Whether settings view is shown */
  settingsVisible: boolean;
}

// ============================================================
// Default Values
// ============================================================

const DEFAULT_LAYOUT: TrackerPanelLayout = {
  activeType: null,
  lastActiveType: 'plan',
  height: 300,
  settingsVisible: false,
};

// Track workspace path for persistence
let currentWorkspacePath: string | null = null;

// ============================================================
// Main Layout Atom
// ============================================================

/**
 * Main atom for tracker panel layout state.
 */
export const trackerPanelLayoutAtom = atom<TrackerPanelLayout>(DEFAULT_LAYOUT);

// ============================================================
// Derived Atoms (read-only slices)
// ============================================================

/** Currently active tracker type (null = panel closed) */
export const activeTrackerTypeAtom = atom(
  (get) => get(trackerPanelLayoutAtom).activeType
);

/** Last active tracker type */
export const lastActiveTrackerTypeAtom = atom(
  (get) => get(trackerPanelLayoutAtom).lastActiveType
);

/** Tracker panel height */
export const trackerPanelHeightAtom = atom(
  (get) => get(trackerPanelLayoutAtom).height
);

/** Whether settings view is visible */
export const trackerSettingsVisibleAtom = atom(
  (get) => get(trackerPanelLayoutAtom).settingsVisible
);

/** Whether the tracker panel is open */
export const trackerPanelOpenAtom = atom(
  (get) => get(trackerPanelLayoutAtom).activeType !== null
);

// ============================================================
// Debounced Persistence
// ============================================================

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(workspacePath: string, layout: TrackerPanelLayout): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
  }

  persistTimer = setTimeout(async () => {
    try {
      await window.electronAPI.invoke('workspace:update-state', workspacePath, {
        trackerBottomPanel: layout.activeType,
        trackerBottomPanelHeight: layout.height,
        lastActiveTrackerType: layout.activeType || layout.lastActiveType,
      });
    } catch (err) {
      console.error('[trackers] Failed to persist layout:', err);
    }
  }, 300);
}

// ============================================================
// Setter Atoms
// ============================================================

/**
 * Update tracker panel layout with partial values.
 */
export const setTrackerPanelLayoutAtom = atom(
  null,
  (get, set, updates: Partial<TrackerPanelLayout>) => {
    const current = get(trackerPanelLayoutAtom);
    const newLayout = { ...current, ...updates };

    // Auto-update lastActiveType when activeType changes to non-null
    if (updates.activeType !== undefined && updates.activeType !== null) {
      newLayout.lastActiveType = updates.activeType;
    }

    set(trackerPanelLayoutAtom, newLayout);

    if (currentWorkspacePath) {
      schedulePersist(currentWorkspacePath, newLayout);
    }
  }
);

/**
 * Set active tracker type directly.
 */
export const setActiveTrackerTypeAtom = atom(
  null,
  (get, set, type: TrackerType | null) => {
    set(setTrackerPanelLayoutAtom, { activeType: type });
  }
);

/**
 * Set tracker panel height.
 */
export const setTrackerPanelHeightAtom = atom(
  null,
  (_get, set, height: number) => {
    set(setTrackerPanelLayoutAtom, { height });
  }
);

/**
 * Toggle settings view visibility.
 */
export const toggleTrackerSettingsAtom = atom(
  null,
  (get, set) => {
    const current = get(trackerPanelLayoutAtom);
    set(setTrackerPanelLayoutAtom, { settingsVisible: !current.settingsVisible });
  }
);

/**
 * Toggle tracker panel - smart toggle behavior:
 * - If closed: open to last active type (or requested type)
 * - If open on different type: switch to requested type
 * - If open on same type: close
 */
export const toggleTrackerPanelAtom = atom(
  null,
  (get, set, requestedType?: TrackerType) => {
    const layout = get(trackerPanelLayoutAtom);

    if (layout.activeType === null) {
      // Panel is closed - open to last active or requested type
      const typeToOpen = requestedType || layout.lastActiveType;
      set(setTrackerPanelLayoutAtom, { activeType: typeToOpen });
    } else if (requestedType && layout.activeType !== requestedType) {
      // Panel is open but on different type - switch to requested type
      set(setTrackerPanelLayoutAtom, { activeType: requestedType });
    } else {
      // Panel is open on same type (or no type requested) - close it
      set(setTrackerPanelLayoutAtom, { activeType: null });
    }
  }
);

/**
 * Close tracker panel.
 */
export const closeTrackerPanelAtom = atom(null, (_get, set) => {
  set(setTrackerPanelLayoutAtom, { activeType: null });
});

// ============================================================
// Initialization
// ============================================================

/**
 * Initialize tracker panel layout from workspace state.
 * Call this when workspace path is known.
 */
export async function initTrackerPanelLayout(workspacePath: string): Promise<void> {
  currentWorkspacePath = workspacePath;

  try {
    const workspaceState = await window.electronAPI.invoke(
      'workspace:get-state',
      workspacePath
    );

    const restoredLayout: TrackerPanelLayout = {
      activeType: workspaceState?.trackerBottomPanel ?? DEFAULT_LAYOUT.activeType,
      lastActiveType: workspaceState?.lastActiveTrackerType ?? DEFAULT_LAYOUT.lastActiveType,
      height: workspaceState?.trackerBottomPanelHeight ?? DEFAULT_LAYOUT.height,
      settingsVisible: DEFAULT_LAYOUT.settingsVisible, // Don't persist settings view
    };

    store.set(trackerPanelLayoutAtom, restoredLayout);

    // Also restore tracker mode layout
    const savedModeLayout = workspaceState?.trackerModeLayout;
    if (savedModeLayout && typeof savedModeLayout === 'object') {
      store.set(trackerModeLayoutAtom, {
        selectedType: savedModeLayout.selectedType ?? DEFAULT_MODE_LAYOUT.selectedType,
        activeFilters: Array.isArray(savedModeLayout.activeFilters)
          ? savedModeLayout.activeFilters
          : DEFAULT_MODE_LAYOUT.activeFilters,
        viewMode: savedModeLayout.viewMode ?? DEFAULT_MODE_LAYOUT.viewMode,
        selectedItemId: savedModeLayout.selectedItemId ?? DEFAULT_MODE_LAYOUT.selectedItemId,
      });
    }
  } catch (err) {
    console.error('[trackers] Failed to load layout:', err);
  }
}

// ============================================================
// Tracker Mode State (full-screen mode)
// ============================================================

/**
 * Tracker mode layout state.
 * Persisted to workspace state so it survives app restarts.
 */
/** Filter chips that can be toggled independently */
export type TrackerFilterChip = 'mine' | 'high-priority' | 'recently-updated' | 'archived';

export interface TrackerModeLayout {
  /** Selected type filter in sidebar ('all' or specific type) */
  selectedType: string;
  /** Active filter chips (empty = show all, multiple = intersection) */
  activeFilters: TrackerFilterChip[];
  /** Table or kanban display */
  viewMode: 'table' | 'kanban';
  /** Currently selected tracker item ID (opens detail panel when non-null) */
  selectedItemId: string | null;
}

const DEFAULT_MODE_LAYOUT: TrackerModeLayout = {
  selectedType: 'all',
  activeFilters: [],
  viewMode: 'table',
  selectedItemId: null,
};

/** Main atom for tracker mode layout. */
export const trackerModeLayoutAtom = atom<TrackerModeLayout>(DEFAULT_MODE_LAYOUT);

/** Selected type in tracker mode sidebar. */
export const trackerModeSelectedTypeAtom = atom(
  (get) => get(trackerModeLayoutAtom).selectedType
);

/** Active filter chips in tracker mode sidebar. */
export const trackerModeActiveFiltersAtom = atom(
  (get) => get(trackerModeLayoutAtom).activeFilters
);

/** View mode (table/kanban) in tracker mode. */
export const trackerModeViewModeAtom = atom(
  (get) => get(trackerModeLayoutAtom).viewMode
);

/** Currently selected item ID in tracker mode (opens detail panel). */
export const trackerModeSelectedItemIdAtom = atom(
  (get) => get(trackerModeLayoutAtom).selectedItemId
);

let modeLayoutPersistTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleModeLayoutPersist(workspacePath: string, layout: TrackerModeLayout): void {
  if (modeLayoutPersistTimer) clearTimeout(modeLayoutPersistTimer);
  modeLayoutPersistTimer = setTimeout(async () => {
    try {
      await window.electronAPI.invoke('workspace:update-state', workspacePath, {
        trackerModeLayout: layout,
      });
    } catch (err) {
      console.error('[trackers] Failed to persist mode layout:', err);
    }
  }, 300);
}

/** Update tracker mode layout with partial values and persist. */
export const setTrackerModeLayoutAtom = atom(
  null,
  (get, set, updates: Partial<TrackerModeLayout>) => {
    const current = get(trackerModeLayoutAtom);
    const newLayout = { ...current, ...updates };
    set(trackerModeLayoutAtom, newLayout);

    if (currentWorkspacePath) {
      scheduleModeLayoutPersist(currentWorkspacePath, newLayout);
    }
  }
);

// ============================================================
// Tracker Data Atoms (separate from layout)
// ============================================================

/**
 * Counts by tracker type.
 */
export const trackerCountsAtom = atom<Record<TrackerType, number>>({
  bug: 0,
  plan: 0,
  task: 0,
  idea: 0,
  decision: 0,
});

/**
 * Per-type tracker count.
 */
export const trackerCountAtom = atomFamily((type: TrackerType) =>
  atom((get) => {
    const counts = get(trackerCountsAtom);
    return counts[type] ?? 0;
  })
);

/**
 * Items per tracker type.
 */
export const trackerItemsAtom = atomFamily((_type: TrackerType) =>
  atom<TrackerItem[]>([])
);

/**
 * Currently selected tracker item ID.
 */
export const selectedTrackerItemAtom = atom<string | null>(null);

/**
 * Filter state per tracker type.
 */
export interface TrackerFilter {
  status?: TrackerStatus[];
  priority?: TrackerItem['priority'][];
  tags?: string[];
  search?: string;
}

export const trackerFilterAtom = atomFamily((_type: TrackerType) =>
  atom<TrackerFilter>({})
);

/**
 * Derived: filtered items for a tracker type.
 */
export const filteredTrackerItemsAtom = atomFamily((type: TrackerType) =>
  atom((get) => {
    const items = get(trackerItemsAtom(type));
    const filter = get(trackerFilterAtom(type));

    let filtered = items;

    if (filter.status && filter.status.length > 0) {
      filtered = filtered.filter((item) => filter.status!.includes(item.status));
    }

    if (filter.priority && filter.priority.length > 0) {
      filtered = filtered.filter((item) =>
        filter.priority!.includes(item.priority)
      );
    }

    if (filter.tags && filter.tags.length > 0) {
      filtered = filtered.filter((item) =>
        filter.tags!.some((tag) => item.tags.includes(tag))
      );
    }

    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      filtered = filtered.filter(
        (item) =>
          item.title.toLowerCase().includes(searchLower) ||
          item.description?.toLowerCase().includes(searchLower)
      );
    }

    return filtered;
  })
);

/**
 * Derived: total open items across all tracker types.
 */
export const totalOpenItemsAtom = atom((get) => {
  const counts = get(trackerCountsAtom);
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
});

/**
 * Derived: critical/high priority items count.
 */
export const criticalItemsCountAtom = atom((get) => {
  let count = 0;
  const types: TrackerType[] = ['bug', 'plan', 'task', 'idea', 'decision'];
  for (const type of types) {
    const items = get(trackerItemsAtom(type));
    count += items.filter(
      (item) =>
        (item.priority === 'critical' || item.priority === 'high') &&
        item.status !== 'completed' &&
        item.status !== 'rejected'
    ).length;
  }
  return count;
});

// ============================================================
// Action Atoms for Tracker Data
// ============================================================

/**
 * Update counts for all tracker types.
 */
export const updateTrackerCountsAtom = atom(
  null,
  (_get, set, counts: Record<TrackerType, number>) => {
    set(trackerCountsAtom, counts);
  }
);

/**
 * Update items for a tracker type.
 */
export const updateTrackerItemsAtom = atom(
  null,
  (
    _get,
    set,
    { type, items }: { type: TrackerType; items: TrackerItem[] }
  ) => {
    set(trackerItemsAtom(type), items);
  }
);

/**
 * Set filter for a tracker type.
 */
export const setTrackerFilterAtom = atom(
  null,
  (
    _get,
    set,
    { type, filter }: { type: TrackerType; filter: TrackerFilter }
  ) => {
    set(trackerFilterAtom(type), filter);
  }
);

/**
 * Clear filter for a tracker type.
 */
export const clearTrackerFilterAtom = atom(
  null,
  (_get, set, type: TrackerType) => {
    set(trackerFilterAtom(type), {});
  }
);
