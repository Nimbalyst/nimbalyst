import Store from 'electron-store';
import { existsSync } from 'fs';
import { RecentItem, SessionState, SessionWindow } from '../types';
import { logger } from './logger';

type AppTheme = 'dark' | 'light' | 'system' | 'crystal-dark';

interface AppStoreSchema {
  theme: AppTheme;
  recent: {
    workspaces: RecentItem[];
    documents: RecentItem[];
  };
  openWorkspaces: Array<{ path: string; windowId?: number }>;
  sessionState?: SessionState;
  loggerConfig?: unknown;
}

export interface TabState {
  id: string;
  filePath: string;
  fileName: string;
  isDirty: boolean;
  isPinned: boolean;
  lastSaved?: string;
}

export interface TabManagerState {
  tabs: TabState[];
  activeTabId: string | null;
  tabOrder: string[];
}

export interface WorkspaceAIPanelState {
  collapsed: boolean;
  width: number;
  currentSessionId?: string;
  draftInput?: string;
}

export interface NavigationHistoryState {
  history: Array<{ tabId: string; timestamp: number }>;
  currentIndex: number;
}

export interface AgenticCodingWindowState {
  bounds?: { width: number; height: number; x?: number; y?: number };
  devToolsOpen?: boolean;
}

export interface WorkspaceState {
  workspacePath: string;
  windowState?: SessionWindow;
  agenticCodingWindowState?: AgenticCodingWindowState;
  sidebarWidth: number;
  recentDocuments: string[];
  tabs: TabManagerState;
  aiPanel: WorkspaceAIPanelState;
  navigationHistory?: NavigationHistoryState;
  lastUpdated: number;
}

const appStore = new Store<AppStoreSchema>({
  name: 'app-settings',
  clearInvalidConfig: true,
  defaults: {
    theme: 'system',
    recent: {
      workspaces: [],
      documents: [],
    },
    openWorkspaces: [],
  },
});

const workspaceStore = new Store<Record<string, WorkspaceState>>({
  name: 'workspace-settings',
  clearInvalidConfig: true,
  defaults: {},
});

const DEFAULT_TAB_MANAGER_STATE: TabManagerState = {
  tabs: [],
  activeTabId: null,
  tabOrder: [],
};

const DEFAULT_AI_PANEL_STATE: WorkspaceAIPanelState = {
  collapsed: false,
  width: 350,
};

function workspaceKey(path: string): string {
  if (!path) {
    throw new Error('[store] workspacePath is required');
  }
  const base64 = Buffer.from(path).toString('base64url');
  return `ws:${base64}`;
}

function normalizeWorkspaceState(raw: any, path: string): WorkspaceState {
  if (!raw) {
    return {
      workspacePath: path,
      windowState: undefined,
      agenticCodingWindowState: undefined,
      sidebarWidth: 240,
      recentDocuments: [],
      tabs: { ...DEFAULT_TAB_MANAGER_STATE },
      aiPanel: { ...DEFAULT_AI_PANEL_STATE },
      navigationHistory: undefined,
      lastUpdated: Date.now(),
    };
  }

  const fallbackTabs = raw?.tabs ?? raw?.documents;
  const openTabs: TabState[] = Array.isArray(fallbackTabs?.openTabs)
    ? fallbackTabs.openTabs.map((tab: any) => ({ ...tab }))
    : Array.isArray(fallbackTabs?.tabs)
      ? fallbackTabs.tabs.map((tab: any) => ({ ...tab }))
      : [];

  const aiPanelRaw = raw?.aiPanel ?? raw?.ai_chat ?? {};

  // Parse navigation history if present
  let navigationHistory: NavigationHistoryState | undefined;
  if (raw.navigationHistory) {
    navigationHistory = {
      history: Array.isArray(raw.navigationHistory.history) ? raw.navigationHistory.history : [],
      currentIndex: raw.navigationHistory.currentIndex ?? -1
    };
  }

  return {
    workspacePath: raw.workspacePath ?? raw.workspace_path ?? path,
    windowState: raw.windowState ?? raw.window_state ?? undefined,
    agenticCodingWindowState: raw.agenticCodingWindowState ? { ...raw.agenticCodingWindowState } : undefined,
    sidebarWidth: raw.sidebarWidth ?? raw.uiState?.sidebarWidth ?? raw.ui_state?.sidebarWidth ?? 240,
    recentDocuments: Array.isArray(raw.recentDocuments)
      ? raw.recentDocuments.slice(0, 50)
      : Array.isArray(raw.documents?.recentDocuments)
        ? raw.documents.recentDocuments.slice(0, 50)
        : [],
    tabs: {
      tabs: openTabs,
      activeTabId: fallbackTabs?.activeTabId ?? fallbackTabs?.active_tab_id ?? null,
      tabOrder: Array.isArray(fallbackTabs?.tabOrder)
        ? [...fallbackTabs.tabOrder]
        : Array.isArray(fallbackTabs?.tab_order)
          ? [...fallbackTabs.tab_order]
          : [],
    },
    aiPanel: {
      collapsed: aiPanelRaw.collapsed ?? aiPanelRaw.aiChatCollapsed ?? DEFAULT_AI_PANEL_STATE.collapsed,
      width: aiPanelRaw.width ?? aiPanelRaw.aiChatWidth ?? DEFAULT_AI_PANEL_STATE.width,
      currentSessionId: aiPanelRaw.currentSessionId ?? aiPanelRaw.sessionId ?? undefined,
      draftInput: aiPanelRaw.draftInput ?? undefined,
    },
    navigationHistory,
    lastUpdated: raw.lastUpdated ?? raw.updated_at ?? Date.now(),
  };
}

