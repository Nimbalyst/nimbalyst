import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { usePostHog } from 'posthog-js/react';
import { logger } from './utils/logger';
import type { LexicalCommand } from 'rexical';
// aiChatBridge has been replaced by editorRegistry
// Import styles - handled by vite plugin for both dev and prod
import 'rexical/styles';
// Import refactored hooks and utilities
import { useIPCHandlers } from './hooks/useIPCHandlers';
import { useWindowLifecycle } from './hooks/useWindowLifecycle';
import { useTheme } from './hooks/useTheme';
import { useConfirmDialog } from './hooks/useConfirmDialog';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useOnboarding } from './hooks/useOnboarding';
// NOTE: useDocumentContext removed - we build documentContext manually now
import { handleWorkspaceFileSelect as handleWorkspaceFileSelectUtil } from './utils/workspaceFileOperations';
import { createInitialFileContent } from './utils/fileUtils';
import { aiToolService } from './services/AIToolService';
import { editorRegistry } from '@nimbalyst/runtime/ai/EditorRegistry';
import { WorkspaceWelcome } from './components/WorkspaceWelcome.tsx';
// Dialog system - new centralized dialog management
import { DialogProvider, dialogRef } from './contexts/DialogContext';
import { initializeDialogs, DIALOG_IDS } from './dialogs';
import type { ProjectSelectionData, ErrorDialogData } from './dialogs';
import { NavigationDialogKeyboardHandler } from './components/NavigationDialogKeyboardHandler';
import { ConfirmDialog } from './components/ConfirmDialog/ConfirmDialog';
// NOTE: DiscordInvitation, KeyboardShortcutsDialog, ApiKeyDialog now managed by DialogProvider
// NOTE: WindowsClaudeCodeWarning now managed by DialogProvider
// NOTE: ErrorDialog now managed by DialogProvider
import { ErrorToastContainer } from './components/ErrorToast/ErrorToast';
// NOTE: ProjectSelectionDialog now managed by DialogProvider
// NOTE: UnifiedOnboarding now managed by DialogProvider
import { WorkspaceManager } from './components/WorkspaceManager/WorkspaceManager.tsx';
import { AIUsageReport } from './components/AIUsageReport';
import { DatabaseBrowser } from './components/DatabaseBrowser/DatabaseBrowser';
import { AgentMode, type AgentModeRef } from './components/AgentMode';
import { ChatSidebar, type ChatSidebarRef } from './components/ChatSidebar';
import EditorMode, { type EditorModeRef } from './components/EditorMode/EditorMode';
import { TabsProvider } from './contexts/TabsContext';
import { NavigationGutter } from './components/NavigationGutter';
// NOTE: useTabs and useTabNavigation removed - EditorMode manages tabs now
import type { ContentMode } from './types/WindowModeTypes';
import {
  windowModeAtom,
  setWindowModeAtom,
  initWindowMode,
  settingsInitialCategoryAtom,
  settingsInitialScopeAtom,
  settingsKeyAtom,
  setSettingsInitialCategoryAtom,
  setSettingsInitialScopeAtom,
  incrementSettingsKeyAtom,
  clearSettingsNavigationAtom,
  // Unified navigation history
  goBackAtom,
  goForwardAtom,
  registerNavigationRestoreCallbacks,
  initNavigationHistory,
  // Session state
  sessionModeAtom,
  selectedWorkstreamAtom,
  // Session draft utilities
  setSessionDraftInputAtom,
  // File navigation
  openFileRequestAtom,
} from './store';
import { TrackerBottomPanel } from './components/TrackerBottomPanel/TrackerBottomPanel.tsx';
import { TerminalBottomPanel } from './components/TerminalBottomPanel';
import { registerDocumentLinkPlugin } from './plugins/registerDocumentLinkPlugin';
import { registerAIChatPlugin } from './plugins/registerAIChatPlugin';
import { registerTrackerPlugin } from './plugins/registerTrackerPlugin';
import { registerDiffApprovalBarPlugin } from './plugins/registerDiffApprovalBarPlugin';
import { registerSearchReplacePlugin } from './plugins/registerSearchReplacePlugin';
import { registerMockupPlugin } from './plugins/registerMockupPlugin';
import { registerExtensionSystem, setExtensionWorkspacePath } from './plugins/registerExtensionSystem';
import { SettingsView } from './components/Settings/SettingsView';
import type { SettingsCategory } from './components/Settings/SettingsSidebar';
import { loadCustomTrackers } from './services/CustomTrackerLoader';
import { MockupPickerMenuHost } from './components/MockupPickerMenu';
import { ExtensionHostComponents } from './components/ExtensionHostComponents';
// ClaudeCommandsToast removed - commands now provided via extension-based claude plugins
import { UpdateToast } from './components/UpdateToast';
import { ProjectTrustToast } from './components/ProjectTrustToast';
import { getTextSelection } from './components/UnifiedAI/TextSelectionIndicator';
// NOTE: PostHogSurvey now managed by DialogProvider
import { NotificationSessionChecker } from './components/NotificationSessionChecker';
import OnboardingService from './services/OnboardingService';
import { WalkthroughProvider } from './walkthroughs';
import {
  initializePanelRegistry,
  getPanelById,
  PanelContainer,
  electronStorageBackend,
  initializeElectronStorageBackend,
} from './extensions/panels';
import { setStorageBackend } from '@nimbalyst/runtime';
import { store } from '@nimbalyst/runtime/store';
import { extensionPanelAIContextAtom } from './store/atoms/extensionPanels';
import { setDiffTreeGroupByDirectoryAtom, setAgentFileScopeModeAtom } from './store/atoms/projectState';
import { toggleSessionHistoryCollapsedAtom } from './store/atoms/agentMode';
import { setDeveloperFeatureSettingsAtom } from './store/atoms/appSettings';
import {
  activeTrackerTypeAtom,
  trackerPanelOpenAtom,
  toggleTrackerPanelAtom,
  closeTrackerPanelAtom,
  initTrackerPanelLayout,
} from './store/atoms/trackers';
import {
  terminalPanelVisibleAtom,
  terminalPanelHeightAtom,
  toggleTerminalPanelAtom,
  closeTerminalPanelAtom,
  openTerminalPanelAtom,
  loadTerminalPanelState,
} from './store/atoms/terminals';

logger.ui.info('App.tsx loading');
logger.ui.info('About to import StravuEditor');
logger.ui.info('StravuEditor imported');

// aiChatBridge has been replaced by editorRegistry - no global setup needed

// Logging configuration - control which categories are logged
const LOG_CONFIG = {
  AUTOSAVE: false,  // Set to true to enable autosave logging
  FILE_SYNC: false,  // File sync operations
  FILE_WATCH: false,  // File watcher events
  WORKSPACE_FILE_SELECT: false,  // Workspace file selection
  HMR: false,  // Hot Module Replacement
  AUTO_SNAPSHOT: false,  // Automatic snapshots
  IPC_LISTENERS: false,  // IPC listener setup (very verbose!)
  AI_CHAT_STATE: false,  // AI Chat state save/load
  THEME: false,  // Theme changes
  FILE_OPS: false,  // File open/save operations
  WORKSPACE_OPS: false,  // Workspace open/close operations
};

// Note: FileTreeItem and ElectronAPI interfaces are defined in electron.d.ts

// Register plugins once at module level
// These provide Electron-specific services to the plugins
let pluginsRegistered = false;
if (!pluginsRegistered) {
  registerDocumentLinkPlugin();
  registerTrackerPlugin(null); // Load built-in trackers now, custom trackers loaded in AppLayout
  registerAIChatPlugin();
  // Note: DiffApprovalBarPlugin disabled - now using UnifiedDiffHeader in TabEditor directly
  // registerDiffApprovalBarPlugin();
  registerSearchReplacePlugin(); // Search/replace bar in fixed tab header
  registerMockupPlugin(); // Mockup embedding support
  pluginsRegistered = true;
}

