import Store from 'electron-store';
import { existsSync } from 'fs';
import * as path from 'path';
import { RecentItem, SessionState, SessionWindow } from '../types';
import { logger } from './logger';
import type { OnboardingConfig } from '../../shared/types/workspace';
import { DEFAULT_ONBOARDING_CONFIG } from '../../shared/types/workspace';
import type { InstalledPackage } from '../../shared/toolPackages';

export type AppTheme = 'dark' | 'light' | 'system' | 'auto' | 'crystal-dark';
export type { SessionState, SessionWindow } from '../types';

export type CompletionSoundType = 'chime' | 'bell' | 'pop' | 'alert' | 'none';
export type ReleaseChannel = 'stable' | 'alpha';
export type WorkspaceFileTreeFilter = 'all' | 'markdown' | 'known' | 'git-uncommitted' | 'git-worktree' | 'ai-read' | 'ai-written';

/**
 * Extension settings stored per extension.
 * Tracks enabled state and extension-specific configuration.
 */
export interface ExtensionSettings {
  /** Whether the extension is enabled */
  enabled: boolean;
  /** Whether the Claude Agent SDK plugin is enabled (if extension has one) */
  claudePluginEnabled?: boolean;
  /** Extension-specific configuration values (user scope) */
  configuration?: Record<string, unknown>;
}

interface AppStoreSchema {
  theme: AppTheme;
  recent: {
    workspaces: RecentItem[];
    documents: RecentItem[];
  };
  openWorkspaces: Array<{ path: string; windowId?: number }>;
  sessionState?: SessionState;
  loggerConfig?: unknown;
  // Discord invitation tracking
  launchCount?: number;
  discordInvitationDismissed?: boolean;
  // Sound notifications
  completionSoundEnabled?: boolean;
  completionSoundType?: CompletionSoundType;
  // OS notifications
  osNotificationsEnabled?: boolean;
  // Release channel
  releaseChannel?: ReleaseChannel;
  // Default AI model for new sessions (format: "provider:model" e.g., "claude-code:sonnet")
  defaultAIModel?: string;
  // Analytics
  analyticsEnabled?: boolean;
  // User onboarding
  userRole?: string; // The user's selected role (or 'skipped' if permanently dismissed)
  userEmail?: string; // Optional email provided during onboarding
  onboardingNextPrompt?: number; // Timestamp for when to show onboarding again (if deferred)
  // Custom Editors
  mockupLMEnabled?: boolean; // Enable MockupLM custom editor
  // First launch Claude Code installation detection (only checked once ever)
  claudeCodeInstallationChecked?: boolean;
  // Feature walkthrough shown on first launch
  featureWalkthroughCompleted?: boolean;
  // Worktree onboarding modal shown
  worktreeOnboardingShown?: boolean;
  // Extension settings (enabled/disabled state and configuration)
  extensionSettings?: Record<string, ExtensionSettings>;
  // Claude Code settings
  claudeCode?: {
    // Enable project-level commands (.claude/commands/ in workspace)
    projectCommandsEnabled?: boolean;
    // Enable user-level commands (~/.claude/commands/)
    userCommandsEnabled?: boolean;
  };
  // Extension Development Kit (EDK) - enables MCP tools for building/reloading extensions
  extensionDevToolsEnabled?: boolean;
  // Session Sync (optional device sync)
  sessionSync?: {
    enabled: boolean;
    serverUrl: string; // e.g., 'ws://localhost:8790' or 'wss://sync.nimbalyst.com'
    enabledProjects?: string[]; // List of workspace paths enabled for sync
    // Dev-only: override environment (defaults to 'production' even in dev builds)
    environment?: 'development' | 'production';
  };
  // Stytch Auth Configuration (project ID and public token only - secret stored in keychain)
  stytchAuth?: {
    projectId: string;
    publicToken: string;
  };
  // Auto-update suppression (when user dismisses an update)
  updateDismissedVersion?: string;
  updateDismissedAt?: number;
  // Voice Mode settings
  voiceMode?: {
    enabled: boolean; // Master toggle for voice mode feature
    voice?: 'marin' | 'cedar'; // OpenAI voice selection
    autoCommitAudio?: boolean; // Auto-commit audio on speech pause (VAD)
    showTranscription?: boolean; // Show live transcription in UI
  };
  // Walkthrough guide system state
  walkthroughs?: WalkthroughState;
}

/**
 * State for the walkthrough guide system.
 * Tracks which walkthroughs have been shown, completed, or dismissed.
 */
export interface WalkthroughState {
  /** Master toggle for all walkthroughs (default: true) */
  enabled: boolean;
  /** Walkthrough IDs that were completed (user finished all steps) */
  completed: string[];
  /** Walkthrough IDs that were dismissed (user skipped) */
  dismissed: string[];
  /** History of walkthrough interactions for analytics/rate limiting */
  history?: Record<string, WalkthroughHistory>;
}

export interface WalkthroughHistory {
  /** Timestamp when walkthrough was first shown */
  shownAt: number;
  /** Timestamp when walkthrough was completed (if applicable) */
  completedAt?: number;
  /** Timestamp when walkthrough was dismissed (if applicable) */
  dismissedAt?: number;
  /** Version of the walkthrough that was shown */
  version?: number;
}

export interface TabState {
  id: string;
  filePath: string;
  fileName: string;
  isDirty: boolean;
  isPinned: boolean;
  isVirtual?: boolean;
  lastSaved?: string;
}

export interface TabManagerState {
  tabs: TabState[];
  activeTabId: string | null;
  tabOrder: string[];
  closedTabs?: TabState[]; // History of recently closed tabs for reopening
}

