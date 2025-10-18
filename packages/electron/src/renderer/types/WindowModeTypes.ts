/**
 * Window Mode System Types
 *
 * Defines the structure for managing multiple content modes within a workspace window.
 * Each mode (files, agent, plan) has independent state that is preserved when switching.
 */

import type { TabState } from '../../main/types';

/**
 * Content modes available in workspace windows
 */
export type ContentMode = 'files' | 'agent' | 'plan';

/**
 * Sidebar views (orthogonal to content modes)
 */
export type SidebarView = 'files' | 'plans' | 'settings';

/**
 * Files mode state - the default editing mode with tabs
 */
export interface FilesModeState {
  /** Active tab ID */
  activeTabId: string | null;

  /** All open tabs */
  tabs: TabState[];

  /** Recently closed tabs (for Cmd+Shift+T) */
  closedTabs: TabState[];

  /** Tab order for drag-and-drop reordering */
  tabOrder: string[];

  /** Navigation history for back/forward */
  navigationHistory?: {
    backStack: string[];
    forwardStack: string[];
  };

  /** Current sidebar view */
  sidebarView: SidebarView;

  /** Sidebar width */
  sidebarWidth: number;
}

/**
 * Agent mode state - AI coding interface
 */
export interface AgentModeState {
  /** Whether agent mode is mounted in main window or separate window */
  mountLocation: 'main' | 'window';

  /** Active session ID */
  activeSessionId: string | null;

  /** Open session tabs (agent mode supports multi-tab sessions) */
  sessionTabs: Array<{
    sessionId: string;
    name: string;
    isPinned?: boolean;
  }>;

  /** Recently closed sessions */
  closedSessions: Array<{
    sessionId: string;
    name: string;
  }>;

  /** Session history panel state */
  sessionHistoryLayout: {
    width: number;
    collapsed: boolean;
    collapsedGroups: string[];
  };

  /** Last used plan document path (if opened from plan) */
  lastPlanDocumentPath?: string;
}

/**
 * Plan mode state - plan document viewing/editing interface
 */
export interface PlanModeState {
  /** Active plan document path */
  activePlanPath: string | null;

  /** View mode for plans */
  viewMode: 'edit' | 'preview';

  /** Filter settings for plan list */
  filters?: {
    status?: string[];
    tags?: string[];
    owner?: string;
  };
}

/**
 * Complete workspace window state with mode preservation
 */
export interface WorkspaceWindowState {
  /** Currently active content mode */
  activeMode: ContentMode;

  /** Workspace path */
  workspacePath: string;

  /** Files mode state (preserved when not active) */
  filesMode: FilesModeState;

  /** Agent mode state (preserved when not active) */
  agentMode: AgentModeState;

  /** Plan mode state (preserved when not active) */
  planMode: PlanModeState;

  /** AI Chat panel state (shared across all modes) */
  aiChat: {
    collapsed: boolean;
    width: number;
    currentSessionId: string | null;
    planningModeEnabled: boolean;
  };

  /** Last updated timestamp */
  lastUpdated: number;
}

/**
 * Mode change event data
 */
export interface ModeChangeEvent {
  from: ContentMode;
  to: ContentMode;
  timestamp: number;
}

/**
 * Default state factories
 */
export const createDefaultFilesModeState = (): FilesModeState => ({
  activeTabId: null,
  tabs: [],
  closedTabs: [],
  tabOrder: [],
  navigationHistory: {
    backStack: [],
    forwardStack: []
  },
  sidebarView: 'files',
  sidebarWidth: 250
});

export const createDefaultAgentModeState = (): AgentModeState => ({
  mountLocation: 'main', // Default to main window
  activeSessionId: null,
  sessionTabs: [],
  closedSessions: [],
  sessionHistoryLayout: {
    width: 240,
    collapsed: false,
    collapsedGroups: []
  }
});

export const createDefaultPlanModeState = (): PlanModeState => ({
  activePlanPath: null,
  viewMode: 'edit',
  filters: {}
});

export const createDefaultWorkspaceWindowState = (workspacePath: string): WorkspaceWindowState => ({
  activeMode: 'files', // Start in files mode by default
  workspacePath,
  filesMode: createDefaultFilesModeState(),
  agentMode: createDefaultAgentModeState(),
  planMode: createDefaultPlanModeState(),
  aiChat: {
    collapsed: false,
    width: 350,
    currentSessionId: null,
    planningModeEnabled: true
  },
  lastUpdated: Date.now()
});
