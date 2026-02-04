/**
 * Project State Atom
 *
 * Unified project state persisted as a single blob via IPC.
 * This consolidates all window-level state that should survive app restart.
 *
 * Key principles:
 * - Single IPC call for persistence (atomic load/save)
 * - Debounced writes to avoid excessive IPC traffic
 * - Derived atoms for specific pieces (read-only slices)
 * - Setter atoms that update slice and trigger persist
 */

import { atom } from 'jotai';
import type { EditorKey, EditorContext } from '@nimbalyst/runtime/store';
import type { TrackerType } from './trackers';

/**
 * Tab information for persistence.
 */
export interface PersistedTabInfo {
  key: EditorKey;
  isPinned: boolean;
}

/**
 * Per-context tab state.
 */
export interface ContextTabState {
  tabs: PersistedTabInfo[];
  activeTabKey: EditorKey | null;
}

/**
 * Panel layout configuration.
 */
export interface PanelLayout {
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  aiPanelWidth: number;
  aiPanelCollapsed: boolean;
  bottomPanelHeight: number;
  bottomPanelType: TrackerType | null;
}

/**
 * File tree UI state.
 */
export interface FileTreeState {
  expandedDirs: string[];
  activeFilter: string | null;
}

/**
 * Diff tree view settings.
 */
export interface DiffTreeState {
  groupByDirectory: boolean;
}

/**
 * File scope mode for the Files Edited sidebar in agent mode.
 * - current-changes: Show only files with uncommitted git changes (default)
 * - session-files: Show all files touched in this session/workstream
 * - all-changes: Show all uncommitted files in the repository
 */
export type AgentFileScopeMode = 'current-changes' | 'session-files' | 'all-changes';

/**
 * Agent mode settings for the Files Edited sidebar.
 */
export interface AgentModeSettings {
  fileScopeMode: AgentFileScopeMode;
}

/**
 * Complete project state for persistence.
 */
export interface ProjectState {
  version: number; // Schema version for migrations
  contexts: Record<EditorContext, ContextTabState>;
  layout: PanelLayout;
  fileTree: FileTreeState;
  diffTree: DiffTreeState;
  agentMode: AgentModeSettings;
  lastOpenedFile: string | null;
  recentFiles: string[];
}

/**
 * Default project state values.
 */
const defaultProjectState: ProjectState = {
  version: 1,
  contexts: {
    main: {
      tabs: [],
      activeTabKey: null,
    },
  },
  layout: {
    sidebarWidth: 250,
    sidebarCollapsed: false,
    aiPanelWidth: 400,
    aiPanelCollapsed: true,
    bottomPanelHeight: 200,
    bottomPanelType: null,
  },
  fileTree: {
    expandedDirs: [],
    activeFilter: null,
  },
  diffTree: {
    groupByDirectory: true,
  },
  agentMode: {
    fileScopeMode: 'session-files', // Default to showing all session edits
  },
  lastOpenedFile: null,
  recentFiles: [],
};

/**
 * The main project state atom.
 * Should be initialized from IPC on window load.
 */
export const projectStateAtom = atom<ProjectState>(defaultProjectState);

/**
 * Debounce timer for persistence.
 */
let persistDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const PERSIST_DEBOUNCE_MS = 1000;

/**
 * Persist project state to main process.
 * Debounced to avoid excessive IPC calls during rapid changes.
 */
function schedulePersist(state: ProjectState): void {
  if (persistDebounceTimer) {
    clearTimeout(persistDebounceTimer);
  }
  persistDebounceTimer = setTimeout(() => {
    persistDebounceTimer = null;
    // Only persist if electronAPI is available (not in tests)
    if (typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.send('project-state:save', state);
    }
  }, PERSIST_DEBOUNCE_MS);
}

/**
 * Force immediate persist (e.g., on window close).
 */
export function persistNow(state: ProjectState): void {
  if (persistDebounceTimer) {
    clearTimeout(persistDebounceTimer);
    persistDebounceTimer = null;
  }
  if (typeof window !== 'undefined' && window.electronAPI) {
    window.electronAPI.send('project-state:save', state);
  }
}

