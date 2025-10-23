import React, { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from './utils/logger';
import type { ConfigTheme, LexicalCommand } from 'rexical';
import { TOGGLE_SEARCH_COMMAND } from 'rexical';
// aiChatBridge has been replaced by editorRegistry
// Import styles - handled by vite plugin for both dev and prod
import 'rexical/styles';
// Import refactored hooks and utilities
import { useIPCHandlers } from './hooks/useIPCHandlers';
import { useWindowLifecycle } from './hooks/useWindowLifecycle';
import { useTheme } from './hooks/useTheme';
import { useConfirmDialog } from './hooks/useConfirmDialog';
import { useDocumentContext } from './hooks/useDocumentContext';
import { handleWorkspaceFileSelect as handleWorkspaceFileSelectUtil } from './utils/workspaceFileOperations';
import { aiToolService } from './services/AIToolService';
import { editorRegistry } from '@nimbalyst/runtime/ai/EditorRegistry';
import { WorkspaceSidebar } from './components/WorkspaceSidebar.tsx';
import { WorkspaceWelcome } from './components/WorkspaceWelcome.tsx';
import { QuickOpen } from './components/QuickOpen';
import { AgentCommandPalette } from './components/AgentCommandPalette';
import { AIChat } from './components/AIChat';
import { ConfirmDialog } from './components/ConfirmDialog/ConfirmDialog';
import { DiscordInvitation } from './components/DiscordInvitation/DiscordInvitation';
import { HistoryDialog } from './components/HistoryDialog';
import { KeyboardShortcutsDialog } from './components/KeyboardShortcutsDialog/KeyboardShortcutsDialog';
import { ErrorDialog } from './components/ErrorDialog/ErrorDialog';
import { ErrorToastContainer } from './components/ErrorToast/ErrorToast';
import { ApiKeyDialog } from './components/ApiKeyDialog';
import { AIModelsRedesigned as AIModels } from './components/AIModels/AIModelsRedesigned';
import { SessionManager } from './components/SessionManager/SessionManager';
import { WorkspaceManager } from './components/WorkspaceManager/WorkspaceManager.tsx';
import { NewFileDialog } from './components/NewFileDialog';
import { AgenticCodingWindow } from './components/AgenticCodingWindow';
import { AgenticPanel } from './components/UnifiedAI';
import { TabManager } from './components/TabManager/TabManager';
import { TabContent } from './components/TabContent/TabContent';
import { NavigationGutter, type NavigationMode, type SidebarView } from './components/NavigationGutter';
import { BugsScreen } from './components/BugsScreen/BugsScreen';
import { useTabs } from './hooks/useTabs';
import { useTabNavigation } from './hooks/useTabNavigation';
import type { ContentMode } from './types/WindowModeTypes';
import { PlansPanel } from './components/PlansPanel/PlansPanel';
import { TrackerBottomPanel, TrackerBottomPanelType } from './components/TrackerBottomPanel/TrackerBottomPanel.tsx';
import { registerDocumentLinkPlugin } from './plugins/registerDocumentLinkPlugin';
import { registerPlanStatusPlugin } from './plugins/registerPlanStatusPlugin';
import { registerDecisionStatusPlugin } from './plugins/registerDecisionStatusPlugin';
import { registerAIChatPlugin } from './plugins/registerAIChatPlugin';
import { registerItemTrackerPlugin } from './plugins/registerItemTrackerPlugin';
import { registerTrackerPlugin } from './plugins/registerTrackerPlugin';
import SettingsScreen from './components/SettingsScreen/SettingsScreen';
import OnboardingService from './services/OnboardingService';
import './WorkspaceWelcome.css';
import './components/AIModels/AIModelsRedesigned.css';

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
  registerTrackerPlugin(); // New unified tracker system
  registerPlanStatusPlugin(); // TODO: Remove after testing
  registerDecisionStatusPlugin(); // TODO: Remove after testing
  registerItemTrackerPlugin();
  registerAIChatPlugin();
  pluginsRegistered = true;
}

