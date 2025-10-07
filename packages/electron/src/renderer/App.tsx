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
import { handleWorkspaceFileSelect as handleWorkspaceFileSelectUtil } from './utils/workspaceFileOperations';
import { aiToolService } from './services/AIToolService';
import { WorkspaceSidebar } from './components/WorkspaceSidebar.tsx';
import { WorkspaceWelcome } from './components/WorkspaceWelcome.tsx';
import { QuickOpen } from './components/QuickOpen';
import { AgentCommandPalette } from './components/AgentCommandPalette';
import { AIChat } from './components/AIChat';
import { HistoryDialog } from './components/HistoryDialog';
import { ErrorDialog } from './components/ErrorDialog/ErrorDialog';
import { ErrorToastContainer } from './components/ErrorToast/ErrorToast';
import { ApiKeyDialog } from './components/ApiKeyDialog';
import { AIModelsRedesigned as AIModels } from './components/AIModels/AIModelsRedesigned';
import { SessionManager } from './components/SessionManager/SessionManager';
import { WorkspaceManager } from './components/WorkspaceManager/WorkspaceManager.tsx';
import { NewFileDialog } from './components/NewFileDialog';
import { AgenticCodingWindow } from './components/AgenticCodingWindow';
import { TabManager } from './components/TabManager/TabManager';
import { EditorContainer } from './components/EditorContainer';
import { getEditorPool } from './services/EditorPool';
import { useTabs } from './hooks/useTabs';
import { useTabNavigation } from './hooks/useTabNavigation';
import { registerDocumentLinkPlugin } from './plugins/registerDocumentLinkPlugin';
import { registerPlanStatusPlugin } from './plugins/registerPlanStatusPlugin';
import { registerAIChatPlugin } from './plugins/registerAIChatPlugin';
import { registerItemTrackerPlugin } from './plugins/registerItemTrackerPlugin';
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
  registerPlanStatusPlugin();
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
  const savedTheme = localStorage.getItem('theme') as ConfigTheme || 'auto';
  useEffect(() => {
    const root = document.documentElement;

    if (savedTheme === 'dark') {
      root.classList.add('dark-theme');
      root.classList.remove('light-theme', 'crystal-dark-theme');
      root.setAttribute('data-theme', 'dark');
    } else if (savedTheme === 'light') {
      root.classList.add('light-theme');
      root.classList.remove('dark-theme', 'crystal-dark-theme');
      root.setAttribute('data-theme', 'light');
    } else if (savedTheme === 'crystal-dark') {
      root.classList.add('crystal-dark-theme');
      root.classList.remove('light-theme', 'dark-theme');
      root.setAttribute('data-theme', 'crystal-dark');
    } else {
      // Auto theme - let CSS handle it with prefers-color-scheme
      root.classList.remove('dark-theme', 'light-theme', 'crystal-dark-theme');
      root.removeAttribute('data-theme');
    }
  }, [savedTheme]);

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
        window.electronAPI.setTitle('Workspace Manager - Preditor');
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
  // Initialize theme from localStorage immediately
  const [theme, setTheme] = useState<ConfigTheme>(() => {
    const savedTheme = localStorage.getItem('theme');
    console.log('[App] Initial theme from localStorage:', savedTheme);
    return (savedTheme as ConfigTheme) || 'auto';
  });
  const [sidebarWidth, setSidebarWidth] = useState<number>(250);
  const [isQuickOpenVisible, setIsQuickOpenVisible] = useState(false);
  const [isAgentPaletteVisible, setIsAgentPaletteVisible] = useState(false);
  const [recentWorkspaceFiles, setRecentWorkspaceFiles] = useState<string[]>([]);
  const [isNewFileDialogOpen, setIsNewFileDialogOpen] = useState(false);
  const [currentDirectory, setCurrentDirectory] = useState<string | null>(null);
  const [isAIChatCollapsed, setIsAIChatCollapsed] = useState(false);
  const [aiChatWidth, setAIChatWidth] = useState<number>(350);
  const [isHistoryDialogOpen, setIsHistoryDialogOpen] = useState(false);
  const [isAIChatStateLoaded, setIsAIChatStateLoaded] = useState(false);
  const [isApiKeyDialogOpen, setIsApiKeyDialogOpen] = useState(false);
  const [sessionToLoad, setSessionToLoad] = useState<{ sessionId: string; workspacePath?: string } | null>(null);
  const [currentAISessionId, setCurrentAISessionId] = useState<string | null>(null);
  const [diffError, setDiffError] = useState<{ isOpen: boolean; title: string; message: string; details?: any }>({
    isOpen: false,
    title: '',
    message: '',
    details: undefined
  });
  const [lastPrompt, setLastPrompt] = useState<string>('');
  const [lastAIResponse, setLastAIResponse] = useState<string>('');

  // Sync theme with main process preference on mount
  useEffect(() => {
    if (!window.electronAPI?.getTheme) return;
    window.electronAPI
      .getTheme()
      .then(themeValue => {
        if (!themeValue) return;
        const resolvedTheme = (themeValue === 'system' ? 'auto' : themeValue) as ConfigTheme;
        setTheme(resolvedTheme);
      })
      .catch(error => {
        console.error('[THEME] Failed to load theme from main process:', error);
      });
  }, []);

  // Register aiToolService methods on aiChatBridge for runtime to use
  useEffect(() => {
    aiToolService.registerBridgeMethods();
  }, []);

  // NOTE: lastSaveTime is now tracked per-file in EditorPool (see editor.ts EditorInstance.lastSaveTime)

  // Tab management state
  // Tabs are always enabled - removed tabPreferences

  // Create a ref to hold navigation state getter
  const getNavigationStateRef = useRef<(() => any) | undefined>();

  // console.log('[APP] Creating useTabs hook, workspaceMode:', workspaceMode, 'workspacePath:', workspacePath);
  const tabs = useTabs({
    maxTabs: Infinity, // Unlimited tabs - EditorPool manages memory with sleep state (max 20 rendered)
    enabled: true,
    getNavigationState: () => getNavigationStateRef.current?.(),
    onTabChange: async (tab) => {
      console.log(`[App] onTabChange: switching to ${tab.fileName}, isDirty=${tab.isDirty}`);

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

        // Double-check: reload file from disk if it changed externally
        // This catches cases where file watchers missed the change
        if (!tab.isVirtual && window.electronAPI?.readFileContent) {
          try {
            const result = await window.electronAPI.readFileContent(tab.filePath);
            if (result && result.content) {
              const editorPool = getEditorPool();
              const instance = editorPool.get(tab.filePath);
              if (instance && instance.content !== result.content) {
                console.log('[App] Tab switch detected external file change, updating EditorPool:', tab.fileName);
                // Update the EditorPool with the new content
                editorPool.update(tab.filePath, {
                  content: result.content,
                  initialContent: result.content,
                  isDirty: false,
                  reloadVersion: (instance.reloadVersion ?? 0) + 1,
                });
              }
            }
          } catch (error) {
            console.error('[App] Failed to check file for external changes:', error);
          }
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
    if (!window.electronAPI?.getWorkspaceTabState) return;

    const restoreNavigationState = async () => {
      try {
        const savedState = await window.electronAPI.getWorkspaceTabState();
        if (savedState?.navigationHistory) {
          navigation.setNavigationState(savedState.navigationHistory);
        }
      } catch (error) {
        console.error('Failed to restore navigation state:', error);
      }
    };

    // Delay to ensure tabs are loaded first
    const timer = setTimeout(restoreNavigationState, 600);
    return () => clearTimeout(timer);
  }, [workspaceMode, navigation.setNavigationState]);

  const getContentRef = useRef<(() => string) | null>(null);
  // NOTE: initialContentRef removed - EditorPool tracks initialContent per-file
  const editorRef = useRef<any>(null);
  const searchCommandRef = useRef<LexicalCommand<undefined> | null>(null);
  // NOTE: contentVersionRef removed - EditorContainer doesn't need version bumping for remounts
  const isInitializedRef = useRef<boolean>(false);
  // NOTE: autoSnapshotIntervalRef removed - EditorContainer handles periodic snapshots now

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

  // NOTE: useHMRStateRestoration removed - no longer needed now that EditorContainer/EditorPool
  // manage all editor state and useTabs persists tabs to localStorage. During HMR, tabs will
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

  // Apply theme to document and save to localStorage
  useEffect(() => {
    const root = document.documentElement;

    if (theme === 'dark') {
      root.classList.add('dark-theme');
      root.classList.remove('light-theme', 'crystal-dark-theme');
      root.setAttribute('data-theme', 'dark');
    } else if (theme === 'light') {
      root.classList.add('light-theme');
      root.classList.remove('dark-theme', 'crystal-dark-theme');
      root.setAttribute('data-theme', 'light');
    } else if (theme === 'crystal-dark') {
      root.classList.add('crystal-dark-theme');
      root.classList.remove('light-theme', 'dark-theme');
      root.setAttribute('data-theme', 'crystal-dark');
    } else {
      // Auto theme - let CSS handle it with prefers-color-scheme
      root.classList.remove('dark-theme', 'light-theme', 'crystal-dark-theme');
      root.removeAttribute('data-theme');
    }

    // Save theme to localStorage
    localStorage.setItem('theme', theme);
  }, [theme]);

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
        // NOTE: lastSaveTime now tracked in EditorPool per-file
        if (LOG_CONFIG.FILE_OPS) console.log('[FILE_OPS] Setting current file path to:', result.filePath);
        setCurrentFilePath(result.filePath);
        setCurrentFileName(result.filePath.split('/').pop() || result.filePath);
        setIsDirty(false);

        // Update EditorPool state for the active tab
        if (tabs.activeTab) {
          const editorPool = getEditorPool();
          editorPool.update(result.filePath, {
            isDirty: false,
            initialContent: content,
            lastSaveTime: Date.now(),
          });
        }

        // Update tab state if tabs are enabled
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
      setCurrentDirectory,
    });
  }, [currentFilePath, tabs, setCurrentFileName, setCurrentFilePath, setCurrentDirectory]);

  // Configure aiToolService with handleWorkspaceFileSelect
  useEffect(() => {
    aiToolService.setHandleWorkspaceFileSelectFunction(handleWorkspaceFileSelect);
  }, [handleWorkspaceFileSelect]);

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
        // EditorPool will be updated by EditorContainer
      }
    } catch (error) {
      console.error('[WELCOME] Failed to open welcome tab:', error);
    }
  }, [tabs, setIsDirty, setCurrentFileName, setCurrentFilePath]);

  // Open the plans tab - virtual document
  const openPlansTab = useCallback(async () => {
    const virtualPath = 'virtual://plans';

    // Check if plans tab is already open
    const existingTab = tabs.findTabByPath(virtualPath);
    if (existingTab) {
      tabs.switchTab(existingTab.id);
      return;
    }

    try {
      const content = await (window.electronAPI.documentService as any).loadVirtual(virtualPath);

      if (!content) {
        console.error('[PLANS] Failed to load plans document - content is null or undefined');
        return;
      }

      // Add the plans tab
      const tabId = tabs.addTab(virtualPath, content);
      if (tabId) {
        // Mark the tab as virtual
        tabs.updateTab(tabId, { isVirtual: true });
      }
    } catch (error) {
      console.error('[PLANS] Failed to open plans tab:', error);
    }
  }, [tabs]);

  // Update window title and dirty state
  useEffect(() => {
    if (!window.electronAPI) return;

    let title = 'Preditor';
    if (workspaceMode && workspaceName) {
      if (currentFileName) {
        title = `${currentFileName}${isDirty ? ' •' : ''} - ${workspaceName} - Preditor`;
      } else {
        title = `${workspaceName} - Preditor`;
      }
    } else if (currentFileName) {
      title = `${currentFileName}${isDirty ? ' •' : ''} - Preditor`;
    }

    window.electronAPI.setTitle(title);
    window.electronAPI.setDocumentEdited(isDirty);
  }, [currentFileName, isDirty, workspaceMode, workspaceName]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K (Mac) or Ctrl+K (Windows/Linux) for Agent Command Palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (workspaceMode) {
          setIsAgentPaletteVisible(true);
        }
        return false;
      }
      // Cmd+O (Mac) or Ctrl+O (Windows/Linux) for Quick Open
      if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (workspaceMode) {
          // Load recent files before showing dialog
          if (window.electronAPI?.getRecentWorkspaceFiles) {
            window.electronAPI.getRecentWorkspaceFiles().then(files => {
              // console.log('[RECENT_FILES] Loaded files for QuickOpen:', files);
              setRecentWorkspaceFiles(files || []);
            }).catch(error => {
              console.error('[RECENT_FILES] Failed to load:', error);
            });
          }
          setIsQuickOpenVisible(true);
        }
        return false;
      }
      // Cmd+Shift+A (Mac) or Ctrl+Shift+A (Windows/Linux) for AI Chat
      if (workspaceMode && (e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'a') {
        e.preventDefault();
        setIsAIChatCollapsed(prev => !prev);
      }
      // Cmd+Y (Mac) or Ctrl+Y (Windows/Linux) for History
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        e.preventDefault();
        // Save current state as manual snapshot before opening history (only if dirty)
        if (isDirty && currentFilePath && getContentRef.current && window.electronAPI?.history) {
          const content = getContentRef.current();
          window.electronAPI.history.createSnapshot(
            currentFilePath,
            content,
            'manual',
            'Before viewing history'
          );
        }
        setIsHistoryDialogOpen(true);
      }
    };

    // Use capture phase to intercept before any other handlers (like Lexical's)
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [workspaceMode, currentFilePath]);

  // Save AI Chat state when it changes (but only after initial load)
  useEffect(() => {
    if (!workspacePath || !workspaceMode) return;
    if (isAIChatStateLoaded && window.electronAPI.setAIChatState) {
      const state = {
        workspacePath,
        collapsed: isAIChatCollapsed,
        width: aiChatWidth,
        currentSessionId: currentAISessionId || undefined,
      };
      if (LOG_CONFIG.AI_CHAT_STATE) console.log('[AI_CHAT] Saving AI Chat state:', state);
      window.electronAPI.setAIChatState(state);
    }
  }, [isAIChatCollapsed, aiChatWidth, currentAISessionId, isAIChatStateLoaded, workspacePath, workspaceMode]);

  // Load recent workspace files when in workspace mode
  useEffect(() => {
    if (!workspaceMode || !window.electronAPI) return;

    const loadRecentFiles = async () => {
      try {
        if (window.electronAPI.getRecentWorkspaceFiles) {
          // console.log('[RECENT_FILES] Loading recent files for workspace');
          const files = await window.electronAPI.getRecentWorkspaceFiles();
          // console.log('[RECENT_FILES] Loaded recent files:', files);
          setRecentWorkspaceFiles(files || []);
        } else {
          console.warn('[RECENT_FILES] getRecentWorkspaceFiles API not available');
        }
      } catch (error) {
        console.error('[RECENT_FILES] Failed to load recent workspace files:', error);
      }
    };

    loadRecentFiles();
  }, [workspaceMode, currentFilePath]); // Reload when current file changes

  // Handle QuickOpen file selection
  const handleQuickOpenFileSelect = useCallback(async (filePath: string) => {
    await handleWorkspaceFileSelect(filePath);
    // Recent files are now added inside handleWorkspaceFileSelect
  }, [handleWorkspaceFileSelect]);

  // Handle creating a new file in workspace
  const handleCreateNewFile = useCallback(async (fileName: string) => {
    if (!window.electronAPI || !currentDirectory) return;

    const filePath = `${currentDirectory}/${fileName}`;

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
    } catch (error) {
      console.error('Failed to create file:', error);
      alert('Failed to create file: ' + error);
    }
  }, [currentDirectory, workspacePath, handleWorkspaceFileSelect]);

  // Handle restoring content from history
  const handleRestoreFromHistory = useCallback((content: string) => {
    console.log('[App] handleRestoreFromHistory called', {
      contentLength: content?.length,
      tabsEnabled: true,
      activeTabId: tabs.activeTabId
    });

    // Update the content based on tab mode
    if (tabs.activeTabId && tabs.activeTab) {
      const activeTab = tabs.activeTab;

      // 1. Update the tab's content first
      tabs.updateTab(tabs.activeTabId, { content, isDirty: true });
      console.log('[App] Updated tab content for tab:', tabs.activeTabId);

      // 2. Destroy and recreate the EditorPool instance with incremented reloadVersion
      const editorPool = getEditorPool();
      if (editorPool.has(activeTab.filePath)) {
        const oldInstance = editorPool.get(activeTab.filePath);
        const oldReloadVersion = oldInstance?.reloadVersion ?? 0;
        const oldInitialContent = oldInstance?.initialContent ?? '';

        editorPool.destroy(activeTab.filePath);
        console.log('[App] Destroyed editor instance - will be recreated with restored content');

        // Recreate with incremented reloadVersion to force React remount
        // Create with the restored content, but keep the old initialContent so isDirty is true
        editorPool.create(activeTab.filePath, content);
        editorPool.update(activeTab.filePath, {
          reloadVersion: oldReloadVersion + 1,
          initialContent: oldInitialContent, // Keep original initialContent so content !== initialContent
          isDirty: true,
        });
        console.log('[App] Recreated editor instance with reloadVersion:', oldReloadVersion + 1);
      }

      // 3. Update global UI state
      setIsDirty(true);
    } else {
      console.warn('[App] No active tab to restore content to');
    }
    // Close the history dialog
    setIsHistoryDialogOpen(false);
    console.log('[App] Content restored from history');
  }, [tabs]);

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

  // Set up IPC listeners
  // IPC handlers hook - sets up all IPC communication with main process
  useIPCHandlers({
    // Handlers
    handleNew,
    handleOpen,
    handleSave: async () => {
      // Delegate to EditorContainer's manual save
      if (handleSaveRef.current) {
        await handleSaveRef.current();
      }
    },
    handleSaveAs,
    handleWorkspaceFileSelect,
    openWelcomeTab,
    openPlansTab,

    // State setters
    setIsApiKeyDialogOpen,
    setWorkspaceMode,
    setWorkspacePath,
    setWorkspaceName,
    setFileTree,
    setCurrentDirectory,
    setCurrentFilePath,
    setCurrentFileName,
    setIsDirty,
    setIsNewFileDialogOpen,
    setIsAIChatCollapsed,
    setAIChatWidth,
    setIsAIChatStateLoaded,
    setSessionToLoad,
    setIsHistoryDialogOpen,
    setIsAgentPaletteVisible,
    setTheme,

    // Refs
    isInitializedRef,
    isDirtyRef,
    getContentRef,
    editorRef,
    searchCommandRef,

    // State values
    currentFilePath,
    currentDirectory,
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

  // Show nothing while initializing to prevent flash
  if (isInitializing) {
    return <div style={{ height: '100vh', backgroundColor: '#1e1e1e' }} />;
  }

  return (
    <div
      style={{ height: '100vh', display: 'flex', flexDirection: workspaceMode ? 'row' : 'column' }}
      onKeyDown={(e) => {
        // Intercept Cmd+K/Ctrl+K before it reaches Lexical editor
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
          e.preventDefault();
          e.stopPropagation();
          if (workspaceMode) {
            setIsQuickOpenVisible(true);
          }
        }
      }}
    >
      {workspaceMode && workspaceName && (
        <>
          <div ref={sidebarRef} style={{ width: sidebarWidth, position: 'relative' }}>
            <WorkspaceSidebar
              workspaceName={workspaceName}
              workspacePath={workspacePath || ''}
              fileTree={fileTree}
              currentFilePath={currentFilePath}
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
            />
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
                width: '1px',
                backgroundColor: '#e5e7eb',
                transition: 'background-color 0.2s'
              }}
              className="sidebar-resize-handle"
            />
          </div>
        </>
      )}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/*{console.log('[APP] Rendering TabManager check:', {*/}
        {/*  enabled: true,*/}
        {/*  workspaceMode,*/}
        {/*  numTabs: tabs.tabs.length,*/}
        {/*  activeTabId: tabs.activeTabId*/}
        {/*})}*/}
        {workspaceMode || tabs.activeTab ? (
          <TabManager
            tabs={tabs.tabs}
            activeTabId={tabs.activeTabId}
            onTabSelect={tabs.switchTab}
            onTabClose={tabs.removeTab}
            onNewTab={() => {
              // Open file dialog or create untitled tab
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
            hideTabBar={!workspaceMode}
          >
            {tabs.activeTab ? (
              <EditorContainer
                tabs={tabs.tabs}
                activeTabId={tabs.activeTabId}
                theme={theme}
                onManualSaveReady={(saveFn) => {
                  // Store manual save function for use by menu handlers
                  handleSaveRef.current = saveFn;
                }}
                onSaveComplete={(filePath) => {
                  // Update UI state after save completes
                  setCurrentFilePath(filePath);
                  setCurrentFileName(filePath.split('/').pop() || filePath);
                  setIsDirty(false);

                  // Update tab state
                  if (tabs.activeTabId) {
                    tabs.updateTab(tabs.activeTabId, {
                      isDirty: false,
                      lastSaved: new Date()
                    });
                  }
                }}
                onGetContent={(getContentFn) => {
                  logger.ui.info('Received getContent function for tab');
                  getContentRef.current = getContentFn;

                  // Configure aiToolService with content getter
                  aiToolService.setGetContentFunction(getContentFn);
                }}
                onEditorReady={(editor) => {
                  logger.ui.info('Editor ready for tab');
                  editorRef.current = editor;
                  searchCommandRef.current = TOGGLE_SEARCH_COMMAND;
                }}
                onContentChange={(changedTabId, changedIsDirty) => {
                  const tab = tabs.getTabState(changedTabId);

                  // Only update if isDirty state actually changed to avoid unnecessary re-renders
                  if (tab && tab.isDirty !== changedIsDirty) {
                    // console.log(`[App] onContentChange: ${tab.fileName} isDirty changed ${tab.isDirty} -> ${changedIsDirty}`);

                    // Update the tab's dirty state
                    tabs.updateTab(changedTabId, { isDirty: changedIsDirty });

                    // For the active tab, update global UI state (for window title, menus, etc.)
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
        ) : (
          <WorkspaceWelcome workspaceName={workspaceName || 'Open a file to get started'} />
        )}
      </div>
      {workspaceMode && (
        <AIChat
          isCollapsed={isAIChatCollapsed}
          onToggleCollapse={() => setIsAIChatCollapsed(prev => !prev)}
          width={aiChatWidth}
          onWidthChange={setAIChatWidth}
          workspacePath={workspacePath || undefined}
          sessionToLoad={sessionToLoad}
          onSessionLoaded={() => setSessionToLoad(null)}
          onSessionIdChange={setCurrentAISessionId}
          onShowApiKeyError={() => setIsApiKeyDialogOpen(true)}
          documentContext={(() => {
            // CRITICAL: Always use the ACTIVE tab's information, not global state
            // This ensures AI edits target the currently visible document
            const activeTab = tabs.activeTab;
            if (!activeTab) {
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
              filePath: activeTab.filePath || '',
              fileType: 'markdown',
              content: getContentRef.current ? getContentRef.current() : '',
              cursorPosition: undefined, // TODO: Get from Lexical editor
              selection: undefined, // TODO: Get selected text from Lexical
              getLatestContent: getContentRef.current // Pass the function itself
            };
          })()}
          onApplyEdit={(edit, prompt, aiResponse) => {
            console.log('Edit already applied by AIChat component, updating UI state');
            // Store the prompt and response for error reporting
            setLastPrompt(prompt || '');
            setLastAIResponse(aiResponse || '');

            // The edit has already been applied by AIChat.tsx through aiApi.applyEdit()
            // This callback is just for UI state updates, not for applying the edit
            // We just need to handle any UI updates or error display

            if (edit.type === 'diff' && edit.replacements) {
              // The edit was already applied, just log for debugging
              console.log('Diff applied successfully - showing red/green preview');
              // Document will show diffs but not marked as dirty yet
              // User needs to approve/reject the diffs

              // Note: Error handling is done in AIChat.tsx now
              // If there was an error, AIChat.tsx will handle the retry and show error messages
            }
          }}
        />
      )}
      {workspaceMode && workspacePath && (
        <>
          <QuickOpen
            isOpen={isQuickOpenVisible}
            onClose={() => setIsQuickOpenVisible(false)}
            workspacePath={workspacePath}
            currentFilePath={currentFilePath}
            recentFiles={recentWorkspaceFiles}
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
            onClose={() => setIsNewFileDialogOpen(false)}
            currentDirectory={currentDirectory || workspacePath}
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
      <ApiKeyDialog
        isOpen={isApiKeyDialogOpen}
        onClose={() => setIsApiKeyDialogOpen(false)}
        onOpenPreferences={() => {
          setIsApiKeyDialogOpen(false);
          // Open AI Models window for settings
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
      <ErrorToastContainer />
    </div>
  );
}