// === Derived read-only atoms (slices) ===

/**
 * Sidebar width.
 */
export const sidebarWidthAtom = atom(
  (get) => get(projectStateAtom).layout.sidebarWidth
);

/**
 * Sidebar collapsed state.
 */
export const sidebarCollapsedAtom = atom(
  (get) => get(projectStateAtom).layout.sidebarCollapsed
);

/**
 * AI panel width.
 */
export const aiPanelWidthAtom = atom(
  (get) => get(projectStateAtom).layout.aiPanelWidth
);

/**
 * AI panel collapsed state.
 */
export const aiPanelCollapsedAtom = atom(
  (get) => get(projectStateAtom).layout.aiPanelCollapsed
);

/**
 * Bottom panel height.
 */
export const bottomPanelHeightAtom = atom(
  (get) => get(projectStateAtom).layout.bottomPanelHeight
);

/**
 * Bottom panel type.
 */
export const bottomPanelTypeAtom = atom(
  (get) => get(projectStateAtom).layout.bottomPanelType
);

/**
 * File tree expanded directories.
 */
export const persistedExpandedDirsAtom = atom(
  (get) => get(projectStateAtom).fileTree.expandedDirs
);

/**
 * Recent files list.
 */
export const recentFilesAtom = atom((get) => get(projectStateAtom).recentFiles);

/**
 * Diff tree group by directory setting.
 */
export const diffTreeGroupByDirectoryAtom = atom(
  (get) => get(projectStateAtom).diffTree.groupByDirectory
);

/**
 * Agent mode file scope mode setting.
 * Workspace-level setting that persists across all sessions.
 */
export const agentFileScopeModeAtom = atom(
  (get) => get(projectStateAtom).agentMode.fileScopeMode
);

// === Setter atoms (update slice + trigger persist) ===

/**
 * Set sidebar width.
 */
export const setSidebarWidthAtom = atom(
  null,
  (get, set, width: number) => {
    const state = get(projectStateAtom);
    const newState = {
      ...state,
      layout: { ...state.layout, sidebarWidth: width },
    };
    set(projectStateAtom, newState);
    schedulePersist(newState);
  }
);

/**
 * Set sidebar collapsed.
 */
export const setSidebarCollapsedAtom = atom(
  null,
  (get, set, collapsed: boolean) => {
    const state = get(projectStateAtom);
    const newState = {
      ...state,
      layout: { ...state.layout, sidebarCollapsed: collapsed },
    };
    set(projectStateAtom, newState);
    schedulePersist(newState);
  }
);

/**
 * Set AI panel width.
 */
export const setAiPanelWidthAtom = atom(null, (get, set, width: number) => {
  const state = get(projectStateAtom);
  const newState = {
    ...state,
    layout: { ...state.layout, aiPanelWidth: width },
  };
  set(projectStateAtom, newState);
  schedulePersist(newState);
});

/**
 * Set AI panel collapsed.
 */
export const setAiPanelCollapsedAtom = atom(
  null,
  (get, set, collapsed: boolean) => {
    const state = get(projectStateAtom);
    const newState = {
      ...state,
      layout: { ...state.layout, aiPanelCollapsed: collapsed },
    };
    set(projectStateAtom, newState);
    schedulePersist(newState);
  }
);

/**
 * Set bottom panel height.
 */
export const setBottomPanelHeightAtom = atom(
  null,
  (get, set, height: number) => {
    const state = get(projectStateAtom);
    const newState = {
      ...state,
      layout: { ...state.layout, bottomPanelHeight: height },
    };
    set(projectStateAtom, newState);
    schedulePersist(newState);
  }
);

/**
 * Set bottom panel type.
 */
export const setBottomPanelTypeAtom = atom(
  null,
  (get, set, type: TrackerType | null) => {
    const state = get(projectStateAtom);
    const newState = {
      ...state,
      layout: { ...state.layout, bottomPanelType: type },
    };
    set(projectStateAtom, newState);
    schedulePersist(newState);
  }
);

/**
 * Update file tree expanded directories.
 */
