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
// NOTE: useDocumentContext removed - we build documentContext manually now
import { handleWorkspaceFileSelect as handleWorkspaceFileSelectUtil } from './utils/workspaceFileOperations';
import { createInitialFileContent } from './utils/fileUtils';
import { aiToolService } from './services/AIToolService';
import { editorRegistry } from '@nimbalyst/runtime/ai/EditorRegistry';
import { WorkspaceWelcome } from './components/WorkspaceWelcome.tsx';
import { QuickOpen } from './components/QuickOpen';
import { SessionQuickOpen } from './components/SessionQuickOpen';
import { AgentCommandPalette } from './components/AgentCommandPalette';
import { ConfirmDialog } from './components/ConfirmDialog/ConfirmDialog';
import { DiscordInvitation } from './components/DiscordInvitation/DiscordInvitation';
import { WindowsClaudeCodeWarning } from './components/WindowsClaudeCodeWarning/WindowsClaudeCodeWarning';
import { KeyboardShortcutsDialog } from './components/KeyboardShortcutsDialog/KeyboardShortcutsDialog';
import { ErrorDialog } from './components/ErrorDialog/ErrorDialog';
import { ErrorToastContainer } from './components/ErrorToast/ErrorToast';
import { ApiKeyDialog } from './components/ApiKeyDialog';
import { ProjectSelectionDialog } from './components/ProjectSelectionDialog/ProjectSelectionDialog';
import { OnboardingDialog } from './components/OnboardingDialog/OnboardingDialog';
import { FeatureWalkthrough } from './components/FeatureWalkthrough/FeatureWalkthrough';
import { WorkspaceManager } from './components/WorkspaceManager/WorkspaceManager.tsx';
import { AIUsageReport } from './components/AIUsageReport';
import { DatabaseBrowser } from './components/DatabaseBrowser/DatabaseBrowser';
import { AgenticPanel, type AgenticPanelRef } from './components/UnifiedAI';
import EditorMode, { type EditorModeRef } from './components/EditorMode/EditorMode';
import { TabsProvider } from './contexts/TabsContext';
import { NavigationGutter, type SidebarView } from './components/NavigationGutter';
// NOTE: useTabs and useTabNavigation removed - EditorMode manages tabs now
import type { ContentMode } from './types/WindowModeTypes';
import { TrackerBottomPanel, TrackerBottomPanelType } from './components/TrackerBottomPanel/TrackerBottomPanel.tsx';
import { registerDocumentLinkPlugin } from './plugins/registerDocumentLinkPlugin';
import { registerAIChatPlugin } from './plugins/registerAIChatPlugin';
import { registerTrackerPlugin } from './plugins/registerTrackerPlugin';
import { registerDiffApprovalBarPlugin } from './plugins/registerDiffApprovalBarPlugin';
import { registerSearchReplacePlugin } from './plugins/registerSearchReplacePlugin';
import { registerMockupPlugin } from './plugins/registerMockupPlugin';
import { registerExtensionSystem, setExtensionWorkspacePath } from './plugins/registerExtensionSystem';
import ProjectSettingsScreen from './components/ProjectSettingsScreen/ProjectSettingsScreen.tsx';
import { SettingsView, type SettingsScope } from './components/Settings/SettingsView';
import type { SettingsCategory } from './components/Settings/SettingsSidebar';
import { loadCustomTrackers } from './services/CustomTrackerLoader';
import { customEditorRegistry } from './components/CustomEditors';
import { MockupViewer } from './components/CustomEditors/MockupEditor/MockupViewer';
import { MockupPickerMenuHost } from './components/MockupPickerMenu';
import { ExtensionHostComponents } from './components/ExtensionHostComponents';
import { ClaudeCommandsToast } from './components/ClaudeCommandsToast';
import { UpdateToast } from './components/UpdateToast';
import { ProjectTrustToast } from './components/ProjectTrustToast';
import { PostHogSurvey } from './components/PostHogSurvey';
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
import { extensionPanelAIContextAtom } from './store/atoms/extensionPanels';
import { setDiffTreeGroupByDirectoryAtom } from './store/atoms/projectState';
import './WorkspaceWelcome.css';

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

        // Conditionally register MockupLM based on settings
        const mockupLMEnabled = await window.electronAPI.invoke('mockupLM:is-enabled');
        if (mockupLMEnabled) {
          customEditorRegistry.register({
            extensions: ['.mockup.html'],
            component: MockupViewer,
            name: 'MockupLM',
            supportsAI: true,
            supportsSourceMode: true,
          });
          logger.ui.info('[CustomEditors] MockupLM editor registered');
        }

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
  const [isQuickOpenVisible, setIsQuickOpenVisible] = useState(false);
  const [isSessionQuickOpenVisible, setIsSessionQuickOpenVisible] = useState(false);
  const [isAgentPaletteVisible, setIsAgentPaletteVisible] = useState(false);
  // NOTE: isAIChatCollapsed, aiChatWidth moved to EditorMode for workspace mode
  // These are kept for potential single-file mode or agent mode use
  const [isAIChatCollapsed, setIsAIChatCollapsed] = useState(false);
  const [aiChatWidth, setAIChatWidth] = useState<number>(350);
  const [isKeyboardShortcutsDialogOpen, setIsKeyboardShortcutsDialogOpen] = useState(false);
  const [isDiscordInvitationOpen, setIsDiscordInvitationOpen] = useState(false);
  const [isPostHogSurveyOpen, setIsPostHogSurveyOpen] = useState(false);
  const [isWindowsClaudeCodeWarningOpen, setIsWindowsClaudeCodeWarningOpen] = useState(false);
  const [isAIChatStateLoaded, setIsAIChatStateLoaded] = useState(false);
  // Planning mode for AI sidebar (Claude Code safety). Default ON
  const [aiPlanningModeEnabled, setAIPlanningModeEnabled] = useState<boolean>(true);
  const [isApiKeyDialogOpen, setIsApiKeyDialogOpen] = useState(false);
  // Force show trust toast (when user wants to change permission mode)
  const [forceShowTrustToast, setForceShowTrustToast] = useState(false);
  const [sessionToLoad, setSessionToLoad] = useState<{ sessionId: string; workspacePath?: string } | null>(null);
  const [currentAISessionId, setCurrentAISessionId] = useState<string | null>(null);
  const [diffError, setDiffError] = useState<{ isOpen: boolean; title: string; message: string; details?: any }>({
    isOpen: false,
    title: '',
    message: '',
    details: undefined
  });
  const [projectSelection, setProjectSelection] = useState<{
    isOpen: boolean;
    filePath: string;
    fileName: string;
    suggestedWorkspace?: string;
  } | null>(null);

  // Onboarding dialog state
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);

  // Feature walkthrough state (shown on first launch)
  const [isFeatureWalkthroughOpen, setIsFeatureWalkthroughOpen] = useState(false);

  // Claude commands install toast state
  const [showCommandsToast, setShowCommandsToast] = useState(false);
  const hasCheckedCommandsRef = useRef(false);

  // Settings deep link state (for navigating directly to a specific settings section)
  const [settingsInitialCategory, setSettingsInitialCategory] = useState<SettingsCategory | undefined>(undefined);
  const [settingsInitialScope, setSettingsInitialScope] = useState<SettingsScope | undefined>(undefined);
  const [settingsKey, setSettingsKey] = useState(0); // Force remount when deep linking

  // Navigation gutter state
  const [sidebarView, setSidebarView] = useState<SidebarView>('files');

  // Active extension panel (for sidebar or fullscreen panels from extensions)
  const [activeExtensionPanel, setActiveExtensionPanel] = useState<string | null>(null);

  // Extension panel AI context (synced from PanelContainer when aiSupported panels are active)
  const extensionPanelAIContext = useAtomValue(extensionPanelAIContextAtom);

  // Diff tree grouping state - setter for hydration from workspace state
  const setDiffTreeGroupByDirectory = useSetAtom(setDiffTreeGroupByDirectoryAtom);

  // Check if a fullscreen extension panel is active (hides other content modes)
  const activeFullscreenPanel = activeExtensionPanel ? getPanelById(activeExtensionPanel) : null;
  const isFullscreenPanelActive = activeFullscreenPanel?.placement === 'fullscreen';

  // Content mode management - simple state, no manager needed
  const [activeMode, setActiveModeRaw] = useState<ContentMode>('files');
  // Keep a ref to activeMode for use in callbacks that might have stale closures
  const activeModeStateRef = useRef<ContentMode>(activeMode);
  useEffect(() => {
    activeModeStateRef.current = activeMode;
  }, [activeMode]);

  const setActiveMode = (mode: ContentMode) => {
    // console.log('[App] setActiveMode called with:', mode, 'current:', activeMode);
    setActiveModeRaw(mode);
  };

  // Expose test helpers for testing
  useEffect(() => {
    // Always expose in development
    if (import.meta.env.DEV) {
      (window as any).__testHelpers = {
        ...(window as any).__testHelpers,
        setSidebarView: (view: any) => setSidebarView(view),
        setActiveMode: (mode: any) => setActiveMode(mode),
        getActiveMode: () => activeMode,
        getSidebarView: () => sidebarView,
        // Settings deep link helpers
        openAgentPermissions: () => {
          setSettingsInitialCategory('agent-permissions');
          setSettingsInitialScope('project');
          setSettingsKey(k => k + 1);
          setTimeout(() => setActiveMode('settings'), 0);
        },
      };
      console.log('[App] Test helpers exposed, DEV mode:', import.meta.env.DEV);
    }
  }, [activeMode, sidebarView]);

  // Bottom panel state (shared across all modes)
  const [bottomPanel, setBottomPanel] = useState<TrackerBottomPanelType | null>(null);
  const [bottomPanelHeight, setBottomPanelHeight] = useState<number>(300);

  // Agent panel plan reference (for launching from plan status)
  const [agentPlanReference, setAgentPlanReference] = useState<string | null>(null);

  // Check for first-time user after initialization completes
  useEffect(() => {
    // Only check after initialization is complete
    if (isInitializing) return;

    const checkOnboarding = async () => {
      // Skip in Playwright tests
      if ((window as any).PLAYWRIGHT) {
        return;
      }

      // Only show in workspace mode windows
      if (!workspaceMode) {
        return;
      }

      // Small delay to let other windows start up first
      await new Promise(resolve => setTimeout(resolve, 100));

      // Recheck after delay - another window might have already shown it
      const state = await window.electronAPI.invoke('onboarding:get');

      // Don't show if user has completed or permanently skipped
      if (state.onboardingCompleted || state.userRole) {
        return;
      }

      // Check if we should wait before prompting again
      if (state.onboardingNextPrompt) {
        const now = Date.now();
        if (now < state.onboardingNextPrompt) {
          // Not time to show again yet
          return;
        }

        // Time has passed, clear the timestamp
        await window.electronAPI.invoke('onboarding:update', { onboardingNextPrompt: undefined });
      }

      // Show onboarding dialog
      setIsOnboardingOpen(true);
    };

    checkOnboarding();
  }, [isInitializing, workspaceMode]);

  // Handle onboarding completion
  const handleOnboardingComplete = useCallback(async (role: string | null, customRole: string | null, email: string | null) => {
    const roleToStore = customRole || role || undefined;

    // Store onboarding data in electron-store
    await window.electronAPI.invoke('onboarding:update', {
      userRole: roleToStore,
      userEmail: email || undefined,
      onboardingCompleted: true
    });

    // Associate email with user in PostHog if provided
    if (email && posthog) {
      posthog.people.set({ email });
    }

    // Track onboarding completion event
    if (posthog) {
      posthog.capture('onboarding_completed', {
        user_role: role || undefined,
        custom_role_provided: !!customRole,
        custom_role_text: customRole || undefined,
        email_provided: !!email,
      });
    }

    // Close the dialog
    setIsOnboardingOpen(false);
  }, [posthog]);

  // Handle onboarding skip
  const handleOnboardingSkip = useCallback(async () => {
    // Mark as completed to prevent re-showing
    await window.electronAPI.invoke('onboarding:update', {
      onboardingCompleted: true
    });

    // Track skip event
    if (posthog) {
      posthog.capture('onboarding_skipped');
    }

    // Close the dialog
    setIsOnboardingOpen(false);
  }, [posthog]);

  // Check for feature walkthrough on first launch
  // Set to true to force the walkthrough to display (for development/testing)
  const FORCE_FEATURE_WALKTHROUGH = false;

  useEffect(() => {
    // Only check after initialization is complete
    if (isInitializing) return;

    // Skip in Playwright tests
    if ((window as any).PLAYWRIGHT) {
      return;
    }

    // Only show in workspace mode windows
    if (!workspaceMode) {
      return;
    }

    const checkFeatureWalkthrough = async () => {
      // Force display if flag is set (for development/testing)
      if (FORCE_FEATURE_WALKTHROUGH) {
        setIsFeatureWalkthroughOpen(true);
        return;
      }

      // Check if walkthrough has been completed
      const isCompleted = await window.electronAPI.invoke('feature-walkthrough:is-completed');
      if (!isCompleted) {
        setIsFeatureWalkthroughOpen(true);
      }
    };

    checkFeatureWalkthrough();
  }, [isInitializing, workspaceMode]);

  // Handle feature walkthrough completion
  const handleFeatureWalkthroughComplete = useCallback(async () => {
    // Mark as completed in settings
    // PostHog event is sent from the FeatureWalkthrough component with timing data
    await window.electronAPI.invoke('feature-walkthrough:set-completed', true);
    setIsFeatureWalkthroughOpen(false);
  }, []);

  // Handle feature walkthrough skip
  const handleFeatureWalkthroughSkip = useCallback(async () => {
    // Mark as completed even when skipped (so it doesn't show again)
    // PostHog event is sent from the FeatureWalkthrough component with timing data
    await window.electronAPI.invoke('feature-walkthrough:set-completed', true);
    setIsFeatureWalkthroughOpen(false);
  }, []);

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

  // Load active mode and diff tree state from workspace state
  useEffect(() => {
    if (!workspacePath || !window.electronAPI?.invoke) return;

    console.log('[App Layout] Loading workspace state for:', workspacePath);
    window.electronAPI.invoke('workspace:get-state', workspacePath)
      .then(state => {
        // console.log('[App Layout] Loaded workspace state:', JSON.stringify(state, null, 2));
        if (state?.activeMode) {
          // console.log('[App Layout] Restoring activeMode:', state.activeMode);
          setActiveMode(state.activeMode as ContentMode);
        } else {
          console.log('[App Layout] No activeMode in state (keys:', Object.keys(state || {}), ')');
        }

        // Hydrate diff tree grouping state into Jotai atom
        if (state?.diffTreeGroupByDirectory !== undefined) {
          setDiffTreeGroupByDirectory({ groupByDirectory: state.diffTreeGroupByDirectory, workspacePath });
        }
      })
      .catch(error => {
        console.error('[ContentMode] Failed to load active mode:', error);
      });
  }, [workspacePath, setDiffTreeGroupByDirectory]);

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
  }, [activeMode, workspacePath, bottomPanel]);

  // Load bottom panel state from workspace state
  useEffect(() => {
    if (!workspacePath || !window.electronAPI?.invoke) return;

    window.electronAPI.invoke('workspace:get-state', workspacePath)
      .then(state => {
        if (state?.trackerBottomPanel !== undefined) {
          setBottomPanel(state.trackerBottomPanel);
        }
        if (state?.trackerBottomPanelHeight !== undefined) {
          setBottomPanelHeight(state.trackerBottomPanelHeight);
        }
      })
      .catch(error => {
        console.error('[TrackerBottomPanel] Failed to load bottom panel state:', error);
      });
  }, [workspacePath]);

  // Save bottom panel state when it changes
  useEffect(() => {
    // console.log('[App Layout] Bottom panel state changed:', {
    //   bottomPanel,
    //   bottomPanelHeight,
    //   activeMode
    // });

    if (!workspacePath || !window.electronAPI?.invoke) return;

    window.electronAPI.invoke('workspace:update-state', workspacePath, {
      trackerBottomPanel: bottomPanel,
      trackerBottomPanelHeight: bottomPanelHeight
    })
      .catch(error => {
        console.error('[TrackerBottomPanel] Failed to save bottom panel state:', error);
      });
  }, [bottomPanel, bottomPanelHeight, workspacePath, activeMode]);


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
  }, [activeMode, bottomPanel, bottomPanelHeight]);

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
    getLatestContent: () => getContentRef.current?.() || ''
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
  const agenticPanelRef = useRef<AgenticPanelRef>(null);
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

    // Wait for next tick to ensure AgenticPanel is mounted/visible
    setTimeout(() => {
      if (planDocumentPath) {
        // Create new session with document reference
        if (agenticPanelRef.current?.createNewSession) {
          agenticPanelRef.current.createNewSession(planDocumentPath);
        }
      } else if (sessionId && agenticPanelRef.current) {
        // Load existing session
        console.log('Load session:', sessionId);
        agenticPanelRef.current.openSessionInTab(sessionId);
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


  // Listen for IPC events from menu
  useEffect(() => {
    if (!window.electronAPI?.on) return;

    const handleToggleAgentPalette = () => {
      setIsAgentPaletteVisible(prev => !prev);
    };

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
      setProjectSelection({
        isOpen: true,
        filePath: data.filePath,
        fileName: data.fileName,
        suggestedWorkspace: data.suggestedWorkspace
      });
    };

    // console.log('[App] Setting up IPC listener for set-content-mode');
    window.electronAPI.on('set-content-mode', handleSetContentMode);
    window.electronAPI.on('agent:insert-plan-reference', handleInsertPlanReference);
    window.electronAPI.on('show-project-selection-dialog', handleShowProjectSelectionDialog);
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
      if (agenticPanelRef.current) {
        agenticPanelRef.current.createNewSession();
      } else {
        console.warn('[App] agenticPanelRef not available');
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
      setIsDiscordInvitationOpen(true);
    };

    window.electronAPI.on('show-discord-invitation', handleShowDiscordInvitation);
    // console.log('[App] Discord invitation listener registered');

    return () => {
      // console.log('[App] Removing Discord invitation listener');
      window.electronAPI.off?.('show-discord-invitation', handleShowDiscordInvitation);
    };
  }, []);

  // Check for Windows Claude Code warning after other dialogs close
  // This shows after feature walkthrough and onboarding are dismissed
  useEffect(() => {
    // Only check after initialization is complete
    if (isInitializing) return;

    // Skip in Playwright tests
    if ((window as any).PLAYWRIGHT) return;

    // Only show in workspace mode windows
    if (!workspaceMode) return;

    // Only run on Windows
    if (navigator.platform !== 'Win32') return;

    // Wait for feature walkthrough and onboarding to be closed first
    if (isFeatureWalkthroughOpen || isOnboardingOpen) return;

    const checkWindowsWarning = async () => {
      try {
        // Check if we should show the warning (Windows only, not dismissed)
        const shouldShow = await window.electronAPI.invoke('claude-code:should-show-windows-warning');
        if (!shouldShow) return;

        // Check if Claude Code is installed
        const installation = await window.electronAPI.cliCheckClaudeCodeWindowsInstallation();
        if (installation.claudeCodeVersion) {
          // Claude Code is installed, no warning needed
          return;
        }

        // Show the warning
        setIsWindowsClaudeCodeWarningOpen(true);
      } catch (error) {
        console.error('[App] Error checking Windows Claude Code warning:', error);
      }
    };

    // Small delay to ensure smooth transition after other dialogs
    const timeout = setTimeout(checkWindowsWarning, 500);
    return () => clearTimeout(timeout);
  }, [isInitializing, workspaceMode, isFeatureWalkthroughOpen, isOnboardingOpen]);

  // Listen for show-feature-walkthrough IPC event (from Developer menu)
  useEffect(() => {
    if (!window.electronAPI?.on) return;

    const handleShowFeatureWalkthrough = () => {
      setIsFeatureWalkthroughOpen(true);
    };

    window.electronAPI.on('show-feature-walkthrough', handleShowFeatureWalkthrough);

    return () => {
      window.electronAPI.off?.('show-feature-walkthrough', handleShowFeatureWalkthrough);
    };
  }, []);

  // Listen for show-onboarding-dialog IPC event (from Developer menu)
  useEffect(() => {
    if (!window.electronAPI?.on) return;

    const handleShowOnboardingDialog = () => {
      setIsOnboardingOpen(true);
    };

    window.electronAPI.on('show-onboarding-dialog', handleShowOnboardingDialog);

    return () => {
      window.electronAPI.off?.('show-onboarding-dialog', handleShowOnboardingDialog);
    };
  }, []);

  // Listen for show-windows-claude-code-warning IPC event (from Developer menu)
  useEffect(() => {
    if (!window.electronAPI?.on) return;

    const handleShowWindowsWarning = () => {
      setIsWindowsClaudeCodeWarningOpen(true);
    };

    window.electronAPI.on('show-windows-claude-code-warning', handleShowWindowsWarning);

    return () => {
      window.electronAPI.off?.('show-windows-claude-code-warning', handleShowWindowsWarning);
    };
  }, []);

  // Listen for show-commands-toast IPC event (from Developer menu)
  useEffect(() => {
    if (!window.electronAPI?.on) return;

    const handleShowCommandsToast = () => {
      setShowCommandsToast(true);
    };

    window.electronAPI.on('show-commands-toast', handleShowCommandsToast);

    return () => {
      window.electronAPI.off?.('show-commands-toast', handleShowCommandsToast);
    };
  }, []);

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

  // Check if Claude commands need to be installed (show toast)
  useEffect(() => {
    const checkCommands = async () => {
      if (!workspacePath || !workspaceMode) return;
      if (hasCheckedCommandsRef.current) return;

      // Skip in Playwright tests
      if ((window as any).PLAYWRIGHT) return;

      // Wait for other dialogs to close first
      if (isFeatureWalkthroughOpen || isOnboardingOpen || isWindowsClaudeCodeWarningOpen) return;

      try {
        const needsInstall = await OnboardingService.needsCommandInstallation(workspacePath);
        if (needsInstall) {
          hasCheckedCommandsRef.current = true;
          setShowCommandsToast(true);
          posthog?.capture('claude_commands_toast_shown');
        }
      } catch (error) {
        console.error('[App] Error checking command installation:', error);
      }
    };

    // Small delay to ensure smooth transition after other dialogs
    const timeout = setTimeout(checkCommands, 500);
    return () => clearTimeout(timeout);
  }, [workspacePath, workspaceMode, isFeatureWalkthroughOpen, isOnboardingOpen, isWindowsClaudeCodeWarningOpen]);

  // Reset commands check when workspace changes
  useEffect(() => {
    hasCheckedCommandsRef.current = false;
    setShowCommandsToast(false);
  }, [workspacePath]);

  // Update window title for files mode - agent mode sets title directly from AgenticPanel
  useEffect(() => {
    if (!window.electronAPI) return;
    // Skip if in agent mode - AgenticPanel manages the title
    if (activeMode === 'agent') return;

    const currentFileName = currentFileNameRef.current;
    let title = 'Nimbalyst';
    if (workspaceMode && workspaceName) {
      if (currentFileName) {
        title = `${currentFileName} - ${workspaceName} - Nimbalyst`;
      } else {
        title = `${workspaceName} - Nimbalyst`;
      }
    } else if (currentFileName) {
      title = `${currentFileName} - Nimbalyst`;
    }

    window.electronAPI.setTitle(title);
  }, [workspaceMode, workspaceName, activeMode]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      // Cmd+E for Files mode
      if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setActiveMode('files');
        return;
      }
      // Cmd+K for Agent mode
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setActiveMode('agent');
        return;
      }
      // Cmd+O (Mac) or Ctrl+O (Windows/Linux) for Quick Open
      if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (workspaceMode) {
          setIsQuickOpenVisible(true);
        }
        return;
      }
      // Cmd+L (Mac) or Ctrl+L (Windows/Linux) for Session Quick Open
      if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (workspaceMode) {
          setIsSessionQuickOpenVisible(true);
        }
        return;
      }
      // Cmd+Shift+A (Mac) or Ctrl+Shift+A (Windows/Linux) for AI Chat
      if (workspaceMode && (e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'a') {
        e.preventDefault();
        setIsAIChatCollapsed(prev => !prev);
      }
      // NOTE: Cmd+Shift+T handled by menu system (reopen-last-closed-tab IPC event)
      // Cmd+Y (Mac) or Ctrl+Y (Windows/Linux) for History - only in files mode
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        e.preventDefault();
        // Only open history dialog when in files mode
        if (workspaceMode && activeModeStateRef.current === 'files' && editorModeRef.current) {
          editorModeRef.current.openHistoryDialog();
        }
      }
      // Bottom panel keyboard shortcuts
      // Cmd+Shift+P for Plans panel
      if (workspaceMode && (e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'p') {
        e.preventDefault();
        setBottomPanel(prev => prev === 'plan' ? null : 'plan');
      }
      // Cmd+Shift+B for Bugs panel
      if (workspaceMode && (e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'b') {
        e.preventDefault();
        setBottomPanel(prev => prev === 'bug' ? null : 'bug');
      }
      // Cmd+Shift+K for Tasks panel
      if (workspaceMode && (e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'k') {
        e.preventDefault();
        setBottomPanel(prev => prev === 'task' ? null : 'task');
      }
    };

    // Use capture phase to intercept before any other handlers (like Lexical's)
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [workspaceMode, activeMode]);

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

    // Open session in AgenticPanel
    if (agenticPanelRef.current) {
      await agenticPanelRef.current.openSessionInTab(sessionId);
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
      agenticPanelRef.current?.nextTab?.();
    } else {
      editorModeRef.current?.tabs?.nextTab?.();
    }
  };

  const handlePreviousTab = () => {
    if (activeMode === 'agent') {
      agenticPanelRef.current?.previousTab?.();
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
    setIsApiKeyDialogOpen,
    setWorkspaceMode,
    setWorkspacePath,
    setWorkspaceName,
    setIsAIChatCollapsed,
    setAIChatWidth,
    setIsAIChatStateLoaded,
    setSessionToLoad,
    setIsKeyboardShortcutsDialogOpen,
    setIsAgentPaletteVisible,
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
        console.log('[App] Routing to agenticPanelRef.closeActiveTab()');
        agenticPanelRef.current?.closeActiveTab();
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
        // console.log('[App] Calling agenticPanelRef.current?.reopenLastClosedSession()');
        agenticPanelRef.current?.reopenLastClosedSession?.();
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
    return <div style={{ height: '100vh' }} />;
  }

  return (
    <WalkthroughProvider currentMode={activeMode}>
    <div data-layout="root-container" style={{ height: '100vh', display: 'flex', flexDirection: 'row' }}>
      {/* Left: Navigation Gutter - full height */}
      <NavigationGutter
        contentMode={activeMode}
        onContentModeChange={setActiveMode}
        onOpenHistory={() => {
          // Switch to agent mode instead of opening old session manager
          setActiveMode('agent');
        }}
        onTogglePlansPanel={() => {
          setBottomPanel(prev => prev === 'plan' ? null : 'plan');
        }}
        bottomPanel={bottomPanel as any}
        onToggleBugsPanel={() => {
          setBottomPanel(prev => prev === 'bug' ? null : 'bug');
        }}
        onToggleTasksPanel={() => {
          setBottomPanel(prev => prev === 'task' ? null : 'task');
        }}
        onToggleIdeasPanel={() => {
          setBottomPanel(prev => prev === 'idea' ? null : 'idea');
        }}
        workspacePath={workspacePath}
        onOpenSettings={() => {
          setActiveMode('settings');
        }}
        onOpenPermissions={() => {
          // Deep link to agent permissions settings
          setSettingsInitialCategory('agent-permissions');
          setSettingsInitialScope('project');
          setSettingsKey(k => k + 1); // Force SettingsView remount
          setTimeout(() => setActiveMode('settings'), 0);
        }}
        onOpenFeedback={() => {
          setIsPostHogSurveyOpen(true);
        }}
        onChangeTrustMode={() => {
          // Show the trust toast so user can pick a new mode
          setForceShowTrustToast(true);
        }}
        activeExtensionPanel={activeExtensionPanel}
        onExtensionPanelChange={setActiveExtensionPanel}
      />

      {/* Right: Main content area + Bottom Panel */}
      <div data-layout="main-column-container" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Top: Main content (sidebar + editor/agent + AI chat) */}
        <div data-layout="top-content-row" style={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0 }}>
          {/* Center: Editor/Agent/Settings area */}
          <div data-layout="center-content-wrapper" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
            {/* Files Mode - always mounted, visibility controlled by display */}
            <div
              data-layout="files-mode-wrapper"
              style={{
                flex: 1,
                display: activeMode === 'files' && !isFullscreenPanelActive ? 'flex' : 'none',
                flexDirection: 'row',
                overflow: 'hidden',
                minHeight: 0
              }}
            >
              {/* Extension Sidebar Panel (when active) */}
              {activeExtensionPanel && (() => {
                const panel = getPanelById(activeExtensionPanel);
                if (panel && panel.placement === 'sidebar' && workspacePath) {
                  return (
                    <div
                      data-layout="extension-panel-sidebar"
                      style={{
                        width: 280,
                        minWidth: 200,
                        maxWidth: 400,
                        display: 'flex',
                        flexDirection: 'column',
                        borderRight: '1px solid var(--border-color)',
                        overflow: 'hidden',
                      }}
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

              {/* Main content (file tree + editor or settings) */}
              {sidebarView === 'settings' ? (
                <ProjectSettingsScreen
                  workspacePath={workspacePath || ''}
                  workspaceName={workspaceName || ''}
                  onClose={() => {
                    setSidebarView('files');
                  }}
                  isFirstTime={false}
                />
              ) : workspacePath ? (
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
                    onOpenQuickSearch={() => setIsQuickOpenVisible(true)}
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
              style={{
                flex: 1,
                display: activeMode === 'agent' && !isFullscreenPanelActive ? 'flex' : 'none',
                flexDirection: 'column',
                overflow: 'hidden',
                minHeight: 0
              }}
            >
              {workspacePath ? (
                <AgenticPanel
                  ref={agenticPanelRef}
                  mode="agent"
                  workspacePath={workspacePath}
                  workspaceName={workspaceName || ''}
                  documentContext={documentContext}
                  planDocumentPath={agentPlanReference || undefined}
                  onContentModeChange={setActiveMode as (mode: string) => void}
                  onFileOpen={handleWorkspaceFileSelect}
                  isActive={activeMode === 'agent'}
                  onOpenQuickSearch={() => setIsSessionQuickOpenVisible(true)}
                />
              ) : (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
                  <div style={{ textAlign: 'center' }}>
                    <p>Agent mode requires a workspace</p>
                    <p style={{ marginTop: '8px', fontSize: '14px' }}>Open a workspace to use agent features</p>
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
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'row',
                      overflow: 'hidden',
                      minHeight: 0,
                    }}
                  >
                    {/* Extension panel content */}
                    <div
                      style={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden',
                        minHeight: 0,
                      }}
                    >
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
                        style={{
                          width: 400,
                          minWidth: 320,
                          maxWidth: 600,
                          display: 'flex',
                          flexDirection: 'column',
                          borderLeft: '1px solid var(--border-primary)',
                          overflow: 'hidden',
                        }}
                      >
                        <AgenticPanel
                          mode="chat"
                          workspacePath={workspacePath}
                          workspaceName={workspaceName || ''}
                          documentContext={extensionPanelDocumentContext}
                          isActive={true}
                          onContentModeChange={setActiveMode as (mode: string) => void}
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
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
                <SettingsView
                  key={settingsKey}
                  workspacePath={workspacePath}
                  workspaceName={workspaceName}
                  initialCategory={settingsInitialCategory}
                  initialScope={settingsInitialScope}
                  onClose={() => {
                    setActiveMode('files');
                    // Clear initial settings state so next open uses defaults
                    setSettingsInitialCategory(undefined);
                    setSettingsInitialScope(undefined);
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Bottom: Bottom Panel - spans width after nav gutter */}
        {bottomPanel && (
          <TrackerBottomPanel
            activePanel={bottomPanel}
            onPanelChange={setBottomPanel}
            height={bottomPanelHeight}
            onHeightChange={setBottomPanelHeight}
            onSwitchToFilesMode={() => setActiveMode('files')}
          />
        )}
      </div>

      {/* Dialogs - rendered at root level */}
      {workspacePath && (
        <>
          <QuickOpen
            isOpen={isQuickOpenVisible}
            onClose={() => setIsQuickOpenVisible(false)}
            workspacePath={workspacePath}
            currentFilePath={currentFilePathRef.current}
            onFileSelect={handleQuickOpenFileSelect}
          />
          <SessionQuickOpen
            isOpen={isSessionQuickOpenVisible}
            onClose={() => setIsSessionQuickOpenVisible(false)}
            workspacePath={workspacePath}
            onSessionSelect={handleSessionQuickOpenSelect}
          />
          <AgentCommandPalette
            isOpen={isAgentPaletteVisible}
            onClose={() => setIsAgentPaletteVisible(false)}
            workspacePath={workspacePath}
            documentContext={{
              content: getContentRef.current ? getContentRef.current() : '',
              filePath: currentFilePathRef.current || undefined
            }}
          />
        </>
      )}
      <KeyboardShortcutsDialog
        isOpen={isKeyboardShortcutsDialogOpen}
        onClose={() => setIsKeyboardShortcutsDialogOpen(false)}
      />
      <ApiKeyDialog
        isOpen={isApiKeyDialogOpen}
        onClose={() => setIsApiKeyDialogOpen(false)}
        onOpenPreferences={() => {
          setIsApiKeyDialogOpen(false);
          setActiveMode('settings');
        }}
      />
      {projectSelection && (
        <ProjectSelectionDialog
          isOpen={projectSelection.isOpen}
          fileName={projectSelection.fileName}
          suggestedWorkspace={projectSelection.suggestedWorkspace}
          onSelectProject={async (selectedWorkspacePath) => {
            // Send IPC event to main process with selected project
            await window.electronAPI.invoke('project-selected', {
              filePath: projectSelection.filePath,
              workspacePath: selectedWorkspacePath
            });
            setProjectSelection(null);
          }}
          onCancel={() => {
            // User cancelled - just open file without workspace
            window.electronAPI.invoke('project-selection-cancelled', {
              filePath: projectSelection.filePath
            });
            setProjectSelection(null);
          }}
        />
      )}
      <ErrorDialog
        isOpen={diffError.isOpen}
        onClose={() => setDiffError(prev => ({ ...prev, isOpen: false }))}
        title={diffError.title}
        message={diffError.message}
        details={diffError.details}
      />
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
      <DiscordInvitation
        isOpen={isDiscordInvitationOpen}
        onClose={() => setIsDiscordInvitationOpen(false)}
        onDismiss={() => setIsDiscordInvitationOpen(false)}
      />
      <WindowsClaudeCodeWarning
        isOpen={isWindowsClaudeCodeWarningOpen}
        onClose={() => {
          posthog.capture('windows_claude_code_warning_closed');
          setIsWindowsClaudeCodeWarningOpen(false);
        }}
        onDismiss={() => {
          posthog.capture('windows_claude_code_warning_dismissed_forever');
          setIsWindowsClaudeCodeWarningOpen(false)
        }}
        onOpenSettings={() => {
          posthog.capture('windows_claude_code_warning_shown');
          setIsWindowsClaudeCodeWarningOpen(false);
          setActiveMode('settings');
        }}
      />
      <OnboardingDialog
        isOpen={isOnboardingOpen}
        onComplete={handleOnboardingComplete}
        onSkip={handleOnboardingSkip}
      />
      <FeatureWalkthrough
        isOpen={isFeatureWalkthroughOpen}
        onComplete={handleFeatureWalkthroughComplete}
        onSkip={handleFeatureWalkthroughSkip}
      />
      {showCommandsToast && workspacePath && (
        <ClaudeCommandsToast
          onInstallAll={async () => {
            posthog?.capture('claude_commands_toast_install_all');
            try {
              await OnboardingService.installAllCommands(workspacePath);
              setShowCommandsToast(false);
            } catch (error) {
              console.error('[App] Failed to install commands:', error);
            }
          }}
          onOpenSettings={() => {
            posthog?.capture('claude_commands_toast_settings');
            setShowCommandsToast(false);
            // Use setTimeout to ensure state updates are flushed before switching modes
            setSettingsInitialCategory('tool-packages');
            setSettingsInitialScope('project');
            setSettingsKey(k => k + 1); // Force SettingsView remount
            // Defer mode change to next tick so initial values are set first
            setTimeout(() => setActiveMode('settings'), 0);
          }}
          onSkip={async () => {
            posthog?.capture('claude_commands_toast_skip');
            try {
              await OnboardingService.dismissCommandInstallToast(workspacePath);
              setShowCommandsToast(false);
            } catch (error) {
              console.error('[App] Failed to dismiss toast:', error);
            }
          }}
        />
      )}
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
          setSettingsKey(k => k + 1);
          setTimeout(() => setActiveMode('settings'), 0);
        }}
        forceShow={forceShowTrustToast}
        onDismiss={() => setForceShowTrustToast(false)}
      />
      {isPostHogSurveyOpen && (
        <PostHogSurvey onClose={() => setIsPostHogSurveyOpen(false)} />
      )}
    </div>
    </WalkthroughProvider>
  );
}