export interface WorkspaceAIPanelState {
  collapsed: boolean;
  width: number;
  currentSessionId?: string;
  draftInput?: string;
  // Planning mode toggle for AI sidebar (Claude Code safety)
  planningModeEnabled?: boolean;
  // User-set prompt box height (null = auto-size)
  promptBoxHeight?: number | null;
}

export interface NavigationHistoryState {
  history: Array<{ tabId: string; timestamp: number }>;
  currentIndex: number;
}

/**
 * Per-provider override settings for project-level configuration.
 * Values of `undefined` mean "inherit from global settings".
 * Explicit values override the global setting.
 */
export interface ProviderOverride {
  /** Override enabled state: true = force enabled, false = force disabled, undefined = inherit */
  enabled?: boolean;
  /** Override selected models (if provided, replaces global model selection) */
  models?: string[];
  /** Override default model for this provider */
  defaultModel?: string;
  /** Project-specific API key (optional, overrides global key) */
  apiKey?: string;
}

/**
 * Project-level AI provider overrides.
 * Allows projects to customize AI settings without affecting global configuration.
 *
 * Use cases:
 * - Disable a provider for a specific project
 * - Enable a provider only for certain projects
 * - Use different models per project
 * - Use project-specific API keys (e.g., client-provided keys)
 */
export interface AIProviderOverrides {
  /** Override default provider for this project */
  defaultProvider?: string;
  /** Per-provider overrides */
  providers?: Record<string, ProviderOverride>;
}

export interface SessionHistoryLayout {
  width: number;
  collapsed: boolean;
  collapsedGroups: string[];
  sortOrder?: 'updated' | 'created';
}

/**
 * Permission mode for the workspace
 * - null: Workspace not trusted (show trust toast)
 * - 'ask': Smart permissions - prompt for new patterns, remember choices
 * - 'allow-all': Auto-approve file edits, follow Claude Code settings for Bash
 * - 'bypass-all': Auto-approve all tool calls without any prompts (dangerous)
 */
export type AgentPermissionMode = 'ask' | 'allow-all' | 'bypass-all' | null;

/**
 * Agent permissions stored per workspace.
 *
 * Only stores the trust mode - all tool/URL patterns are now managed by
 * Claude Code's native settings files (.claude/settings.json and .claude/settings.local.json).
 * We are just a UI on top of Claude's permission system.
 *
 * Trust is determined by permissionMode:
 * - null: Not trusted (show trust toast)
 * - 'ask', 'allow-all', or 'bypass-all': Trusted
 */
export interface AgentPermissions {
  /** Permission mode: null=untrusted, 'ask'=smart permissions, 'allow-all'=auto-approve edits, 'bypass-all'=auto-approve everything */
  permissionMode: AgentPermissionMode;
}

export interface AgenticCodingWindowState {
  bounds?: { width: number; height: number; x?: number; y?: number };
  devToolsOpen?: boolean;
  sessionHistoryLayout?: SessionHistoryLayout;
}

// Re-export OnboardingConfig for convenience
export type { OnboardingConfig } from '../../shared/types/workspace';

/**
 * Workspace state stored per workspace path.
 *
 * CRITICAL: Workspace and Agentic Coding windows share the same workspace path but maintain
 * separate tab states to prevent cross-contamination:
 * - `tabs`: Stores tab state for the main workspace window
 * - `agenticTabs`: Stores tab state for the agentic coding window
 *
 * The IPC handlers in WorkspaceHandlers.ts route get/save operations to the correct field
 * based on the window's mode (workspace vs agentic-coding).
 */
export interface WorkspaceState {
  workspacePath: string;
  windowState?: SessionWindow;
  // only when separate agentic coding window is open
  agenticCodingWindowState?: AgenticCodingWindowState;
  // Active content mode (files/agent/plan/tracker/settings)
  activeMode?: string;
  sidebarWidth: number;
  recentDocuments: string[];
  tabs: TabManagerState; // Tab state for workspace window
  agenticTabs?: TabManagerState; // Tab state for agentic coding window (separate storage)
  aiPanel: WorkspaceAIPanelState;
  navigationHistory?: NavigationHistoryState;
  // Tracker bottom panel state
  trackerBottomPanel?: 'plans' | 'bugs' | 'tasks' | 'ideas' | 'decisions' | null;
  trackerBottomPanelHeight?: number;
  // Onboarding configuration
  onboarding?: OnboardingConfig;
  // Installed tool packages
  installedPackages?: InstalledPackage[];
  // File tree filter state
  fileTreeFilter?: WorkspaceFileTreeFilter;
  // File tree icons visibility
  showFileIcons?: boolean;
  // AI provider overrides for this project
  aiProviderOverrides?: AIProviderOverrides;
  // Extension configuration for this project (extensionId -> key -> value)
  extensionConfiguration?: Record<string, Record<string, unknown>>;
  // Agent permissions for this project (allowed/denied patterns, trust status)
  agentPermissions?: AgentPermissions;
  // Worktree session mode preferences (per agentic session)
  agentWorktreeSessionModes?: Record<string, 'agent' | 'files'>;
  // Diff tree view settings (file gutter grouping)
  diffTreeGroupByDirectory?: boolean;
  lastUpdated: number;
}

// Lazy-initialized stores to avoid reading userData path at module load time.
// This allows bootstrap.ts to set a custom userData path before stores are created.
// The stores are created on first access via getAppStore() and getWorkspaceStore().
let _appStore: Store<AppStoreSchema> | null = null;
let _workspaceStore: Store<Record<string, WorkspaceState>> | null = null;

