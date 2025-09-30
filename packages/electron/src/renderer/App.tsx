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

// Import refactored hooks and utilities
import { useIPCHandlers } from './hooks/useIPCHandlers';
import { useWindowLifecycle } from './hooks/useWindowLifecycle';
import { useHMRStateRestoration } from './hooks/useHMRStateRestoration';
import { autoSaveBeforeNavigation as autoSaveUtil, type AutoSaveOptions } from './utils/autosave';
import { handleWorkspaceFileSelect as handleWorkspaceFileSelectUtil } from './utils/workspaceFileOperations';
import { aiToolService } from './services/AIToolService';

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
import { AIModelsRedesigned as AIModels } from './components/AIModels/AIModelsRedesigned';
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
import './components/AIModels/AIModelsRedesigned.css';

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

// Note: FileTreeItem and ElectronAPI interfaces are defined in electron.d.ts

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

  // Register aiToolService methods on aiChatBridge for runtime to use
  useEffect(() => {
    aiToolService.registerBridgeMethods();
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
      const previousTab = previousTabId ? tabs.getTabState(previousTabId) : undefined;
      // Use the tab's stored isDirty state, not isDirtyRef, to avoid overwriting autosave updates
      const wasDirty = previousTab?.isDirty ?? isDirtyRef.current;
      let previousContent: string | null = null;

      if (previousTabId && getContentRef.current) {
        previousContent = getContentRef.current();
        tabs.updateTab(previousTabId, {
          content: previousContent,
          isDirty: wasDirty
        });
        // console.log('[TABS] Saved content for previous tab:', previousTabId);
      }

      if (
        wasDirty &&
        previousTab &&
        previousTab.filePath &&
        previousTab.filePath !== tab.filePath &&
        previousTabId &&
        previousContent !== null
      ) {
        await autoSaveBeforeNavigation({
          tabId: previousTabId,
          filePath: previousTab.filePath,
          content: previousContent,
          force: true,
          reason: 'Autosave before tab switch'
        });
      }

      // When switching tabs, restore the tab's saved state
      if (tab.filePath) {
        // Always reload from disk to get latest autosaved content
        if (window.electronAPI) {
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
          // CRITICAL: Update refs FIRST before any state changes that trigger re-renders
          // The editor will load: contentRef.current || tabs.activeTab.content || ''
          // initialContentRef will be updated in onGetContent when editor actually loads
          const contentToLoad = tab.content;
          contentRef.current = contentToLoad;
          initialContentRef.current = contentToLoad;
          // Since we always autosave before switching tabs, and we just loaded fresh content from disk,
          // only the active tab can ever be dirty
          isDirtyRef.current = false;

          // Now trigger state updates that cause re-renders
          setCurrentFilePath(tab.filePath);
          setCurrentFileName(tab.fileName);
          setIsDirty(false);
          contentVersionRef.current += 1;
          setContentVersion(v => v + 1);

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
        const wasDirty = isDirtyRef.current;

        tabs.updateTab(tab.id, {
          content: currentContent,
          isDirty: wasDirty
        });

        // Update the actual tab object with latest content
        tab.content = currentContent;
        tab.isDirty = wasDirty;

        if (wasDirty && tab.filePath) {
          autoSaveBeforeNavigation({
            tabId: tab.id,
            filePath: tab.filePath,
            content: currentContent,
            force: true,
            reason: 'Autosave before closing tab'
          }).catch(error => {
            console.error('[TAB CLOSE] Autosave failed:', error);
          });
          return;
        }
      }

      // Handle tab close - save if dirty
      if (tab.isDirty && tab.filePath && window.electronAPI) {
        // console.log('[TAB CLOSE] Saving unsaved changes for:', tab.fileName);

        // Try to save the file
        if (tab.content) {
          autoSaveBeforeNavigation({
            tabId: tab.id,
            filePath: tab.filePath,
            content: tab.content,
            force: true,
            reason: 'Autosave before closing tab'
          }).catch(error => {
            console.error('[TAB CLOSE] Autosave failed:', error);
            if (window.electronAPI.showErrorDialog) {
              window.electronAPI.showErrorDialog(
                'Failed to Save',
                `Failed to save ${tab.fileName} before closing.\n\nYour changes may be lost.`
              );
            }
          });
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

  // Window lifecycle hook - handles mount/unmount and beforeunload
  useWindowLifecycle({
    tabsRef,
    getContentRef,
    isDirtyRef,
    currentFilePath,
    lastSaveTimeRef,
  });

  // HMR state restoration hook - saves and restores state during hot reloads
  useHMRStateRestoration({
    setWorkspaceMode,
    setWorkspacePath,
    setWorkspaceName,
    setFileTree,
    setCurrentFilePath,
    setCurrentFileName,
    setIsDirty,
    setContentVersion,
    setSidebarWidth,
    setTheme,
    contentRef,
    initialContentRef,
    isInitializedRef,
    isDirtyRef,
    contentVersionRef,
    workspaceMode,
    workspacePath,
    workspaceName,
    fileTree,
    currentFilePath,
    currentFileName,
    sidebarWidth,
    theme,
    LOG_CONFIG,
  });

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

  // Wrapper for autosave utility with component-specific context
  const autoSaveBeforeNavigation = useCallback(async (options: AutoSaveOptions = {}) => {
    return autoSaveUtil(options, {
      currentFilePath,
      tabPreferences,
      tabs,
      isDirtyRef,
      getContentRef,
      contentRef,
      initialContentRef,
      lastSaveTimeRef,
      setIsDirty,
      setCurrentFilePath,
      setCurrentFileName,
    });
  }, [currentFilePath, tabPreferences, tabs, setIsDirty, setCurrentFileName, setCurrentFilePath]);

  // Wrapper for workspace file selection utility with component-specific context
  const handleWorkspaceFileSelect = useCallback(async (filePath: string) => {
    return handleWorkspaceFileSelectUtil({
      filePath,
      currentFilePath,
      isDirtyRef,
      tabPreferences,
      tabs,
      autoSaveBeforeNavigation,
      autoSaveCancellationRef,
      contentVersionRef,
      isInitializedRef,
      contentRef,
      initialContentRef,
      setCurrentFilePath,
      setCurrentFileName,
      setIsDirty,
      setContentVersion,
      setCurrentDirectory,
    });
  }, [currentFilePath, tabs, tabPreferences, autoSaveBeforeNavigation, setIsDirty, setCurrentFileName, setCurrentFilePath, setContentVersion, setCurrentDirectory]);

  // Configure aiToolService with handleWorkspaceFileSelect
  useEffect(() => {
    aiToolService.setHandleWorkspaceFileSelectFunction(handleWorkspaceFileSelect);
  }, [handleWorkspaceFileSelect]);

  // Open the welcome tab - virtual document
  const openWelcomeTab = useCallback(async () => {
    const virtualPath = 'virtual://welcome';

    // Check if welcome tab is already open
    if (tabPreferences.preferences.enabled) {
      const existingTab = tabs.findTabByPath(virtualPath);
      if (existingTab) {
        tabs.switchTab(existingTab.id);
        return;
      }
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
      if (tabPreferences.preferences.enabled) {
        const tabId = tabs.addTab(virtualPath, content);
        if (tabId) {
          // Mark the tab as virtual
          tabs.updateTab(tabId, { isVirtual: true });
          // Set up state for virtual document
          initialContentRef.current = content;
          setCurrentFilePath(virtualPath);
          setCurrentFileName('Welcome to Preditor');
          contentRef.current = content;
          isDirtyRef.current = false;
          setIsDirty(false);
        }
      } else {
        // If tabs are disabled, load it directly
        contentVersionRef.current += 1;
        setContentVersion(v => v + 1);
        isInitializedRef.current = false;
        contentRef.current = content;
        setCurrentFilePath(virtualPath);
        setCurrentFileName('Welcome to Preditor');
        isDirtyRef.current = false;
        setIsDirty(false);
        initialContentRef.current = content;
      }
    } catch (error) {
      console.error('[WELCOME] Failed to open welcome tab:', error);
    }
  }, [tabs, tabPreferences, setIsDirty, setCurrentFileName, setCurrentFilePath]);

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

    // Check if current file is a virtual document
    const isVirtual = currentFilePath?.startsWith('virtual://');

    // Set up autosave if we have a file path (check dirty state inside the interval)
    // Skip autosave for virtual documents
    if (currentFilePath && getContentRef.current && !isVirtual) {
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

    // Skip autosave for virtual documents
    const isVirtual = currentFilePath?.startsWith('virtual://');
    if (!currentFilePath || isVirtual) {
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

          // Check if this is a virtual document
          const isVirtual = tabs.activeTab.filePath.startsWith('virtual://');

          if (isVirtual) {
            // Load virtual document
            (window.electronAPI.documentService as any).loadVirtual(tabs.activeTab.filePath).then((content: string | null) => {
              if (content) {
                tabs.updateTab(tabs.activeTab.id, { content, isVirtual: true });
                setCurrentFilePath(tabs.activeTab.filePath);
                setCurrentFileName(tabs.activeTab.fileName);
                contentRef.current = content;
                initialContentRef.current = content;
                contentVersionRef.current += 1;
                setContentVersion(v => v + 1);
                setIsDirty(false);
              }
            }).catch((error: Error) => {
              console.error('[APP] Failed to load virtual document for active tab:', error);
            });
          } else {
            // Load regular file
            window.electronAPI.switchWorkspaceFile(tabs.activeTab.filePath).then(result => {
              if (result) {
                tabs.updateTab(tabs.activeTab.id, { content: result.content });
                setCurrentFilePath(tabs.activeTab.filePath);
                setCurrentFileName(tabs.activeTab.fileName);
                contentRef.current = result.content;
                initialContentRef.current = result.content;
                contentVersionRef.current += 1;
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
          }
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
  // IPC handlers hook - sets up all IPC communication with main process
  useIPCHandlers({
    // Handlers
    handleNew,
    handleOpen,
    handleSave,
    handleSaveAs,
    handleWorkspaceFileSelect,
    openWelcomeTab,
    
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
    setContentVersion,
    setIsNewFileDialogOpen,
    setIsAIChatCollapsed,
    setAIChatWidth,
    setIsAIChatStateLoaded,
    setSessionToLoad,
    setIsHistoryDialogOpen,
    setIsAgentPaletteVisible,
    
    // Refs
    contentRef,
    initialContentRef,
    isInitializedRef,
    isDirtyRef,
    contentVersionRef,
    getContentRef,
    editorRef,
    searchCommandRef,
    lastSaveTimeRef,
    
    // State values
    currentFilePath,
    currentDirectory,
    workspaceMode,
    workspacePath,
    sessionToLoad,
    isDirty,
    
    // Tabs
    tabs,
    tabPreferences,
    
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
            onTogglePin={tabs.togglePin}
            onTabReorder={tabs.reorderTabs}
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

                      // Normalize content before comparing to avoid false positives from trailing whitespace
                      const normalizedCurrent = currentContent.trimEnd();
                      const normalizedInitial = initialContentRef.current.trimEnd();
                      const hasChanged = normalizedCurrent !== normalizedInitial;

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

                    // Update initialContentRef to match what the editor actually loaded
                    // This ensures onContentChange comparisons are accurate after tab switches
                    if (getContentFn) {
                      const loadedContent = getContentFn();
                      initialContentRef.current = loadedContent;
                    }

                    // Configure aiToolService with content getter
                    aiToolService.setGetContentFunction(getContentFn);
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

              // Normalize content before comparing to avoid false positives from trailing whitespace
              const normalizedCurrent = currentContent.trimEnd();
              const normalizedInitial = initialContentRef.current.trimEnd();
              const hasChanged = normalizedCurrent !== normalizedInitial;

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
