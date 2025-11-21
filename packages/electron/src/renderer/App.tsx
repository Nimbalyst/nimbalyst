import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
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
import OnboardingService from './services/OnboardingService';
import { editorRegistry } from '@nimbalyst/runtime/ai/EditorRegistry';
import { WorkspaceWelcome } from './components/WorkspaceWelcome.tsx';
import { QuickOpen } from './components/QuickOpen';
import { AgentCommandPalette } from './components/AgentCommandPalette';
import { ConfirmDialog } from './components/ConfirmDialog/ConfirmDialog';
import { DiscordInvitation } from './components/DiscordInvitation/DiscordInvitation';
import { KeyboardShortcutsDialog } from './components/KeyboardShortcutsDialog/KeyboardShortcutsDialog';
import { ErrorDialog } from './components/ErrorDialog/ErrorDialog';
import { ErrorToastContainer } from './components/ErrorToast/ErrorToast';
import { ApiKeyDialog } from './components/ApiKeyDialog';
import { ProjectSelectionDialog } from './components/ProjectSelectionDialog/ProjectSelectionDialog';
import { OnboardingDialog } from './components/OnboardingDialog/OnboardingDialog';
import { GlobalSettingsScreen as AIModels } from './components/GlobalSettings/GlobalSettingsScreen.tsx';
import { WorkspaceManager } from './components/WorkspaceManager/WorkspaceManager.tsx';
import { AgenticPanel, type AgenticPanelRef } from './components/UnifiedAI';
import EditorMode, { type EditorModeRef } from './components/EditorMode/EditorMode';
import { NavigationGutter, type SidebarView } from './components/NavigationGutter';
// NOTE: useTabs and useTabNavigation removed - EditorMode manages tabs now
import type { ContentMode } from './types/WindowModeTypes';
import { TrackerBottomPanel, TrackerBottomPanelType } from './components/TrackerBottomPanel/TrackerBottomPanel.tsx';
import { registerDocumentLinkPlugin } from './plugins/registerDocumentLinkPlugin';
import { registerAIChatPlugin } from './plugins/registerAIChatPlugin';
import { registerTrackerPlugin } from './plugins/registerTrackerPlugin';
import { registerDiffApprovalBarPlugin } from './plugins/registerDiffApprovalBarPlugin';
import { registerSearchReplacePlugin } from './plugins/registerSearchReplacePlugin';
import ProjectSettingsScreen from './components/ProjectSettingsScreen/ProjectSettingsScreen.tsx';
import { loadCustomTrackers } from './services/CustomTrackerLoader';
import './WorkspaceWelcome.css';
import './components/GlobalSettings/GlobalSettingsScreen.css';

logger.ui.info('App.tsx loading');
logger.ui.info('About to import StravuEditor');
logger.ui.info('StravuEditor imported');

// aiChatBridge has been replaced by editorRegistry - no global setup needed

// Logging configuration - control which categories are logged
const LOG_CONFIG = {
  AUTOSAVE: false,  // Set to true to enable autosave logging
  FILE_SYNC: false,  // File sync operations
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
  registerDiffApprovalBarPlugin(); // Diff approval bar in fixed tab header
  registerSearchReplacePlugin(); // Search/replace bar in fixed tab header
  pluginsRegistered = true;
}