function cloneWorkspaceState(state: WorkspaceState): WorkspaceState {
  return {
    workspacePath: state.workspacePath,
    windowState: state.windowState ? { ...state.windowState } : undefined,
    agenticCodingWindowState: state.agenticCodingWindowState ? { ...state.agenticCodingWindowState } : undefined,
    sidebarWidth: state.sidebarWidth,
    recentDocuments: [...state.recentDocuments],
    tabs: {
      tabs: state.tabs.tabs.map(tab => ({ ...tab })),
      activeTabId: state.tabs.activeTabId,
      tabOrder: [...state.tabs.tabOrder],
    },
    aiPanel: { ...state.aiPanel },
    navigationHistory: state.navigationHistory ? {
      history: [...state.navigationHistory.history],
      currentIndex: state.navigationHistory.currentIndex
    } : undefined,
    lastUpdated: state.lastUpdated,
  };
}

function ensureWorkspaceState(path: string): WorkspaceState {
  const key = workspaceKey(path);
  const raw = workspaceStore.get(key);
  const normalized = normalizeWorkspaceState(raw, path);
  if (!raw) {
    workspaceStore.set(key, cloneWorkspaceState(normalized));
  }
  return normalized;
}

function persistWorkspaceState(path: string, state: WorkspaceState): WorkspaceState {
  const key = workspaceKey(path);
  const next = cloneWorkspaceState({ ...state, lastUpdated: Date.now() });
  workspaceStore.set(key, next);
  return next;
}

