/**
 * Jotai Store Exports
 *
 * Central export point for all Jotai atoms and utilities.
 * Re-exports shared atoms from @nimbalyst/runtime/store,
 * plus Electron-specific atoms (sessions, file tree, project state, trackers).
 *
 * @example
 * import { store, themeAtom, makeEditorKey } from '@/store';
 */

// ============================================================
// Re-export shared atoms from runtime
// These are used by extensions and are platform-agnostic
// ============================================================

// Store instance
export { store, getStore } from '@nimbalyst/runtime/store';

// EditorKey utilities
export {
  type EditorKey,
  type EditorContext,
  makeEditorKey,
  makeEditorContext,
  parseEditorKey,
  getFilePathFromKey,
  isWorktreeKey,
  isMainKey,
  getKeysForFilePath,
} from '@nimbalyst/runtime/store';

// Theme atoms
export {
  themeIdAtom,
  themeAtom,
  isDarkThemeAtom,
  themeColorsAtom,
  setThemeAtom,
  getThemeById,
  registerCustomTheme,
  type ThemeId,
  type Theme,
  type ThemeColors,
} from '@nimbalyst/runtime/store';

// Editor atoms
export {
  editorDirtyAtom,
  editorProcessingAtom,
  editorHasUnacceptedChangesAtom,
  tabIdsAtom,
  activeTabIdAtom,
  tabMetadataAtom,
  dirtyEditorCountAtom,
  hasAnyPendingReviewAtom,
  addTabAtom,
  closeTabAtom,
  reorderTabsAtom,
  type TabMetadata,
} from '@nimbalyst/runtime/store';

// ============================================================
// Electron-specific atoms
// These depend on IPC, file watchers, or other Electron features
// ============================================================

// Session atoms (Electron IPC)
export {
  sessionListAtom,
  activeSessionIdAtom,
  sessionProcessingAtom,
  sessionUnreadAtom,
  sessionPendingPromptAtom,
  sessionHasPendingInteractivePromptAtom,
  // Durable interactive prompts (DB-derived) - used for pending indicator
  sessionPendingPromptsAtom,
  refreshPendingPromptsAtom,
  respondToPromptAtom,
  sessionPromptAdditionsAtom,
  sessionLastReadAtom,
  sessionDraftInputAtom,
  setSessionDraftInputAtom,
  sessionDraftAttachmentsAtom,
  sessionHistoryIndexAtom,
  sessionTempInputAtom,
  navigateSessionHistoryAtom,
  resetSessionHistoryAtom,
  totalUnreadCountAtom,
  anySessionProcessingAtom,
  anyPendingInteractivePromptAtom,
  markSessionReadAtom,
  setActiveSessionAtom,
  // Session list loading
  sessionListLoadingAtom,
  sessionListWorkspaceAtom,
  sessionListRootAtom,
  sessionListChatAtom,
  showArchivedSessionsAtom,
  refreshSessionListAtom,
  initSessionList,
  addSessionFullAtom,
  updateSessionFullAtom,
  removeSessionFullAtom,
  // New registry-based atoms
  sessionRegistryAtom,
  sessionListFromRegistryAtom,
  sessionListRootFromRegistryAtom,
  // Per-session data (AISessionView owns its own data)
  sessionStoreAtom,
  sessionDataAtom, // deprecated alias
  updateSessionStoreAtom, // Unified update atom
  sessionMessagesAtom,
  sessionTokenUsageAtom,
  sessionLoadingAtom,
  sessionModeAtom,
  sessionModelAtom,
  sessionArchivedAtom,
  sessionActiveAtom,
  sessionTitleAtom,
  sessionProviderAtom,
  sessionParentIdDerivedAtom,
  sessionWorktreeIdAtom,
  openSessionsAtom,
  loadSessionDataAtom,
  updateSessionDataAtom, // deprecated - use updateSessionStoreAtom
  reloadSessionDataAtom,
  cleanupSessionAtom,
  // Hierarchical session atoms (workstreams)
  sessionChildrenAtom,
  sessionActiveChildAtom,
  sessionHasChildrenAtom,
  sessionOrChildProcessingAtom,
  groupSessionStatusAtom,
  sessionParentIdAtom,
  loadSessionChildrenAtom,
  setActiveChildSessionAtom,
  createChildSessionAtom,
  // Workstream atoms (AgentMode rewrite)
  selectedWorkstreamAtom,
  setSelectedWorkstreamAtom,
  workstreamSessionsAtom,
  setActiveSessionInWorkstreamAtom, // Wrapper that also marks as read
  workstreamProcessingAtom,
  workstreamUnreadAtom,
  workstreamPendingPromptAtom,
  workstreamPendingInteractivePromptAtom,
  workstreamTitleAtom,
  type SessionInfo,
  type SessionListItem,
  type OpenSession,
  type WorkstreamType,
  reparentSessionAtom,
} from './atoms/sessions';

