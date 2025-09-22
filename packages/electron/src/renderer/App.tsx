import React, { useEffect, useState, useCallback, useRef } from 'react';
import { logger } from './utils/logger';

logger.ui.info('App.tsx loading');
logger.ui.info('About to import StravuEditor');
import {
  StravuEditor,
  TOGGLE_SEARCH_COMMAND,
  aiChatBridge,
  APPROVE_DIFF_COMMAND,
  REJECT_DIFF_COMMAND,
  parseFrontmatter,
  serializeWithFrontmatter,
  type FrontmatterData,
} from 'rexical';
import type { LexicalCommand, ConfigTheme, TextReplacement } from 'rexical';
// Import styles - handled by vite plugin for both dev and prod
import 'rexical/styles';
logger.ui.info('StravuEditor imported');

// Ensure aiChatBridge is available globally
if (typeof window !== 'undefined' && !window.aiChatBridge) {
  (window as any).aiChatBridge = aiChatBridge;
  logger.ui.info('Set window.aiChatBridge manually');
}
import { WorkspaceSidebar } from './components/WorkspaceSidebar.tsx';
import { WorkspaceWelcome } from './components/WorkspaceWelcome.tsx';
import { QuickOpen } from './components/QuickOpen';
import { AgentCommandPalette } from './components/AgentCommandPalette';
import { AIChat } from './components/AIChat';
import { HistoryDialog } from './components/HistoryDialog';
import { ErrorDialog } from './components/ErrorDialog/ErrorDialog';
import { ApiKeyDialog } from './components/ApiKeyDialog';
import { AIModels } from './components/AIModels/AIModels';
import { SessionManager } from './components/SessionManager/SessionManager';
import { WorkspaceManager } from './components/WorkspaceManager/WorkspaceManager.tsx';
import { NewFileDialog } from './components/NewFileDialog';
import { TabManager } from './components/TabManager/TabManager';
import { useTabPreferences } from './hooks/useTabPreferences';
import { useTabs } from './hooks/useTabs';
import { useTabNavigation } from './hooks/useTabNavigation';
import { registerDocumentLinkPlugin } from './plugins/registerDocumentLinkPlugin';
import { registerPlanStatusPlugin } from './plugins/registerPlanStatusPlugin';
import './WorkspaceWelcome.css';
import './components/AIModels/AIModels.css';

const PLAN_STATUS_KEYS = new Set([
  'planId',
  'title',
  'status',
  'state',
  'planType',
  'priority',
  'owner',
  'stakeholders',
  'tags',
  'created',
  'updated',
  'dueDate',
  'startDate',
  'progress',
]);

function mergeFrontmatterData(
  existing: FrontmatterData | undefined,
  updates: Partial<FrontmatterData>,
): FrontmatterData {
  const result: FrontmatterData = existing ? { ...existing } : {};

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      result[key] = value;
      continue;
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const currentValue = result[key];
      const nestedExisting = (currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue))
        ? (currentValue as FrontmatterData)
        : {};

      result[key] = mergeFrontmatterData(nestedExisting, value as Partial<FrontmatterData>);
      continue;
    }

    result[key] = value;
  }

  return result;
}

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

// File tree interface
interface FileTreeItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeItem[];
}

