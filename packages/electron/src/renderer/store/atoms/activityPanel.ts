/**
 * Activity Panel Atoms
 *
 * State for the Activity History bottom panel.
 * Follows the same "blob atom" pattern as trackers.ts.
 */

import { atom } from 'jotai';

// ============================================================
// Types
// ============================================================

export interface ActivityPanelLayout {
  /** Whether the panel is open */
  isOpen: boolean;
  /** Panel height in pixels */
  height: number;
}

// ============================================================
// Default Values
// ============================================================

const DEFAULT_LAYOUT: ActivityPanelLayout = {
  isOpen: false,
  height: 300,
};

// Track workspace path for persistence
let currentWorkspacePath: string | null = null;

// ============================================================
// Main Layout Atom
// ============================================================

export const activityPanelLayoutAtom = atom<ActivityPanelLayout>(DEFAULT_LAYOUT);

// ============================================================
// Derived Atoms (read-only slices)
// ============================================================

/** Whether the activity panel is open */
export const isActivityPanelOpenAtom = atom(
  (get) => get(activityPanelLayoutAtom).isOpen
);

/** Activity panel height */
export const activityPanelHeightAtom = atom(
  (get) => get(activityPanelLayoutAtom).height
);

// ============================================================
// Debounced Persistence
// ============================================================

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(workspacePath: string, layout: ActivityPanelLayout): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
  }

  persistTimer = setTimeout(async () => {
    try {
      await window.electronAPI.invoke('workspace:update-state', workspacePath, {
        activityPanelOpen: layout.isOpen,
        activityPanelHeight: layout.height,
      });
    } catch (err) {
      console.error('[activityPanel] Failed to persist layout:', err);
    }
  }, 300);
}

// ============================================================
// Setter Atoms
// ============================================================

/**
 * Update activity panel layout with partial values.
 */
export const setActivityPanelLayoutAtom = atom(
  null,
  (get, set, updates: Partial<ActivityPanelLayout>) => {
    const current = get(activityPanelLayoutAtom);
    const newLayout = { ...current, ...updates };
    set(activityPanelLayoutAtom, newLayout);

    if (currentWorkspacePath) {
      schedulePersist(currentWorkspacePath, newLayout);
    }
  }
);

/**
 * Toggle activity panel open/closed.
 */
export const toggleActivityPanelAtom = atom(null, (get, set) => {
  const current = get(activityPanelLayoutAtom);
  set(setActivityPanelLayoutAtom, { isOpen: !current.isOpen });
});

/**
 * Close activity panel.
 */
export const closeActivityPanelAtom = atom(null, (_get, set) => {
  set(setActivityPanelLayoutAtom, { isOpen: false });
});

/**
 * Set activity panel height.
 */
export const setActivityPanelHeightAtom = atom(
  null,
  (_get, set, height: number) => {
    set(setActivityPanelLayoutAtom, { height });
  }
);

// ============================================================
// Initialization
// ============================================================

/**
 * Initialize activity panel layout from workspace state.
 * Call this when workspace path is known.
 */
export async function initActivityPanelLayout(workspacePath: string): Promise<void> {
  currentWorkspacePath = workspacePath;

  // We don't restore isOpen on load (panel starts closed each session)
  // But we do restore height preference
  try {
    const workspaceState = await window.electronAPI.invoke(
      'workspace:get-state',
      workspacePath
    );

    if (workspaceState?.activityPanelHeight) {
      const { store } = await import('@nimbalyst/runtime/store');
      store.set(activityPanelLayoutAtom, {
        ...DEFAULT_LAYOUT,
        height: workspaceState.activityPanelHeight ?? DEFAULT_LAYOUT.height,
      });
    }
  } catch (err) {
    console.error('[activityPanel] Failed to load layout:', err);
  }
}