function sortRecentItems(items: RecentItem[]): RecentItem[] {
  return [...items].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

function getRecentKey(type: 'workspaces' | 'documents'): `recent.workspaces` | `recent.documents` {
  return type === 'workspaces' ? 'recent.workspaces' : 'recent.documents';
}

function getRecentLimit(type: 'workspaces' | 'documents'): number {
  return type === 'workspaces' ? 10 : 10;
}

export const store = appStore;

export function getRecentItems(type: 'workspaces' | 'documents'): RecentItem[] {
  const key = getRecentKey(type);
  const items = appStore.get(key, []) as RecentItem[];
  if (!Array.isArray(items)) {
    logger.store.warn(`[store] Recent ${type} payload not array, resetting`, items);
    appStore.set(key, []);
    return [];
  }
  return sortRecentItems(items);
}

export function addToRecentItems(type: 'workspaces' | 'documents', path: string, name: string, maxItems: number = getRecentLimit(type)) {
  const key = getRecentKey(type);
  const items = getRecentItems(type);
  const filtered = items.filter(item => item.path !== path);
  filtered.unshift({ path, name, timestamp: Date.now() });
  appStore.set(key, filtered.slice(0, maxItems));
}

export function clearRecentItems(type: 'workspaces' | 'documents') {
  const key = getRecentKey(type);
  appStore.set(key, []);
}

export function getSessionState(): SessionState | undefined {
  return appStore.get('sessionState');
}

export function saveSessionState(state: SessionState): void {
  appStore.set('sessionState', { ...state, lastUpdated: state.lastUpdated ?? Date.now() });
}

export function getTheme(): AppTheme {
  return appStore.get('theme');
}

export function setTheme(theme: AppTheme): void {
  appStore.set('theme', theme);
}

export const getThemeSync = getTheme;
export const setThemeSync = setTheme;

export function getWorkspaceState(workspacePath: string): WorkspaceState {
  return cloneWorkspaceState(ensureWorkspaceState(workspacePath));
}

export function setWorkspaceState(workspacePath: string, state: WorkspaceState): WorkspaceState {
  return cloneWorkspaceState(persistWorkspaceState(workspacePath, state));
}

export function updateWorkspaceState(
  workspacePath: string,
  updater: (state: WorkspaceState) => void | WorkspaceState
): WorkspaceState {
  const current = ensureWorkspaceState(workspacePath);
  const draft = cloneWorkspaceState(current);
  const result = updater(draft) || draft;
  return cloneWorkspaceState(persistWorkspaceState(workspacePath, result));
}

export function getWorkspaceRecentFiles(workspacePath: string): string[] {
  return getWorkspaceState(workspacePath).recentDocuments;
}

export function addWorkspaceRecentFile(workspacePath: string, filePath: string): void {
  updateWorkspaceState(workspacePath, state => {
    state.recentDocuments = [filePath, ...state.recentDocuments.filter(path => path !== filePath)].slice(0, 50);
  });
}

export function getWorkspaceTabState(workspacePath: string): TabManagerState & { navigationHistory?: any } {
  const workspace = getWorkspaceState(workspacePath);
  const tabs = workspace.tabs;

  // Filter out tabs for files that no longer exist (unless they're virtual)
  const validTabs = tabs.tabs.filter(tab => {
    if (tab.isVirtual || tab.filePath.startsWith('virtual://')) {
      return true; // Keep virtual tabs
    }
    const exists = existsSync(tab.filePath);
    if (!exists) {
      console.log('[getWorkspaceTabState] Filtering out non-existent file:', tab.filePath);
    }
    return exists;
  });

  // Get valid tab IDs for filtering
  const validTabIds = new Set(validTabs.map(tab => tab.id));

  // Filter tab order to only include valid tabs
  const validTabOrder = tabs.tabOrder.filter(id => validTabIds.has(id));

  // Clear active tab if it was removed
  const validActiveTabId = tabs.activeTabId && validTabIds.has(tabs.activeTabId)
    ? tabs.activeTabId
    : null;

  return {
    tabs: validTabs.map(tab => ({ ...tab })),
    activeTabId: validActiveTabId,
    tabOrder: validTabOrder,
    navigationHistory: workspace.navigationHistory
  };
}

export function saveWorkspaceTabState(workspacePath: string, state: TabManagerState & { navigationHistory?: any }): void {
  updateWorkspaceState(workspacePath, workspace => {
    workspace.tabs = {
      tabs: state.tabs.map(tab => ({ ...tab })),
      activeTabId: state.activeTabId,
      tabOrder: [...state.tabOrder],
    };
    // Save navigation history if provided
    if ('navigationHistory' in state) {
      workspace.navigationHistory = state.navigationHistory;
    }
  });
}

export function clearWorkspaceTabState(workspacePath: string): void {
  updateWorkspaceState(workspacePath, workspace => {
    workspace.tabs = { ...DEFAULT_TAB_MANAGER_STATE };
    // Also clear navigation history when clearing tabs
    delete workspace.navigationHistory;
  });
}

export function getWorkspaceNavigationHistory(workspacePath: string): NavigationHistoryState | undefined {
  return getWorkspaceState(workspacePath).navigationHistory;
}

export function saveWorkspaceNavigationHistory(workspacePath: string, navigationHistory: NavigationHistoryState): void {
  updateWorkspaceState(workspacePath, workspace => {
    workspace.navigationHistory = navigationHistory;
  });
}

export function getWorkspaceWindowState(workspacePath: string): SessionWindow | undefined {
  return getWorkspaceState(workspacePath).windowState;
}

export function saveWorkspaceWindowState(workspacePath: string, windowState: SessionWindow): void {
  updateWorkspaceState(workspacePath, workspace => {
    workspace.windowState = { ...windowState };
  });
}

export function clearWorkspaceWindowState(workspacePath: string): void {
  updateWorkspaceState(workspacePath, workspace => {
    delete workspace.windowState;
  });
}

// Agentic Coding Window State Management
export function getAgenticCodingWindowState(workspacePath: string): AgenticCodingWindowState | undefined {
  return getWorkspaceState(workspacePath).agenticCodingWindowState;
}

export function saveAgenticCodingWindowState(workspacePath: string, state: AgenticCodingWindowState): void {
  updateWorkspaceState(workspacePath, workspace => {
    workspace.agenticCodingWindowState = { ...state };
  });
}

export function clearAgenticCodingWindowState(workspacePath: string): void {
  updateWorkspaceState(workspacePath, workspace => {
    delete workspace.agenticCodingWindowState;
  });
}

export function getAIChatState(workspacePath: string): WorkspaceAIPanelState {
  const { aiPanel } = getWorkspaceState(workspacePath);
  return { ...aiPanel };
}