// Electron API interface
interface ElectronAPI {
  onFileNew: (callback: () => void) => () => void;
  onFileNewInWorkspace?: (callback: () => void) => () => void;
  onFileOpen: (callback: () => void) => () => void;
  onWorkspaceOpened: (callback: (data: { workspacePath: string; workspaceName: string; fileTree: FileTreeItem[] }) => void) => () => void;
  onOpenWorkspaceFile?: (callback: (filePath: string) => void) => () => void;
  onOpenDocument?: (callback: (data: { path: string }) => void) => () => void;
  onOpenWorkspaceFromCLI?: (callback: (workspacePath: string) => void) => () => void;
  onFileSave: (callback: () => void) => () => void;
  onFileSaveAs: (callback: () => void) => () => void;
  onFileOpenedFromOS: (callback: (data: { filePath: string; content: string }) => void) => () => void;
  onNewUntitledDocument: (callback: (data: { untitledName: string }) => void) => () => void;
  onToggleSearch: (callback: () => void) => () => void;
  onToggleSearchReplace: (callback: () => void) => () => void;
  onFileDeleted: (callback: (data: { filePath: string }) => void) => () => void;
  onFileRenamed: (callback: (data: { oldPath: string; newPath: string }) => void) => () => void;
  onFileMoved: (callback: (data: { sourcePath: string; destinationPath: string }) => void) => () => void;
  onWorkspaceFileTreeUpdated: (callback: (data: { fileTree: FileTreeItem[]; addedPath?: string; removedPath?: string }) => void) => () => void;
  onFileChangedOnDisk?: (callback: (data: { path: string }) => void) => () => void;
  onThemeChange: (callback: (theme: string) => void) => () => void;
  onShowAbout: (callback: () => void) => () => void;
  onViewHistory?: (callback: () => void) => () => void;
  onNextTab?: (callback: () => void) => () => void;
  onPreviousTab?: (callback: () => void) => () => void;
  onLoadSessionFromManager?: (callback: (data: { sessionId: string; workspacePath?: string }) => void) => () => void;
  onShowPreferences?: (callback: () => void) => () => void;
  openFile: () => Promise<{ filePath: string; content: string } | null>;
  saveFile: (content: string, filePath: string) => Promise<{ success: boolean; filePath: string } | null>;
  saveFileAs: (content: string) => Promise<{ success: boolean; filePath: string } | null>;
  setDocumentEdited: (edited: boolean) => void;
  setTitle: (title: string) => void;
  setCurrentFile: (filePath: string | null) => void;
  // Get initial window state
  getInitialState?: () => Promise<{ mode: string; workspacePath?: string; workspaceName?: string; fileTree?: FileTreeItem[] } | null>;
  // Workspace operations
  getFolderContents: (dirPath: string) => Promise<FileTreeItem[]>;
  switchWorkspaceFile: (filePath: string) => Promise<{ filePath: string; content: string } | null>;
  readFileContent?: (filePath: string) => Promise<{ content: string } | null>;
  // Settings
  getSidebarWidth: (workspacePath: string) => Promise<number>;
  setSidebarWidth: (workspacePath: string, width: number) => void;
  getAIChatState: (workspacePath: string) => Promise<{ collapsed: boolean; width: number; currentSessionId?: string; draftInput?: string } | null>;
  setAIChatState: (state: { workspacePath: string; collapsed: boolean; width: number; currentSessionId?: string; draftInput?: string }) => void;
  getRecentWorkspaceFiles?: () => Promise<string[]>;
  addToWorkspaceRecentFiles?: (filePath: string) => void;
  searchWorkspaceFileNames?: (workspacePath: string, query: string) => Promise<any[]>;
  searchWorkspaceFileContent?: (workspacePath: string, query: string) => Promise<any[]>;
  // Tab state operations
  getWorkspaceTabState?: () => Promise<any>;
  saveWorkspaceTabState?: (tabState: any) => void;
  clearWorkspaceTabState?: () => void;
  // History operations
  history?: {
    createSnapshot: (filePath: string, state: string, type: string, description?: string) => Promise<void>;
    listSnapshots: (filePath: string) => Promise<any[]>;
    loadSnapshot: (filePath: string, timestamp: string) => Promise<string>;
    deleteSnapshot: (filePath: string, timestamp: string) => Promise<void>;
  };
  // Session operations
  session?: {
    create: (filePath: string, type: string, source?: any) => Promise<any>;
    load: (sessionId: string) => Promise<any>;
    save: (session: any) => Promise<void>;
    delete: (sessionId: string) => Promise<void>;
    getActive: (filePath: string) => Promise<any>;
    setActive: (filePath: string, sessionId: string, type: string) => Promise<void>;
    checkConflicts: (session: any, currentMarkdownHash: string) => Promise<any>;
    resolveConflict: (session: any, resolution: string, newBaseHash?: string) => Promise<void>;
    createCheckpoint: (sessionId: string, state: string) => Promise<void>;
  };
  // MCP Server operations
  onMcpApplyDiff?: (callback: (data: { replacements: any[], resultChannel: string }) => void) => () => void;
  onMcpStreamContent?: (callback: (data: { streamId: string, content: string, position: string, insertAfter?: string, mode?: string }) => void) => () => void;
  onMcpNavigateTo?: (callback: (data: { line: number, column: number }) => void) => () => void;
  sendMcpApplyDiffResult?: (resultChannel: string, result: any) => void;
  updateMcpDocumentState?: (state: any) => Promise<void>;
  clearMcpDocumentState?: () => Promise<void>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

// Register plugins once at module level
// These provide Electron-specific services to the plugins
let pluginsRegistered = false;
if (!pluginsRegistered) {
  registerDocumentLinkPlugin();
  registerPlanStatusPlugin();
  pluginsRegistered = true;
}

export default function App() {
  // console.log('[APP RENDER]', new Date().toISOString(), 'App component rendering');
  logger.ui.info('App component rendering');

  // Check for special window modes
  const urlParams = new URLSearchParams(window.location.search);
  const windowMode = urlParams.get('mode');

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

  const contentRef = useRef('');
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
  const [currentFileName, setCurrentFileName] = useState<string | null>(null);
  const isDirtyRef = useRef(false);  // Internal tracking for autosave
  const [isDirty, setIsDirty] = useState(false);  // For UI updates
  const [contentVersion, setContentVersion] = useState(0);  // For forcing editor re-render
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

  // Track when we last saved to ignore file change events shortly after
  const lastSaveTimeRef = useRef<number>(0);

  // Tab management state
  const tabPreferences = useTabPreferences();

  // Create a ref to hold navigation state getter
  const getNavigationStateRef = useRef<(() => any) | undefined>();

  // console.log('[APP] Creating useTabs hook, workspaceMode:', workspaceMode, 'workspacePath:', workspacePath);
  const tabs = useTabs({
    maxTabs: tabPreferences.preferences.maxTabs,
    enabled: tabPreferences.preferences.enabled,
    getNavigationState: () => getNavigationStateRef.current?.(),
    onTabChange: async (tab) => {
      // console.log('[APP] onTabChange called for tab:', tab.id, tab.filePath);

      // Save current tab's content before switching
      const previousTabId = tabs.activeTabId;
      if (previousTabId && getContentRef.current) {
        const currentContent = getContentRef.current();
        tabs.updateTab(previousTabId, {
          content: currentContent,
          isDirty: isDirtyRef.current
        });
        // console.log('[TABS] Saved content for previous tab:', previousTabId);
      }

      // When switching tabs, restore the tab's saved state
      if (tab.filePath) {
        // If tab has no content, load it from file
        if (!tab.content && window.electronAPI) {
          try {
            const result = await window.electronAPI.switchWorkspaceFile(tab.filePath);
            if (result) {
              tab.content = result.content;
              tabs.updateTab(tab.id, { content: result.content });
            }
          } catch (error) {
            console.error('[TABS] Failed to load content for tab:', error);
          }
        }

        if (tab.content !== undefined) {
          setCurrentFilePath(tab.filePath);
          setCurrentFileName(tab.fileName);
          contentRef.current = tab.content;
          initialContentRef.current = tab.content;
          contentVersionRef.current += 1;
          setContentVersion(v => v + 1);
          isDirtyRef.current = tab.isDirty || false;
          setIsDirty(tab.isDirty || false);

          // Update the main process about the current file
          if (window.electronAPI) {
            window.electronAPI.setCurrentFile(tab.filePath);
          }
        }
      }
    },
    onTabClose: (tab) => {
      // Save current tab's content if it's the active tab being closed
      if (tab.id === tabs.activeTabId && getContentRef.current) {
        const currentContent = getContentRef.current();
        tabs.updateTab(tab.id, {
          content: currentContent,
          isDirty: isDirtyRef.current
        });

        // Update the actual tab object with latest content
        tab.content = currentContent;
        tab.isDirty = isDirtyRef.current;
      }

      // Handle tab close - save if dirty
      if (tab.isDirty && tab.filePath && window.electronAPI) {
        // console.log('[TAB CLOSE] Saving unsaved changes for:', tab.fileName);

        // Try to save the file
        if (tab.content) {
          // Save the specific tab's content
          const saveTab = async () => {
            try {
              // Set the current file first (may or may not return a promise)
              const setFileResult = window.electronAPI.setCurrentFile(tab.filePath);
              if (setFileResult && typeof setFileResult.then === 'function') {
                await setFileResult;
              }

              // Now save the content
              const result = await window.electronAPI.saveFile(tab.content, tab.filePath);
              if (result && result.success) {
                // Mark the time we saved to ignore file change events
                lastSaveTimeRef.current = Date.now();
                console.log('[TAB CLOSE] Saved successfully:', tab.fileName);
              }
            } catch (error) {
              console.error('[TAB CLOSE] Failed to save:', tab.fileName, error);
              // Could show an error dialog here
              if (window.electronAPI.showErrorDialog) {
                window.electronAPI.showErrorDialog(
                  'Failed to Save',
                  `Failed to save ${tab.fileName} before closing.\n\nYour changes may be lost.`
                );
              }
            }
          };

          saveTab();
        }
      }
    }
  });

  // Keep tabsRef updated with the current tabs object
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  // Initialize tab navigation for back/forward functionality
  const navigation = useTabNavigation({
    enabled: tabPreferences.preferences.enabled && workspaceMode,
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
  const initialContentRef = useRef<string>('');
  const editorRef = useRef<any>(null);
  const searchCommandRef = useRef<LexicalCommand<undefined> | null>(null);
  const contentVersionRef = useRef<number>(0);
  const isInitializedRef = useRef<boolean>(false);
  const autoSaveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const autoSnapshotIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSnapshotContentRef = useRef<string>('');

  // Autosave cancellation and validation
  const autoSaveCancellationRef = useRef<AbortController | null>(null);
  const activeSavesRef = useRef<Set<string>>(new Set());
  const lastSavePathRef = useRef<string | null>(null);
  const lastChangeTimeRef = useRef<number>(0);  // Track when content last changed for debouncing
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isResizingRef = useRef<boolean>(false);

  // Log mount/unmount and handle window close
  useEffect(() => {
    logger.ui.info('App component mounted');

    // Save on window close/reload
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Save current tab content first
      if (tabsRef.current && tabsRef.current.activeTabId && getContentRef.current) {
        const currentContent = getContentRef.current();
        tabsRef.current.updateTab(tabsRef.current.activeTabId, {
          content: currentContent,
          isDirty: isDirtyRef.current
        });
      }

      // Check if any tabs are dirty
      let hasDirtyTabs = isDirtyRef.current;
      if (tabsRef.current && tabsRef.current.tabs) {
        hasDirtyTabs = hasDirtyTabs || tabsRef.current.tabs.some((tab: any) => tab.isDirty);
      }

      if (hasDirtyTabs) {
        console.log('[WINDOW CLOSE] Has unsaved changes');
        // This will show a dialog in Electron
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to quit?';

        // Try to save current file quickly
        if (isDirtyRef.current && getContentRef.current && currentFilePath && window.electronAPI) {
          const content = getContentRef.current();
          // Fire and forget - don't await
          window.electronAPI.saveFile(content, currentFilePath).then(result => {
            if (result && result.success) {
              // Mark the time we saved to ignore file change events
              lastSaveTimeRef.current = Date.now();
              console.log('[WINDOW CLOSE] Saved current file');
            }
          }).catch(error => {
            console.error('[WINDOW CLOSE] Failed to save:', error);
          });
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      logger.ui.info('App component unmounting');
      window.removeEventListener('beforeunload', handleBeforeUnload);

      // Final save attempt on unmount
      if (isDirtyRef.current && getContentRef.current && currentFilePath && window.electronAPI) {
        const content = getContentRef.current();
        window.electronAPI.saveFile(content, currentFilePath).catch(error => {
          console.error('[UNMOUNT] Failed to save:', error);
        });
      }
    };
  }, [currentFilePath]);

  // Restore state during development HMR (only on mount)
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      // Restore state from session storage on mount
      const savedState = sessionStorage.getItem('rexical-dev-state');
      if (savedState) {
        try {
          const state = JSON.parse(savedState);
          if (LOG_CONFIG.HMR) console.log('[HMR] Restoring dev state:', state);

          // Restore the state
          if (state.workspaceMode) {
            setWorkspaceMode(true);
            setWorkspacePath(state.workspacePath);
            setWorkspaceName(state.workspaceName);
            setFileTree(state.fileTree || []);
          }

          if (state.filePath) {
            setCurrentFilePath(state.filePath);
            setCurrentFileName(state.fileName);
            contentRef.current = state.content || '';
            initialContentRef.current = state.content || '';
            contentVersionRef.current += 1;
            setContentVersion(v => v + 1);
      setContentVersion(v => v + 1);
        setContentVersion(v => v + 1);
    setContentVersion(v => v + 1);
          setContentVersion(v => v + 1);
            isInitializedRef.current = false;

            // Update the main process about the current file
            if (window.electronAPI) {
              window.electronAPI.setCurrentFile(state.filePath);
            }
          }

          if (state.sidebarWidth) {
            setSidebarWidth(state.sidebarWidth);
          }

          if (state.isDirty !== undefined) {
            setIsDirty(state.isDirty);
          }

          if (state.theme) {
            setTheme(state.theme);
          }

          // Clear the saved state
          sessionStorage.removeItem('rexical-dev-state');
        } catch (error) {
          if (LOG_CONFIG.HMR) console.error('[HMR] Failed to restore dev state:', error);
        }
      }
    }
  }, []); // Empty dependency array - only run on mount

  // Save state before HMR in development
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      const saveDevState = () => {
        const state = {
          workspaceMode,
          workspacePath,
          workspaceName,
          fileTree,
          filePath: currentFilePath,
          fileName: currentFileName,
          content: getContentRef.current ? getContentRef.current() : contentRef.current,
          sidebarWidth: sidebarWidth,
          isDirty: isDirty,
          theme: theme
        };
        if (LOG_CONFIG.HMR) console.log('[HMR] Saving dev state:', state);
        sessionStorage.setItem('rexical-dev-state', JSON.stringify(state));
      };

      // Save state on beforeunload (catches HMR)
      window.addEventListener('beforeunload', saveDevState);

      return () => {
        window.removeEventListener('beforeunload', saveDevState);
      };
    }
  }, [workspaceMode, workspacePath, workspaceName, fileTree, currentFilePath, currentFileName, sidebarWidth, isDirty, theme]);

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
    contentVersionRef.current += 1;
    setContentVersion(v => v + 1);
    isInitializedRef.current = false;
    contentRef.current = '';
    setCurrentFilePath(null);
    setCurrentFileName(null);
    isDirtyRef.current = false;
    setIsDirty(false);
    initialContentRef.current = '';
  }, []);

  // Handle open file
  const handleOpen = useCallback(async () => {
    if (!window.electronAPI) return;

    try {
      const result = await window.electronAPI.openFile();
      if (result) {
        contentVersionRef.current += 1;
      setContentVersion(v => v + 1);
        setContentVersion(v => v + 1);
    setContentVersion(v => v + 1);
        isInitializedRef.current = false;
        contentRef.current = result.content;
        setCurrentFilePath(result.filePath);
        setCurrentFileName(result.filePath.split('/').pop() || result.filePath);
        isDirtyRef.current = false;
    setIsDirty(false);
        initialContentRef.current = result.content;

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
        // Mark the time we saved to ignore file change events
        lastSaveTimeRef.current = Date.now();
        if (LOG_CONFIG.FILE_OPS) console.log('[FILE_OPS] Setting current file path to:', result.filePath);
        setCurrentFilePath(result.filePath);
        setCurrentFileName(result.filePath.split('/').pop() || result.filePath);
        isDirtyRef.current = false;
    setIsDirty(false);
        // Update initial content ref to the saved content
        if (getContentRef.current) {
          initialContentRef.current = getContentRef.current();
        }
      }
    } catch (error) {
      console.error('Failed to save file as:', error);
    }
  }, []);

  // Handle save
  const handleSave = useCallback(async () => {
    // Get the current file path from tabs if enabled, otherwise use state
    const filePath = tabPreferences.preferences.enabled && tabs.activeTab
      ? tabs.activeTab.filePath
      : currentFilePath;

    if (LOG_CONFIG.FILE_OPS) console.log('[FILE_OPS] handleSave called, filePath:', filePath);
    if (!window.electronAPI || !getContentRef.current) return;

    const content = getContentRef.current();
    if (LOG_CONFIG.FILE_OPS) console.log('[FILE_OPS] Saving content:', { contentLength: contentRef.current.length, hasFilePath: !!filePath, filePath });

    if (!filePath) {
      if (LOG_CONFIG.FILE_OPS) console.log('[FILE_OPS] No file path, triggering save as');
      // No file loaded, for Cmd+S we should trigger save as
      // This matches typical editor behavior
      await handleSaveAs();
      return;
    }

    try {
      if (LOG_CONFIG.FILE_OPS) console.log('[FILE_OPS] Calling electronAPI.saveFile with path:', filePath);
      const result = await window.electronAPI.saveFile(content, filePath);
      if (LOG_CONFIG.FILE_OPS) console.log('[FILE_OPS] Save result:', result);
      if (result) {
        // Mark the time we saved to ignore file change events
        lastSaveTimeRef.current = Date.now();
        setCurrentFilePath(result.filePath);
        setCurrentFileName(result.filePath.split('/').pop() || result.filePath);
        isDirtyRef.current = false;
    setIsDirty(false);
        // Update initial content ref to the saved content
        if (getContentRef.current) {
          initialContentRef.current = getContentRef.current();
        }

        // Update tab state if tabs are enabled
        if (tabPreferences.preferences.enabled && tabs.activeTabId) {
          tabs.updateTab(tabs.activeTabId, {
            isDirty: false,
            lastSaved: new Date()
          });
        }

        // Create a history snapshot for manual save
        if (LOG_CONFIG.FILE_OPS) console.log('[FILE_OPS] Checking history API:', !!window.electronAPI?.history);
        if (window.electronAPI?.history) {
          try {
            if (LOG_CONFIG.FILE_OPS) console.log('[FILE_OPS] Creating snapshot for:', result.filePath, 'content length:', contentRef.current.length);
            await window.electronAPI.history.createSnapshot(
              result.filePath,
              content,
              'manual',
              'Manual save'
            );
            if (LOG_CONFIG.FILE_OPS) console.log('[FILE_OPS] Created history snapshot for manual save');
          } catch (error) {
            console.error('Failed to create history snapshot:', error);
          }
        } else {
          if (LOG_CONFIG.FILE_OPS) console.log('[FILE_OPS] History API not available');
        }

        if (LOG_CONFIG.FILE_OPS) console.log('[FILE_OPS] File saved successfully');
      } else {
        console.log('Save returned null - no current file in main process');
      }
    } catch (error) {
      console.error('Failed to save file:', error);
    }
  }, [currentFilePath, handleSaveAs]);

  // Handle close workspace
  const handleCloseWorkspace = useCallback(async () => {
    // Auto-save current file if dirty (no prompt needed with autosave)
    if (isDirty && getContentRef.current) {
      if (LOG_CONFIG.WORKSPACE_OPS) console.log('[CLOSE_WORKSPACE] Auto-saving current file before closing');
      await handleSave();
    }

    // Close the window
    window.close();
  }, [isDirty, handleSave]);

  // Handle file selection in workspace
  const handleWorkspaceFileSelect = useCallback(async (filePath: string) => {
    // Cancel any pending autosave for the previous file
    if (autoSaveCancellationRef.current) {
      console.log('[FILE_SELECT] Cancelling pending autosave');
      autoSaveCancellationRef.current.abort();
      autoSaveCancellationRef.current = null;
    }

    if (!window.electronAPI) return;

    if (LOG_CONFIG.WORKSPACE_FILE_SELECT) console.log('[WORKSPACE_FILE_SELECT] Selecting file:', filePath);

    // If tabs are enabled, check if file is already open in a tab
    console.log('[TABS] Tab preferences:', tabPreferences.preferences);
    if (tabPreferences.preferences.enabled) {
      const existingTab = tabs.findTabByPath(filePath);
      if (existingTab) {
        if (LOG_CONFIG.WORKSPACE_FILE_SELECT) console.log('[WORKSPACE_FILE_SELECT] File already open in tab, switching');
        tabs.switchTab(existingTab.id);
        return;
      }
    }

    // Auto-save current file if dirty (no prompt needed with autosave)
    if (isDirty && getContentRef.current && currentFilePath && currentFilePath !== filePath) {
      if (LOG_CONFIG.WORKSPACE_FILE_SELECT) console.log('[WORKSPACE_FILE_SELECT] Auto-saving current file before switching');
      await handleSave();
    }

    try {
      const result = await window.electronAPI.switchWorkspaceFile(filePath);
      if (result) {
        if (LOG_CONFIG.WORKSPACE_FILE_SELECT) console.log('[WORKSPACE_FILE_SELECT] File loaded successfully');

        // If tabs are enabled, add a new tab
        if (tabPreferences.preferences.enabled) {
          console.log('[TABS] Adding tab for file:', result.filePath);
          console.log('[TABS] Current tabs before add:', tabs.tabs);
          const tabId = tabs.addTab(result.filePath, result.content);
          if (!tabId) {
            console.warn('Failed to add tab - max tabs reached');
            // Could show a dialog here
          } else {
            console.log('[TABS] Added tab with ID:', tabId);
            console.log('[TABS] Current tabs after add:', tabs.tabs);
            // Set initialContentRef for the new tab
            initialContentRef.current = result.content;
            setCurrentFilePath(result.filePath);
            setCurrentFileName(result.filePath.split('/').pop() || result.filePath);
            contentRef.current = result.content;
            isDirtyRef.current = false;
            setIsDirty(false);
          }
        } else {
          // Original non-tab behavior
          contentVersionRef.current += 1;
          setContentVersion(v => v + 1);
          isInitializedRef.current = false;
          contentRef.current = result.content;
          setCurrentFilePath(result.filePath);
          setCurrentFileName(result.filePath.split('/').pop() || result.filePath);
          isDirtyRef.current = false;
    setIsDirty(false);
          initialContentRef.current = result.content;
        }

        // Update current directory based on the file path
        const dirPath = result.filePath.substring(0, result.filePath.lastIndexOf('/'));
        setCurrentDirectory(dirPath);

        // Add to recent files
        if (window.electronAPI?.addToWorkspaceRecentFiles) {
          window.electronAPI.addToWorkspaceRecentFiles(filePath);
        }

        // Explicitly update the current file in main process (redundant but safe)
        if (LOG_CONFIG.WORKSPACE_FILE_SELECT) console.log('[WORKSPACE_FILE_SELECT] Ensuring backend has correct file path');
        const syncResult = window.electronAPI.setCurrentFile(filePath);
        if (syncResult && typeof syncResult.then === 'function') {
          await syncResult;
        }

        // Create automatic snapshot when switching to file
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
      console.error('Failed to switch workspace file:', error);
    }
  }, [isDirty, currentFilePath, handleSave, tabs, tabPreferences]);

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
      currentVersion: contentVersionRef.current,
      tabsEnabled: tabPreferences.preferences.enabled,
      activeTabId: tabs.activeTabId
    });

    // Update the content ref first to ensure it's available for the remount
    contentRef.current = content;

    // Update content version to force editor remount
    contentVersionRef.current += 1;
    setContentVersion(v => v + 1);
    isInitializedRef.current = false;

    // Update the content based on tab mode
    if (tabPreferences.preferences.enabled && tabs.activeTabId) {
      // In tab mode, also update the active tab's content
      tabs.updateTab(tabs.activeTabId, { content });
      console.log('[App] Updated tab content for tab:', tabs.activeTabId);
    } else {
      console.log('[App] Updated content state directly');
    }

    isDirtyRef.current = true;
    setIsDirty(true);
    // Close the history dialog
    setIsHistoryDialogOpen(false);
    console.log('[App] Content restored from history');
  }, [tabPreferences.preferences.enabled, tabs]);

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

  // Autosave functionality
  useEffect(() => {
    // Clear any existing interval
    if (autoSaveIntervalRef.current) {
      clearInterval(autoSaveIntervalRef.current);
      autoSaveIntervalRef.current = null;
    }

    // Set up autosave if we have a file path (check dirty state inside the interval)
    if (currentFilePath && getContentRef.current) {
      if (LOG_CONFIG.AUTOSAVE) console.log('[AUTOSAVE] Setting up autosave for:', currentFilePath);

      autoSaveIntervalRef.current = setInterval(async () => {
        // Capture values at the start of the interval to prevent race conditions
        const saveFilePath = currentFilePath;
        const isDirtyNow = isDirtyRef.current;
        const getContentNow = getContentRef.current;

        console.log('[AUTOSAVE INTERVAL] Checking:', {
          isDirtyRef: isDirtyNow,
          currentFilePath: saveFilePath,
          hasGetContent: !!getContentNow,
          hasElectronAPI: !!window.electronAPI
        });
        if (isDirtyNow && saveFilePath && getContentNow && window.electronAPI) {
          // Check debounce: only save if 1500ms have passed since last change
          const timeSinceLastChange = Date.now() - lastChangeTimeRef.current;
          if (timeSinceLastChange < 1500) {
            // console.log('[AUTOSAVE_DEBOUNCE] Skipping save - only', timeSinceLastChange, 'ms since last change (need 1500ms)');
            return;
          }
          console.log('[AUTOSAVE_DEBOUNCE] Proceeding with save -', timeSinceLastChange, 'ms since last change');

          if (LOG_CONFIG.AUTOSAVE) console.log('[AUTOSAVE] Starting save attempt...');
          if (LOG_CONFIG.AUTOSAVE) console.log('[AUTOSAVE] Current state:', {
            isDirty: isDirtyRef.current,
            currentFilePath,
            hasGetContent: !!getContentRef.current,
            timestamp: new Date().toISOString()
          });

          // Validate that the file path hasn't changed since we started
          if (saveFilePath !== currentFilePath) {
            console.warn('[AUTOSAVE] File path changed during autosave, aborting:', {
              original: saveFilePath,
              current: currentFilePath
            });
            return;
          }

          // Create abort controller for this save
          const abortController = new AbortController();
          autoSaveCancellationRef.current = abortController;

          try {
            const content = getContentNow();
            if (LOG_CONFIG.AUTOSAVE) console.log('[AUTOSAVE] Got content, length:', content.length);

            // Check for abort before proceeding
            if (abortController.signal.aborted) {
              console.log('[AUTOSAVE] Save cancelled before execution');
              return;
            }

            // First ensure the backend knows the current file path
            if (LOG_CONFIG.AUTOSAVE) console.log('[AUTOSAVE] Ensuring backend has current file path...');
            const setFileResult = window.electronAPI.setCurrentFile(saveFilePath);
            // Handle both promise and non-promise returns
            if (setFileResult && typeof setFileResult.then === 'function') {
              await setFileResult;
            }

            // Check for abort again
            if (abortController.signal.aborted) {
              console.log('[AUTOSAVE] Save cancelled after setting file path');
              return;
            }

            // Small delay to ensure the backend has processed the file path update
            await new Promise(resolve => setTimeout(resolve, 100));

            // Final check before save
            if (abortController.signal.aborted) {
              console.log('[AUTOSAVE] Save cancelled before saveFile call');
              return;
            }

            if (LOG_CONFIG.AUTOSAVE) console.log('[AUTOSAVE] Calling saveFile...');
            // console.log('[AUTOSAVE_TRIGGER] About to save file via autosave at', new Date().toISOString());
            const result = await window.electronAPI.saveFile(content, saveFilePath);
            if (LOG_CONFIG.AUTOSAVE) console.log('[AUTOSAVE] Save result:', result);

            if (result && result.success) {
              // Double-check file path hasn't changed after save
              if (saveFilePath === currentFilePath) {
                // Mark the time we saved to ignore file change events
                lastSaveTimeRef.current = Date.now();
                isDirtyRef.current = false;
                setIsDirty(false);
                initialContentRef.current = content;
                if (LOG_CONFIG.AUTOSAVE) console.log('[AUTOSAVE] ✓ Autosaved successfully to:', result.filePath);
              } else {
                console.warn('[AUTOSAVE] File path changed after save, not updating dirty state:', {
                  saved: saveFilePath,
                  current: currentFilePath
                });
              }
            } else {
              if (LOG_CONFIG.AUTOSAVE) console.error('[AUTOSAVE] ✗ Save failed - result:', result);
              if (LOG_CONFIG.AUTOSAVE) console.error('[AUTOSAVE] This typically means the backend lost track of the file path');

              // Try to recover by re-syncing the file path
              if (LOG_CONFIG.AUTOSAVE) console.log('[AUTOSAVE] Attempting recovery by re-syncing file path...');
              const recoverResult = window.electronAPI.setCurrentFile(saveFilePath);
              if (recoverResult && typeof recoverResult.then === 'function') {
                await recoverResult;
              }

              // Show user notification about save failure
              if (window.electronAPI?.showErrorDialog) {
                window.electronAPI.showErrorDialog(
                  'Auto-save Failed',
                  `Failed to auto-save to: ${currentFilePath}\n\nYour changes may not be saved. Please try saving manually (Cmd+S).`
                );
              }
            }
          } catch (error) {
            if (LOG_CONFIG.AUTOSAVE) console.error('[AUTOSAVE] ✗ Exception during autosave:', error);
            if (LOG_CONFIG.AUTOSAVE) console.error('[AUTOSAVE] Error details:', {
              message: error.message,
              stack: error.stack,
              currentFilePath
            });

            // Show user notification about save failure
            if (window.electronAPI?.showErrorDialog) {
              window.electronAPI.showErrorDialog(
                'Auto-save Error',
                `Failed to save document: ${error.message}\n\nFile: ${currentFilePath}`
              );
            }
          }
        } else {
          if (LOG_CONFIG.AUTOSAVE) console.log('[AUTOSAVE] Skipping autosave - conditions not met:', {
            isDirty: isDirtyRef.current,
            currentFilePath,
            hasGetContent: !!getContentRef.current,
            hasElectronAPI: !!window.electronAPI
          });
        }
      }, 2000); // Autosave every 2 seconds
    } else {
      if (LOG_CONFIG.AUTOSAVE) console.log('[AUTOSAVE] Not setting up autosave:', {
        hasPath: !!currentFilePath,
        hasGetContent: !!getContentRef.current
      });
    }

    // Cleanup on unmount or when dependencies change
    return () => {
      if (autoSaveIntervalRef.current) {
        if (LOG_CONFIG.AUTOSAVE) console.log('[AUTOSAVE] Cleaning up autosave interval');
        clearInterval(autoSaveIntervalRef.current);
        autoSaveIntervalRef.current = null;
      }
    };
  }, [currentFilePath])  // Remove isDirty from deps - use ref instead

  // Set up autosave when we have both a file path and the content getter
  useEffect(() => {
    // Clear any existing interval first
    if (autoSaveIntervalRef.current) {
      clearInterval(autoSaveIntervalRef.current);
      autoSaveIntervalRef.current = null;
    }

    if (!currentFilePath) {
      return;
    }

    // Check every second if we have getContentRef, then set up autosave
    const checkInterval = setInterval(() => {
      if (getContentRef.current) {
        clearInterval(checkInterval);

        // console.log('[AUTOSAVE] Setting up autosave interval - getContentRef is now available');

        autoSaveIntervalRef.current = setInterval(async () => {
          // console.log('[AUTOSAVE CHECK] Checking dirty state:', {
          //   isDirtyRef: isDirtyRef.current,
          //   currentFilePath,
          //   hasGetContent: !!getContentRef.current
          // });

          // Capture values at interval start
          const saveFilePath = currentFilePath;
          const isDirtyNow = isDirtyRef.current;
          const getContentNow = getContentRef.current;

          if (isDirtyNow && saveFilePath && getContentNow && window.electronAPI) {
            // Check debounce: only save if 1500ms have passed since last change
            const timeSinceLastChange = Date.now() - lastChangeTimeRef.current;
            if (timeSinceLastChange < 1500) {
              // console.log('[AUTOSAVE_DEBOUNCE] Skipping save - only', timeSinceLastChange, 'ms since last change (need 1500ms)');
              return;
            }
            // console.log('[AUTOSAVE_DEBOUNCE] Proceeding with save -', timeSinceLastChange, 'ms since last change');

            // Validate file path hasn't changed
            if (saveFilePath !== currentFilePath) {
              console.warn('[AUTOSAVE] File path changed, aborting autosave');
              return;
            }

            // Create abort controller
            const abortController = new AbortController();
            autoSaveCancellationRef.current = abortController;

            // console.log('[AUTOSAVE] Saving...');
            try {
              const content = getContentNow();

              // Check for abort
              if (abortController.signal.aborted) {
                return;
              }

              // console.log('[AUTOSAVE_TRIGGER] About to save file via autosave at', new Date().toISOString());
              const result = await window.electronAPI.saveFile(content, saveFilePath);
              if (result && result.success) {
                // Validate path again after save
                if (saveFilePath === currentFilePath) {
                  // Mark the time we saved to ignore file change events
                  lastSaveTimeRef.current = Date.now();
                  isDirtyRef.current = false;
                  setIsDirty(false);
                  initialContentRef.current = content;
                } else {
                  console.warn('[AUTOSAVE] File path changed after save, skipping dirty state update');
                }

                // Update the tab's dirty state using ref to get current tabs
                if (tabsRef.current && tabsRef.current.activeTabId) {
                  // console.log('[AUTOSAVE] Updating tab dirty state for:', tabsRef.current.activeTabId);
                  tabsRef.current.updateTab(tabsRef.current.activeTabId, { isDirty: false });
                }

                // console.log('[AUTOSAVE] ✓ Saved successfully');
              }
            } catch (error) {
              console.error('[AUTOSAVE] Failed:', error);
            }
          }
        }, 2000);
      }
    }, 100);

    return () => {
      clearInterval(checkInterval);
      if (autoSaveIntervalRef.current) {
        clearInterval(autoSaveIntervalRef.current);
        autoSaveIntervalRef.current = null;
      }
    };
  }, [currentFilePath]) // Only re-run when file path changes

  // Automatic snapshot functionality
  useEffect(() => {
    // Clear any existing interval
    if (autoSnapshotIntervalRef.current) {
      clearInterval(autoSnapshotIntervalRef.current);
      autoSnapshotIntervalRef.current = null;
    }

    // Set up auto-snapshot if we have a file path
    if (currentFilePath && getContentRef.current && window.electronAPI?.history) {
      // console.log('Starting auto-snapshot interval');
      autoSnapshotIntervalRef.current = setInterval(async () => {
        if (currentFilePath && getContentRef.current && window.electronAPI?.history) {
          try {
            const content = getContentRef.current();
            // Only create snapshot if content changed since last snapshot
            if (content !== lastSnapshotContentRef.current && content !== '') {
              if (LOG_CONFIG.AUTO_SNAPSHOT) console.log('[AUTO-SNAPSHOT] Creating periodic snapshot');
              await window.electronAPI.history.createSnapshot(
                currentFilePath,
                content,
                'auto',
                'Periodic auto-save'
              );
              lastSnapshotContentRef.current = content;
            }
          } catch (error) {
            if (LOG_CONFIG.AUTO_SNAPSHOT) console.error('[AUTO-SNAPSHOT] Failed to create snapshot:', error);
          }
        }
      }, 300000); // Create snapshot every 5 minutes
    }

    // Don't update last snapshot content here - let the interval handle it

    // Cleanup on unmount or when dependencies change
    return () => {
      if (autoSnapshotIntervalRef.current) {
        clearInterval(autoSnapshotIntervalRef.current);
        autoSnapshotIntervalRef.current = null;
      }
    };
  }, [currentFilePath]);

  // Handle active tab changes (especially after restoration)
  useEffect(() => {
    if (tabs.activeTab && tabPreferences.preferences.enabled) {
      console.log('[APP] Active tab changed to:', tabs.activeTab.id, tabs.activeTab.filePath);
      // Load the tab's content if it's not already loaded
      if (tabs.activeTab.filePath) {
        // Load content if needed
        if (!tabs.activeTab.content && window.electronAPI) {
          console.log('[APP] Loading content for restored active tab');
          window.electronAPI.switchWorkspaceFile(tabs.activeTab.filePath).then(result => {
            if (result) {
              tabs.updateTab(tabs.activeTab.id, { content: result.content });
              setCurrentFilePath(tabs.activeTab.filePath);
              setCurrentFileName(tabs.activeTab.fileName);
              contentRef.current = result.content;
              initialContentRef.current = result.content;
              contentVersionRef.current += 1;
              setContentVersion(v => v + 1);
            setContentVersion(v => v + 1);
      setContentVersion(v => v + 1);
        setContentVersion(v => v + 1);
    setContentVersion(v => v + 1);
          setContentVersion(v => v + 1);
              setIsDirty(tabs.activeTab.isDirty);

              // Update the main process
              if (window.electronAPI) {
                window.electronAPI.setCurrentFile(tabs.activeTab.filePath);
              }
            }
          }).catch(error => {
            console.error('[APP] Failed to load content for active tab:', error);
          });
        } else if (tabs.activeTab.content !== undefined) {
          // Tab already has content, just set it
          setCurrentFilePath(tabs.activeTab.filePath);
          setCurrentFileName(tabs.activeTab.fileName);
          contentRef.current = tabs.activeTab.content;
          initialContentRef.current = tabs.activeTab.content;
          contentVersionRef.current += 1;
          setContentVersion(v => v + 1);
          setIsDirty(tabs.activeTab.isDirty);

          // Update the main process
          if (window.electronAPI) {
            window.electronAPI.setCurrentFile(tabs.activeTab.filePath);
          }
        }
      }
    }
  }, [tabs.activeTab?.id]); // Only re-run when active tab ID changes

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
  useEffect(() => {
    if (!window.electronAPI) return;

    if (LOG_CONFIG.IPC_LISTENERS) console.log('[IPC] Setting up IPC listeners, currentFilePath:', currentFilePath);

    // Check for first launch (no API key configured)
    const checkFirstLaunch = async () => {
      try {
        const hasApiKey = await window.electronAPI.aiHasApiKey();
        if (!hasApiKey) {
          // Show API key dialog on first launch
          setIsApiKeyDialogOpen(true);
        }
      } catch (error) {
        console.error('Failed to check for API key:', error);
      }
    };

    // Only check on initial mount (when currentFilePath is null)
    if (!currentFilePath && !sessionToLoad) {
      checkFirstLaunch();
    }

    // Set up listeners and store cleanup functions
    const cleanupFns: Array<() => void> = [];

    cleanupFns.push(window.electronAPI.onFileNew(handleNew));

    // Handle new file in workspace mode
    if (window.electronAPI.onFileNewInWorkspace) {
      cleanupFns.push(window.electronAPI.onFileNewInWorkspace(() => {
        if (workspaceMode) {
          // Use current directory or workspace root
          if (!currentDirectory && workspacePath) {
            setCurrentDirectory(workspacePath);
          }
          setIsNewFileDialogOpen(true);
        }
      }));
    }
    cleanupFns.push(window.electronAPI.onFileOpen(handleOpen));
    cleanupFns.push(window.electronAPI.onFileSave(handleSave));
    cleanupFns.push(window.electronAPI.onFileSaveAs(handleSaveAs));
    cleanupFns.push(window.electronAPI.onWorkspaceOpened(async (data) => {
      if (LOG_CONFIG.WORKSPACE_OPS) console.log('[WORKSPACE] Workspace opened:', data);
      setWorkspaceMode(true);
      setWorkspacePath(data.workspacePath);
      setWorkspaceName(data.workspaceName);
      setFileTree(data.fileTree);
      // Set current directory to workspace root
      setCurrentDirectory(data.workspacePath);
      // Clear current document
      contentRef.current = '';
      setCurrentFilePath(null);
      setCurrentFileName(null);
      isDirtyRef.current = false;
    setIsDirty(false);
      contentVersionRef.current += 1;
      setContentVersion(v => v + 1);
    setContentVersion(v => v + 1);
      isInitializedRef.current = false;

      // Restore AI Chat state when opening a workspace
      try {
        const aiChatState = await window.electronAPI.getAIChatState(data.workspacePath);
        console.log('Restoring AI Chat state for workspace:', aiChatState);
        if (aiChatState) {
          setIsAIChatCollapsed(aiChatState.collapsed);
          setAIChatWidth(aiChatState.width);
          if (aiChatState.currentSessionId) {
            setSessionToLoad({ sessionId: aiChatState.currentSessionId, workspacePath: data.workspacePath });
          }
        }
        setIsAIChatStateLoaded(true);
      } catch (error) {
        console.error('Failed to restore AI Chat state:', error);
        setIsAIChatStateLoaded(true);
      }
    }));

    // Handle opening a specific file in a workspace (used when restoring workspace state)
    if (window.electronAPI.onOpenWorkspaceFile) {
      cleanupFns.push(window.electronAPI.onOpenWorkspaceFile(async (filePath) => {
        console.log('Opening workspace file from saved state:', filePath);
        // Use the existing file selection handler
        await handleWorkspaceFileSelect(filePath);
      }));
    }

    if (window.electronAPI.onOpenDocument) {
      cleanupFns.push(window.electronAPI.onOpenDocument(async ({ path }) => {
        console.log('[DOCUMENT_LINK] Renderer received open-document for path:', path);
        try {
          await handleWorkspaceFileSelect(path);
        } catch (error) {
          console.error('[DOCUMENT_LINK] Failed to open document reference:', error);
        }
      }));
    }

    // Handle workspace open from CLI
    if (window.electronAPI.onOpenWorkspaceFromCLI) {
      cleanupFns.push(window.electronAPI.onOpenWorkspaceFromCLI(async (workspacePath) => {
        console.log('Opening workspace from CLI:', workspacePath);
        // Open the workspace using the existing openWorkspace API
        if (window.electronAPI.openWorkspace) {
          await window.electronAPI.openWorkspace(workspacePath);
        }
      }));
    }

    cleanupFns.push(window.electronAPI.onFileOpenedFromOS(async (data) => {
      if (LOG_CONFIG.FILE_OPS) console.log('[FILE_OPS] File opened from OS:', data.filePath);
      contentVersionRef.current += 1;
      setContentVersion(v => v + 1);
    setContentVersion(v => v + 1);
      isInitializedRef.current = false;
      contentRef.current = data.content;
      setCurrentFilePath(data.filePath);
      setCurrentFileName(data.filePath.split('/').pop() || data.filePath);
      isDirtyRef.current = false;
    setIsDirty(false);
      initialContentRef.current = data.content;

      // Create automatic snapshot when file is opened from OS
      if (window.electronAPI.history) {
        try {
          // Check if we have previous snapshots
          const snapshots = await window.electronAPI.history.listSnapshots(data.filePath);
          if (snapshots.length === 0) {
            // First time opening this file, create initial snapshot
            await window.electronAPI.history.createSnapshot(
              data.filePath,
              data.content,
              'auto',
              'Initial file open'
            );
          } else {
            // Check if content changed since last snapshot
            const latestSnapshot = snapshots[0]; // Assuming sorted by timestamp desc
            const lastContent = await window.electronAPI.history.loadSnapshot(
              data.filePath,
              latestSnapshot.timestamp
            );
            if (lastContent !== data.content) {
              // Content actually changed, create snapshot
              await window.electronAPI.history.createSnapshot(
                data.filePath,
                data.content,
                'auto',
                'File changed externally'
              );
            }
          }
        } catch (error) {
          console.error('Failed to create automatic snapshot:', error);
        }
      }
    }));
    cleanupFns.push(window.electronAPI.onNewUntitledDocument((data) => {
      logger.file.log('Received new-untitled-document event:', data.untitledName);
      contentRef.current = '';
      setCurrentFilePath(null);
      setCurrentFileName(data.untitledName);
      // setIsDirty(true); // New documents start as dirty
      initialContentRef.current = '';
      // Update the window title immediately
      if (window.electronAPI) {
        window.electronAPI.setTitle(`${data.untitledName} • - Preditor`);
        window.electronAPI.setDocumentEdited(true);
      }
    }));
    cleanupFns.push(window.electronAPI.onToggleSearch(() => {
      console.log('Toggle search command received');
      if (editorRef.current && searchCommandRef.current) {
        editorRef.current.dispatchCommand(searchCommandRef.current, undefined);
      }
    }));
    cleanupFns.push(window.electronAPI.onToggleSearchReplace(() => {
      console.log('Toggle search replace command received');
      if (editorRef.current && searchCommandRef.current) {
        editorRef.current.dispatchCommand(searchCommandRef.current, undefined);
      }
    }));
    cleanupFns.push(window.electronAPI.onFileDeleted((data) => {
      console.log('File deleted:', data.filePath);
      if (currentFilePath === data.filePath) {
        // Current file was deleted, mark as dirty and clear the file path
        setCurrentFilePath(null);
        isDirtyRef.current = true;
    setIsDirty(true);
        // Optionally show a notification to the user
        alert('The file has been deleted from disk.');
      }
    }));

    // Handle file changes on disk
    if (window.electronAPI.onFileChangedOnDisk) {
      cleanupFns.push(window.electronAPI.onFileChangedOnDisk(async (data) => {
        // console.log('[FILE_WATCH] File changed on disk event received:', data.path);

        // CRITICAL: Check if we're in tab mode and if this is the active tab's file
        let shouldReload = false;
        let fileToCheck = currentFilePath;

        if (tabPreferences.preferences.enabled && tabs.activeTab) {
          // In tab mode, only reload if it's the active tab's file
          fileToCheck = tabs.activeTab.filePath;
          shouldReload = (fileToCheck === data.path);
          console.log('[FILE_WATCH] Tab mode check:', {
            activeTabPath: fileToCheck,
            changedPath: data.path,
            shouldReload
          });
        } else {
          // In single-file mode, check against current file
          shouldReload = (currentFilePath === data.path);
          console.log('[FILE_WATCH] Single-file mode check:', {
            currentPath: currentFilePath,
            changedPath: data.path,
            shouldReload
          });
        }

        if (shouldReload) {
          // Check if this change is from our own save (within 2 seconds)
          const timeSinceLastSave = Date.now() - lastSaveTimeRef.current;
          if (timeSinceLastSave < 2000) {
            console.log('[FILE_WATCH] Ignoring file change, was just saved', timeSinceLastSave, 'ms ago');
            return;
          }

          // The current file was changed on disk
          try {
            // Read the file content without touching the watcher
            const result = window.electronAPI.readFileContent
              ? await window.electronAPI.readFileContent(data.path)
              : await window.electronAPI.switchWorkspaceFile(data.path);
            if (result && result.content !== undefined) {
              // Get current content from the editor
              const currentContent = getContentRef.current ? getContentRef.current() : contentRef.current;

              console.log('[FILE CHANGE] Content comparison:', {
                diskLength: result.content.length,
                currentLength: currentContent.length,
                diskFirst100: result.content.substring(0, 100),
                currentFirst100: currentContent.substring(0, 100),
                areEqual: result.content === currentContent
              });

              // Compare the content
              if (result.content === currentContent) {
                // Content is the same, ignore the change (likely from our own save)
                // console.log('File changed on disk but content is identical, ignoring');
                return;
              }

              // Content is different, handle based on dirty state
              if (!isDirtyRef.current) {
                // File is not dirty, reload it automatically
                console.log('[FILE_WATCH] File is not dirty, reloading from disk');
                console.log('[FILE_WATCH] Loading content for path:', data.path, 'first 100 chars:', result.content.substring(0, 100));
                contentRef.current = result.content;
                initialContentRef.current = result.content;
                contentVersionRef.current += 1;
                setContentVersion(v => v + 1);  // Trigger re-render and remount editor
                // Reset the getContentRef since editor will remount
                getContentRef.current = null;
                // Ensure editor is not marked as dirty
                isDirtyRef.current = false;
                setIsDirty(false);
                // IMPORTANT: Update the tab's content so it doesn't reload and restart the watcher
                if (tabs.activeTab && tabs.activeTab.filePath === data.path) {
                  tabs.updateTab(tabs.activeTab.id, { content: result.content });
                }
              } else {
                // File is dirty, we have a conflict
                console.log('[FILE_WATCH] File changed on disk but local changes exist');
                const choice = confirm(
                  'The file has been changed on disk but you have unsaved changes.\n\n' +
                  'Do you want to reload the file from disk and lose your changes?\n\n' +
                  'Click OK to reload from disk, or Cancel to keep your changes.'
                );

                if (choice) {
                  // User chose to reload from disk
                  contentRef.current = result.content;
                  initialContentRef.current = result.content;
                  contentVersionRef.current += 1;
                  setContentVersion(v => v + 1);  // Trigger re-render and remount editor
                  // Reset the getContentRef since editor will remount
                  getContentRef.current = null;
                  isDirtyRef.current = false;
                  setIsDirty(false);
                }
                // If user chose Cancel, we just keep the current changes
              }
            }
          } catch (error) {
            console.error('[FILE_WATCH] Failed to check file changes:', error);
          }
        } else {
          console.log('[FILE_WATCH] Ignoring file change for non-active file:', data.path);
        }
      }));
    }
    cleanupFns.push(window.electronAPI.onFileMoved(async (data) => {
      console.log('File moved:', data);
      if (currentFilePath === data.sourcePath) {
        // The current file was moved, update the path and reload it
        console.log('Current file was moved, updating to new path:', data.destinationPath);

        // Update the current file path
        setCurrentFilePath(data.destinationPath);
        setCurrentFileName(data.destinationPath.split('/').pop() || data.destinationPath);

        // Update the file in main process
        if (window.electronAPI.setCurrentFile) {
          window.electronAPI.setCurrentFile(data.destinationPath);
        }

        // If we're dirty, just update the path but keep the current content
        // If not dirty, we could optionally reload from the new location
        // but since it's the same content, we don't need to
      }
    }));
    cleanupFns.push(window.electronAPI.onThemeChange((newTheme) => {
      if (LOG_CONFIG.THEME) console.log('[THEME] Theme changed to:', newTheme);
      const editorTheme = newTheme === 'system' ? 'auto' : newTheme;

      // Flush unsaved changes to disk before visual reset, when possible
      const flushAndReload = async () => {
        try {
          if (currentFilePath && getContentRef.current) {
            if (isDirtyRef.current) {
              const content = getContentRef.current();
              if (LOG_CONFIG.THEME) console.log('[THEME] Dirty before theme switch. Saving to disk...');
              const result = await window.electronAPI?.saveFile(content, currentFilePath);
              if (result?.success) {
                lastSaveTimeRef.current = Date.now();
                isDirtyRef.current = false;
                setIsDirty(false);
                initialContentRef.current = content;
                // Reflect clean state in active tab UI
                if (tabPreferences.preferences.enabled && tabs.activeTabId) {
                  tabs.updateTab(tabs.activeTabId, { isDirty: false });
                }
                if (LOG_CONFIG.THEME) console.log('[THEME] Saved successfully before theme switch');
              } else if (LOG_CONFIG.THEME) {
                console.warn('[THEME] Save before theme switch did not succeed:', result);
              }
            }

            // Reload from disk to ensure we rehydrate with canonical content
            if (window.electronAPI?.readFileContent) {
              const res = await window.electronAPI.readFileContent(currentFilePath);
              if (res?.content !== undefined) {
                contentRef.current = res.content;
                initialContentRef.current = res.content;
                contentVersionRef.current += 1;
                setContentVersion(v => v + 1);
                // Keep tab content in sync
                if (tabPreferences.preferences.enabled && tabs.activeTabId) {
                  tabs.updateTab(tabs.activeTabId, { content: res.content });
                }
              }
            } else if (window.electronAPI?.switchWorkspaceFile) {
              const res = await window.electronAPI.switchWorkspaceFile(currentFilePath);
              if (res?.content !== undefined) {
                contentRef.current = res.content;
                initialContentRef.current = res.content;
                contentVersionRef.current += 1;
                setContentVersion(v => v + 1);
                if (tabPreferences.preferences.enabled && tabs.activeTabId) {
                  tabs.updateTab(tabs.activeTabId, { content: res.content });
                }
              }
            }
          }
        } catch (err) {
          console.error('[THEME] Error flushing/reloading content on theme change:', err);
        } finally {
          // Apply theme after content rehydration
          if (theme !== (editorTheme as ConfigTheme)) {
            setTheme(editorTheme as ConfigTheme);
            if (LOG_CONFIG.THEME) console.log('[THEME] Editor theme set to:', editorTheme);
          }
        }
      };

      // Kick off the async workflow without blocking
      flushAndReload();
    }));

    // Listen for show preferences event
    cleanupFns.push(window.electronAPI.onFileRenamed((data) => {
      console.log('File renamed:', data);

      // Update file tree with the renamed file
      const updateFileTree = (items: FileTreeItem[]): FileTreeItem[] => {
        return items.map(item => {
          if (item.path === data.oldPath) {
            // Update the renamed item
            const newFileName = data.newPath.split('/').pop() || data.newPath;
            return { ...item, path: data.newPath, name: newFileName };
          } else if (item.children) {
            // Recursively update children
            return { ...item, children: updateFileTree(item.children) };
          }
          return item;
        });
      };

      setFileTree(prevTree => updateFileTree(prevTree));

      // Update current file path if it was renamed
      if (currentFilePath === data.oldPath) {
        setCurrentFilePath(data.newPath);
        setCurrentFileName(data.newPath.split('/').pop() || data.newPath);
      }
    }));
    cleanupFns.push(window.electronAPI.onWorkspaceFileTreeUpdated((data) => {
      // console.log('Workspace file tree updated:', data);
      setFileTree(data.fileTree);
    }));

    // Load session from Session Manager
    if (window.electronAPI.onLoadSessionFromManager) {
      cleanupFns.push(window.electronAPI.onLoadSessionFromManager(async (data: { sessionId: string; workspacePath?: string }) => {
        console.log('Loading session from manager:', data);

        // If there's a workspace path and we're not in workspace mode, open the workspace first
        if (data.workspacePath && !workspaceMode) {
          // Open the workspace
          const workspaceName = data.workspacePath.split('/').pop() || 'Workspace';
          const fileTree = await window.electronAPI.getFolderContents(data.workspacePath);
          setWorkspaceMode(true);
          setWorkspacePath(data.workspacePath);
          setWorkspaceName(workspaceName);
          setFileTree(fileTree);
        }

        // Set the session to load - AIChat will pick this up
        setSessionToLoad(data);

        // Make sure AI Chat is visible
        setIsAIChatCollapsed(false);
      }));
    }

    // View history menu handler
    if (window.electronAPI.onViewHistory) {
      cleanupFns.push(window.electronAPI.onViewHistory(() => {
        console.log('View history menu triggered');
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
      }));
    }

    // Tab navigation handlers
    if (window.electronAPI.onNextTab) {
      cleanupFns.push(window.electronAPI.onNextTab(() => {
        if (tabPreferences.preferences.enabled && tabs.tabs.length > 1) {
          const currentIndex = tabs.tabs.findIndex(tab => tab.id === tabs.activeTabId);
          const nextIndex = (currentIndex + 1) % tabs.tabs.length;
          const nextTab = tabs.tabs[nextIndex];
          if (nextTab) {
            tabs.switchTab(nextTab.id);
          }
        }
      }));
    }

    if (window.electronAPI.onPreviousTab) {
      cleanupFns.push(window.electronAPI.onPreviousTab(() => {
        if (tabPreferences.preferences.enabled && tabs.tabs.length > 1) {
          const currentIndex = tabs.tabs.findIndex(tab => tab.id === tabs.activeTabId);
          const prevIndex = currentIndex <= 0 ? tabs.tabs.length - 1 : currentIndex - 1;
          const prevTab = tabs.tabs[prevIndex];
          if (prevTab) {
            tabs.switchTab(prevTab.id);
          }
        }
      }));
    }

    // Approve/Reject action handlers
    if (window.electronAPI.onApproveAction) {
      cleanupFns.push(window.electronAPI.onApproveAction(() => {
        console.log('Approve action triggered');
        // Trigger approve action in the editor
        const editor = editorRef.current;
        if (editor) {
          editor.dispatchCommand(APPROVE_DIFF_COMMAND, undefined);
        }
      }));
    }

    if (window.electronAPI.onRejectAction) {
      cleanupFns.push(window.electronAPI.onRejectAction(() => {
        console.log('Reject action triggered');
        // Trigger reject action in the editor
        const editor = editorRef.current;
        if (editor) {
          editor.dispatchCommand(REJECT_DIFF_COMMAND, undefined);
        }
      }));
    }

    // MCP Server handlers
    if (window.electronAPI.onMcpApplyDiff) {
      cleanupFns.push(window.electronAPI.onMcpApplyDiff(async ({ replacements, resultChannel }) => {
        console.log('MCP applyDiff request:', replacements);
        try {
          // Use the AI chat bridge to apply replacements
          const result = await aiChatBridge.applyReplacements(replacements);

          // Ensure result is defined and has the expected shape
          const finalResult = result || { success: false, error: 'No result returned from diff application' };

          if (window.electronAPI.sendMcpApplyDiffResult) {
            // Make sure we have all required properties and no undefined values
            const resultToSend = {
              success: finalResult.success ?? false
            };
            // Only add error if it exists (IPC can't handle undefined values)
            if (finalResult.error) {
              (resultToSend as any).error = finalResult.error;
            }
            window.electronAPI.sendMcpApplyDiffResult(resultChannel, resultToSend);
          }

          // Show error in UI if the diff failed
          if (!finalResult.success) {
            console.error('Diff application failed:', finalResult.error);
            // You could also show a toast or notification here
            // For now, we'll just make sure it's visible in the console
          }
        } catch (error) {
          console.error('MCP applyDiff error:', error);
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';

          if (window.electronAPI.sendMcpApplyDiffResult) {
            // Ensure we're sending a clean object without undefined values
            window.electronAPI.sendMcpApplyDiffResult(resultChannel, {
              success: false,
              error: errorMessage || 'Unknown error'
            });
          }

          // Could show error notification here
          // alert(`Failed to apply edit: ${errorMessage}`);
        }
      }));
    }

    if (window.electronAPI.onMcpStreamContent) {
      cleanupFns.push(window.electronAPI.onMcpStreamContent(({ streamId, content, position, insertAfter, mode }) => {
        console.log('MCP streamContent request:', { streamId, position, mode });
        // Start streaming
        aiChatBridge.startStreamingEdit({
          id: streamId,
          position: position || 'cursor',
          mode: mode || 'after',
          insertAfter,
          insertAtEnd: position === 'end'
        });
        // Stream the content
        aiChatBridge.streamContent(streamId, content);
        // End streaming
        aiChatBridge.endStreamingEdit(streamId);
      }));
    }

    if (window.electronAPI.onMcpNavigateTo) {
      cleanupFns.push(window.electronAPI.onMcpNavigateTo(({ line, column }) => {
        console.log('MCP navigateTo request:', { line, column });
        // TODO: Implement navigation to specific line/column in editor
        // This would require adding a navigation command to the editor
      }));
    }

    // AI Tool handlers for document manipulation
    if (window.electronAPI.onAIApplyDiff) {
      cleanupFns.push(window.electronAPI.onAIApplyDiff(async ({ replacements, resultChannel }) => {
        console.log('AI applyDiff request:', replacements);
        try {
          const result = await aiChatBridge.applyReplacements(replacements);
          const finalResult = result || { success: false, error: 'No result returned from diff application' };

          if (window.electronAPI.sendAIApplyDiffResult) {
            const resultToSend = {
              success: finalResult.success ?? false
            };
            if (finalResult.error) {
              (resultToSend as any).error = finalResult.error;
            }
            window.electronAPI.sendAIApplyDiffResult(resultChannel, resultToSend);
          }
        } catch (error) {
          console.error('AI applyDiff error:', error);
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';

          if (window.electronAPI.sendAIApplyDiffResult) {
            window.electronAPI.sendAIApplyDiffResult(resultChannel, {
              success: false,
              error: errorMessage || 'Unknown error'
            });
          }
        }
      }));
    }

    if (window.electronAPI.onAIGetDocumentContent) {
      cleanupFns.push(window.electronAPI.onAIGetDocumentContent(async ({ resultChannel }) => {
        console.log('AI getDocumentContent request');
        try {
          // Get content from the editor using the ref
          let content = '';
          if (getContentRef.current) {
            content = getContentRef.current();
          }

          if (window.electronAPI.sendAIGetDocumentContentResult) {
            window.electronAPI.sendAIGetDocumentContentResult(resultChannel, {
              content: content || ''
            });
          }
        } catch (error) {
          console.error('AI getDocumentContent error:', error);

          if (window.electronAPI.sendAIGetDocumentContentResult) {
            window.electronAPI.sendAIGetDocumentContentResult(resultChannel, {
              content: ''
            });
          }
        }
      }));
    }

    if (window.electronAPI.onAIUpdateFrontmatter) {
      cleanupFns.push(window.electronAPI.onAIUpdateFrontmatter(async ({ updates, resultChannel }) => {
        console.log('AI updateFrontmatter request:', updates);
        try {
          const currentContent = aiChatBridge.getContent();
          const { data: existingData } = parseFrontmatter(currentContent);

          const normalizedUpdates: Record<string, unknown> = { ...updates };
          const planStatusUpdate: Record<string, unknown> = {};

          for (const key of Object.keys(normalizedUpdates)) {
            if (PLAN_STATUS_KEYS.has(key)) {
              planStatusUpdate[key] = normalizedUpdates[key];
              delete normalizedUpdates[key];
            }
          }

          if (Object.keys(planStatusUpdate).length > 0) {
            const existingPlanStatus = existingData?.planStatus;
            const existingPlanStatusObject =
              existingPlanStatus && typeof existingPlanStatus === 'object' && !Array.isArray(existingPlanStatus)
                ? (existingPlanStatus as FrontmatterData)
                : {};

            normalizedUpdates.planStatus = mergeFrontmatterData(
              existingPlanStatusObject,
              planStatusUpdate as Partial<FrontmatterData>,
            );
          }

          const mergedData = mergeFrontmatterData(existingData ?? {}, normalizedUpdates as Partial<FrontmatterData>);

          const frontmatterMatch = currentContent.match(/^---\n([\s\S]*?)\n---\n?/);
          const newFrontmatterBlockBase = serializeWithFrontmatter('', mergedData);

          let replacements: Array<{ oldText: string; newText: string }>;

          if (frontmatterMatch) {
            const originalFrontmatterBlock = frontmatterMatch[0];
            const trailingNewlines = originalFrontmatterBlock.match(/\n*$/)?.[0] ?? '';
            const trimmedBase = newFrontmatterBlockBase.replace(/\s*$/, '');
            const newFrontmatterBlock = `${trimmedBase}${trailingNewlines || '\n'}`;

            replacements = [{
              oldText: originalFrontmatterBlock,
              newText: newFrontmatterBlock,
            }];
          } else {
            const trimmedBase = newFrontmatterBlockBase.replace(/\s*$/, '');
            const newFrontmatterBlock = `${trimmedBase}\n\n`;
            replacements = [{
              oldText: currentContent,
              newText: `${newFrontmatterBlock}${currentContent}`,
            }];
          }

          // Apply the replacement
          const result = await aiChatBridge.applyReplacements(replacements);
          const finalResult = result || { success: false, error: 'Failed to update frontmatter' };

          if (window.electronAPI.sendAIUpdateFrontmatterResult) {
            const resultToSend = {
              success: finalResult.success ?? false
            };
            if (finalResult.error) {
              (resultToSend as any).error = finalResult.error;
            }
            window.electronAPI.sendAIUpdateFrontmatterResult(resultChannel, resultToSend);
          }
        } catch (error) {
          console.error('AI updateFrontmatter error:', error);
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';

          if (window.electronAPI.sendAIUpdateFrontmatterResult) {
            window.electronAPI.sendAIUpdateFrontmatterResult(resultChannel, {
              success: false,
              error: errorMessage || 'Unknown error'
            });
          }
        }
      }));
    }

    // Update MCP document state whenever content or selection changes
    const updateDocumentState = () => {
      if (window.electronAPI?.updateMcpDocumentState && getContentRef.current) {
        const content = getContentRef.current();
        window.electronAPI.updateMcpDocumentState({
          content,
          filePath: currentFilePath || 'untitled.md',
          fileType: 'markdown',
          // TODO: Get actual cursor position and selection from editor
          cursorPosition: undefined,
          selection: undefined
        });
      }
    };

    // Update document state when file is opened or content changes
    // We need to send the initial state when a file is opened, not just when it's dirty
    if (currentFilePath || isDirty) {
      updateDocumentState();
    }

    // Clean up listeners when dependencies change
    return () => {
      // console.log('Cleaning up IPC listeners');
      cleanupFns.forEach(cleanup => cleanup());
    };
  }, [handleNew, handleOpen, handleSave, handleSaveAs, handleWorkspaceFileSelect, currentFilePath, isDirty, workspaceMode]);

  logger.ui.info('Rendering App with config:', {
    contentLength: contentRef.current.length,
    currentFileName,
    theme
  });

  logger.ui.info('About to render StravuEditor');

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
        {/*  enabled: tabPreferences.preferences.enabled,*/}
        {/*  workspaceMode,*/}
        {/*  numTabs: tabs.tabs.length,*/}
        {/*  activeTabId: tabs.activeTabId*/}
        {/*})}*/}
        {tabPreferences.preferences.enabled && workspaceMode ? (
          <TabManager
            tabs={tabs.tabs}
            activeTabId={tabs.activeTabId}
            onTabSelect={tabs.switchTab}
            onTabClose={tabs.removeTab}
            onNewTab={() => {
              // Open file dialog or create untitled tab
              setIsNewFileDialogOpen(true);
            }}
            onTogglePin={(tabId) => {
              const tab = tabs.getTabState(tabId);
              if (tab) {
                tabs.updateTab(tabId, { isPinned: !tab.isPinned });
              }
            }}
            onViewHistory={(tabId) => {
              const tab = tabs.getTabState(tabId);
              if (tab && tab.filePath) {
                setIsHistoryDialogOpen(true);
              }
            }}
          >
            {tabs.activeTab ? (
              <StravuEditor
                key={`${tabs.activeTabId}-${contentVersion}-${theme}`}
                config={{
                  // Prefer the latest in-memory content; fall back to tab snapshot
                  initialContent: contentRef.current || tabs.activeTab.content || '',
                  onContentChange: () => {
                    // Track dirty state in ref for autosave without re-rendering
                    if (getContentRef.current) {
                      const currentContent = getContentRef.current();
                      // Keep the latest content in memory to prevent losing edits
                      contentRef.current = currentContent;
                      const hasChanged = currentContent !== initialContentRef.current;

                      // console.log('[TAB CONTENT CHANGE] Dirty check:', {
                      //   hasChanged,
                      //   currentLength: currentContent.length,
                      //   initialLength: initialContentRef.current.length,
                      //   isDirtyRef: isDirtyRef.current
                      // });

                      // Track when content last changed for debouncing
                      if (hasChanged) {
                        const now = Date.now();
                        // console.log('[CONTENT_CHANGE] Content marked dirty at', new Date(now).toISOString());
                        lastChangeTimeRef.current = now;
                      }

                      // Update ref immediately for autosave
                      isDirtyRef.current = hasChanged;

                      // Track tab dirty state in ref
                      if (tabs.activeTabId) {
                        tabStatesRef.current.set(tabs.activeTabId, { isDirty: hasChanged });
                      }

                      // Only update state if the visual indicator needs to change
                      if (isDirty !== hasChanged) {
                        setIsDirty(hasChanged);
                        // Also update the tab's dirty state for UI
                        if (tabs.activeTabId) {
                          tabs.updateTab(tabs.activeTabId, { isDirty: hasChanged });
                        }
                      }
                    }
                  },
                  onGetContent: (getContentFn) => {
                    logger.ui.info('Received getContent function for tab');
                    getContentRef.current = getContentFn;
                  },
                  onEditorReady: (editor) => {
                    logger.ui.info('Editor ready for tab');
                    editorRef.current = editor;
                    searchCommandRef.current = TOGGLE_SEARCH_COMMAND;
                  },
                  theme: theme
                }}
              />
            ) : (
              <WorkspaceWelcome workspaceName={workspaceName || 'Workspace'} />
            )}
          </TabManager>
        ) : workspaceMode && !currentFilePath ? (
          <WorkspaceWelcome workspaceName={workspaceName || 'Workspace'} />
        ) : (
          <StravuEditor
            key={`${contentVersion}-${theme}`}
            config={{
              initialContent: contentRef.current,
              onContentChange: () => {
            // Track dirty state in ref for autosave without re-rendering
            if (getContentRef.current) {
              const currentContent = getContentRef.current();
              // Keep the latest content in memory to prevent losing edits
              contentRef.current = currentContent;
              const hasChanged = currentContent !== initialContentRef.current;

              // Track when content last changed for debouncing
              if (hasChanged) {
                const now = Date.now();
                // console.log('[CONTENT_CHANGE] Content marked dirty at', new Date(now).toISOString());
                lastChangeTimeRef.current = now;
              }

              // Update ref immediately for autosave
              isDirtyRef.current = hasChanged;

              // Only update state if the visual indicator needs to change
              if (isDirty !== hasChanged) {
                setIsDirty(hasChanged);
              }
            }
          },
          onGetContent: (getContentFn) => {
            logger.ui.info('Received getContent function');
            getContentRef.current = getContentFn;
          },
          onEditorReady: (editor) => {
            logger.ui.info('Editor ready');
            editorRef.current = editor;
            searchCommandRef.current = TOGGLE_SEARCH_COMMAND;
          },
          isRichText: true,
          showTreeView: false,
          markdownOnly: true,
          theme: theme,
            }}
          />
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
          documentContext={{
            filePath: currentFilePath || '',
            fileType: 'markdown',
            content: getContentRef.current ? getContentRef.current() : contentRef.current,
            cursorPosition: undefined, // TODO: Get from Lexical editor
            selection: undefined, // TODO: Get selected text from Lexical
            getLatestContent: getContentRef.current // Pass the function itself
          }}
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
              content: getContentRef.current ? getContentRef.current() : contentRef.current,
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
    </div>
  );
}