export default function App() {
  // console.log('[APP RENDER]', new Date().toISOString(), 'App component rendering');
  logger.ui.info('App component rendering');

  // PostHog for analytics
  const posthog = usePostHog();

  // Check for special window modes
  const urlParams = new URLSearchParams(window.location.search);
  const windowMode = urlParams.get('mode');

  // Apply theme for ALL window modes (must run before early returns)
  const { theme, setTheme } = useTheme();

  // General confirm dialog
  const confirmDialog = useConfirmDialog();

  // Document context hook needs to be after tabs - will declare after special window modes

  // Handle special window modes
  if (windowMode === 'ai-models') {
    // Set window title for AI Models
    React.useEffect(() => {
      if (window.electronAPI) {
        window.electronAPI.setTitle('Global Settings');
      }
    }, []);
    return <AIModels onClose={() => window.close()} />;
  }



  if (windowMode === 'workspace-manager') {
    // Set window title for Workspace Manager
    React.useEffect(() => {
      if (window.electronAPI) {
        window.electronAPI.setTitle('Project Manager - Nimbalyst');
      }
    }, []);
    return <WorkspaceManager />;
  }

  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
  const [currentFileName, setCurrentFileName] = useState<string | null>(null);
  const isDirtyRef = useRef(false);  // Internal tracking for autosave
  const [isDirty, setIsDirty] = useState(false);  // For UI updates
  // NOTE: contentVersion removed - EditorContainer doesn't need version bumping for remounts
  const tabStatesRef = useRef<Map<string, { isDirty: boolean }>>(new Map());  // Track tab dirty states without re-renders
  const tabsRef = useRef<any>(null);  // Reference to current tabs object for use in intervals only
  const hasShownOnboardingRef = useRef(false);  // Track if onboarding was shown in this session
  const [isFirstTimeSetup, setIsFirstTimeSetup] = useState(false);  // Track if showing first-time setup
  const [isInitializing, setIsInitializing] = useState(true);
  const [workspaceMode, setWorkspaceMode] = useState(false);
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  // NOTE: fileTree, sidebarWidth, isNewFileDialogOpen, newFileDirectory, isHistoryDialogOpen moved to EditorMode
  const [isQuickOpenVisible, setIsQuickOpenVisible] = useState(false);
  const [isAgentPaletteVisible, setIsAgentPaletteVisible] = useState(false);
  // NOTE: isAIChatCollapsed, aiChatWidth moved to EditorMode for workspace mode
  // These are kept for potential single-file mode or agent mode use
  const [isAIChatCollapsed, setIsAIChatCollapsed] = useState(false);
  const [aiChatWidth, setAIChatWidth] = useState<number>(350);
  const [isKeyboardShortcutsDialogOpen, setIsKeyboardShortcutsDialogOpen] = useState(false);
  const [isDiscordInvitationOpen, setIsDiscordInvitationOpen] = useState(false);
  const [isAIChatStateLoaded, setIsAIChatStateLoaded] = useState(false);
  // Planning mode for AI sidebar (Claude Code safety). Default ON
  const [aiPlanningModeEnabled, setAIPlanningModeEnabled] = useState<boolean>(true);
  const [isApiKeyDialogOpen, setIsApiKeyDialogOpen] = useState(false);
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

  // Navigation gutter state
  const [sidebarView, setSidebarView] = useState<SidebarView>('files');

  // Content mode management - simple state, no manager needed
  const [activeMode, setActiveModeRaw] = useState<ContentMode>('files');
  const setActiveMode = (mode: ContentMode) => {
    // console.log('[App] setActiveMode called with:', mode, 'current:', activeMode);
    setActiveModeRaw(mode);
  };

  // Track active session ID for agent mode (needed for search routing)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Expose test helpers for testing
  useEffect(() => {
    // Always expose in development
    if (import.meta.env.DEV) {
      (window as any).__testHelpers = {
        ...(window as any).__testHelpers,
        setSidebarView: (view: any) => setSidebarView(view),
        setActiveMode: (mode: any) => setActiveMode(mode),
        getActiveMode: () => activeMode,
        getSidebarView: () => sidebarView
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

    const userRole = localStorage.getItem('user_role');
    const nextPromptTime = localStorage.getItem('onboarding_next_prompt');

    // Don't show if user has completed or permanently skipped
    if (userRole) {
      return;
    }

    // Check if we should wait before prompting again
    if (nextPromptTime) {
      const now = Date.now();
      const promptTime = parseInt(nextPromptTime, 10);

      if (now < promptTime) {
        // Not time to show again yet
        return;
      }

      // Time has passed, clear the timestamp
      localStorage.removeItem('onboarding_next_prompt');
    }

    // Show onboarding dialog
    setIsOnboardingOpen(true);
  }, [isInitializing]);

  // Handle onboarding completion
  const handleOnboardingComplete = useCallback((role: string, customRole: string | null, email: string | null) => {
    // Store user role in localStorage
    const roleToStore = customRole || role;
    localStorage.setItem('user_role', roleToStore);

    // Store email if provided
    if (email) {
      localStorage.setItem('user_email', email);

      // Associate email with user in PostHog
      if (posthog) {
        posthog.people.set({ email });
      }
    }

    // Track onboarding completion event
    if (posthog) {
      posthog.capture('onboarding_completed', {
        user_role: role, // Use the predefined role value (developer, product_manager, or "other")
        custom_role_provided: !!customRole,
        custom_role_text: customRole || undefined, // The actual custom role text
        email_provided: !!email,
      });
    }

    // Close the dialog
    setIsOnboardingOpen(false);
  }, [posthog]);

  // Handle "Ask me later" - set a timestamp for 2 days from now
  const handleOnboardingAskLater = useCallback(() => {
    const nextPromptTime = Date.now() + (2 * 24 * 60 * 60 * 1000); // 2 days in milliseconds
    localStorage.setItem('onboarding_next_prompt', nextPromptTime.toString());

    if (posthog) {
      posthog.capture('onboarding_deferred');
    }

    setIsOnboardingOpen(false);
  }, [posthog]);

  // Handle "Never ask again" - permanently dismiss
  const handleOnboardingNeverAsk = useCallback(() => {
    localStorage.setItem('user_role', 'skipped'); // Special value to indicate user chose to skip

    if (posthog) {
      posthog.capture('onboarding_skipped');
    }

    setIsOnboardingOpen(false);
  }, [posthog]);

  // Load custom trackers when workspace is available
  useEffect(() => {
    if (workspacePath) {
      loadCustomTrackers(workspacePath);
    }
  }, [workspacePath]);

  // Load active mode from workspace state
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
      })
      .catch(error => {
        console.error('[ContentMode] Failed to load active mode:', error);
      });
  }, [workspacePath]);

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
  // EditorMode notifies us of currentFilePath changes via onCurrentFileChange callback.

  // Declare refs needed by hooks below
  const getContentRef = useRef<(() => string) | null>(null);

  // Build document context for AI features (without needing tabs)
  const documentContext = useMemo(() => {
    if (!currentFilePath) {
      return {
        filePath: '',
        fileType: 'markdown',
        content: '',
        cursorPosition: undefined,
        selection: undefined,
        getLatestContent: undefined
      };
    }

    return {
      filePath: currentFilePath,
      fileType: 'markdown',
      content: '', // Don't call getContentRef during render - getLatestContent will be called when needed
      cursorPosition: undefined,
      selection: undefined,
      getLatestContent: getContentRef.current || undefined
    };
  }, [currentFilePath]);
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
    isDirtyRef,
    currentFilePath,
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
  }, [workspacePath]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).currentFilePath = currentFilePath;
    }
  }, [currentFilePath]);

  // NOTE: Sidebar resize handlers moved to EditorMode


  // Handle new file (legacy - used in single-file mode)
  const handleNew = useCallback(() => {
    // Reset global UI state for new file
    setCurrentFilePath(null);
    setCurrentFileName(null);
    setIsDirty(false);

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

  // Wrapper for workspace file selection - delegates to EditorMode
  const handleWorkspaceFileSelect = useCallback(async (filePath: string) => {
    // Switch to files mode if needed
    if (activeMode !== 'files' && activeMode !== 'plan') {
      setActiveMode('files');
    }

    // Delegate to EditorMode
    if (editorModeRef.current) {
      await editorModeRef.current.selectFile(filePath);
    }
  }, [activeMode]);

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

  // Update window title and dirty state
  useEffect(() => {
    if (!window.electronAPI) return;

    let title = 'Nimbalyst';
    if (workspaceMode && workspaceName) {
      if (currentFileName) {
        title = `${currentFileName}${isDirty ? ' •' : ''} - ${workspaceName} - Nimbalyst`;
      } else {
        title = `${workspaceName} - Nimbalyst`;
      }
    } else if (currentFileName) {
      title = `${currentFileName}${isDirty ? ' •' : ''} - Nimbalyst`;
    }

    window.electronAPI.setTitle(title);
    window.electronAPI.setDocumentEdited(isDirty);
  }, [currentFileName, isDirty, workspaceMode, workspaceName]);

  // Create refs to hold current values without triggering re-setup of event listeners
  const isDirtyRefForKeyboard = useRef(isDirty);
  const currentFilePathRefForKeyboard = useRef(currentFilePath);

  useEffect(() => {
    isDirtyRefForKeyboard.current = isDirty;
  }, [isDirty]);

  useEffect(() => {
    currentFilePathRefForKeyboard.current = currentFilePath;
  }, [currentFilePath]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+E for Files mode
      if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setActiveMode('files');
        return false;
      }
      // Cmd+K for Agent mode
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setActiveMode('agent');
        return false;
      }
      // Cmd+L for Plans mode
      if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setActiveMode('plan');
        return false;
      }
      // Cmd+K (Mac) or Ctrl+K (Windows/Linux) for Agent Command Palette - COMMENTED OUT
      // if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      //   e.preventDefault();
      //   e.stopPropagation();
      //   e.stopImmediatePropagation();
      //   if (workspaceMode) {
      //     setIsAgentPaletteVisible(true);
      //   }
      //   return false;
      // }
      // Cmd+O (Mac) or Ctrl+O (Windows/Linux) for Quick Open
      if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (workspaceMode) {
          setIsQuickOpenVisible(true);
        }
        return false;
      }
      // Cmd+Shift+A (Mac) or Ctrl+Shift+A (Windows/Linux) for AI Chat
      if (workspaceMode && (e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'a') {
        e.preventDefault();
        setIsAIChatCollapsed(prev => !prev);
      }
      // NOTE: Cmd+Shift+T for reopening last closed tab disabled - needs EditorMode integration
      // TODO: Move this functionality to EditorMode
      // Cmd+Y (Mac) or Ctrl+Y (Windows/Linux) for History
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        e.preventDefault();
        // Use refs to get current values
        const currentIsDirty = isDirtyRefForKeyboard.current;
        const currentPath = currentFilePathRefForKeyboard.current;
        // Save current state as manual snapshot before opening history (only if dirty)
        const openHistoryDialog = async () => {
          if (currentIsDirty && currentPath && getContentRef.current && window.electronAPI?.history) {
            try {
              const content = getContentRef.current();
              // Wait for snapshot to be created before opening dialog to avoid race conditions
              await window.electronAPI.history.createSnapshot(
                currentPath,
                content,
                'manual',
                'Before viewing history'
              );
            } catch (error) {
              console.error('[App] Failed to create history snapshot before opening dialog:', error);
            }
          }
          // Delegate to EditorMode
          if (workspaceMode && editorModeRef.current) {
            editorModeRef.current.openHistoryDialog();
          }
        };
        openHistoryDialog();
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
    if (activeMode !== 'files' && activeMode !== 'plan') {
      setActiveMode('files');
    }

    // Delegate to EditorMode's file selection handler
    if (editorModeRef.current) {
      await editorModeRef.current.selectFile(filePath);
    }
  }, [activeMode]);

  // NOTE: handleCreateNewFile and handleRestoreFromHistory moved to EditorMode

  // Sync current file path with backend for window title and session restore
  useEffect(() => {
    if (window.electronAPI && currentFilePath !== null) {
      if (LOG_CONFIG.FILE_SYNC) console.log('[FILE_SYNC] Syncing current file path to backend:', currentFilePath);
      const result = window.electronAPI.setCurrentFile(currentFilePath);
      // Handle both promise and non-promise returns
      if (result && typeof result.then === 'function') {
        result.then(() => {
          if (LOG_CONFIG.FILE_SYNC) console.log('[FILE_SYNC] ✓ File path synced successfully');
        }).catch((error) => {
          if (LOG_CONFIG.FILE_SYNC) console.error('[FILE_SYNC] ✗ Failed to sync file path:', error);
        });
      }
    } else if (window.electronAPI && currentFilePath === null) {
      if (LOG_CONFIG.FILE_SYNC) console.log('[FILE_SYNC] Clearing file path in backend');
      window.electronAPI.setCurrentFile(null);
    }
  }, [currentFilePath]);

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
            setWorkspacePath(initialState.workspacePath);
            setWorkspaceName(initialState.workspaceName);
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

  // Check for first-time setup when workspace changes
  useEffect(() => {
    const checkFirstTimeSetup = async () => {
      if (!workspacePath || !workspaceMode) return;

      // Only check once per session for this workspace
      if (hasShownOnboardingRef.current) return;

      try {
        const needsSetup = await OnboardingService.needsOnboarding(workspacePath);
        // console.log('[SETTINGS] Needs first-time setup:', needsSetup);
        if (needsSetup) {
          hasShownOnboardingRef.current = true;
          setIsFirstTimeSetup(true);
          setActiveMode('settings');  // Use activeMode for full-width display

          // Mark onboarding as shown to prevent it from appearing again
          // even if the user dismisses without completing setup
          await OnboardingService.markOnboardingShown(workspacePath);
        }
      } catch (error) {
        console.error('[SETTINGS] Failed to check setup status:', error);
      }
    };

    checkFirstTimeSetup();
  }, [workspacePath, workspaceMode]);

  // Reset onboarding flag when workspace changes
  useEffect(() => {
    hasShownOnboardingRef.current = false;
    setIsFirstTimeSetup(false);
  }, [workspacePath]);

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
    activeSessionId,

    // State setters
    setIsApiKeyDialogOpen,
    setWorkspaceMode,
    setWorkspacePath,
    setWorkspaceName,
    setCurrentFilePath,
    setCurrentFileName,
    setIsDirty,
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
    isDirtyRef,
    getContentRef,
    searchCommandRef,
    editorModeRef,

    // State values
    currentFilePath,
    workspaceMode,
    workspacePath,
    sessionToLoad,
    isDirty,

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

    window.addEventListener('aiToolRequest:createDocument', handleCreateDocument as EventListener);

    return () => {
      window.removeEventListener('aiToolRequest:createDocument', handleCreateDocument as EventListener);
    };
  }, [handleWorkspaceFileSelect]);

  logger.ui.info('Rendering App with config:', {
    currentFilePath,
    currentFileName,
    theme
  });

  logger.ui.info('About to render StravuEditor');

  // Debug: expose values for testing (in useEffect to run after state updates)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__tabPreferencesEnabled__ = true;
      (window as any).__currentFilePath__ = currentFilePath;
      (window as any).__currentFileName__ = currentFileName;
      (window as any).__workspaceMode__ = workspaceMode;
    }
  }, [currentFilePath, currentFileName, workspaceMode]);

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
  const activeModeRef = useRef(activeMode);

  useEffect(() => {
    activeModeRef.current = activeMode;
  });

  useEffect(() => {
    const handleCloseActiveTab = () => {
      // console.log('[App] handleCloseActiveTab called, activeMode:', activeModeRef.current);
      if (activeModeRef.current === 'agent') {
        // console.log('[App] Calling agenticPanelRef.current?.closeActiveTab()');
        agenticPanelRef.current?.closeActiveTab();
      } else if (activeModeRef.current === 'files' || activeModeRef.current === 'plan') {
        // console.log('[App] Calling editorModeRef.current?.closeActiveTab(), ref exists:', !!editorModeRef.current);
        editorModeRef.current?.closeActiveTab();
      }
    };

    window.electronAPI.on('close-active-tab', handleCloseActiveTab);

    return () => {
      window.electronAPI?.off?.('close-active-tab', handleCloseActiveTab);
    };
  }, []); // Empty deps - listener registered once, uses refs for current values

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
  if (isInitializing) {
    return <div style={{ height: '100vh' }} />;
  }

  return (
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
        bottomPanel={bottomPanel}
        onToggleBugsPanel={() => {
          setBottomPanel(prev => prev === 'bug' ? null : 'bug');
        }}
        onToggleTasksPanel={() => {
          setBottomPanel(prev => prev === 'task' ? null : 'task');
        }}
        onToggleIdeasPanel={() => {
          setBottomPanel(prev => prev === 'idea' ? null : 'idea');
        }}
      />

      {/* Right: Main content area + Bottom Panel */}
      <div data-layout="main-column-container" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Top: Main content (sidebar + editor/agent + AI chat) */}
        <div data-layout="top-content-row" style={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0 }}>
          {/* Center: Editor/Agent/Settings area */}
          <div data-layout="center-content-wrapper" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
            {/* Files/Plan Mode - always mounted, visibility controlled by display */}
            <div
              data-layout="files-mode-wrapper"
              style={{
                flex: 1,
                display: (activeMode === 'files' || activeMode === 'plan') ? 'flex' : 'none',
                flexDirection: 'row',
                overflow: 'hidden',
                minHeight: 0
              }}
            >
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
                <EditorMode
                  ref={editorModeRef}
                  workspacePath={workspacePath}
                  workspaceName={workspaceName}
                  theme={theme}
                  isActive={activeMode === 'files' || activeMode === 'plan'}
                  onModeChange={setActiveMode}
                  onCurrentFileChange={(filePath, fileName, isDirty) => {
                    setCurrentFilePath(filePath);
                    setCurrentFileName(fileName);
                    setIsDirty(isDirty);
                  }}
                  onGetContentReady={(getContentFn) => {
                    getContentRef.current = getContentFn;
                  }}
                  onCloseWorkspace={handleCloseWorkspace}
                  onOpenQuickSearch={() => setIsQuickOpenVisible(true)}
                  onSwitchToAgentMode={(planDocumentPath, sessionId) => {
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
                  }}
                />
              ) : (
                <WorkspaceWelcome workspaceName="Open a workspace to get started" />
              )}
            </div>

            {/* Agent Mode - always mounted, visibility controlled by display */}
            <div
              data-layout="agent-mode-wrapper"
              style={{
                flex: 1,
                display: activeMode === 'agent' ? 'flex' : 'none',
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
                  documentContext={documentContext}
                  planDocumentPath={agentPlanReference || undefined}
                  onContentModeChange={setActiveMode}
                  onSessionChange={setActiveSessionId}
                  isActive={activeMode === 'agent'}
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


            {/* Settings Mode - conditionally rendered for now */}
            {activeMode === 'settings' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
                <ProjectSettingsScreen
                  workspacePath={workspacePath || ''}
                  workspaceName={workspaceName || ''}
                  onClose={async () => {
                    // Mark onboarding as complete when closing first-time setup
                    if (isFirstTimeSetup && workspacePath) {
                      try {
                        await OnboardingService.completeOnboarding(workspacePath);
                        console.log('[SETTINGS] Onboarding marked as complete');
                      } catch (error) {
                        console.error('[SETTINGS] Failed to mark onboarding complete:', error);
                      }
                      setIsFirstTimeSetup(false);
                    }
                    setActiveMode('files');
                  }}
                  isFirstTime={isFirstTimeSetup}
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
            currentFilePath={currentFilePath}
            onFileSelect={handleQuickOpenFileSelect}
          />
          <AgentCommandPalette
            isOpen={isAgentPaletteVisible}
            onClose={() => setIsAgentPaletteVisible(false)}
            workspacePath={workspacePath}
            documentContext={{
              content: getContentRef.current ? getContentRef.current() : '',
              filePath: currentFilePath || undefined
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
          window.electronAPI.openAIModels();
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
      <OnboardingDialog
        isOpen={isOnboardingOpen}
        onComplete={handleOnboardingComplete}
        onAskLater={handleOnboardingAskLater}
        onNeverAsk={handleOnboardingNeverAsk}
      />
      <ErrorToastContainer />
    </div>
  );
}