export default function App() {
  if (import.meta.env.DEV) console.log('[App] render');

   // IMPORTANT: This state must be declared before the useEffect that uses it
  // and before any conditional early returns (workspace-manager, usage-report, etc.)
  const [extensionsReady, setExtensionsReady] = useState(false);

  // Initialize dialog system (must run early, before any dialogs are opened)
  useEffect(() => {
    initializeDialogs();
    logger.ui.info('[Dialogs] Dialog system initialized');
  }, []);

  // Register custom editors and extensions based on settings
  useEffect(() => {
    const registerCustomEditors = async () => {
      try {
        // Set up storage backend for extensions BEFORE loading extensions
        setStorageBackend(electronStorageBackend);
        logger.ui.info('[Extensions] Storage backend initialized');

        // Initialize the extension system (discovers and loads extensions)
        // This MUST complete before any editors are mounted so that extension nodes
        // (like DataModelNode) are registered with the pluginRegistry
        await registerExtensionSystem();
        logger.ui.info('[Extensions] Extension system initialized');

        // Initialize panel registry (syncs panels from loaded extensions)
        initializePanelRegistry();
        logger.ui.info('[Extensions] Panel registry initialized');

        // NOTE: MockupLM is now registered via the extension system (com.nimbalyst.mockuplm)
        // The manifest's customEditors contribution handles registration automatically

        logger.ui.info('[CustomEditors] Custom editors registration complete');
      } catch (error) {
        logger.ui.error('[CustomEditors] Failed to register custom editors:', error);
      } finally {
        // Mark extensions as ready even on error - we don't want to block the app
        setExtensionsReady(true);
      }
    };

    registerCustomEditors();
  }, []);

  // PostHog for analytics
  const posthog = usePostHog();

  // Track user activity for sync presence awareness
  useEffect(() => {
    // Throttle activity reports to max once per second
    let lastReportTime = 0;
    const throttleMs = 1000;

    const reportActivity = () => {
      const now = Date.now();
      if (now - lastReportTime > throttleMs) {
        lastReportTime = now;
        window.electronAPI?.reportUserActivity?.();
      }
    };

    // Track keyboard and mouse activity
    document.addEventListener('keydown', reportActivity);
    document.addEventListener('mousedown', reportActivity);
    document.addEventListener('mousemove', reportActivity);
    document.addEventListener('scroll', reportActivity, true);

    return () => {
      document.removeEventListener('keydown', reportActivity);
      document.removeEventListener('mousedown', reportActivity);
      document.removeEventListener('mousemove', reportActivity);
      document.removeEventListener('scroll', reportActivity, true);
    };
  }, []);

  // Check for special window modes
  const urlParams = new URLSearchParams(window.location.search);
  const windowMode = urlParams.get('mode');

  // Apply theme for ALL window modes (must run before early returns)
  const { theme, setTheme } = useTheme();

  // General confirm dialog
  const confirmDialog = useConfirmDialog();

  // Document context hook needs to be after tabs - will declare after special window modes

  // Handle special window modes
  if (windowMode === 'workspace-manager') {
    // Set window title for Workspace Manager
    React.useEffect(() => {
      if (window.electronAPI) {
        window.electronAPI.setTitle('Project Manager - Nimbalyst');
      }
    }, []);
    return <WorkspaceManager />;
  }

  if (windowMode === 'usage-report') {
    // Set window title for AI Usage Report
    React.useEffect(() => {
      if (window.electronAPI) {
        window.electronAPI.setTitle('AI Usage Report - Nimbalyst');
      }
    }, []);
    return <AIUsageReport onClose={() => window.close()} />;
  }

  if (windowMode === 'database-browser') {
    // Set window title for Database Browser
    React.useEffect(() => {
      if (window.electronAPI) {
        window.electronAPI.setTitle('Database Browser - Nimbalyst');
      }
    }, []);
    return <DatabaseBrowser />;
  }

  // IMPORTANT: These are refs, not state, to prevent re-renders when the active file changes.
  // Window title and other side effects are updated imperatively via editorModeRef.
  const currentFilePathRef = useRef<string | null>(null);
  const currentFileNameRef = useRef<string | null>(null);
  // NOTE: isDirty state removed - TabEditor owns dirty state and calls setDocumentEdited directly
  // NOTE: contentVersion removed - EditorContainer doesn't need version bumping for remounts
  // NOTE: tabStatesRef removed - TabEditor tracks its own dirty state
  const tabsRef = useRef<any>(null);  // Reference to current tabs object for use in intervals only
  const [isInitializing, setIsInitializing] = useState(true);
  // NOTE: extensionsReady state moved to top of component (before early returns)
  const [workspaceMode, setWorkspaceMode] = useState(false);
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  // NOTE: fileTree, sidebarWidth, isNewFileDialogOpen, newFileDirectory, isHistoryDialogOpen moved to EditorMode
  // NOTE: Navigation dialogs (QuickOpen, SessionQuickOpen, PromptQuickOpen, AgentCommandPalette) are now managed by DialogProvider
  // NOTE: isAIChatCollapsed, aiChatWidth moved to EditorMode for workspace mode
  // These are kept for potential single-file mode or agent mode use
  const [isAIChatCollapsed, setIsAIChatCollapsed] = useState(false);
  const [aiChatWidth, setAIChatWidth] = useState<number>(350);
  // NOTE: KeyboardShortcutsDialog, DiscordInvitation, PostHogSurvey, ApiKeyDialog are now managed by DialogProvider
  // NOTE: WindowsClaudeCodeWarning now managed by DialogProvider via useOnboarding hook
  const [isAIChatStateLoaded, setIsAIChatStateLoaded] = useState(false);
  // Planning mode for AI sidebar (Claude Code safety). Default ON
  const [aiPlanningModeEnabled, setAIPlanningModeEnabled] = useState<boolean>(true);
  // Force show trust toast (when user wants to change permission mode)
  const [forceShowTrustToast, setForceShowTrustToast] = useState(false);
  const [sessionToLoad, setSessionToLoad] = useState<{ sessionId: string; workspacePath?: string } | null>(null);
  const [currentAISessionId, setCurrentAISessionId] = useState<string | null>(null);
  // NOTE: diffError and projectSelection are now managed by DialogProvider

  // NOTE: UnifiedOnboarding state now managed by DialogProvider via useOnboarding hook

  // Claude commands install toast state
  // Commands toast removed - commands now provided via extension-based claude plugins

  // Settings deep link state - now using atoms
  const settingsInitialCategory = useAtomValue(settingsInitialCategoryAtom);
  const settingsInitialScope = useAtomValue(settingsInitialScopeAtom);
  const settingsKey = useAtomValue(settingsKeyAtom);
  const setSettingsInitialCategory = useSetAtom(setSettingsInitialCategoryAtom);
  const setSettingsInitialScope = useSetAtom(setSettingsInitialScopeAtom);
  const incrementSettingsKey = useSetAtom(incrementSettingsKeyAtom);
  const clearSettingsNavigation = useSetAtom(clearSettingsNavigationAtom);

  // Active extension panel (for sidebar or fullscreen panels from extensions)
  const [activeExtensionPanel, setActiveExtensionPanel] = useState<string | null>(null);

  // Extension panel AI context (synced from PanelContainer when aiSupported panels are active)
  const extensionPanelAIContext = useAtomValue(extensionPanelAIContextAtom);

  // Diff tree grouping state - setter for hydration from workspace state
  const setDiffTreeGroupByDirectory = useSetAtom(setDiffTreeGroupByDirectoryAtom);
  const setAgentFileScopeMode = useSetAtom(setAgentFileScopeModeAtom);

  // Check if a fullscreen extension panel is active (hides other content modes)
  const activeFullscreenPanel = activeExtensionPanel ? getPanelById(activeExtensionPanel) : null;
  const isFullscreenPanelActive = activeFullscreenPanel?.placement === 'fullscreen';

  // Window mode - which view is active (files, agent, settings)
  const activeMode = useAtomValue(windowModeAtom);
  const setActiveMode = useSetAtom(setWindowModeAtom);
  const toggleAgentCollapsed = useSetAtom(toggleSessionHistoryCollapsedAtom);
  const updateDeveloperSettings = useSetAtom(setDeveloperFeatureSettingsAtom);
  // Keep a ref for use in callbacks that might have stale closures
  const activeModeStateRef = useRef<ContentMode>(activeMode);
  useEffect(() => {
    activeModeStateRef.current = activeMode;
  }, [activeMode]);

  // Unified navigation history (cross-mode back/forward)
  const goBack = useSetAtom(goBackAtom);
  const goForward = useSetAtom(goForwardAtom);

  // Onboarding dialogs (UnifiedOnboarding, WindowsClaudeCodeWarning) - managed via DialogProvider
  useOnboarding({
    workspacePath,
    workspaceMode,
    isInitializing,
    setActiveMode,
  });

  // Expose test helpers for testing
  useEffect(() => {
    // Always expose in development
    if (import.meta.env.DEV) {
      (window as any).__testHelpers = {
        ...(window as any).__testHelpers,
        setActiveMode: (mode: any) => setActiveMode(mode),
        getActiveMode: () => activeMode,
        // Settings deep link helpers
        openAgentPermissions: () => {
          setSettingsInitialCategory('agent-permissions');
          setSettingsInitialScope('project');
          incrementSettingsKey();
          setTimeout(() => setActiveMode('settings'), 0);
        },
        openSettings: (category?: any, scope?: 'user' | 'project') => {
          if (category) setSettingsInitialCategory(category);
          if (scope) setSettingsInitialScope(scope);
          incrementSettingsKey();
          setTimeout(() => setActiveMode('settings'), 0);
        },
      };
      console.log('[App] Test helpers exposed, DEV mode:', import.meta.env.DEV);
    }
  }, [activeMode]);

  // Tracker panel state from atoms
  const isTrackerPanelOpen = useAtomValue(trackerPanelOpenAtom);
  const toggleTrackerPanel = useSetAtom(toggleTrackerPanelAtom);
  const closeTrackerPanel = useSetAtom(closeTrackerPanelAtom);

  // Terminal bottom panel state (Jotai atoms)
  const terminalPanelVisible = useAtomValue(terminalPanelVisibleAtom);
  const terminalPanelHeight = useAtomValue(terminalPanelHeightAtom);
  const toggleTerminalPanel = useSetAtom(toggleTerminalPanelAtom);
  const closeTerminalPanel = useSetAtom(closeTerminalPanelAtom);
  const openTerminalPanel = useSetAtom(openTerminalPanelAtom);

  // Agent panel plan reference (for launching from plan status)
  const [agentPlanReference, setAgentPlanReference] = useState<string | null>(null);

  // NOTE: Onboarding check and handlers moved to useOnboarding hook

  // Load custom trackers when workspace is available
  useEffect(() => {
    if (workspacePath) {
      loadCustomTrackers(workspacePath);
    }
  }, [workspacePath]);

  // Initialize storage backend for extensions when workspace path changes
  useEffect(() => {
    initializeElectronStorageBackend(workspacePath);
  }, [workspacePath]);

  // Load diff tree state from workspace state
  // NOTE: activeMode is restored by initWindowMode() in the initial load effect
  useEffect(() => {
    if (!workspacePath || !window.electronAPI?.invoke) return;

    window.electronAPI.invoke('workspace:get-state', workspacePath)
      .then(state => {
        // Hydrate diff tree grouping state into Jotai atom
        if (state?.diffTreeGroupByDirectory !== undefined) {
          setDiffTreeGroupByDirectory({ groupByDirectory: state.diffTreeGroupByDirectory, workspacePath });
        }
        // Hydrate agent file scope mode into Jotai atom
        if (state?.agentFileScopeMode !== undefined) {
          setAgentFileScopeMode({ fileScopeMode: state.agentFileScopeMode, workspacePath });
        }
      })
      .catch(error => {
        console.error('[App] Failed to load workspace state:', error);
      });
  }, [workspacePath, setDiffTreeGroupByDirectory, setAgentFileScopeMode]);

  // Save active mode when it changes
  useEffect(() => {
    // console.log('[App Layout] Active mode changed to:', activeMode, 'workspacePath:', workspacePath);

    if (!workspacePath || !window.electronAPI?.invoke) return;

    const updates = { activeMode };
    // console.log('[App Layout] Saving updates:', JSON.stringify(updates));
    window.electronAPI.invoke('workspace:update-state', workspacePath, updates)
      .then((result) => {
        // console.log('[App Layout] Successfully saved active mode:', activeMode, 'result:', result);
      })
      .catch(error => {
        console.error('[ContentMode] Failed to save active mode:', error);
      });
  }, [activeMode, workspacePath]);

  // Initialize tracker panel state from workspace state
  useEffect(() => {
    if (workspacePath) {
      initTrackerPanelLayout(workspacePath);
    }
  }, [workspacePath]);

  // Load terminal panel state from terminal store into Jotai atoms
  useEffect(() => {
    if (!workspacePath) return;
    loadTerminalPanelState().then(() => {
      // If terminal panel is visible on load, close tracker panel (mutually exclusive)
      if (store.get(terminalPanelVisibleAtom)) {
        closeTrackerPanel();
      }
    });
  }, [workspacePath, closeTrackerPanel]);


  // Register aiToolService methods on aiChatBridge for runtime to use
  useEffect(() => {
    aiToolService.registerBridgeMethods();
  }, []);

  // Debug: Log computed layout dimensions after render
  useEffect(() => {
    // Use setTimeout to ensure DOM has updated
    const timeout = setTimeout(() => {
      const rootContainer = document.querySelector('[data-layout="root-container"]') as HTMLElement;
      const navGutter = document.querySelector('.navigation-gutter') as HTMLElement;
      const mainColumnContainer = document.querySelector('[data-layout="main-column-container"]') as HTMLElement;
      const topContentRow = document.querySelector('[data-layout="top-content-row"]') as HTMLElement;
      const centerContentWrapper = document.querySelector('[data-layout="center-content-wrapper"]') as HTMLElement;
      const filesModeWrapper = document.querySelector('[data-layout="files-mode-wrapper"]') as HTMLElement;
      const agentModeWrapper = document.querySelector('[data-layout="agent-mode-wrapper"]') as HTMLElement;
      const fileTabsContainer = document.querySelector('.file-tabs-container') as HTMLElement;
      const bottomPanelContainer = document.querySelector('.bottom-panel-container') as HTMLElement;

      const logDimensions = (name: string, el: HTMLElement | null) => {
        if (!el) return { found: false };
        const styles = window.getComputedStyle(el);
        return {
          found: true,
          height: el.clientHeight,
          offsetTop: el.offsetTop,
          scrollTop: el.scrollTop,
          scrollHeight: el.scrollHeight,
          flex: styles.flex,
          overflow: styles.overflow,
          minHeight: styles.minHeight,
          position: styles.position,
          top: styles.top,
          transform: styles.transform,
          margin: styles.margin
        };
      };

      // console.log('[App Layout] === FULL LAYOUT DIMENSIONS ===');
      // console.log('[App Layout] Window height:', window.innerHeight);
      // console.log('[App Layout] Active mode:', activeMode, '| Bottom panel:', bottomPanel);
      // console.log('[App Layout] ---');
      // console.log('[App Layout] root-container:', logDimensions('root', rootContainer));
      // console.log('[App Layout] navigation-gutter:', logDimensions('nav', navGutter));
      // console.log('[App Layout] main-column-container:', logDimensions('main-col', mainColumnContainer));
      // console.log('[App Layout] top-content-row:', logDimensions('top-row', topContentRow));
      // console.log('[App Layout] center-content-wrapper:', logDimensions('center', centerContentWrapper));
      // console.log('[App Layout] files-mode-wrapper:', logDimensions('files-wrapper', filesModeWrapper));
      // console.log('[App Layout] agent-mode-wrapper:', logDimensions('agent-wrapper', agentModeWrapper));
      // console.log('[App Layout] file-tabs-container:', logDimensions('tabs', fileTabsContainer));
      // console.log('[App Layout] bottom-panel-container:', logDimensions('bottom', bottomPanelContainer));

      // Calculate totals
      const topRowHeight = topContentRow?.clientHeight || 0;
      const bottomPanelHeight = bottomPanelContainer?.clientHeight || 0;
      const total = topRowHeight + bottomPanelHeight;
      const mainColHeight = mainColumnContainer?.clientHeight || 0;

      // console.log('[App Layout] ---');
      // console.log('[App Layout] MATH CHECK:');
      // console.log('[App Layout]   top-content-row height:', topRowHeight);
      // console.log('[App Layout]   bottom-panel height:', bottomPanelHeight);
      // console.log('[App Layout]   TOTAL:', total);
      // console.log('[App Layout]   main-column-container height:', mainColHeight);
      // console.log('[App Layout]   DIFFERENCE:', total - mainColHeight, (total === mainColHeight ? '✓ OK' : '✗ MISMATCH!'));
      //
      // // Check viewport positions
      // console.log('[App Layout] ---');
      // console.log('[App Layout] VIEWPORT POSITIONS (getBoundingClientRect):');
      if (fileTabsContainer) {
        const rect = fileTabsContainer.getBoundingClientRect();
        // console.log('[App Layout]   file-tabs-container: top=' + rect.top + ', visible=' + (rect.top >= 0));
      }
      if (topContentRow) {
        const rect = topContentRow.getBoundingClientRect();
        // console.log('[App Layout]   top-content-row: top=' + rect.top + ', visible=' + (rect.top >= 0));
      }
      // console.log('[App Layout] ================================');
    }, 100);

    return () => clearTimeout(timeout);
  }, [activeMode, isTrackerPanelOpen]);

  // NOTE: Tab management moved to EditorMode. App.tsx no longer maintains tabs.
  // Current file info is stored in refs to prevent re-renders.

  // Declare refs needed by hooks below
  const getContentRef = useRef<(() => string) | null>(null);

  // Build document context for AI features - reads from refs, stable object reference
  // Components that need to use this should call getLatestContent() to get current state
  const documentContext = useMemo(() => ({
    get filePath() { return currentFilePathRef.current || ''; },
    fileType: 'markdown' as const,
    content: '', // Don't call getContentRef during render - getLatestContent will be called when needed
    cursorPosition: undefined,
    selection: undefined,
    getLatestContent: () => getContentRef.current?.() || '',
    get textSelection() { return getTextSelection() ?? undefined; },
    get textSelectionTimestamp() { return getTextSelection()?.timestamp ?? undefined; }
  }), []); // Empty deps - never recreates, reads from refs

  // Build extension panel context for AI features (when an aiSupported panel is active)
  // This provides extension-specific context (e.g., database name, schema) to the AI chat
  const extensionPanelDocumentContext = useMemo(() => {
    if (!extensionPanelAIContext) return undefined;
    return {
      filePath: `extension:${extensionPanelAIContext.panelId}`,
      fileType: 'extension-panel' as const,
      content: JSON.stringify(extensionPanelAIContext.context, null, 2),
      cursorPosition: undefined,
      selection: undefined,
      getLatestContent: () => JSON.stringify(extensionPanelAIContext.context, null, 2),
      // Extension-specific metadata
      extensionId: extensionPanelAIContext.extensionId,
      panelId: extensionPanelAIContext.panelId,
      panelTitle: extensionPanelAIContext.panelTitle,
    };
  }, [extensionPanelAIContext]);
  const searchCommandRef = useRef<LexicalCommand<undefined> | null>(null);
  const isInitializedRef = useRef<boolean>(false);
  const chatSidebarRef = useRef<ChatSidebarRef>(null);
  const agentModeRef = useRef<AgentModeRef>(null);
  const editorModeRef = useRef<EditorModeRef>(null);

  // NOTE: autoSaveIntervalRef and autoSaveCancellationRef removed - EditorContainer handles autosave now
  const activeSavesRef = useRef<Set<string>>(new Set());
  const lastSavePathRef = useRef<string | null>(null);
  const lastChangeTimeRef = useRef<number>(0);  // Track when content last changed for debouncing
  // NOTE: sidebarRef and isResizingRef moved to EditorMode

  // Window lifecycle hook - handles mount/unmount and beforeunload
  useWindowLifecycle({
    tabsRef,
    getContentRef,
    currentFilePathRef,
  });

  // NOTE: useHMRStateRestoration removed - no longer needed now that TabEditor
  // manages all editor state and useTabs persists tabs to localStorage. During HMR, tabs will
  // be restored from localStorage and editors recreated from tab content.

  // Prepare AI chat state loading
  useEffect(() => {
    setIsAIChatStateLoaded(false);
  }, []);

  // NOTE: Sidebar width loading moved to EditorMode

  // Expose workspacePath and currentFilePath globally for plugins
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).workspacePath = workspacePath;
    }
    // Update extension system with workspace path for MCP tool registration
    setExtensionWorkspacePath(workspacePath);
  }, [workspacePath]);

  // NOTE: currentFilePath is now exposed to window via EditorMode's imperative updates
  // The ref is updated when tabs change, and EditorMode handles the window exposure

  // NOTE: Sidebar resize handlers moved to EditorMode


  // Handle new file (legacy - used in single-file mode)
  const handleNew = useCallback(() => {
    // Reset refs for new file
    currentFilePathRef.current = null;
    currentFileNameRef.current = null;

    // Note: In workspace mode, this is handled by EditorMode via 'file-new-in-workspace' event
  }, []);

  // Handle open file - delegate to EditorMode in workspace mode
  const handleOpen = useCallback(async () => {
    if (workspaceMode && editorModeRef.current) {
      await editorModeRef.current.handleOpen();
    } else {
      // TODO: Handle single-file mode if needed
      console.warn('handleOpen called but not in workspace mode');
    }
  }, [workspaceMode]);

  // Handle save as - delegate to EditorMode in workspace mode
  const handleSaveAs = useCallback(async () => {
    if (workspaceMode && editorModeRef.current) {
      await editorModeRef.current.handleSaveAs();
    } else {
      // TODO: Handle single-file mode if needed
      console.warn('handleSaveAs called but not in workspace mode');
    }
  }, [workspaceMode]);

  // Manual save function provided by EditorContainer
  const handleSaveRef = useRef<(() => Promise<void>) | null>(null);

  // Handle close workspace
  const handleCloseWorkspace = useCallback(async () => {
    // NOTE: EditorContainer handles saving dirty files automatically
    // Close the window
    window.close();
  }, []);

  // Handle switch to agent mode - extracted to useCallback to prevent EditorMode re-renders
  const handleSwitchToAgentMode = useCallback((planDocumentPath?: string, sessionId?: string) => {
    // Switch to agent mode first
    setActiveMode('agent');

    // Wait for next tick to ensure AgentMode is mounted/visible
    setTimeout(() => {
      if (planDocumentPath) {
        // Create new session with document reference
        // AgentMode doesn't support planDocumentPath yet, just create a new session
        if (agentModeRef.current?.createNewSession) {
          agentModeRef.current.createNewSession();
        }
      } else if (sessionId && agentModeRef.current) {
        // Load existing session
        console.log('Load session:', sessionId);
        agentModeRef.current.openSessionInTab(sessionId);
      }
    }, 100);
  }, []);

  // Wrapper for workspace file selection - delegates to EditorMode
  // CRITICAL: Use activeModeStateRef.current to avoid stale closure bugs
  // This function is passed to AgenticPanel and stored in callbacks that may have stale references
  const handleWorkspaceFileSelect = useCallback(async (filePath: string) => {
    const currentMode = activeModeStateRef.current;

    // CRITICAL: If workspacePath is null, something is very wrong
    if (!workspacePath) {
      console.error('[App.handleWorkspaceFileSelect] ERROR: workspacePath is null/undefined! Cannot open file.');
      return;
    }

    // Switch to files mode if needed
    if (currentMode !== 'files') {
      setActiveMode('files');
    }

    // Delegate to EditorMode
    if (editorModeRef.current) {
      await editorModeRef.current.selectFile(filePath);
    } else {
      console.error('[App.handleWorkspaceFileSelect] editorModeRef.current is null! This should never happen if workspacePath is set.');
    }
  }, [workspacePath]); // Only workspacePath - activeMode is read from ref

  // Configure aiToolService with handleWorkspaceFileSelect
  useEffect(() => {
    aiToolService.setHandleWorkspaceFileSelectFunction(handleWorkspaceFileSelect);
  }, [handleWorkspaceFileSelect]);

  // Subscribe to openFileRequestAtom (breadcrumb clicks from any mode)
  useEffect(() => {
    const unsub = store.sub(openFileRequestAtom, () => {
      const req = store.get(openFileRequestAtom);
      if (req) {
        handleWorkspaceFileSelect(req.path);
        store.set(openFileRequestAtom, null);
      }
    });
    return unsub;
  }, [handleWorkspaceFileSelect]);

  // File opener - delegates to EditorMode in workspace mode
  useEffect(() => {
    const fileOpener = async (filePath: string, content: string, switchToTab: boolean) => {
      if (workspaceMode && editorModeRef.current && switchToTab) {
        await editorModeRef.current.selectFile(filePath);
      }
    };
    editorRegistry.setFileOpener(fileOpener);
  }, [workspaceMode]);

  // Welcome tab - no-op in workspace mode (workspace always shows file tree)
  const openWelcomeTab = useCallback(async () => {
    // No-op: workspace mode doesn't use welcome tabs, always shows file tree
  }, []);

  // Register unified navigation restore callbacks
  // These are called when goBack/goForward restores a navigation entry
  useEffect(() => {
    registerNavigationRestoreCallbacks({
      setMode: (mode) => {
        setActiveMode(mode);
      },
      restoreFiles: (state) => {
        // Switch to files mode and select the tab
        if (editorModeRef.current) {
          editorModeRef.current.selectFile(state.filePath);
        }
      },
      restoreAgent: (state) => {
        // Switch to agent mode and select the session
        if (agentModeRef.current) {
          agentModeRef.current.openSessionInTab(state.workstreamId);
        }
      },
      restoreSettings: (state) => {
        // Switch to settings mode and select the category
        setSettingsInitialCategory(state.category as any);
        setSettingsInitialScope(state.scope);
        incrementSettingsKey();
      },
    });
  }, []);

  // Listen for unified navigation back/forward IPC events
  useEffect(() => {
    if (!window.electronAPI?.on) return;

    const handleGoBack = () => {
      console.log('[App] navigation:go-back received, using unified navigation');
      goBack();
    };

    const handleGoForward = () => {
      console.log('[App] navigation:go-forward received, using unified navigation');
      goForward();
    };

    window.electronAPI.on('navigation:go-back', handleGoBack);
    window.electronAPI.on('navigation:go-forward', handleGoForward);

    return () => {
      window.electronAPI.off?.('navigation:go-back', handleGoBack);
      window.electronAPI.off?.('navigation:go-forward', handleGoForward);
    };
  }, [goBack, goForward]);

  // Listen for mouse back/forward button clicks (unified navigation)
  useEffect(() => {
    const handleMouseButton = (event: MouseEvent) => {
      // Mouse button 3 = back, button 4 = forward (side buttons on mice)
      // See: https://developer.mozilla.org/en-US/docs/Web/API/MouseEvent/button
      if (event.button === 3) {
        event.preventDefault();
        event.stopPropagation();
        goBack();
      } else if (event.button === 4) {
        event.preventDefault();
        event.stopPropagation();
        goForward();
      }
    };

    // Use auxclick which is specifically designed for non-primary mouse buttons
    document.addEventListener('auxclick', handleMouseButton);

    return () => {
      document.removeEventListener('auxclick', handleMouseButton);
    };
  }, [goBack, goForward]);

  // Listen for IPC events from menu
  useEffect(() => {
    if (!window.electronAPI?.on) return;

    const handleSetContentMode = (mode: ContentMode) => {
      console.log('[App] handleSetContentMode called with mode:', mode);
      setActiveMode(mode);
    };

    const handleInsertPlanReference = (planPath: string) => {
      console.log('[App] handleInsertPlanReference called with path:', planPath);
      setAgentPlanReference(planPath);
    };

    const handleShowProjectSelectionDialog = (data: { filePath: string; fileName: string; suggestedWorkspace?: string }) => {
      console.log('[App] handleShowProjectSelectionDialog called with data:', data);
      if (dialogRef.current) {
        dialogRef.current.open<ProjectSelectionData>(DIALOG_IDS.PROJECT_SELECTION, {
          filePath: data.filePath,
          fileName: data.fileName,
          suggestedWorkspace: data.suggestedWorkspace,
          onSelectProject: async (selectedWorkspacePath) => {
            await window.electronAPI.invoke('project-selected', {
              filePath: data.filePath,
              workspacePath: selectedWorkspacePath
            });
          },
          onCancel: () => {
            window.electronAPI.invoke('project-selection-cancelled', {
              filePath: data.filePath
            });
          }
        });
      }
    };

    // console.log('[App] Setting up IPC listener for set-content-mode');
    window.electronAPI.on('set-content-mode', handleSetContentMode);
    window.electronAPI.on('agent:insert-plan-reference', handleInsertPlanReference);
    window.electronAPI.on('show-project-selection-dialog', handleShowProjectSelectionDialog);
    // NOTE: toggle-ai-chat-panel is handled by EditorMode where the AI chat state lives
    // COMMENTED OUT - Cmd+K now switches to Agent mode
    // window.electronAPI.on('toggle-agent-palette', handleToggleAgentPalette);

    return () => {
      // console.log('[App] Removing IPC listener for set-content-mode');
      window.electronAPI.off?.('set-content-mode', handleSetContentMode);
      window.electronAPI.off?.('agent:insert-plan-reference', handleInsertPlanReference);
      window.electronAPI.off?.('show-project-selection-dialog', handleShowProjectSelectionDialog);
      // window.electronAPI.off?.('toggle-agent-palette', handleToggleAgentPalette);
    };
  }, []); // Remove workspaceMode dependency - listener should always be active

  // Listen for agent-new-session IPC event (Cmd+N in agent mode)
  useEffect(() => {
    // console.log('[App] Setting up IPC listener for agent-new-session');
    if (!window.electronAPI?.onAgentNewSession) {
      console.log('[App] electronAPI.onAgentNewSession not available');
      return;
    }

    const handleAgentNewSession = () => {
      console.log('[App] Received agent-new-session event');
      if (agentModeRef.current) {
        agentModeRef.current.createNewSession();
      } else {
        console.warn('[App] agentModeRef not available');
      }
    };

    const cleanup = window.electronAPI.onAgentNewSession(handleAgentNewSession);

    return () => {
      // console.log('[App] Cleaning up agent-new-session listener');
      cleanup();
    };
  }, []);

  // Listen for Discord invitation IPC event
  useEffect(() => {
    // console.log('[App] Setting up Discord invitation IPC listener');
    if (!window.electronAPI?.on) {
      console.log('[App] electronAPI.on not available');
      return;
    }

    const handleShowDiscordInvitation = () => {
      console.log('[App] Received show-discord-invitation event');
      if (dialogRef.current) {
        dialogRef.current.open(DIALOG_IDS.DISCORD_INVITATION, {
          onDismiss: () => {
            // No additional action needed - dialog will close automatically
          }
        });
      }
    };

    window.electronAPI.on('show-discord-invitation', handleShowDiscordInvitation);
    // console.log('[App] Discord invitation listener registered');

    return () => {
      // console.log('[App] Removing Discord invitation listener');
      window.electronAPI.off?.('show-discord-invitation', handleShowDiscordInvitation);
    };
  }, []);

  // NOTE: Windows Claude Code warning and onboarding IPC listeners moved to useOnboarding hook
  // NOTE: show-commands-toast IPC listener removed - commands now via extension-based plugins

  // Listen for show-trust-toast IPC event (from Developer menu)
  useEffect(() => {
    if (!window.electronAPI?.on) return;

    const handleShowTrustToast = () => {
      setForceShowTrustToast(true);
    };

    window.electronAPI.on('show-trust-toast', handleShowTrustToast);

    return () => {
      window.electronAPI.off?.('show-trust-toast', handleShowTrustToast);
    };
  }, []);

  // Listen for show-session-import-dialog IPC event (from Developer menu)
  useEffect(() => {
    if (!window.electronAPI?.on) return;

    const handleShowSessionImportDialog = () => {
      if (dialogRef.current && workspacePath) {
        dialogRef.current.open(DIALOG_IDS.SESSION_IMPORT, {
          workspacePath,
        });
      }
    };

    window.electronAPI.on('show-session-import-dialog', handleShowSessionImportDialog);

    return () => {
      window.electronAPI.off?.('show-session-import-dialog', handleShowSessionImportDialog);
    };
  }, [workspacePath]);

  // NOTE: Commands toast check removed - commands now via extension-based plugins

  // Update window title for files mode - agent mode sets title directly from AgenticPanel
  useEffect(() => {
    if (!window.electronAPI) return;
    // Skip if in agent mode - AgenticPanel manages the title
    if (activeMode === 'agent') return;

    let title = 'Nimbalyst';
    if (workspaceMode && workspaceName) {
      title = `${workspaceName} - Nimbalyst`;
    }

    window.electronAPI.setTitle(title);
  }, [workspaceMode, workspaceName, activeMode]);

  // Keyboard shortcuts (Cmd+E, Cmd+K, Cmd+Y, bottom panel shortcuts, terminal toggle, Cmd+Alt+W)
  useKeyboardShortcuts({
    activeMode,
    workspaceMode,
    setActiveMode,
    activeModeStateRef,
    editorModeRef,
    agentModeRef,
    toggleAgentCollapsed,
  });

  // Listen for terminal:show events (from worktree terminal button)
  useEffect(() => {
    const handleTerminalShow = () => {
      openTerminalPanel();
      closeTrackerPanel(); // Close tracker when opening terminal
    };

    window.addEventListener('terminal:show', handleTerminalShow);
    return () => window.removeEventListener('terminal:show', handleTerminalShow);
  }, [openTerminalPanel, closeTrackerPanel]);

  // Listen for open-ai-session events (from rebase/merge conflict resolution)
  useEffect(() => {
    const handleOpenAiSession = async (event: CustomEvent<{ sessionId: string; workspacePath: string; draftInput?: string }>) => {
      const { sessionId, workspacePath: eventWorkspacePath, draftInput } = event.detail;

      // Set the draft input BEFORE navigating so it's ready when the session mounts
      // This is the canonical pattern for creating sessions with initial prompts
      if (draftInput) {
        store.set(setSessionDraftInputAtom, {
          sessionId,
          draftInput,
          workspacePath: eventWorkspacePath,
          persist: true,
        });
      }

      // Switch to agent mode if needed
      if (activeMode !== 'agent') {
        setActiveMode('agent');
      }

      // Open the session using the AgentMode ref
      if (agentModeRef.current) {
        await agentModeRef.current.openSessionInTab(sessionId);
      }
    };

    window.addEventListener('open-ai-session', handleOpenAiSession as unknown as EventListener);
    return () => window.removeEventListener('open-ai-session', handleOpenAiSession as unknown as EventListener);
  }, [activeMode]);

  // Save AI Chat state when it changes (but only after initial load)
  useEffect(() => {
    if (!workspacePath || !workspaceMode || !isAIChatStateLoaded) return;
    if (!window.electronAPI?.invoke) return;

    const saveAIChatState = async () => {
      try {
        const aiPanelState = {
          collapsed: isAIChatCollapsed,
          width: aiChatWidth,
          currentSessionId: currentAISessionId || undefined,
          planningModeEnabled: aiPlanningModeEnabled,
        };
        if (LOG_CONFIG.AI_CHAT_STATE) console.log('[AI_CHAT] Saving AI Chat state:', aiPanelState);
        await window.electronAPI.invoke('workspace:update-state', workspacePath, {
          aiPanel: aiPanelState
        });
      } catch (error) {
        console.error('[AI_CHAT] Failed to save AI Chat state:', error);
      }
    };

    saveAIChatState();
  }, [isAIChatCollapsed, aiChatWidth, currentAISessionId, aiPlanningModeEnabled, isAIChatStateLoaded, workspacePath, workspaceMode]);

  // Handle QuickOpen file selection - delegates to EditorMode and switches mode if needed
  const handleQuickOpenFileSelect = useCallback(async (filePath: string) => {
    // Switch to files mode if we're in a different mode
    if (activeMode !== 'files') {
      setActiveMode('files');
    }

    // Delegate to EditorMode's file selection handler
    if (editorModeRef.current) {
      await editorModeRef.current.selectFile(filePath);
    }
  }, [activeMode]);

  // Handle SessionQuickOpen session selection - switches to agent mode and opens session
  const handleSessionQuickOpenSelect = useCallback(async (sessionId: string) => {
    // Switch to agent mode
    if (activeMode !== 'agent') {
      setActiveMode('agent');
    }

    // Open session in AgentMode
    if (agentModeRef.current) {
      await agentModeRef.current.openSessionInTab(sessionId);
    }
  }, [activeMode]);

  // Handle PromptQuickOpen session selection - same as SessionQuickOpen
  const handlePromptQuickOpenSelect = useCallback(async (sessionId: string) => {
    // Switch to agent mode
    if (activeMode !== 'agent') {
      setActiveMode('agent');
    }

    // Open session in AgentMode
    if (agentModeRef.current) {
      await agentModeRef.current.openSessionInTab(sessionId);
    }
  }, [activeMode]);

  // NOTE: handleCreateNewFile and handleRestoreFromHistory moved to EditorMode

  // NOTE: File path sync with backend is now handled imperatively by EditorMode
  // when the active tab changes. See EditorMode's subscription to tabsActions.

  // NOTE: EditorContainer now handles all autosave functionality with per-editor timers
  // Old autosave useEffects removed - see EditorContainer.tsx lines 218-281

  // NOTE: Periodic snapshot functionality moved to EditorContainer

  // NOTE: EditorContainer handles all content loading for tabs
  // This useEffect is no longer needed - removed to avoid conflicts

  // Load initial state on mount
  useEffect(() => {
    const loadInitialState = async () => {
      try {
        // Load window initial state
        if (window.electronAPI?.getInitialState) {
          const initialState = await window.electronAPI.getInitialState();
          if (initialState && initialState.mode === 'workspace') {
            // Set workspace state immediately
            setWorkspaceMode(true);
            setWorkspacePath(initialState.workspacePath ?? null);
            setWorkspaceName(initialState.workspaceName ?? null);
            // NOTE: fileTree loading moved to EditorMode

            // Initialize window mode from workspace state (await to prevent flash of wrong mode)
            if (initialState.workspacePath) {
              await initWindowMode(initialState.workspacePath);
              // Initialize unified navigation history
              await initNavigationHistory(initialState.workspacePath);
            }
          }
        }
      } catch (error) {
        console.error('[INIT] Failed to load initial state:', error);
      } finally {
        setIsInitializing(false);
      }
    };

    loadInitialState();
  }, []);


  // Mode-aware tab navigation handlers
  const handleNextTab = () => {
    if (activeMode === 'agent') {
      agentModeRef.current?.nextTab?.();
    } else {
      editorModeRef.current?.tabs?.nextTab?.();
    }
  };

  const handlePreviousTab = () => {
    if (activeMode === 'agent') {
      agentModeRef.current?.previousTab?.();
    } else {
      editorModeRef.current?.tabs?.previousTab?.();
    }
  };

  // Set up IPC listeners
  // IPC handlers hook - sets up all IPC communication with main process
  useIPCHandlers({
    // Handlers
    handleNew,
    handleOpen,
    handleSave: async () => {
      // Delegate to TabEditor's manual save via TabContent
      if (handleSaveRef.current) {
        await handleSaveRef.current();
      }
    },
    handleSaveAs,
    handleWorkspaceFileSelect,
    openWelcomeTab,
    handleNextTab,
    handlePreviousTab,

    // State
    activeMode,

    // State setters
    setIsApiKeyDialogOpen: () => {}, // Unused - ApiKeyDialog now managed by DialogProvider
    setWorkspaceMode,
    setWorkspacePath,
    setWorkspaceName,
    setIsAIChatCollapsed,
    setAIChatWidth,
    setIsAIChatStateLoaded,
    setSessionToLoad,
    setIsKeyboardShortcutsDialogOpen: () => {}, // Unused - KeyboardShortcutsDialog now managed by DialogProvider
    setIsAgentPaletteVisible: () => {}, // Unused - AgentCommandPalette now managed by DialogProvider
    setAIPlanningMode: setAIPlanningModeEnabled,
    setTheme,

    // Refs
    isInitializedRef,
    getContentRef,
    searchCommandRef,
    editorModeRef,
    currentFilePathRef,
    currentFileNameRef,

    // State values
    workspaceMode,
    workspacePath,
    sessionToLoad,

    // Config
    LOG_CONFIG,
  });

  // Handle AI tool createDocument requests
  useEffect(() => {
    const handleCreateDocument = async (event: CustomEvent) => {
      const { correlationId, filePath, initialContent, switchToFile } = event.detail;
      console.log('[AI Tool] createDocument request received:', { correlationId, filePath, switchToFile });

      try {
        if (!window.electronAPI) {
          throw new Error('Electron API not available');
        }

        // Create the document via IPC
        console.log('[AI Tool] Invoking IPC create-document with:', filePath);
        const result = await window.electronAPI.invoke('create-document', filePath, initialContent);
        console.log('[AI Tool] IPC result:', result);

        if (result.success) {
          // Switch to the new file if requested
          if (switchToFile && result.filePath) {
            console.log('[AI Tool] Switching to new file:', result.filePath);
            await handleWorkspaceFileSelect(result.filePath);
          }

          // Send success response
          console.log('[AI Tool] Sending success response');
          window.dispatchEvent(new CustomEvent('aiToolResponse:createDocument', {
            detail: {
              correlationId,
              success: true,
              filePath: result.filePath
            }
          }));
        } else {
          throw new Error(result.error || 'Failed to create document');
        }
      } catch (error) {
        console.error('[AI Tool] Error creating document:', error);
        // Send error response
        window.dispatchEvent(new CustomEvent('aiToolResponse:createDocument', {
          detail: {
            correlationId,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          }
        }));
      }
    };

    window.addEventListener('aiToolRequest:createDocument', handleCreateDocument as unknown as EventListener);

    return () => {
      window.removeEventListener('aiToolRequest:createDocument', handleCreateDocument as unknown as EventListener);
    };
  }, [handleWorkspaceFileSelect]);

  logger.ui.info('Rendering App with config:', {
    currentFilePath: currentFilePathRef.current,
    currentFileName: currentFileNameRef.current,
    theme
  });

  logger.ui.info('About to render StravuEditor');

  // Debug: expose values for testing (in useEffect to run after state updates)
  // NOTE: These are set imperatively and may not update on every render
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__tabPreferencesEnabled__ = true;
      (window as any).__currentFilePath__ = currentFilePathRef.current;
      (window as any).__currentFileName__ = currentFileNameRef.current;
      (window as any).__workspaceMode__ = workspaceMode;
    }
  }, [workspaceMode]); // Only re-run when workspaceMode changes

  // Handle close confirmation from main process
  useEffect(() => {
    if (!window.electronAPI) return;

    const handleConfirmClose = async () => {
      console.log('[WINDOW CLOSE] Has unsaved changes');
      const confirmed = await confirmDialog.confirm({
        title: 'Unsaved Changes',
        message: 'Do you want to save the changes you made? Your changes will be lost if you don\'t save them.',
        confirmLabel: 'Save',
        cancelLabel: 'Don\'t Save',
        destructive: false
      });

      if (confirmed) {
        // Save
        if (handleSaveRef.current) {
          await handleSaveRef.current();
        }
        window.electronAPI?.send?.('close-window-save');
      } else {
        // Discard
        window.electronAPI?.send?.('close-window-discard');
      }
    };

    window.electronAPI.on('confirm-close-unsaved', handleConfirmClose);

    return () => {
      window.electronAPI?.off?.('confirm-close-unsaved', handleConfirmClose);
    };
  }, [confirmDialog]);

  // Handle close-active-tab from menu - route to active panel
  // NOTE: Uses activeModeStateRef defined earlier near activeMode state
  // Guard against duplicate IPC calls (React StrictMode can cause double-mounting)
  const closeTabInProgressRef = useRef(false);

  useEffect(() => {
    const handleCloseActiveTab = () => {
      // Debounce: if we're already processing a close, ignore duplicate calls
      if (closeTabInProgressRef.current) {
        console.log('[App] handleCloseActiveTab: ignoring duplicate call');
        return;
      }
      closeTabInProgressRef.current = true;
      // Reset the guard after a short delay to allow future closes
      setTimeout(() => { closeTabInProgressRef.current = false; }, 100);

      console.log('[App] handleCloseActiveTab IPC received, activeMode:', activeModeStateRef.current);
      if (activeModeStateRef.current === 'agent') {
        console.log('[App] Routing to agentModeRef.closeActiveTab()');
        agentModeRef.current?.closeActiveTab();
      } else if (activeModeStateRef.current === 'files') {
        console.log('[App] Routing to editorModeRef.closeActiveTab()');
        editorModeRef.current?.closeActiveTab();
      }
    };

    window.electronAPI.on('close-active-tab', handleCloseActiveTab);

    return () => {
      window.electronAPI?.off?.('close-active-tab', handleCloseActiveTab);
    };
  }, []); // Empty deps - listener registered once, uses refs for current values

  // Handle reopen-last-closed-tab from menu - route to active panel
  useEffect(() => {
    const handleReopenLastClosedTab = () => {
      // console.log('[App] handleReopenLastClosedTab called, activeMode:', activeModeStateRef.current);
      if (activeModeStateRef.current === 'agent') {
        // console.log('[App] Calling agentModeRef.current?.reopenLastClosedSession()');
        agentModeRef.current?.reopenLastClosedSession?.();
      } else if (activeModeStateRef.current === 'files') {
        // console.log('[App] Calling editorModeRef.current?.reopenLastClosedTab()');
        editorModeRef.current?.reopenLastClosedTab?.();
      }
    };

    window.electronAPI.on('reopen-last-closed-tab', handleReopenLastClosedTab);

    return () => {
      window.electronAPI?.off?.('reopen-last-closed-tab', handleReopenLastClosedTab);
    };
  }, []); // Empty deps - listener registered once, uses refs for current values

  // NOTE: view-history (Cmd+Y) is handled by the keyboard handler above, not IPC

  // Intercept external link clicks and open in default browser
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      // Find if we clicked on a link or inside a link
      let target = event.target as HTMLElement | null;
      while (target && target !== document.body) {
        if (target.tagName === 'A') {
          const anchor = target as HTMLAnchorElement;
          const href = anchor.getAttribute('href');

          // Check if it's an external link (http:// or https://)
          if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
            event.preventDefault();
            event.stopPropagation();

            // Open in default browser
            window.electronAPI.openExternal(href).catch((error) => {
              logger.ui.error('Failed to open external link:', error);
            });
            return;
          }
          break;
        }
        target = target.parentElement;
      }
    };

    document.addEventListener('click', handleClick, true);

    return () => {
      document.removeEventListener('click', handleClick, true);
    };
  }, []);

  // Show nothing while initializing - let HTML/CSS background show through
  // Wait for both initial state and extensions to be ready before rendering editors
  // This ensures extension nodes (like DataModelNode) are registered with the pluginRegistry
  if (isInitializing || !extensionsReady) {
    return <div className="h-screen" />;
  }

  return (
    <DialogProvider workspacePath={workspacePath || undefined}>
    {/* Navigation dialog keyboard shortcuts - must be inside DialogProvider */}
    <NavigationDialogKeyboardHandler
      workspaceMode={workspaceMode}
      workspacePath={workspacePath}
      currentFilePath={currentFilePathRef.current}
      onFileSelect={handleQuickOpenFileSelect}
      onSessionSelect={handleSessionQuickOpenSelect}
      onPromptSelect={handlePromptQuickOpenSelect}
      documentContext={{
        content: getContentRef.current ? getContentRef.current() : '',
        filePath: currentFilePathRef.current || undefined
      }}
    />
    <WalkthroughProvider currentMode={activeMode}>
    <div data-layout="root-container" className="h-screen flex flex-row">
      {/* Left: Navigation Gutter - full height */}
      <NavigationGutter
        contentMode={activeMode}
        onContentModeChange={setActiveMode}
        onOpenHistory={() => {
          // Switch to agent mode instead of opening old session manager
          setActiveMode('agent');
        }}
        onToggleTerminalPanel={() => {
          toggleTerminalPanel();
          if (!terminalPanelVisible) {
            closeTrackerPanel(); // Close tracker when opening terminal
          }
        }}
        terminalPanelVisible={terminalPanelVisible}
        workspacePath={workspacePath}
        onOpenSettings={() => {
          setActiveMode('settings');
        }}
        onOpenPermissions={() => {
          // Deep link to agent permissions settings
          setSettingsInitialCategory('agent-permissions');
          setSettingsInitialScope('project');
          incrementSettingsKey(); // Force SettingsView remount
          setTimeout(() => setActiveMode('settings'), 0);
        }}
        onOpenFeedback={() => {
          if (dialogRef.current) {
            dialogRef.current.open(DIALOG_IDS.POSTHOG_SURVEY, {});
          }
        }}
        onChangeTrustMode={() => {
          // Show the trust toast so user can pick a new mode
          setForceShowTrustToast(true);
        }}
        activeExtensionPanel={activeExtensionPanel}
        onExtensionPanelChange={setActiveExtensionPanel}
        onToggleFilesCollapsed={() => {
          editorModeRef.current?.toggleSidebarCollapsed();
        }}
        onToggleAgentCollapsed={() => {
          toggleAgentCollapsed();
        }}
      />

      {/* Right: Main content area + Bottom Panel */}
      <div data-layout="main-column-container" className="flex-1 flex flex-col overflow-hidden">
        {/* Top: Main content (sidebar + editor/agent + AI chat) */}
        <div data-layout="top-content-row" className="flex-1 flex flex-row min-h-0">
          {/* Center: Editor/Agent/Settings area */}
          <div data-layout="center-content-wrapper" className="flex-1 flex flex-col overflow-hidden min-h-0">
            {/* Files Mode - always mounted, visibility controlled by display */}
            <div
              data-layout="files-mode-wrapper"
              className={`flex-1 flex-row overflow-hidden min-h-0 ${
                activeMode === 'files' && !isFullscreenPanelActive ? 'flex' : 'hidden'
              }`}
            >
              {/* Extension Sidebar Panel (when active) */}
              {activeExtensionPanel && (() => {
                const panel = getPanelById(activeExtensionPanel);
                if (panel && panel.placement === 'sidebar' && workspacePath) {
                  return (
                    <div
                      data-layout="extension-panel-sidebar"
                      className="w-[280px] min-w-[200px] max-w-[400px] flex flex-col border-r border-nim overflow-hidden"
                    >
                      <PanelContainer
                        panel={panel}
                        workspacePath={workspacePath}
                        onOpenFile={handleWorkspaceFileSelect}
                        onOpenPanel={(panelId) => setActiveExtensionPanel(panelId)}
                        onClose={() => setActiveExtensionPanel(null)}
                      />
                    </div>
                  );
                }
                return null;
              })()}

              {/* Main content (file tree + editor) */}
              {workspacePath ? (
                <TabsProvider
                  workspacePath={workspacePath}
                >
                  <EditorMode
                    ref={editorModeRef}
                    workspacePath={workspacePath}
                    workspaceName={workspaceName}
                    theme={theme}
                    isActive={activeMode === 'files'}
                    onModeChange={setActiveMode as (mode: string) => void}
                    onGetContentReady={(getContentFn) => {
                      getContentRef.current = getContentFn;
                    }}
                    onCloseWorkspace={handleCloseWorkspace}
                    onOpenQuickSearch={() => {
                      if (dialogRef.current && workspacePath) {
                        dialogRef.current.open(DIALOG_IDS.QUICK_OPEN, {
                          workspacePath,
                          currentFilePath: currentFilePathRef.current,
                          onFileSelect: handleQuickOpenFileSelect,
                        });
                      }
                    }}
                    onSwitchToAgentMode={handleSwitchToAgentMode}
                  />
                </TabsProvider>
              ) : (
                <WorkspaceWelcome workspaceName="Open a workspace to get started" />
              )}
            </div>

            {/* Agent Mode - always mounted, visibility controlled by display */}
            <div
              data-layout="agent-mode-wrapper"
              className={`flex-1 flex-col overflow-hidden min-h-0 ${
                activeMode === 'agent' && !isFullscreenPanelActive ? 'flex' : 'hidden'
              }`}
            >
              {workspacePath ? (
                <AgentMode
                  ref={agentModeRef}
                  workspacePath={workspacePath}
                  workspaceName={workspaceName || ''}
                  isActive={activeMode === 'agent'}
                  onFileOpen={handleWorkspaceFileSelect}
                  onOpenQuickSearch={() => {
                    if (dialogRef.current && workspacePath) {
                      dialogRef.current.open(DIALOG_IDS.SESSION_QUICK_OPEN, {
                        workspacePath,
                        onSessionSelect: handleSessionQuickOpenSelect,
                      });
                    }
                  }}
                  onSwitchToAgentMode={handleSwitchToAgentMode}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center text-nim-muted">
                  <div className="text-center">
                    <p>Agent mode requires a workspace</p>
                    <p className="mt-2 text-sm">Open a workspace to use agent features</p>
                  </div>
                </div>
              )}
            </div>

            {/* Extension Fullscreen Panel Mode */}
            {activeExtensionPanel && (() => {
              const panel = getPanelById(activeExtensionPanel);
              if (panel && panel.placement === 'fullscreen' && workspacePath) {
                return (
                  <div
                    data-layout="extension-panel-fullscreen"
                    className="flex-1 flex flex-row overflow-hidden min-h-0"
                  >
                    {/* Extension panel content */}
                    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                      <PanelContainer
                        panel={panel}
                        workspacePath={workspacePath}
                        onOpenFile={handleWorkspaceFileSelect}
                        onOpenPanel={(panelId) => setActiveExtensionPanel(panelId)}
                        onClose={() => setActiveExtensionPanel(null)}
                      />
                    </div>
                    {/* AI Chat Panel (for aiSupported panels) */}
                    {panel.aiSupported && (
                      <div
                        data-layout="extension-ai-chat"
                        className="w-[400px] min-w-[320px] max-w-[600px] flex flex-col border-l border-nim overflow-hidden"
                      >
                        <ChatSidebar
                          ref={chatSidebarRef}
                          workspacePath={workspacePath}
                          documentContext={extensionPanelDocumentContext}
                          onFileOpen={handleWorkspaceFileSelect}
                        />
                      </div>
                    )}
                  </div>
                );
              }
              return null;
            })()}

            {/* Settings Mode - conditionally rendered for now */}
            {activeMode === 'settings' && !isFullscreenPanelActive && (
              <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                <SettingsView
                  key={settingsKey}
                  workspacePath={workspacePath}
                  workspaceName={workspaceName}
                  initialCategory={settingsInitialCategory}
                  initialScope={settingsInitialScope}
                  onClose={() => {
                    setActiveMode('files');
                    // Clear initial settings state so next open uses defaults
                    clearSettingsNavigation();
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Bottom: Tracker Bottom Panel - spans width after nav gutter */}
        {isTrackerPanelOpen && (
          <TrackerBottomPanel
            onSwitchToFilesMode={() => setActiveMode('files')}
            workspacePath={workspacePath || undefined}
          />
        )}

        {/* Bottom: Terminal Bottom Panel - spans width after nav gutter */}
        {workspacePath && (
          <TerminalBottomPanel
            workspacePath={workspacePath}
          />
        )}
      </div>

      {/* Navigation dialogs (QuickOpen, SessionQuickOpen, PromptQuickOpen, AgentCommandPalette) */}
      {/* are now managed by DialogProvider and rendered automatically */}

      {/* KeyboardShortcutsDialog, ApiKeyDialog, ProjectSelectionDialog, ErrorDialog are now managed by DialogProvider */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.options.title}
        message={confirmDialog.options.message}
        confirmLabel={confirmDialog.options.confirmLabel}
        cancelLabel={confirmDialog.options.cancelLabel}
        destructive={confirmDialog.options.destructive}
        onConfirm={confirmDialog.handleConfirm}
        onCancel={confirmDialog.handleCancel}
      />
      {/* DiscordInvitation is now managed by DialogProvider */}
      {/* WindowsClaudeCodeWarning is now managed by DialogProvider via useOnboarding hook */}
      {/* UnifiedOnboarding is now managed by DialogProvider via useOnboarding hook */}
      {/* ClaudeCommandsToast removed - commands now via extension-based plugins */}
      <ErrorToastContainer />
      <MockupPickerMenuHost />
      <ExtensionHostComponents />
      <UpdateToast />
      <NotificationSessionChecker />
      <ProjectTrustToast
        workspacePath={workspacePath}
        onOpenSettings={() => {
          setSettingsInitialCategory('agent-permissions');
          setSettingsInitialScope('project');
          incrementSettingsKey();
          setTimeout(() => setActiveMode('settings'), 0);
        }}
        forceShow={forceShowTrustToast}
        onDismiss={() => setForceShowTrustToast(false)}
      />
      {/* PostHogSurvey is now managed by DialogProvider */}
    </div>
    </WalkthroughProvider>
    </DialogProvider>
  );
}