export const setExpandedDirsAtom = atom(null, (get, set, dirs: string[]) => {
  const state = get(projectStateAtom);
  const newState = {
    ...state,
    fileTree: { ...state.fileTree, expandedDirs: dirs },
  };
  set(projectStateAtom, newState);
  schedulePersist(newState);
});

/**
 * Set diff tree group by directory.
 * Also persists to workspace state via IPC.
 */
export const setDiffTreeGroupByDirectoryAtom = atom(
  null,
  (get, set, payload: { groupByDirectory: boolean; workspacePath: string }) => {
    const { groupByDirectory, workspacePath } = payload;
    const state = get(projectStateAtom);
    const newState = {
      ...state,
      diffTree: { ...state.diffTree, groupByDirectory },
    };
    set(projectStateAtom, newState);
    // Persist to workspace state via IPC
    if (workspacePath && typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.invoke('workspace:update-state', workspacePath, {
        diffTreeGroupByDirectory: groupByDirectory,
      }).catch((err: unknown) => {
        console.error('[projectState] Failed to persist diffTreeGroupByDirectory:', err);
      });
    }
  }
);

/**
 * Set agent file scope mode.
 * Also persists to workspace state via IPC.
 */
export const setAgentFileScopeModeAtom = atom(
  null,
  (get, set, payload: { fileScopeMode: AgentFileScopeMode; workspacePath: string }) => {
    const { fileScopeMode, workspacePath } = payload;
    const state = get(projectStateAtom);
    const newState = {
      ...state,
      agentMode: { ...state.agentMode, fileScopeMode },
    };
    set(projectStateAtom, newState);
    // Persist to workspace state via IPC
    if (workspacePath && typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.invoke('workspace:update-state', workspacePath, {
        agentFileScopeMode: fileScopeMode,
      }).catch((err: unknown) => {
        console.error('[projectState] Failed to persist agentFileScopeMode:', err);
      });
    }
  }
);

/**
 * Add a file to recent files.
 */
export const addRecentFileAtom = atom(null, (get, set, filePath: string) => {
  const state = get(projectStateAtom);
  const recentFiles = state.recentFiles.filter((f) => f !== filePath);
  recentFiles.unshift(filePath);
  // Keep only last 20
  const newRecentFiles = recentFiles.slice(0, 20);
  const newState = {
    ...state,
    recentFiles: newRecentFiles,
    lastOpenedFile: filePath,
  };
  set(projectStateAtom, newState);
  schedulePersist(newState);
});

/**
 * Update tabs for a context.
 */
export const updateContextTabsAtom = atom(
  null,
  (
    get,
    set,
    {
      context,
      tabs,
      activeTabKey,
    }: {
      context: EditorContext;
      tabs: PersistedTabInfo[];
      activeTabKey: EditorKey | null;
    }
  ) => {
    const state = get(projectStateAtom);
    const newState = {
      ...state,
      contexts: {
        ...state.contexts,
        [context]: { tabs, activeTabKey },
      },
    };
    set(projectStateAtom, newState);
    schedulePersist(newState);
  }
);

/**
 * Load project state from persisted data.
 * Called on window init with data from main process.
 */
export const loadProjectStateAtom = atom(
  null,
  (_get, set, state: Partial<ProjectState>) => {
    // Merge with defaults to handle missing fields from older versions
    const merged: ProjectState = {
      ...defaultProjectState,
      ...state,
      layout: { ...defaultProjectState.layout, ...state.layout },
      fileTree: { ...defaultProjectState.fileTree, ...state.fileTree },
      diffTree: { ...defaultProjectState.diffTree, ...state.diffTree },
      agentMode: { ...defaultProjectState.agentMode, ...state.agentMode },
      contexts: { ...defaultProjectState.contexts, ...state.contexts },
    };
    set(projectStateAtom, merged);
  }
);

/**
 * Reset to default state.
 */
export const resetProjectStateAtom = atom(null, (_get, set) => {
  set(projectStateAtom, defaultProjectState);
  schedulePersist(defaultProjectState);
});