// File tree atoms (Electron file watcher)
export {
  fileTreeAtom,
  gitStatusMapAtom,
  fileGitStatusAtom,
  expandedDirsAtom,
  isDirExpandedAtom,
  selectedFilePathAtom,
  selectedFolderPathAtom,
  activeFilePathAtom,
  fileTreeFilterAtom,
  directoryGitStatusAtom,
  modifiedFileCountAtom,
  updateGitStatusAtom,
  toggleDirExpandedAtom,
  revealFileAtom,
  revealFolderAtom,
  type GitStatusCode,
  type FileGitStatus,
  type FileTreeItem,
} from './atoms/fileTree';

// Tracker atoms (Electron-specific)
export {
  trackerCountsAtom,
  trackerCountAtom,
  trackerItemsAtom,
  activeTrackerTypeAtom,
  selectedTrackerItemAtom,
  trackerFilterAtom,
  filteredTrackerItemsAtom,
  totalOpenItemsAtom,
  criticalItemsCountAtom,
  updateTrackerCountsAtom,
  updateTrackerItemsAtom,
  setTrackerFilterAtom,
  clearTrackerFilterAtom,
  type TrackerType,
  type TrackerStatus,
  type TrackerItem,
  type TrackerFilter,
} from './atoms/trackers';

// Agent mode atoms (session history layout)
export {
  agentModeLayoutAtom,
  sessionHistoryWidthAtom,
  sessionHistoryCollapsedAtom,
  filesEditedWidthAtom,
  collapsedGroupsAtom,
  sortOrderAtom,
  viewModeAtom,
  todoPanelCollapsedAtom,
  setAgentModeLayoutAtom,
  setSessionHistoryWidthAtom,
  setFilesEditedWidthAtom,
  toggleCollapsedGroupAtom,
  setCollapsedGroupsAtom,
  setSortOrderAtom,
  setViewModeAtom,
  toggleTodoPanelCollapsedAtom,
  initAgentModeLayout,
  type AgentModeLayout,
} from './atoms/agentMode';

// Project state atoms (Electron persistence)
export {
  projectStateAtom,
  persistNow,
  sidebarWidthAtom,
  sidebarCollapsedAtom,
  aiPanelWidthAtom,
  aiPanelCollapsedAtom,
  bottomPanelHeightAtom,
  bottomPanelTypeAtom,
  persistedExpandedDirsAtom,
  recentFilesAtom,
  setSidebarWidthAtom,
  setSidebarCollapsedAtom,
  setAiPanelWidthAtom,
  setAiPanelCollapsedAtom,
  setBottomPanelHeightAtom,
  setBottomPanelTypeAtom,
  setExpandedDirsAtom,
  addRecentFileAtom,
  updateContextTabsAtom,
  loadProjectStateAtom,
  resetProjectStateAtom,
  type ProjectState,
  type PanelLayout,
  type FileTreeState,
  type ContextTabState,
  type PersistedTabInfo,
} from './atoms/projectState';

// Window mode atoms (files, agent, settings)
export {
  windowModeAtom,
  setWindowModeAtom,
  initWindowMode,
  resetWindowMode,
} from './atoms/windowMode';

