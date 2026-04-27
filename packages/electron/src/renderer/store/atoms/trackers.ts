/**
 * Tracker Atoms
 *
 * State for the tracker system (bugs, plans, tasks, etc.).
 * Uses tracker type as keys for per-tracker-type state.
 */

import { atom } from 'jotai';
import { atomFamily } from '../debug/atomFamilyRegistry';
import { store } from '@nimbalyst/runtime/store';

// ============================================================
// Types
// ============================================================

/**
 * Tracker item types supported by the system.
 */
export type TrackerType = 'bug' | 'plan' | 'task' | 'idea' | 'decision' | 'feature';

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

// Track workspace path for persistence
let currentWorkspacePath: string | null = null;

// ============================================================
// Initialization
// ============================================================

/**
 * Initialize tracker layout from workspace state.
 * Call this when workspace path is known.
 */
export async function initTrackerPanelLayout(workspacePath: string): Promise<void> {
  currentWorkspacePath = workspacePath;

  try {
    const workspaceState = await window.electronAPI.invoke(
      'workspace:get-state',
      workspacePath
    );

    const savedModeLayout = workspaceState?.trackerModeLayout;
    if (savedModeLayout && typeof savedModeLayout === 'object') {
      store.set(trackerModeLayoutAtom, {
        selectedType: savedModeLayout.selectedType ?? DEFAULT_MODE_LAYOUT.selectedType,
        activeFilters: Array.isArray(savedModeLayout.activeFilters)
          ? savedModeLayout.activeFilters
          : DEFAULT_MODE_LAYOUT.activeFilters,
        viewMode: savedModeLayout.viewMode ?? DEFAULT_MODE_LAYOUT.viewMode,
        selectedItemId: savedModeLayout.selectedItemId ?? DEFAULT_MODE_LAYOUT.selectedItemId,
        sidebarWidth: savedModeLayout.sidebarWidth ?? DEFAULT_MODE_LAYOUT.sidebarWidth,
        detailPanelWidth: savedModeLayout.detailPanelWidth ?? DEFAULT_MODE_LAYOUT.detailPanelWidth,
        typeColumnConfigs: savedModeLayout.typeColumnConfigs ?? DEFAULT_MODE_LAYOUT.typeColumnConfigs,
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
export type TrackerFilterChip = 'mine' | 'unassigned' | 'high-priority' | 'recently-updated' | 'archived';

/** Per-type column configuration (re-exported from runtime) */
export type { TypeColumnConfig } from '@nimbalyst/runtime/plugins/TrackerPlugin/components/trackerColumns';
import type { TypeColumnConfig } from '@nimbalyst/runtime/plugins/TrackerPlugin/components/trackerColumns';

export interface TrackerModeLayout {
  /** Selected type filter in sidebar ('all' or specific type) */
  selectedType: string;
  /** Active filter chips (empty = show all, multiple = intersection) */
  activeFilters: TrackerFilterChip[];
  /** Table or kanban display */
  viewMode: 'table' | 'kanban';
  /** Currently selected tracker item ID (opens detail panel when non-null) */
  selectedItemId: string | null;
  /** Sidebar width in pixels */
  sidebarWidth: number;
  /** Detail panel width in pixels */
  detailPanelWidth: number;
  /** Per-type column configuration (keyed by tracker type, 'all' for the all-types view) */
  typeColumnConfigs: Record<string, TypeColumnConfig>;
}

const DEFAULT_MODE_LAYOUT: TrackerModeLayout = {
  selectedType: 'all',
  activeFilters: [],
  viewMode: 'table',
  selectedItemId: null,
  sidebarWidth: 220,
  detailPanelWidth: 400,
  typeColumnConfigs: {},
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
  feature: 0,
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
  const types: TrackerType[] = ['bug', 'plan', 'task', 'idea', 'decision', 'feature'];
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