export default function App() {
  // console.log('[APP RENDER]', new Date().toISOString(), 'App component rendering');
  logger.ui.info('App component rendering');

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
        window.electronAPI.setTitle('AI Models');
      }
    }, []);
    return <AIModels onClose={() => window.close()} />;
  }

  if (windowMode === 'agentic-coding') {
    const sessionId = urlParams.get('sessionId') || undefined;
    const workspacePath = urlParams.get('workspacePath');
    const planDocumentPath = urlParams.get('planDocumentPath') || undefined;

    if (!workspacePath) {
      return (
        <div className="h-screen flex items-center justify-center bg-bg-primary">
          <div className="text-status-error">Missing workspace path</div>
        </div>
      );
    }

    return (
      <AgenticCodingWindow
        sessionId={sessionId}
        workspacePath={workspacePath}
        planDocumentPath={planDocumentPath}
      />
    );
  }

  if (windowMode === 'session-manager') {
    // Set window title for Session Manager
    React.useEffect(() => {
      if (window.electronAPI) {
        window.electronAPI.setTitle('AI Chat Sessions - All Workspaces');
      }
    }, []);
    const filterWorkspace = urlParams.get('filterWorkspace') || undefined;
    return <SessionManager filterWorkspace={filterWorkspace} />;
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
  const [isInitializing, setIsInitializing] = useState(true);
  const [workspaceMode, setWorkspaceMode] = useState(false);
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<FileTreeItem[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState<number>(250);
  const [isQuickOpenVisible, setIsQuickOpenVisible] = useState(false);
  const [isAgentPaletteVisible, setIsAgentPaletteVisible] = useState(false);
  const [isNewFileDialogOpen, setIsNewFileDialogOpen] = useState(false);
  const [newFileDirectory, setNewFileDirectory] = useState<string | null>(null);
  const [isAIChatCollapsed, setIsAIChatCollapsed] = useState(false);
  const [aiChatWidth, setAIChatWidth] = useState<number>(350);
  const [isHistoryDialogOpen, setIsHistoryDialogOpen] = useState(false);
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

  // Navigation gutter state
  const [sidebarView, setSidebarView] = useState<SidebarView>('files');

  // Content mode management - simple state, no manager needed
  const [activeMode, setActiveModeRaw] = useState<ContentMode>('files');
  const setActiveMode = (mode: ContentMode) => {
    console.log('[App] setActiveMode called with:', mode, 'current:', activeMode);
    setActiveModeRaw(mode);
  };

  // Bottom panel state (shared across all modes)
  const [bottomPanel, setBottomPanel] = useState<TrackerBottomPanelType | null>(null);
  const [bottomPanelHeight, setBottomPanelHeight] = useState<number>(300);

  // Agent panel plan reference (for launching from plan status)
  const [agentPlanReference, setAgentPlanReference] = useState<string | null>(null);

  // Load active mode from workspace state
  useEffect(() => {
    if (!workspacePath || !window.electronAPI?.invoke) return;

    window.electronAPI.invoke('workspace:get-state', workspacePath)
      .then(state => {
        if (state?.activeMode) {
          setActiveMode(state.activeMode as ContentMode);
        }
      })
      .catch(error => {
        console.error('[ContentMode] Failed to load active mode:', error);
      });
  }, [workspacePath]);

  // Save active mode when it changes
  useEffect(() => {
    // console.log('[App Layout] Active mode changed to:', activeMode, 'bottomPanel:', bottomPanel);

    if (!workspacePath || !window.electronAPI?.invoke) return;

    window.electronAPI.invoke('workspace:update-state', workspacePath, { activeMode })
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

  // Tab management state
  // Tabs are always enabled - removed tabPreferences

  // Create a ref to hold navigation state getter
  const getNavigationStateRef = useRef<(() => any) | undefined>();

  // console.log('[APP] Creating useTabs hook, workspaceMode:', workspaceMode, 'workspacePath:', workspacePath);
  const tabs = useTabs({
    maxTabs: Infinity, // Unlimited tabs
    enabled: true,
    workspacePath, // Pass workspace path for unified state management
    getNavigationState: () => getNavigationStateRef.current?.(),
    onTabChange: async (tab) => {
      // console.log(`[App] onTabChange: switching to ${tab.fileName}, isDirty=${tab.isDirty}`);

      // EditorContainer handles save-on-switch and all per-editor state
      // We just update global UI state here

      if (tab.filePath) {
        setCurrentFilePath(tab.filePath);
        setCurrentFileName(tab.fileName);
        setIsDirty(tab.isDirty || false);

        // Update the main process about the current file
        if (window.electronAPI) {
          window.electronAPI.setCurrentFile(tab.filePath);
        }
      }
    },
    onTabClose: (tab) => {
      // EditorContainer handles save-on-close
      // Nothing to do here - EditorContainer's cleanup useEffect handles saving
    }
  });

  // Keep tabsRef updated with the current tabs object
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  // Declare refs needed by hooks below
  const getContentRef = useRef<(() => string) | null>(null);

  // Build document context for AI features
  const documentContext = useDocumentContext({
    activeTab: tabs.activeTab,
    getContentRef
  });

  // Initialize tab navigation for back/forward functionality
  const navigation = useTabNavigation({
    enabled: workspaceMode,
    tabs: tabs.tabs,
    activeTabId: tabs.activeTabId,
    switchTab: tabs.switchTab
  });

  // Store navigation state getter in ref for tabs to use
  useEffect(() => {
    getNavigationStateRef.current = navigation.getNavigationState;
  }, [navigation.getNavigationState]);

  // Restore navigation state when tabs are restored
  useEffect(() => {
    if (!window.electronAPI?.invoke || !workspacePath) return;

    const restoreNavigationState = async () => {
      try {
        const workspaceState = await window.electronAPI.invoke('workspace:get-state', workspacePath);
        if (workspaceState?.navigationHistory) {
          navigation.setNavigationState(workspaceState.navigationHistory);
        }
      } catch (error) {
        console.error('Failed to restore navigation state:', error);
      }
    };

    // Delay to ensure tabs are loaded first
    const timer = setTimeout(restoreNavigationState, 600);
    return () => clearTimeout(timer);
  }, [workspaceMode, workspacePath, navigation.setNavigationState]);
  const editorRef = useRef<any>(null);
  const searchCommandRef = useRef<LexicalCommand<undefined> | null>(null);
  const isInitializedRef = useRef<boolean>(false);

  // NOTE: autoSaveIntervalRef and autoSaveCancellationRef removed - EditorContainer handles autosave now
  const activeSavesRef = useRef<Set<string>>(new Set());
  const lastSavePathRef = useRef<string | null>(null);
  const lastChangeTimeRef = useRef<number>(0);  // Track when content last changed for debouncing
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isResizingRef = useRef<boolean>(false);

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

  // Load persisted sidebar width once workspace is known
  useEffect(() => {
    if (!workspacePath || !window.electronAPI?.getSidebarWidth) return;
    window.electronAPI.getSidebarWidth(workspacePath)
      .then(width => {
        if (typeof width === 'number') {
          setSidebarWidth(width);
        }
      })
      .catch(error => {
        console.error('Failed to load workspace sidebar width:', error);
      });
  }, [workspacePath]);

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

  // Handle sidebar resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;

      const newWidth = Math.min(Math.max(150, e.clientX), 500);
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (!isResizingRef.current) return;

      isResizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      // Save the width
      if (window.electronAPI && workspacePath) {
        window.electronAPI.setSidebarWidth(workspacePath, sidebarWidth);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [sidebarWidth]);


  // Handle new file
  const handleNew = useCallback(() => {
    // Close all existing tabs and create a new empty tab
    tabs.closeAllTabs();

    // Reset global UI state
    setCurrentFilePath(null);
    setCurrentFileName(null);
    setIsDirty(false);

    // Note: No need to set refs - EditorContainer manages all editor state
  }, [tabs]);

  // Handle open file
  const handleOpen = useCallback(async () => {
    if (!window.electronAPI) return;

    try {
      const result = await window.electronAPI.openFile();
      if (result) {
        // Close any existing tabs first (single-file mode = one tab only)
        tabs.closeAllTabs();

        // Create a tab for the new file
        tabs.addTab(result.filePath, result.content);

        // UI state will be updated by onTabChange callback

        // Create automatic snapshot when opening file
        if (window.electronAPI.history) {
          try {
            // Check if we have previous snapshots
            const snapshots = await window.electronAPI.history.listSnapshots(result.filePath);
            if (snapshots.length === 0) {
              // First time opening this file, create initial snapshot
              await window.electronAPI.history.createSnapshot(
                result.filePath,
                result.content,
                'auto',
                'Initial file open'
              );
            } else {
              // Check if content changed since last snapshot
              const latestSnapshot = snapshots[0]; // Assuming sorted by timestamp desc
              const lastContent = await window.electronAPI.history.loadSnapshot(
                result.filePath,
                latestSnapshot.timestamp
              );
              if (lastContent !== result.content) {
                // Content actually changed, create snapshot
                await window.electronAPI.history.createSnapshot(
                  result.filePath,
                  result.content,
                  'auto',
                  'File changed externally'
                );
              }
            }
          } catch (error) {
            console.error('Failed to create automatic snapshot:', error);
          }
        }
      }
    } catch (error) {
      console.error('Failed to open file:', error);
    }
  }, []);

  // Handle save as
  const handleSaveAs = useCallback(async () => {
    if (LOG_CONFIG.FILE_OPS) console.log('[FILE_OPS] handleSaveAs called');
    if (!window.electronAPI || !getContentRef.current) return;

    const content = getContentRef.current();

    try {
      if (LOG_CONFIG.FILE_OPS) console.log('[FILE_OPS] Calling electronAPI.saveFileAs');
      const result = await window.electronAPI.saveFileAs(content);
      if (LOG_CONFIG.FILE_OPS) console.log('[FILE_OPS] Save as result:', result);
      if (result) {
        if (LOG_CONFIG.FILE_OPS) console.log('[FILE_OPS] Setting current file path to:', result.filePath);
        setCurrentFilePath(result.filePath);
        setCurrentFileName(result.filePath.split('/').pop() || result.filePath);
        setIsDirty(false);

        // Update tab state
        if (tabs.activeTabId) {
          tabs.updateTab(tabs.activeTabId, {
            filePath: result.filePath,
            fileName: result.filePath.split('/').pop() || result.filePath,
            isDirty: false,
            lastSaved: new Date()
          });
        }
      }
    } catch (error) {
      console.error('Failed to save file as:', error);
    }
  }, []);

  // Manual save function provided by EditorContainer
  const handleSaveRef = useRef<(() => Promise<void>) | null>(null);

  // Handle close workspace
  const handleCloseWorkspace = useCallback(async () => {
    // NOTE: EditorContainer handles saving dirty files automatically
    // Close the window
    window.close();
  }, []);

  // Wrapper for workspace file selection utility with component-specific context
  const handleWorkspaceFileSelect = useCallback(async (filePath: string) => {
    return handleWorkspaceFileSelectUtil({
      filePath,
      currentFilePath,
      tabs,
      isInitializedRef,
      setCurrentFilePath,
      setCurrentFileName,
    });
  }, [currentFilePath, tabs, setCurrentFileName, setCurrentFilePath]);

  // Configure aiToolService with handleWorkspaceFileSelect
  useEffect(() => {
    aiToolService.setHandleWorkspaceFileSelectFunction(handleWorkspaceFileSelect);
  }, [handleWorkspaceFileSelect]);

  // Register file opener with editorRegistry for background file opening
  useEffect(() => {
    const fileOpener = async (filePath: string, content: string, switchToTab: boolean) => {
      if (tabs && tabs.addTab) {
        tabs.addTab(filePath, content, switchToTab);
      }
    };
    editorRegistry.setFileOpener(fileOpener);
  }, [tabs]);

  // Open the welcome tab - virtual document
  const openWelcomeTab = useCallback(async () => {
    const virtualPath = 'virtual://welcome';

    // Check if welcome tab is already open
    const existingTab = tabs.findTabByPath(virtualPath);
    if (existingTab) {
      tabs.switchTab(existingTab.id);
      return;
    }

    try {
      // Load the welcome document content from the main process
      console.log('[WELCOME] Attempting to load virtual document:', virtualPath);
      console.log('[WELCOME] documentService available:', !!window.electronAPI?.documentService);
      console.log('[WELCOME] loadVirtual method available:', !!(window.electronAPI?.documentService as any)?.loadVirtual);

      const content = await (window.electronAPI.documentService as any).loadVirtual(virtualPath);
      console.log('[WELCOME] Received content, length:', content?.length);

      if (!content) {
        console.error('[WELCOME] Failed to load welcome document - content is null or undefined');
        return;
      }

      // Add the welcome tab
      const tabId = tabs.addTab(virtualPath, content);
      if (tabId) {
        // Mark the tab as virtual
        tabs.updateTab(tabId, { isVirtual: true });

        // Global UI state will be updated by onTabChange callback
      }
    } catch (error) {
      console.error('[WELCOME] Failed to open welcome tab:', error);
    }
  }, [tabs, setIsDirty, setCurrentFileName, setCurrentFilePath]);


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

    console.log('[App] Setting up IPC listener for set-content-mode');
    window.electronAPI.on('set-content-mode', handleSetContentMode);
    window.electronAPI.on('agent:insert-plan-reference', handleInsertPlanReference);
    // COMMENTED OUT - Cmd+K now switches to Agent mode
    // window.electronAPI.on('toggle-agent-palette', handleToggleAgentPalette);

    return () => {
      console.log('[App] Removing IPC listener for set-content-mode');
      window.electronAPI.off?.('set-content-mode', handleSetContentMode);
      window.electronAPI.off?.('agent:insert-plan-reference', handleInsertPlanReference);
      // window.electronAPI.off?.('toggle-agent-palette', handleToggleAgentPalette);
    };
  }, []); // Remove workspaceMode dependency - listener should always be active

  // Listen for Discord invitation IPC event
  useEffect(() => {
    console.log('[App] Setting up Discord invitation IPC listener');
    if (!window.electronAPI?.on) {
      console.log('[App] electronAPI.on not available');
      return;
    }

    const handleShowDiscordInvitation = () => {
      console.log('[App] Received show-discord-invitation event');
      setIsDiscordInvitationOpen(true);
    };

    window.electronAPI.on('show-discord-invitation', handleShowDiscordInvitation);
    console.log('[App] Discord invitation listener registered');

    return () => {
      console.log('[App] Removing Discord invitation listener');
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
      // Cmd+Shift+T (Mac) or Ctrl+Shift+T (Windows/Linux) to reopen last closed tab
      if (workspaceMode && (e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 't') {
        e.preventDefault();
        tabs.reopenLastClosedTab();
      }
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
          setIsHistoryDialogOpen(true);
        };
        openHistoryDialog();
      }
      // Bottom panel keyboard shortcuts
      // Cmd+Shift+P for Plans panel
      if (workspaceMode && (e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'p') {
        e.preventDefault();
        setBottomPanel(prev => prev === 'plans' ? null : 'plans');
      }
      // Cmd+Shift+B for Bugs panel
      if (workspaceMode && (e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'b') {
        e.preventDefault();
        setBottomPanel(prev => prev === 'bugs' ? null : 'bugs');
      }
      // Cmd+Shift+K for Tasks panel
      if (workspaceMode && (e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'k') {
        e.preventDefault();
        setBottomPanel(prev => prev === 'tasks' ? null : 'tasks');
      }
    };

    // Use capture phase to intercept before any other handlers (like Lexical's)
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [workspaceMode, tabs.reopenLastClosedTab, activeMode]);

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

  // Handle QuickOpen file selection
  const handleQuickOpenFileSelect = useCallback(async (filePath: string) => {
    await handleWorkspaceFileSelect(filePath);
    // Recent files are now added inside handleWorkspaceFileSelect

    // Switch to files mode if we're in a different mode (e.g., settings, agent, etc.)
    if (activeMode !== 'files' && activeMode !== 'plan') {
      setActiveMode('files');
    }
  }, [handleWorkspaceFileSelect, activeMode]);

  // Handle creating a new file in workspace
  const handleCreateNewFile = useCallback(async (fileName: string) => {
    if (!window.electronAPI) return;

    const directory = newFileDirectory || workspacePath;
    if (!directory) return;

    const filePath = `${directory}/${fileName}`;

    try {
      // Create the file with empty content
      await window.electronAPI.createFile(filePath, '');

      // Open the newly created file
      await handleWorkspaceFileSelect(filePath);

      // Refresh file tree
      if (workspacePath) {
        const tree = await window.electronAPI.getFolderContents(workspacePath);
        setFileTree(tree);
      }

      // Reset the directory after creating the file
      setNewFileDirectory(null);
    } catch (error) {
      console.error('Failed to create file:', error);
      alert('Failed to create file: ' + error);
    }
  }, [newFileDirectory, workspacePath, handleWorkspaceFileSelect]);

  // Handle restoring content from history
  const handleRestoreFromHistory = useCallback(async (content: string) => {
    if (!currentFilePath) {
      return;
    }

    try {
      // Simple approach: Just write the restored content to disk
      // The file watcher will detect the change and reload the editor automatically
      await window.electronAPI.saveFile(content, currentFilePath);
    } catch (error) {
      console.error('[App] Failed to restore content from history:', error);
    }

    // Close the history dialog
    setIsHistoryDialogOpen(false);
  }, [currentFilePath]);

  // Sync current file path with backend whenever it changes
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
      } else {
        if (LOG_CONFIG.FILE_SYNC) console.log('[FILE_SYNC] File path sync called (no promise returned)');
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
            setFileTree(initialState.fileTree || []);
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
  // TEMPORARILY DISABLED - causing settings screen to show on every load
  // useEffect(() => {
  //   const checkFirstTimeSetup = async () => {
  //     if (!workspacePath || !workspaceMode) return;

  //     try {
  //       const needsSetup = await OnboardingService.needsOnboarding(workspacePath);
  //       console.log('[SETTINGS] Needs first-time setup:', needsSetup);
  //       if (needsSetup) {
  //         setSidebarView('settings');
  //       }
  //     } catch (error) {
  //       console.error('[SETTINGS] Failed to check setup status:', error);
  //     }
  //   };

  //   checkFirstTimeSetup();
  // }, [workspacePath, workspaceMode]);

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

    // State setters
    setIsApiKeyDialogOpen,
    setWorkspaceMode,
    setWorkspacePath,
    setWorkspaceName,
    setFileTree,
    setCurrentFilePath,
    setCurrentFileName,
    setIsDirty,
    setIsNewFileDialogOpen,
    setIsAIChatCollapsed,
    setAIChatWidth,
    setIsAIChatStateLoaded,
    setSessionToLoad,
    setIsHistoryDialogOpen,
    setIsKeyboardShortcutsDialogOpen,
    setIsAgentPaletteVisible,
    setAIPlanningMode: setAIPlanningModeEnabled,
    setTheme,

    // Refs
    isInitializedRef,
    isDirtyRef,
    getContentRef,
    editorRef,
    searchCommandRef,

    // State values
    currentFilePath,
    workspaceMode,
    workspacePath,
    sessionToLoad,
    isDirty,

    // Tabs
    tabs,

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
    tabsCount: tabs.tabs.length,
    activeTabId: tabs.activeTabId,
    currentFileName,
    theme
  });

  logger.ui.info('About to render StravuEditor');

  // Debug: expose values for testing (in useEffect to run after state updates)
  useEffect(() => {
    // console.log('[APP-DEBUG] Setting window variables:', {
    //   activeTab: tabs.activeTab?.fileName,
    //   activeTabId: tabs.activeTabId,
    //   tabCount: tabs.tabs.length
    // });
    if (typeof window !== 'undefined') {
      (window as any).__tabPreferencesEnabled__ = true;
      (window as any).__activeTab__ = tabs.activeTab;
      (window as any).__activeTabId__ = tabs.activeTabId;
      (window as any).__tabCount__ = tabs.tabs.length;
    }
  }, [tabs]);

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
          if (window.electronAPI) {
            window.electronAPI.invoke('open-session-manager', workspacePath);
          }
        }}
        onTogglePlansPanel={() => {
          setBottomPanel(prev => prev === 'plans' ? null : 'plans');
        }}
        bottomPanel={bottomPanel}
        onToggleBugsPanel={() => {
          setBottomPanel(prev => prev === 'bugs' ? null : 'bugs');
        }}
        onToggleTasksPanel={() => {
          setBottomPanel(prev => prev === 'tasks' ? null : 'tasks');
        }}
        onToggleIdeasPanel={() => {
          setBottomPanel(prev => prev === 'ideas' ? null : 'ideas');
        }}
      />

      {/* Right: Main content area + Bottom Panel */}
      <div data-layout="main-column-container" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Top: Main content (sidebar + editor/agent + AI chat) */}
        <div data-layout="top-content-row" style={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0 }}>
          {/* Left Sidebar (Files or Plans) */}
          {workspaceName && sidebarView !== 'settings' && (activeMode === 'files' || activeMode === 'plan') && (
        <>
          <div ref={sidebarRef} style={{ width: sidebarWidth, position: 'relative' }}>
            {activeMode === 'files' ? (
              <WorkspaceSidebar
              workspaceName={workspaceName}
              workspacePath={workspacePath || ''}
              fileTree={fileTree}
              currentFilePath={currentFilePath}
              currentView={sidebarView}
              onFileSelect={handleWorkspaceFileSelect}
              onCloseWorkspace={handleCloseWorkspace}
              onOpenQuickSearch={() => setIsQuickOpenVisible(true)}
              onRefreshFileTree={async () => {
                if (workspacePath && window.electronAPI) {
                  const tree = await window.electronAPI.getFolderContents(workspacePath);
                  setFileTree(tree);
                }
              }}
              onViewHistory={(filePath) => {
                setIsHistoryDialogOpen(true);
              }}
              onNewPlan={() => {
                // Create a new plan file in the plans directory
                setIsNewFileDialogOpen(true);
                setNewFileDirectory(workspacePath ? `${workspacePath}/plans` : null);
              }}
              onOpenPlansTable={() => setBottomPanel(prev => prev === 'plans' ? null : 'plans')}
            />
            ) : (
              <PlansPanel
                currentFilePath={currentFilePath}
                onPlanSelect={handleWorkspaceFileSelect}
              />
            )}
          </div>
          <div
            style={{
              width: '5px',
              cursor: 'col-resize',
              backgroundColor: 'transparent',
              position: 'relative',
              zIndex: 10,
              marginLeft: '-2.5px',
              marginRight: '-2.5px'
            }}
            onMouseDown={handleMouseDown}
          >
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: '2px',
                width: '2px',
                backgroundColor: '#e5e7eb',
                transition: 'background-color 0.2s'
              }}
              className="sidebar-resize-handle"
            />
          </div>
          </>
          )}

          {/* Center: Editor/Agent/Settings area */}
          <div data-layout="center-content-wrapper" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
            {/* Files/Plan Mode - always mounted, visibility controlled by display */}
            <div
              data-layout="files-mode-wrapper"
              style={{
                flex: 1,
                display: (activeMode === 'files' || activeMode === 'plan') ? 'flex' : 'none',
                flexDirection: 'column',
                overflow: 'hidden',
                minHeight: 0
              }}
            >
              {sidebarView === 'settings' ? (
                <SettingsScreen
                  workspacePath={workspacePath || ''}
                  workspaceName={workspaceName || ''}
                  onClose={() => {
                    setSidebarView('files');
                  }}
                  isFirstTime={false}
                />
              ) : tabs.activeTab ? (
                <div className="file-tabs-container" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <TabManager
                  tabs={tabs.tabs}
                  activeTabId={tabs.activeTabId}
                  onTabSelect={tabs.switchTab}
                  onTabClose={tabs.removeTab}
                  onNewTab={() => {
                    setIsNewFileDialogOpen(true);
                  }}
                  onTogglePin={tabs.togglePin}
                  onTabReorder={tabs.reorderTabs}
                  onViewHistory={(tabId) => {
                    const tab = tabs.getTabState(tabId);
                    if (tab && tab.filePath) {
                      setIsHistoryDialogOpen(true);
                    }
                  }}
                  hideTabBar={false}
                  isActive={activeMode === 'files' || activeMode === 'plan'}
                >
                  {tabs.activeTab ? (
                    <TabContent
                      tabs={tabs.tabs}
                      activeTabId={tabs.activeTabId}
                      theme={theme}
                      onManualSaveReady={(saveFn) => {
                        handleSaveRef.current = saveFn;
                      }}
                      onSaveComplete={(filePath) => {
                        setCurrentFilePath(filePath);
                        setCurrentFileName(filePath.split('/').pop() || filePath);
                        setIsDirty(false);

                        if (tabs.activeTabId) {
                          tabs.updateTab(tabs.activeTabId, {
                            isDirty: false,
                            lastSaved: new Date()
                          });
                        }
                      }}
                      onGetContentReady={(tabId, getContentFn) => {
                        if (tabId === tabs.activeTabId) {
                          getContentRef.current = getContentFn;
                          aiToolService.setGetContentFunction(getContentFn);
                        }
                      }}
                      onTabDirtyChange={(changedTabId, changedIsDirty) => {
                        const tab = tabs.getTabState(changedTabId);
                        if (tab && tab.isDirty !== changedIsDirty) {
                          tabs.updateTab(changedTabId, { isDirty: changedIsDirty });
                          if (changedTabId === tabs.activeTabId) {
                            setIsDirty(changedIsDirty);
                          }
                        }
                      }}
                    />
                  ) : (
                    <WorkspaceWelcome workspaceName={workspaceName || 'Workspace'} />
                  )}
                </TabManager>
              </div>
            ) : (
              <WorkspaceWelcome workspaceName={workspaceName || 'Open a file to get started'} />
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
                  mode="agent"
                  workspacePath={workspacePath}
                  documentContext={documentContext}
                  planDocumentPath={agentPlanReference || undefined}
                  onContentModeChange={setActiveMode}
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

            {/* Tracker Mode - conditionally rendered for now */}
            {activeMode === 'tracker' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
                <BugsScreen />
              </div>
            )}

            {/* Settings Mode - conditionally rendered for now */}
            {activeMode === 'settings' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
                <SettingsScreen
                  workspacePath={workspacePath || ''}
                  workspaceName={workspaceName || ''}
                  onClose={() => {
                    setActiveMode('files');
                  }}
                  isFirstTime={false}
                />
              </div>
            )}
          </div>

          {/* Right: AI Chat */}
          {sidebarView !== 'settings' && (activeMode === 'files' || activeMode === 'plan') && (
            <AIChat
              isCollapsed={isAIChatCollapsed}
              onToggleCollapse={() => setIsAIChatCollapsed(prev => !prev)}
              width={aiChatWidth}
              onWidthChange={setAIChatWidth}
              planningModeEnabled={aiPlanningModeEnabled}
              onTogglePlanningMode={setAIPlanningModeEnabled}
              workspacePath={workspacePath || undefined}
              sessionToLoad={sessionToLoad}
              onSessionLoaded={() => setSessionToLoad(null)}
              onSessionIdChange={setCurrentAISessionId}
              onShowApiKeyError={() => setIsApiKeyDialogOpen(true)}
              documentContext={documentContext}
              onApplyEdit={(edit, prompt, aiResponse) => {
                console.log('Edit already applied by AIChat component, updating UI state');
                if (edit.type === 'diff' && edit.replacements) {
                  console.log('Diff applied successfully - showing red/green preview');
                }
              }}
            />
          )}
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
          <NewFileDialog
            isOpen={isNewFileDialogOpen}
            onClose={() => {
              setIsNewFileDialogOpen(false);
              setNewFileDirectory(null);
            }}
            currentDirectory={newFileDirectory || workspacePath}
            workspacePath={workspacePath}
            onCreateFile={handleCreateNewFile}
          />
        </>
      )}
      <HistoryDialog
        isOpen={isHistoryDialogOpen}
        onClose={() => setIsHistoryDialogOpen(false)}
        filePath={currentFilePath}
        onRestore={handleRestoreFromHistory}
      />
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
      <ErrorToastContainer />
    </div>
  );
}