// Settings navigation atoms (deep linking to settings panels)
export {
  settingsNavigationAtom,
  settingsInitialCategoryAtom,
  settingsInitialScopeAtom,
  settingsKeyAtom,
  navigateToSettingsAtom,
  clearSettingsNavigationAtom,
  setSettingsInitialCategoryAtom,
  setSettingsInitialScopeAtom,
  incrementSettingsKeyAtom,
  type SettingsScope,
  type SettingsNavigationState,
} from './atoms/settingsNavigation';

// Session editor atoms (per-session embedded editor tabs)
export {
  sessionEditorStateAtom,
  sessionTabKeysAtom,
  sessionActiveTabKeyAtom,
  sessionLayoutModeAtom,
  sessionSplitRatioAtom,
  sessionFilesSidebarVisibleAtom,
  sessionEditorVisibleAtom,
  sessionHasTabsAtom,
  sessionTabCountAtom,
  setSessionTabCountAtom,
  openFileInSessionEditorAtom,
  setSessionLayoutModeAtom,
  setSessionSplitRatioAtom,
  toggleSessionEditorAtom,
  toggleSessionFilesSidebarAtom,
  persistSessionTabs,
  initSessionEditors,
  loadSessionEditorState,
  cleanupSessionEditorState,
  type SessionLayoutMode,
  type SessionEditorState,
} from './atoms/sessionEditors';

// Unified workstream state (replaces fragmented atoms from sessions.ts)
export {
  type WorkstreamState,
  type WorkstreamLayoutMode,
  workstreamStateAtom,
  workstreamTypeAtom,
  workstreamActiveChildAtom,
  workstreamChildrenAtom,
  workstreamLayoutModeAtom,
  workstreamSplitRatioAtom,
  workstreamFilesSidebarVisibleAtom,
  workstreamOpenFilesAtom,
  workstreamActiveFileAtom,
  workstreamWorktreeIdAtom,
  workstreamHasChildrenAtom,
  workstreamHasOpenFilesAtom,
  worktreeActiveSessionAtom,
  setWorktreeActiveSessionAtom,
  setWorkstreamActiveChildAtom,
  setWorkstreamLayoutModeAtom,
  setWorkstreamSplitRatioAtom,
  toggleWorkstreamFilesSidebarAtom,
  addWorkstreamFileAtom,
  closeWorkstreamFileAtom,
  addWorkstreamChildAtom,
  convertToWorkstreamAtom,
  cleanupWorkstreamAtom,
  initWorkstreamState,
  loadWorkstreamStates,
  loadWorkstreamState,
  persistWorkstreamState,
  workstreamStatesLoadedAtom,
} from './atoms/workstreamState';

// File mention atoms (for @ file mentions in AIInput)
export {
  fileMentionOptionsAtom,
  fileMentionQueryAtom,
  documentsLoadingAtom,
  loadDocumentsAtom,
  searchFileMentionAtom,
  selectFileMentionAtom,
  clearFileMentionSearchAtom,
  type FileMentionReference,
} from './atoms/fileMention';

// Unified navigation history (cross-mode back/forward)
export {
  pushNavigationEntryAtom,
  goBackAtom,
  goForwardAtom,
  canGoBackAtom,
  canGoForwardAtom,
  isRestoringNavigationAtom,
  currentNavigationEntryAtom,
  registerNavigationRestoreCallbacks,
  initNavigationHistory,
  clearNavigationHistory,
  type NavigationEntry,
  type FilesNavigationState,
  type AgentNavigationState,
  type SettingsHistoryState,
} from './atoms/navigationHistory';

// Session transcript atoms (centralized state for SessionTranscript)
// Note: ExitPlanMode uses inline widget, no atom needed
export {
  sessionErrorAtom,
  sessionQueuedPromptsAtom,
  type QueuedPrompt,
} from './atoms/sessionTranscript';

// Session transcript listeners (centralized IPC handlers)
export {
  initSessionTranscriptListeners,
  loadInitialQueuedPrompts,
  clearSessionError,
} from './listeners/sessionTranscriptListeners';