function getAppStore(): Store<AppStoreSchema> {
  if (!_appStore) {
    _appStore = new Store<AppStoreSchema>({
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
  }
  return _appStore;
}

function getWorkspaceStore(): Store<Record<string, WorkspaceState>> {
  if (!_workspaceStore) {
    _workspaceStore = new Store<Record<string, WorkspaceState>>({
      name: 'workspace-settings',
      clearInvalidConfig: true,
      defaults: {},
    });
    // Log the store path on initialization for debugging
    console.log('[Store] workspaceStore path:', _workspaceStore.path);
  }
  return _workspaceStore;
}

const DEFAULT_TAB_MANAGER_STATE: TabManagerState = {
  tabs: [],
  activeTabId: null,
  tabOrder: [],
  closedTabs: [],
};

const DEFAULT_AI_PANEL_STATE: WorkspaceAIPanelState = {
  collapsed: false,
  width: 350,
  planningModeEnabled: true,
};

function workspaceKey(workspacePath: string): string {
  if (!workspacePath) {
    throw new Error('[store] workspacePath is required');
  }
  // Normalize the path to ensure consistent storage keys:
  // 1. Use path.normalize to handle . and .. segments
  // 2. Remove trailing slashes to ensure consistent keys
  const normalized = path.normalize(workspacePath).replace(/\/+$/, '');
  const base64 = Buffer.from(normalized).toString('base64url');
  return `ws:${base64}`;
}

/**
 * Normalize raw workspace state from storage.
 *
 * CRITICAL: ALL fields in WorkspaceState MUST be parsed/initialized here.
 * This includes both `tabs` AND `agenticTabs`. Missing fields will be undefined
 * in the normalized state, which can cause state corruption.
 *
 * ⚠️  WHEN ADDING NEW FIELDS TO WorkspaceState:
 * 1. Add the field to the WorkspaceState interface (line ~90)
 * 2. Add the field to the return object in this function (line ~209)
 * 3. Add the field to cloneWorkspaceState function (line ~257)
 *
 * If you forget step 2, the field will be SILENTLY DROPPED on load and users will
 * lose their settings. This has happened multiple times. Don't fuck it up again.
 */
function normalizeWorkspaceState(raw: any, path: string): WorkspaceState {
  if (!raw) {
    return {
      workspacePath: path,
      windowState: undefined,
      agenticCodingWindowState: undefined,
      sidebarWidth: 240,
      recentDocuments: [],
      tabs: { ...DEFAULT_TAB_MANAGER_STATE },
      agenticTabs: undefined,
      aiPanel: { ...DEFAULT_AI_PANEL_STATE },
      navigationHistory: undefined,
      trackerBottomPanel: null,
      trackerBottomPanelHeight: 300,
      onboarding: undefined,
      installedPackages: undefined,
      fileTreeFilter: undefined,
      showFileIcons: undefined,
      aiProviderOverrides: undefined,
      agentPermissions: undefined,
      agentWorktreeSessionModes: {},
      diffTreeGroupByDirectory: undefined,
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

  // CRITICAL: Parse agenticTabs if present to preserve agentic window tab state
  const agenticTabsRaw = raw.agenticTabs;
  const agenticTabs = agenticTabsRaw ? {
    tabs: Array.isArray(agenticTabsRaw.tabs) ? agenticTabsRaw.tabs.map((tab: any) => ({ ...tab })) : [],
    activeTabId: agenticTabsRaw.activeTabId ?? null,
    tabOrder: Array.isArray(agenticTabsRaw.tabOrder) ? [...agenticTabsRaw.tabOrder] : [],
    closedTabs: Array.isArray(agenticTabsRaw.closedTabs) ? agenticTabsRaw.closedTabs.map((tab: any) => ({ ...tab })) : [],
  } : undefined;

  return {
    workspacePath: raw.workspacePath ?? raw.workspace_path ?? path,
    windowState: raw.windowState ?? raw.window_state ?? undefined,
    agenticCodingWindowState: raw.agenticCodingWindowState ? {
      ...raw.agenticCodingWindowState,
      sessionHistoryLayout: raw.agenticCodingWindowState.sessionHistoryLayout ? {
        ...raw.agenticCodingWindowState.sessionHistoryLayout
      } : undefined
    } : undefined,
    activeMode: raw.activeMode ?? undefined,
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
      closedTabs: Array.isArray(fallbackTabs?.closedTabs)
        ? fallbackTabs.closedTabs.map((tab: any) => ({ ...tab }))
        : [],
    },
    agenticTabs,
    aiPanel: {
      collapsed: aiPanelRaw.collapsed ?? aiPanelRaw.aiChatCollapsed ?? DEFAULT_AI_PANEL_STATE.collapsed,
      width: aiPanelRaw.width ?? aiPanelRaw.aiChatWidth ?? DEFAULT_AI_PANEL_STATE.width,
      currentSessionId: aiPanelRaw.currentSessionId ?? aiPanelRaw.sessionId ?? undefined,
      draftInput: aiPanelRaw.draftInput ?? undefined,
      // Default planning mode ON if missing
      planningModeEnabled: aiPanelRaw.planningModeEnabled ?? true,
      promptBoxHeight: aiPanelRaw.promptBoxHeight ?? undefined,
    },
    navigationHistory,
    trackerBottomPanel: raw.trackerBottomPanel ?? raw.bottomPanel ?? null,
    trackerBottomPanelHeight: raw.trackerBottomPanelHeight ?? raw.bottomPanelHeight ?? 300,
    onboarding: raw.onboarding ? { ...raw.onboarding } : undefined,
    installedPackages: raw.installedPackages ? [...raw.installedPackages] : undefined,
    fileTreeFilter: raw.fileTreeFilter ?? undefined,
    showFileIcons: raw.showFileIcons ?? undefined,
    aiProviderOverrides: raw.aiProviderOverrides ? { ...raw.aiProviderOverrides } : undefined,
    extensionConfiguration: raw.extensionConfiguration ? { ...raw.extensionConfiguration } : undefined,
    // AgentPermissions now only contains permissionMode - patterns are in Claude's settings files
    agentPermissions: raw.agentPermissions ? {
      permissionMode: raw.agentPermissions.permissionMode === 'allow-all'
        ? 'allow-all'
        : raw.agentPermissions.permissionMode === 'ask'
          ? 'ask'
          : raw.agentPermissions.permissionMode === 'bypass-all'
            ? 'bypass-all'
            : null,
    } : undefined,
    agentWorktreeSessionModes: raw.agentWorktreeSessionModes
      ? { ...raw.agentWorktreeSessionModes }
      : undefined,
    diffTreeGroupByDirectory: raw.diffTreeGroupByDirectory ?? undefined,
    lastUpdated: raw.lastUpdated ?? raw.updated_at ?? Date.now(),
  };
}

/**
 * Deep clone workspace state.
 *
 * CRITICAL: ALL fields in WorkspaceState MUST be cloned here.
 * Missing fields will be dropped during save/load, corrupting state.
 * This includes both `tabs` AND `agenticTabs` - forgetting agenticTabs
 * caused a critical bug where plans couldn't be opened.
 *
 * ⚠️  WHEN ADDING NEW FIELDS TO WorkspaceState:
 * You MUST add them here too. See normalizeWorkspaceState comment for details.
 */
function cloneWorkspaceState(state: WorkspaceState): WorkspaceState {
  return {
    workspacePath: state.workspacePath,
    windowState: state.windowState ? { ...state.windowState } : undefined,
    agenticCodingWindowState: state.agenticCodingWindowState ? {
      ...state.agenticCodingWindowState,
      sessionHistoryLayout: state.agenticCodingWindowState.sessionHistoryLayout ? {
        width: state.agenticCodingWindowState.sessionHistoryLayout.width,
        collapsed: state.agenticCodingWindowState.sessionHistoryLayout.collapsed,
        collapsedGroups: [...state.agenticCodingWindowState.sessionHistoryLayout.collapsedGroups],
        sortOrder: state.agenticCodingWindowState.sessionHistoryLayout.sortOrder
      } : undefined
    } : undefined,
    activeMode: state.activeMode,
    sidebarWidth: state.sidebarWidth,
    recentDocuments: [...state.recentDocuments],
    tabs: {
      tabs: state.tabs.tabs.map(tab => ({ ...tab })),
      activeTabId: state.tabs.activeTabId,
      tabOrder: [...state.tabs.tabOrder],
      closedTabs: state.tabs.closedTabs?.map(tab => ({ ...tab })) ?? [],
    },
    // CRITICAL: Must clone agenticTabs to prevent state corruption
    agenticTabs: state.agenticTabs ? {
      tabs: state.agenticTabs.tabs.map(tab => ({ ...tab })),
      activeTabId: state.agenticTabs.activeTabId,
      tabOrder: [...state.agenticTabs.tabOrder],
      closedTabs: state.agenticTabs.closedTabs?.map(tab => ({ ...tab })) ?? [],
    } : undefined,
    aiPanel: {
      ...state.aiPanel,
      promptBoxHeight: state.aiPanel.promptBoxHeight,
    },
    navigationHistory: state.navigationHistory ? {
      history: [...state.navigationHistory.history],
      currentIndex: state.navigationHistory.currentIndex
    } : undefined,
    trackerBottomPanel: state.trackerBottomPanel,
    trackerBottomPanelHeight: state.trackerBottomPanelHeight,
    onboarding: state.onboarding ? { ...state.onboarding } : undefined,
    installedPackages: state.installedPackages ? [...state.installedPackages] : undefined,
    fileTreeFilter: state.fileTreeFilter,
    showFileIcons: state.showFileIcons,
    aiProviderOverrides: state.aiProviderOverrides ? {
      defaultProvider: state.aiProviderOverrides.defaultProvider,
      providers: state.aiProviderOverrides.providers ? { ...state.aiProviderOverrides.providers } : undefined,
    } : undefined,
    extensionConfiguration: state.extensionConfiguration
      ? Object.fromEntries(
          Object.entries(state.extensionConfiguration).map(([extId, config]) => [
            extId,
            { ...config }
          ])
        )
      : undefined,
    agentPermissions: state.agentPermissions ? { permissionMode: state.agentPermissions.permissionMode } : undefined,
    agentWorktreeSessionModes: state.agentWorktreeSessionModes
      ? { ...state.agentWorktreeSessionModes }
      : undefined,
    diffTreeGroupByDirectory: state.diffTreeGroupByDirectory,
    lastUpdated: state.lastUpdated,
  };
}

function ensureWorkspaceState(path: string): WorkspaceState {
  const key = workspaceKey(path);
  const raw = getWorkspaceStore().get(key);
  const normalized = normalizeWorkspaceState(raw, path);
  if (!raw) {
    getWorkspaceStore().set(key, cloneWorkspaceState(normalized));
  }
  return normalized;
}

function persistWorkspaceState(path: string, state: WorkspaceState): WorkspaceState {
  const key = workspaceKey(path);
  const next = cloneWorkspaceState({ ...state, lastUpdated: Date.now() });
  getWorkspaceStore().set(key, next);
  return next;
}

function sortRecentItems(items: RecentItem[]): RecentItem[] {
  return [...items].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

function getRecentKey(type: 'workspaces' | 'documents'): `recent.workspaces` | `recent.documents` {
  return type === 'workspaces' ? 'recent.workspaces' : 'recent.documents';
}

function getRecentLimit(type: 'workspaces' | 'documents'): number {
  // No limit for workspaces - track all projects user has opened
  // Keep limit for documents to avoid unbounded growth
  return type === 'workspaces' ? Infinity : 50;
}

// Export store instance for backward compatibility.
// This is a getter that returns the lazy-initialized store.
// Callers use it as `store.get()` / `store.set()`.
export const store = {
  get get() { return getAppStore().get.bind(getAppStore()); },
  get set() { return getAppStore().set.bind(getAppStore()); },
  get delete() { return getAppStore().delete.bind(getAppStore()); },
  get path() { return getAppStore().path; },
  get store() { return getAppStore().store; },
};

export function getRecentItems(type: 'workspaces' | 'documents'): RecentItem[] {
  const key = getRecentKey(type);
  const items = getAppStore().get(key, []) as RecentItem[];
  if (!Array.isArray(items)) {
    logger.store.warn(`[store] Recent ${type} payload not array, resetting`, items);
    getAppStore().set(key, []);
    return [];
  }
  return sortRecentItems(items);
}

export function addToRecentItems(type: 'workspaces' | 'documents', path: string, name: string, maxItems: number = getRecentLimit(type)) {
  const key = getRecentKey(type);
  const items = getRecentItems(type);
  const filtered = items.filter(item => item.path !== path);
  filtered.unshift({ path, name, timestamp: Date.now() });
  getAppStore().set(key, filtered.slice(0, maxItems));
}

export function clearRecentItems(type: 'workspaces' | 'documents') {
  const key = getRecentKey(type);
  getAppStore().set(key, []);
}

export function getSessionState(): SessionState | undefined {
  return getAppStore().get('sessionState');
}

export function saveSessionState(state: SessionState): void {
  getAppStore().set('sessionState', { ...state, lastUpdated: state.lastUpdated ?? Date.now() });
}

export function clearSessionState(): void {
  getAppStore().delete('sessionState');
}

export function getTheme(): AppTheme {
  return getAppStore().get('theme');
}

export function setTheme(theme: AppTheme): void {
  getAppStore().set('theme', theme);
}

// getThemeSync resolves 'system'/'auto' to the actual theme for the renderer
// This prevents flash by ensuring renderer gets 'dark' or 'light', not 'system'
export function getThemeSync(): AppTheme {
  const { nativeTheme } = require('electron');
  const storedTheme = getAppStore().get('theme');

  // Resolve system/auto to actual theme based on OS preference
  if (storedTheme === 'system' || storedTheme === 'auto') {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  }

  return storedTheme;
}

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

/**
 * Get tab state for the agentic coding window.
 *
 * IMPORTANT: This retrieves the `agenticTabs` field, NOT the regular `tabs` field.
 * This separation ensures that:
 * 1. Agentic window tabs (AI chat sessions) don't mix with workspace tabs (files)
 * 2. Opening/closing the agentic window doesn't affect workspace tab state
 * 3. Each window maintains its own independent tab history
 *
 * Called by WorkspaceHandlers.ts when window mode is 'agentic-coding'.
 */
export function getAgenticTabState(workspacePath: string): TabManagerState {
  const workspace = getWorkspaceState(workspacePath);
  return workspace.agenticTabs ?? { ...DEFAULT_TAB_MANAGER_STATE };
}

/**
 * Save tab state for the agentic coding window.
 *
 * IMPORTANT: This saves to the `agenticTabs` field, NOT the regular `tabs` field.
 * This prevents the agentic window from overwriting workspace tab state.
 *
 * Called by WorkspaceHandlers.ts when window mode is 'agentic-coding'.
 */
export function saveAgenticTabState(workspacePath: string, state: TabManagerState): void {
  updateWorkspaceState(workspacePath, workspace => {
    workspace.agenticTabs = {
      tabs: state.tabs.map(tab => ({ ...tab })),
      activeTabId: state.activeTabId,
      tabOrder: [...state.tabOrder],
    };
  });
}

// File Tree Filter State Management
export function getFileTreeFilter(workspacePath: string): WorkspaceFileTreeFilter {
  return getWorkspaceState(workspacePath).fileTreeFilter ?? 'all';
}

export function saveFileTreeFilter(workspacePath: string, filter: WorkspaceFileTreeFilter): void {
  updateWorkspaceState(workspacePath, workspace => {
    workspace.fileTreeFilter = filter;
  });
}

// Diff Tree View State Management
export function getDiffTreeGroupByDirectory(workspacePath: string): boolean {
  return getWorkspaceState(workspacePath).diffTreeGroupByDirectory ?? false;
}

export function saveDiffTreeGroupByDirectory(workspacePath: string, groupByDirectory: boolean): void {
  updateWorkspaceState(workspacePath, workspace => {
    workspace.diffTreeGroupByDirectory = groupByDirectory;
  });
}

// AI Provider Override State Management
export function getAIProviderOverrides(workspacePath: string): AIProviderOverrides | undefined {
  return getWorkspaceState(workspacePath).aiProviderOverrides;
}

export function saveAIProviderOverrides(workspacePath: string, overrides: AIProviderOverrides | undefined): void {
  updateWorkspaceState(workspacePath, workspace => {
    workspace.aiProviderOverrides = overrides;
  });
}

export function clearAIProviderOverrides(workspacePath: string): void {
  updateWorkspaceState(workspacePath, workspace => {
    delete workspace.aiProviderOverrides;
  });
}

// Discord Invitation Management
export function incrementLaunchCount(): number {
  const current = getAppStore().get('launchCount', 0);
  const next = current + 1;
  getAppStore().set('launchCount', next);
  return next;
}

export function getLaunchCount(): number {
  return getAppStore().get('launchCount', 0);
}

export function isClaudeCodeWindowsWarningDismissed(): boolean {
  return getAppStore().get('claudeCodeWindowsWarningDismissed', false);
}

export function dismissClaudeCodeWindowsWarning(): void {
  getAppStore().set('claudeCodeWindowsWarningDismissed', true);
}

export function shouldShowClaudeCodeWindowsWarning(): boolean {
  const isWindows = process.platform === 'win32';
  const dismissed = isClaudeCodeWindowsWarningDismissed();
  return isWindows && !dismissed;
}

export function isDiscordInvitationDismissed(): boolean {
  return getAppStore().get('discordInvitationDismissed', false);
}

export function dismissDiscordInvitation(): void {
  getAppStore().set('discordInvitationDismissed', true);
}

export function shouldShowDiscordInvitation(): boolean {
  const launchCount = getLaunchCount();
  const dismissed = isDiscordInvitationDismissed();
  return launchCount >= 3 && !dismissed;
}

// Completion Sound Settings
export function isCompletionSoundEnabled(): boolean {
  return getAppStore().get('completionSoundEnabled', true);
}

export function setCompletionSoundEnabled(enabled: boolean): void {
  getAppStore().set('completionSoundEnabled', enabled);
}

export function getCompletionSoundType(): CompletionSoundType {
  return getAppStore().get('completionSoundType', 'chime');
}

export function setCompletionSoundType(soundType: CompletionSoundType): void {
  getAppStore().set('completionSoundType', soundType);
}

// OS Notifications Settings
export function isOSNotificationsEnabled(): boolean {
  return getAppStore().get('osNotificationsEnabled', true);
}

export function setOSNotificationsEnabled(enabled: boolean): void {
  getAppStore().set('osNotificationsEnabled', enabled);
}

// Release Channel Settings
export function getReleaseChannel(): ReleaseChannel {
  // Allow env override for testing (set via NIMBALYST_RELEASE_CHANNEL=alpha)
  const envChannel = process.env.NIMBALYST_RELEASE_CHANNEL;
  if (envChannel === 'alpha' || envChannel === 'stable') {
    return envChannel;
  }
  return getAppStore().get('releaseChannel', 'stable');
}

export function setReleaseChannel(channel: ReleaseChannel): void {
  getAppStore().set('releaseChannel', channel);
}

// User Onboarding
export interface OnboardingState {
  userRole?: string;
  userEmail?: string;
  onboardingNextPrompt?: number;
  onboardingCompleted?: boolean;
}

export function getOnboardingState(): OnboardingState {
  return {
    userRole: getAppStore().get('userRole'),
    userEmail: getAppStore().get('userEmail'),
    onboardingNextPrompt: getAppStore().get('onboardingNextPrompt'),
    onboardingCompleted: getAppStore().get('onboardingCompleted')
  };
}

export function updateOnboardingState(state: Partial<OnboardingState>): void {
  if (state.userRole !== undefined) {
    getAppStore().set('userRole', state.userRole);
  }
  if (state.userEmail !== undefined) {
    getAppStore().set('userEmail', state.userEmail);
  }
  if (state.onboardingNextPrompt !== undefined) {
    getAppStore().set('onboardingNextPrompt', state.onboardingNextPrompt);
  }
  if (state.onboardingCompleted !== undefined) {
    getAppStore().set('onboardingCompleted', state.onboardingCompleted);
  }
}

// Default AI Model Settings
export function getDefaultAIModel(): string | undefined {
  return getAppStore().get('defaultAIModel');
}

export function setDefaultAIModel(model: string): void {
  getAppStore().set('defaultAIModel', model);
}

// Analytics Settings
export function isAnalyticsEnabled(): boolean {
  return getAppStore().get('analyticsEnabled', true); // Default to enabled
}

export function setAnalyticsEnabled(enabled: boolean): void {
  getAppStore().set('analyticsEnabled', enabled);
}

// MockupLM Settings
export function isMockupLMEnabled(): boolean {
  return getAppStore().get('mockupLMEnabled', true); // Default to enabled
}

export function setMockupLMEnabled(enabled: boolean): void {
  getAppStore().set('mockupLMEnabled', enabled);
}

// First Launch Claude Code Installation Check
// This flag ensures we only check once ever, on the very first app launch
export function hasCheckedClaudeCodeInstallation(): boolean {
  return getAppStore().get('claudeCodeInstallationChecked', false);
}

export function markClaudeCodeInstallationChecked(): void {
  getAppStore().set('claudeCodeInstallationChecked', true);
}

// Session Sync Settings
// Authentication is handled by StytchAuthService (JWT), encryption key by CredentialService
export interface SessionSyncConfig {
  enabled: boolean;
  serverUrl: string;
  enabledProjects?: string[];
  // Dev-only: override environment (defaults to 'production' even in dev builds)
  environment?: 'development' | 'production';
}

// Stytch Auth Configuration (stored separately from session sync)
export interface StytchAuthConfig {
  projectId: string;
  publicToken: string;
  // Secret key is stored in secure storage, not in this config
}

export function getSessionSyncConfig(): SessionSyncConfig | undefined {
  return getAppStore().get('sessionSync');
}

export function setSessionSyncConfig(config: SessionSyncConfig | undefined): void {
  if (config) {
    getAppStore().set('sessionSync', config);
  } else {
    getAppStore().delete('sessionSync');
  }
}

// Stytch Auth Configuration
export function getStytchAuthConfig(): StytchAuthConfig | undefined {
  return getAppStore().get('stytchAuth');
}

export function setStytchAuthConfig(config: StytchAuthConfig | undefined): void {
  if (config) {
    getAppStore().set('stytchAuth', config);
  } else {
    getAppStore().delete('stytchAuth');
  }
}

// Feature Walkthrough Settings
export function isFeatureWalkthroughCompleted(): boolean {
  return getAppStore().get('featureWalkthroughCompleted', false);
}

export function setFeatureWalkthroughCompleted(completed: boolean): void {
  getAppStore().set('featureWalkthroughCompleted', completed);
}

// Worktree Onboarding Settings
export function isWorktreeOnboardingShown(): boolean {
  return getAppStore().get('worktreeOnboardingShown', false);
}

export function setWorktreeOnboardingShown(shown: boolean): void {
  getAppStore().set('worktreeOnboardingShown', shown);
}

// Extension Settings Management
export function getExtensionSettings(): Record<string, ExtensionSettings> {
  return getAppStore().get('extensionSettings', {});
}

export function setExtensionSettings(settings: Record<string, ExtensionSettings>): void {
  getAppStore().set('extensionSettings', settings);
}

/**
 * Get whether an extension is enabled.
 *
 * @param extensionId - The extension ID to check
 * @param defaultEnabled - The manifest's defaultEnabled value (undefined means true).
 *                         Only used if the user hasn't explicitly set a preference.
 * @returns Whether the extension should be enabled
 */
export function getExtensionEnabled(extensionId: string, defaultEnabled?: boolean): boolean {
  const settings = getExtensionSettings();
  // If user has explicitly set a preference, use it
  if (settings[extensionId]?.enabled !== undefined) {
    return settings[extensionId].enabled;
  }
  // Otherwise use manifest default (true if not specified)
  return defaultEnabled !== false;
}

export function setExtensionEnabled(extensionId: string, enabled: boolean): void {
  const settings = getExtensionSettings();
  if (!settings[extensionId]) {
    settings[extensionId] = { enabled };
  } else {
    settings[extensionId].enabled = enabled;
  }
  setExtensionSettings(settings);
}

export function getClaudePluginEnabled(extensionId: string): boolean | undefined {
  const settings = getExtensionSettings();
  // Returns undefined if not explicitly set (to allow manifest default)
  return settings[extensionId]?.claudePluginEnabled;
}

export function setClaudePluginEnabled(extensionId: string, enabled: boolean): void {
  const settings = getExtensionSettings();
  if (!settings[extensionId]) {
    settings[extensionId] = { enabled: true, claudePluginEnabled: enabled };
  } else {
    settings[extensionId].claudePluginEnabled = enabled;
  }
  setExtensionSettings(settings);
}

// Claude Code settings
export function getClaudeCodeSettings(): { projectCommandsEnabled: boolean; userCommandsEnabled: boolean } {
  const settings = getAppStore().get('claudeCode', {});
  return {
    projectCommandsEnabled: settings.projectCommandsEnabled ?? true,
    userCommandsEnabled: settings.userCommandsEnabled ?? true,
  };
}

export function setClaudeCodeProjectCommandsEnabled(enabled: boolean): void {
  const current = getAppStore().get('claudeCode', {});
  getAppStore().set('claudeCode', { ...current, projectCommandsEnabled: enabled });
}

export function setClaudeCodeUserCommandsEnabled(enabled: boolean): void {
  const current = getAppStore().get('claudeCode', {});
  getAppStore().set('claudeCode', { ...current, userCommandsEnabled: enabled });
}

// Extension Development Kit (EDK) Settings
export function isExtensionDevToolsEnabled(): boolean {
  return getAppStore().get('extensionDevToolsEnabled', false); // Default to disabled
}

export function setExtensionDevToolsEnabled(enabled: boolean): void {
  getAppStore().set('extensionDevToolsEnabled', enabled);
}

export function getExtensionConfiguration(extensionId: string): Record<string, unknown> {
  const settings = getExtensionSettings();
  return settings[extensionId]?.configuration ?? {};
}

export function setExtensionConfiguration(
  extensionId: string,
  key: string,
  value: unknown
): void {
  const settings = getExtensionSettings();
  if (!settings[extensionId]) {
    settings[extensionId] = { enabled: true };
  }
  if (!settings[extensionId].configuration) {
    settings[extensionId].configuration = {};
  }
  settings[extensionId].configuration[key] = value;
  setExtensionSettings(settings);
}

export function setExtensionConfigurationBulk(
  extensionId: string,
  configuration: Record<string, unknown>
): void {
  const settings = getExtensionSettings();
  if (!settings[extensionId]) {
    settings[extensionId] = { enabled: true };
  }
  settings[extensionId].configuration = { ...configuration };
  setExtensionSettings(settings);
}

// Workspace-level extension configuration
export function getWorkspaceExtensionConfiguration(
  workspacePath: string,
  extensionId: string
): Record<string, unknown> {
  const workspace = getWorkspaceState(workspacePath);
  return workspace.extensionConfiguration?.[extensionId] ?? {};
}

export function setWorkspaceExtensionConfiguration(
  workspacePath: string,
  extensionId: string,
  key: string,
  value: unknown
): void {
  updateWorkspaceState(workspacePath, (state) => {
    if (!state.extensionConfiguration) {
      state.extensionConfiguration = {};
    }
    if (!state.extensionConfiguration[extensionId]) {
      state.extensionConfiguration[extensionId] = {};
    }
    state.extensionConfiguration[extensionId][key] = value;
  });
}

export function setWorkspaceExtensionConfigurationBulk(
  workspacePath: string,
  extensionId: string,
  configuration: Record<string, unknown>
): void {
  updateWorkspaceState(workspacePath, (state) => {
    if (!state.extensionConfiguration) {
      state.extensionConfiguration = {};
    }
    state.extensionConfiguration[extensionId] = { ...configuration };
  });
}

// Agent Permission State Management
export function getAgentPermissions(workspacePath: string): AgentPermissions | undefined {
  const key = workspaceKey(workspacePath);
  const workspaceName = workspacePath.split('/').pop() || workspacePath;
  const permissions = getWorkspaceState(workspacePath).agentPermissions;
  // console.log(`[Store:${workspaceName}] getAgentPermissions:`, {
  //   workspacePath,
  //   key,
  //   storePath: getWorkspaceStore().path,
  //   hasPermissions: !!permissions,
  //   permissionMode: permissions?.permissionMode,
  // });
  return permissions;
}

export function saveAgentPermissions(workspacePath: string, permissions: AgentPermissions): void {
  updateWorkspaceState(workspacePath, (state) => {
    state.agentPermissions = { permissionMode: permissions.permissionMode };
  });
}

export function isWorkspaceTrusted(workspacePath: string): boolean {
  return getWorkspaceState(workspacePath).agentPermissions?.permissionMode !== null &&
         getWorkspaceState(workspacePath).agentPermissions?.permissionMode !== undefined;
}

export function setWorkspaceTrusted(workspacePath: string, trusted: boolean, mode: 'ask' | 'allow-all' | 'bypass-all' = 'ask'): void {
  updateWorkspaceState(workspacePath, (state) => {
    state.agentPermissions = { permissionMode: trusted ? mode : null };
  });
}

// Walkthrough Guide System State Management

const DEFAULT_WALKTHROUGH_STATE: WalkthroughState = {
  enabled: true,
  completed: [],
  dismissed: [],
  history: {},
};

/**
 * Get the current walkthrough state.
 * Returns default state if none exists (enabled by default).
 */
export function getWalkthroughState(): WalkthroughState {
  const state = getAppStore().get('walkthroughs');
  if (!state) {
    return { ...DEFAULT_WALKTHROUGH_STATE };
  }
  return {
    enabled: state.enabled ?? true,
    completed: state.completed ?? [],
    dismissed: state.dismissed ?? [],
    history: state.history ?? {},
  };
}

/**
 * Enable or disable all walkthroughs globally.
 */
export function setWalkthroughsEnabled(enabled: boolean): void {
  const current = getWalkthroughState();
  getAppStore().set('walkthroughs', { ...current, enabled });
}

/**
 * Check if walkthroughs are enabled globally.
 */
export function isWalkthroughsEnabled(): boolean {
  return getWalkthroughState().enabled;
}

/**
 * Mark a walkthrough as completed (user finished all steps).
 */
export function markWalkthroughCompleted(walkthroughId: string, version?: number): void {
  const current = getWalkthroughState();
  const completed = current.completed.includes(walkthroughId)
    ? current.completed
    : [...current.completed, walkthroughId];

  const history = {
    ...current.history,
    [walkthroughId]: {
      ...current.history?.[walkthroughId],
      shownAt: current.history?.[walkthroughId]?.shownAt ?? Date.now(),
      completedAt: Date.now(),
      version,
    },
  };

  getAppStore().set('walkthroughs', { ...current, completed, history });
}

/**
 * Mark a walkthrough as dismissed (user skipped/closed it).
 */
export function markWalkthroughDismissed(walkthroughId: string, version?: number): void {
  const current = getWalkthroughState();
  const dismissed = current.dismissed.includes(walkthroughId)
    ? current.dismissed
    : [...current.dismissed, walkthroughId];

  const history = {
    ...current.history,
    [walkthroughId]: {
      ...current.history?.[walkthroughId],
      shownAt: current.history?.[walkthroughId]?.shownAt ?? Date.now(),
      dismissedAt: Date.now(),
      version,
    },
  };

  getAppStore().set('walkthroughs', { ...current, dismissed, history });
}

/**
 * Record that a walkthrough was shown (for analytics).
 */
export function recordWalkthroughShown(walkthroughId: string, version?: number): void {
  const current = getWalkthroughState();
  const history = {
    ...current.history,
    [walkthroughId]: {
      ...current.history?.[walkthroughId],
      shownAt: Date.now(),
      version,
    },
  };

  getAppStore().set('walkthroughs', { ...current, history });
}

/**
 * Check if a walkthrough should be shown.
 * Returns false if disabled globally, already completed, or already dismissed.
 */
export function shouldShowWalkthrough(walkthroughId: string, version?: number): boolean {
  const state = getWalkthroughState();

  // Globally disabled
  if (!state.enabled) return false;

  // Already completed or dismissed
  if (state.completed.includes(walkthroughId)) return false;
  if (state.dismissed.includes(walkthroughId)) return false;

  // If version is specified and a different version was shown, allow re-showing
  if (version !== undefined && state.history?.[walkthroughId]?.version !== undefined) {
    if (state.history[walkthroughId].version !== version) {
      // New version - allow showing again
      return true;
    }
  }

  return true;
}

/**
 * Reset all walkthrough state (for testing/debugging).
 */
export function resetWalkthroughState(): void {
  getAppStore().set('walkthroughs', { ...DEFAULT_WALKTHROUGH_STATE });
}

// Generic App Settings (for extension storage and other dynamic keys)

/**
 * Get a generic app setting by key.
 * Used by extension storage to persist global data.
 */
export function getAppSetting<T>(key: string): T | undefined {
  return getAppStore().get(key as keyof AppStoreSchema) as T | undefined;
}

/**
 * Set a generic app setting by key.
 * Used by extension storage to persist global data.
 */
export function setAppSetting<T>(key: string, value: T): void {
  getAppStore().set(key as keyof AppStoreSchema, value as any);
}

