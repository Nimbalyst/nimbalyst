import React, { useCallback, useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import type { ConfigTheme } from 'rexical';
import { useTabsActions, type TabData } from '../../contexts/TabsContext';
import { store, editorDirtyAtom, makeEditorKey } from '@nimbalyst/runtime/store';
import { useTabNavigation } from '../../hooks/useTabNavigation';
import { handleWorkspaceFileSelect as handleWorkspaceFileSelectUtil } from '../../utils/workspaceFileOperations';
import { createInitialFileContent, createMockupContent } from '../../utils/fileUtils';
import { getFileName } from '../../utils/pathUtils';
import { aiToolService } from '../../services/AIToolService';
import { editorRegistry } from '@nimbalyst/runtime/ai/EditorRegistry';
import { getExtensionLoader } from '@nimbalyst/runtime';
import { customEditorRegistry } from '../CustomEditors';
import { WorkspaceSidebar } from '../WorkspaceSidebar';
import { WorkspaceWelcome } from '../WorkspaceWelcome';
import { TabManager } from '../TabManager/TabManager';
import { TabContent } from '../TabContent/TabContent';
import { ChatSidebar, type ChatSidebarRef } from '../ChatSidebar';
import { NewFileDialog } from '../NewFileDialog';
import type { NewFileType, ExtensionFileType } from '../NewFileMenu';
import { contributionToExtensionFileType } from '../NewFileMenu';
import { HistoryDialog } from '../HistoryDialog';
import { WorkspaceHistoryDialog } from '../WorkspaceHistoryDialog';

export interface EditorModeRef {
  closeActiveTab: () => void;
  reopenLastClosedTab: () => Promise<void>;
  handleOpen: () => Promise<void>;
  handleSaveAs: () => Promise<void>;
  selectFile: (filePath: string) => Promise<void>;
  openHistoryDialog: () => void;
  tabs: {
    addTab: (filePath: string, content?: string) => string | undefined;
    removeTab: (tabId: string) => void;
    switchTab: (tabId: string) => void;
    nextTab: () => void;
    previousTab: () => void;
    findTabByPath: (filePath: string) => any | undefined;
    tabs: any[];
    activeTabId: string | null;
  };
}

export interface EditorModeProps {
  workspacePath: string;
  workspaceName: string | null;
  theme: ConfigTheme;
  isActive: boolean;
  onModeChange?: (mode: string) => void;
  onGetContentReady?: (getContentFn: (() => string) | null) => void;
  onCloseWorkspace?: () => void;
  onOpenQuickSearch?: () => void;
  onSwitchToAgentMode?: (planDocumentPath?: string, sessionId?: string) => void;
}

const EditorMode = forwardRef<EditorModeRef, EditorModeProps>(function EditorMode({
  workspacePath,
  workspaceName,
  theme,
  isActive,
  onModeChange,
  onGetContentReady,
  onCloseWorkspace,
  onOpenQuickSearch,
  onSwitchToAgentMode
}, ref) {
  // Debug: trace re-renders
  if (import.meta.env.DEV) console.log('[EditorMode] render');

  // Sidebar state
  const [sidebarWidth, setSidebarWidth] = useState<number>(250);
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(null);

  // Dirty state is tracked via ref to avoid re-render cascade
  // TabEditor calls setDocumentEdited directly for the macOS indicator
  const isDirtyRef = useRef(false);

  const tabsRef = useRef<any>(null);

  // Dialog states
  const [isNewFileDialogOpen, setIsNewFileDialogOpen] = useState(false);
  const [newFileDirectory, setNewFileDirectory] = useState<string | null>(null);
  const [isHistoryDialogOpen, setIsHistoryDialogOpen] = useState(false);
  const [isWorkspaceHistoryDialogOpen, setIsWorkspaceHistoryDialogOpen] = useState(false);
  const [workspaceHistoryPath, setWorkspaceHistoryPath] = useState<string | null>(null);

  // Extension file types state
  const [extensionFileTypes, setExtensionFileTypes] = useState<ExtensionFileType[]>([]);

  // AI Chat panel state
  const [isAIChatCollapsed, setIsAIChatCollapsed] = useState(false);
  const [aiChatWidth, setAIChatWidth] = useState<number>(350);

  // Track active tab for document context (AI needs to know current file)
  // Uses ref to avoid re-rendering EditorMode on every tab switch
  const activeTabForContextRef = useRef<TabData | null>(null);

  // Refs
  const getContentRef = useRef<(() => string) | null>(null);
  const handleSaveRef = useRef<(() => Promise<void>) | null>(null);
  const getNavigationStateRef = useRef<(() => any) | null>(null);
  const isInitializedRef = useRef<boolean>(false);
  const isResizingRef = useRef<boolean>(false);
  const chatSidebarRef = useRef<ChatSidebarRef>(null);
  const saveTabByIdRef = useRef<((tabId: string) => Promise<void>) | null>(null);

  // Get tab actions from context (doesn't subscribe to state - no re-renders)
  const tabsActions = useTabsActions();

  // Refs for imperative DOM updates - NO re-renders for tab visibility
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const welcomeContainerRef = useRef<HTMLDivElement>(null);

  // Subscribe to changes and update visibility imperatively - NO state, NO re-renders
  useEffect(() => {
    const updateVisibility = () => {
      const snapshot = tabsActions.getSnapshot();
      const hasActiveTab = snapshot.activeTabId !== null;
      if (tabsContainerRef.current) {
        tabsContainerRef.current.style.display = hasActiveTab ? 'flex' : 'none';
      }
      if (welcomeContainerRef.current) {
        welcomeContainerRef.current.style.display = hasActiveTab ? 'none' : 'flex';
      }
    };

    // Initial update
    updateVisibility();

    // Subscribe to future changes
    const unsubscribe = tabsActions.subscribe(updateVisibility);
    return unsubscribe;
  }, [tabsActions]);

  // Keep tabsRef updated with actions
  useEffect(() => {
    tabsRef.current = tabsActions;
  }, [tabsActions]);

  // Update window title and sync current file with backend when active tab changes
  // This is done imperatively to avoid re-renders in parent components
  useEffect(() => {
    const updateWindowTitleAndSync = () => {
      const snapshot = tabsActions.getSnapshot();
      const activeTab = snapshot.activeTabId ? snapshot.tabs.get(snapshot.activeTabId) : null;

      // Update window title
      if (window.electronAPI) {
        let title = 'Nimbalyst';
        if (workspaceName) {
          if (activeTab?.fileName) {
            title = `${activeTab.fileName} - ${workspaceName} - Nimbalyst`;
          } else {
            title = `${workspaceName} - Nimbalyst`;
          }
        } else if (activeTab?.fileName) {
          title = `${activeTab.fileName} - Nimbalyst`;
        }
        window.electronAPI.setTitle(title);

        // Sync current file with backend
        if (activeTab?.filePath) {
          window.electronAPI.setCurrentFile(activeTab.filePath);
        } else {
          window.electronAPI.setCurrentFile(null);
        }
      }

      // Expose to window for plugins
      if (typeof window !== 'undefined') {
        (window as any).currentFilePath = activeTab?.filePath || null;
        (window as any).__currentDocumentPath = activeTab?.filePath || null;
      }
    };

    // Initial update
    updateWindowTitleAndSync();

    // Subscribe to future changes
    const unsubscribe = tabsActions.subscribe(updateWindowTitleAndSync);
    return unsubscribe;
  }, [tabsActions, workspaceName]);

  // Keep activeTabForContextRef in sync with active tab (no re-render)
  useEffect(() => {
    const updateActiveTabForContext = () => {
      const snapshot = tabsActions.getSnapshot();
      const activeTab = snapshot.activeTabId ? snapshot.tabs.get(snapshot.activeTabId) : null;
      activeTabForContextRef.current = activeTab || null;
    };

    // Initial update
    updateActiveTabForContext();

    // Subscribe to future changes
    const unsubscribe = tabsActions.subscribe(updateActiveTabForContext);
    return unsubscribe;
  }, [tabsActions]);

  // Handle tab close with save for dirty tabs
  // CRITICAL: Use tabsRef.current to avoid stale closure bug
  const handleTabClose = useCallback(async (tabId: string) => {
    console.log('[EditorMode.handleTabClose] Closing tab:', tabId);
    const currentTabs = tabsRef.current;
    if (!currentTabs) {
      console.error('[EditorMode.handleTabClose] tabsRef.current is null!');
      return;
    }
    const tab = currentTabs.getTabState(tabId);
    if (!tab) {
      console.error('[EditorMode.handleTabClose] Tab not found:', tabId);
      return;
    }
    // Check dirty state from Jotai atom (the source of truth)
    const editorKey = makeEditorKey(tab.filePath);
    const isDirty = store.get(editorDirtyAtom(editorKey));
    // Save dirty tabs before closing to prevent data loss
    if (isDirty && saveTabByIdRef.current) {
      await saveTabByIdRef.current(tabId);
    }
    currentTabs.removeTab(tabId);
  }, []); // No dependencies - uses refs for all mutable state


  // Get current file info imperatively from tabsActions
  // Note: This doesn't subscribe to changes - TabContent will subscribe and pass data down
  const getCurrentFileInfo = useCallback(() => {
    const store = tabsActions.getSnapshot();
    if (!store.activeTabId) return { filePath: null, fileName: null };
    const activeTab = store.tabs.get(store.activeTabId);
    return {
      filePath: activeTab?.filePath || null,
      fileName: activeTab?.fileName || null
    };
  }, [tabsActions]);

  // For effects that need current file path, we read it imperatively
  const currentFileInfo = getCurrentFileInfo();
  const currentFilePath = currentFileInfo.filePath;
  const currentFileName = currentFileInfo.fileName;

  // Expose current document path and workspace path to window for image paste/rendering
  useEffect(() => {
    (window as any).__currentDocumentPath = currentFilePath;
    (window as any).workspacePath = workspacePath;
  }, [currentFilePath, workspacePath]);

  // Update MCP document state for custom editors (non-markdown files)
  // Markdown files update MCP state via useIPCHandlers when content changes,
  // but custom editors need to update when they become active
  useEffect(() => {
    if (!currentFilePath || !workspacePath) return;

    // Check if this is a custom editor file
    const lastDot = currentFilePath.lastIndexOf('.');
    if (lastDot <= 0) return;

    const ext = currentFilePath.substring(lastDot).toLowerCase();

    // Skip markdown files - they update MCP state via useIPCHandlers
    if (ext === '.md' || ext === '.markdown') return;

    // Check if it's a custom editor (either single or compound extension)
    const isCustom = customEditorRegistry.hasEditor(ext) ||
      (() => {
        const secondLastDot = currentFilePath.lastIndexOf('.', lastDot - 1);
        if (secondLastDot > 0) {
          const compoundExt = currentFilePath.substring(secondLastDot).toLowerCase();
          return customEditorRegistry.hasEditor(compoundExt);
        }
        return false;
      })();

    if (!isCustom) return;

    // Update MCP document state for custom editor
    if (window.electronAPI?.updateMcpDocumentState) {
      const docState = {
        content: '', // Custom editors don't use content-based MCP state
        filePath: currentFilePath,
        fileType: ext.substring(1), // Remove the dot
        workspacePath,
        cursorPosition: undefined,
        selection: undefined
      };
      window.electronAPI.updateMcpDocumentState(docState);
    }
  }, [currentFilePath, workspacePath]);

  // Build document context for AI features
  // Uses ref - context is computed on-demand, not on every tab switch
  // AIChat will read this when it needs it (e.g., when sending a message)
  const getDocumentContext = useCallback(() => {
    const activeTab = activeTabForContextRef.current;
    if (!activeTab) {
      return {
        filePath: '',
        fileType: 'unknown',
        content: '',
        cursorPosition: undefined,
        selection: undefined,
        getLatestContent: undefined,
        textSelection: undefined,
        textSelectionTimestamp: undefined
      };
    }

    const filePath = activeTab.filePath || '';
    const lowerPath = filePath.toLowerCase();
    let fileType = 'unknown';

    if (lowerPath.endsWith('.mockup.html')) {
      fileType = 'mockup';
    } else {
      const lastDot = lowerPath.lastIndexOf('.');
      if (lastDot !== -1) {
        const ext = lowerPath.substring(lastDot);
        switch (ext) {
          case '.md':
          case '.markdown':
            fileType = 'markdown';
            break;
          case '.json':
            fileType = 'json';
            break;
          case '.yaml':
          case '.yml':
            fileType = 'yaml';
            break;
          case '.js':
          case '.jsx':
          case '.ts':
          case '.tsx':
            fileType = 'javascript';
            break;
          case '.html':
            fileType = 'html';
            break;
          case '.css':
          case '.scss':
            fileType = 'css';
            break;
          case '.py':
            fileType = 'python';
            break;
          default:
            fileType = 'code';
        }
      }
    }

    return {
      filePath,
      fileType,
      content: getContentRef.current ? getContentRef.current() : '',
      cursorPosition: undefined,
      selection: undefined,
      getLatestContent: getContentRef.current || undefined,
      mockupSelection: fileType === 'mockup' ? (window as any).__mockupSelectedElement : undefined,
      mockupDrawing: fileType === 'mockup' ? (window as any).__mockupDrawing : undefined,
      mockupAnnotationTimestamp: fileType === 'mockup' ? (window as any).__mockupAnnotationTimestamp : undefined,
      textSelection: undefined,
      textSelectionTimestamp: undefined
    };
  }, []);

  // Initialize tab navigation
  // NOTE: useTabNavigation will be updated to use context internally
  const navigation = useTabNavigation({
    enabled: true,
    tabs: [], // TabManager now handles this
    activeTabId: null,
    switchTab: tabsActions.switchTab
  });

  // Handle opening a file via system dialog
  const handleOpen = useCallback(async () => {
    if (!window.electronAPI) return;

    try {
      const result = await window.electronAPI.openFile();
      if (result) {
        // Close any existing tabs first (single-file mode = one tab only)
        tabsActions.closeAllTabs();

        // Create a tab for the new file
        tabsActions.addTab(result.filePath, result.content);

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
              const latestSnapshot = snapshots[0];
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
    if (!window.electronAPI || !getContentRef.current) return;

    const content = getContentRef.current();

    try {
      const result = await window.electronAPI.saveFileAs(content);
      if (result) {
        isDirtyRef.current = false;

        // Update tab state - this will automatically update currentFilePath
        const store = tabsActions.getSnapshot();
        if (store.activeTabId) {
          tabsActions.updateTab(store.activeTabId, {
            filePath: result.filePath,
            fileName: getFileName(result.filePath),
            isDirty: false,
            lastSaved: new Date()
          });
        }
      }
    } catch (error) {
      console.error('Failed to save file as:', error);
    }
  }, [tabsActions]);

  // Handle workspace file selection
  // CRITICAL: Use tabsRef.current to avoid stale closure bug
  // The tabs object changes on every render, so capturing it in a useCallback
  // leads to stale data when the callback is invoked from refs or async contexts
  const handleWorkspaceFileSelect = useCallback(async (filePath: string) => {
    const currentTabs = tabsRef.current;
    if (!currentTabs) {
      console.error('[EditorMode.handleWorkspaceFileSelect] tabsRef.current is null!');
      return;
    }
    // Use currentFilePath from tabs to also avoid stale closure
    const activeFilePath = currentTabs.activeTab?.filePath || null;
    await handleWorkspaceFileSelectUtil({
      filePath,
      currentFilePath: activeFilePath,
      tabs: currentTabs,
      isInitializedRef
    });
  }, []); // No dependencies - uses refs for all mutable state

  // Handle opening session - switches to Agent Mode since ChatSidebar manages its own single session
  const handleOpenSessionInChat = useCallback(async (sessionId: string) => {
    console.log('[EditorMode] handleOpenSessionInChat called with sessionId:', sessionId);
    // Switch to agent mode to view the specific session
    if (onSwitchToAgentMode) {
      onSwitchToAgentMode(undefined, sessionId);
    }
  }, [onSwitchToAgentMode]);

  // Expose methods to parent via ref
  // CRITICAL: Use tabsRef.current inside closures to avoid stale closure bugs
  // The useImperativeHandle re-runs when tabs changes, but the methods it creates
  // can still be called with stale data if tabs changes between creation and invocation
  useImperativeHandle(ref, () => ({
    closeActiveTab: () => {
      const currentTabs = tabsRef.current;
      const snapshot = currentTabs?.getSnapshot();
      const tabIdToClose = snapshot?.activeTabId;
      console.log('[EditorMode.closeActiveTab] tabIdToClose:', tabIdToClose);
      if (!tabIdToClose) {
        console.log('[EditorMode.closeActiveTab] No activeTabId to close');
        return;
      }
      // Pass the captured tab ID to handleTabClose - this is idempotent
      // because handleTabClose will no-op if the tab doesn't exist
      handleTabClose(tabIdToClose);
    },
    reopenLastClosedTab: async () => {
      const currentTabs = tabsRef.current;
      if (currentTabs) {
        await currentTabs.reopenLastClosedTab(handleWorkspaceFileSelect);
      }
    },
    handleOpen,
    handleSaveAs,
    selectFile: handleWorkspaceFileSelect,
    openHistoryDialog: () => setIsHistoryDialogOpen(true),
    tabs: {
      addTab: (filePath: string, content?: string) => {
        const currentTabs = tabsRef.current;
        return currentTabs?.addTab(filePath, content) ?? undefined;
      },
      removeTab: handleTabClose,
      switchTab: (tabId: string) => {
        const currentTabs = tabsRef.current;
        currentTabs?.switchTab(tabId);
      },
      findTabByPath: (filePath: string) => {
        const currentTabs = tabsRef.current;
        return currentTabs?.findTabByPath(filePath);
      },
      nextTab: () => {
        const currentTabs = tabsRef.current;
        const snapshot = currentTabs?.getSnapshot();
        if (currentTabs && snapshot && snapshot.tabOrder.length > 1) {
          const currentIndex = snapshot.tabOrder.indexOf(snapshot.activeTabId!);
          // Don't wrap - if we're at the end, stay there
          if (currentIndex >= 0 && currentIndex < snapshot.tabOrder.length - 1) {
            const nextTabId = snapshot.tabOrder[currentIndex + 1];
            if (nextTabId) {
              currentTabs.switchTab(nextTabId);
            }
          }
        }
      },
      previousTab: () => {
        const currentTabs = tabsRef.current;
        const snapshot = currentTabs?.getSnapshot();
        if (currentTabs && snapshot && snapshot.tabOrder.length > 1) {
          const currentIndex = snapshot.tabOrder.indexOf(snapshot.activeTabId!);
          // Don't wrap - if we're at the beginning, stay there
          if (currentIndex > 0) {
            const prevTabId = snapshot.tabOrder[currentIndex - 1];
            if (prevTabId) {
              currentTabs.switchTab(prevTabId);
            }
          }
        }
      },
      // These getters read from the snapshot for current state
      get tabs() {
        const snapshot = tabsRef.current?.getSnapshot();
        if (!snapshot) return [];
        return snapshot.tabOrder.map((id: string) => snapshot.tabs.get(id)!).filter(Boolean);
      },
      get activeTabId() { return tabsRef.current?.getSnapshot()?.activeTabId ?? null; },
    }
  }), [handleOpen, handleSaveAs, handleWorkspaceFileSelect, handleTabClose]);

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
  }, [sidebarWidth, workspacePath]);

  // Load sidebar width from storage
  useEffect(() => {
    if (!workspacePath || !window.electronAPI?.getSidebarWidth) return;

    const loadSidebarWidth = async () => {
      try {
        const savedWidth = await window.electronAPI.getSidebarWidth(workspacePath);
        if (savedWidth && typeof savedWidth === 'number') {
          setSidebarWidth(savedWidth);
        }
      } catch (error) {
        console.error('Error loading sidebar width:', error);
      }
    };

    loadSidebarWidth();
  }, [workspacePath]);

  // Load extension file type contributions
  useEffect(() => {
    const loader = getExtensionLoader();

    const updateExtensionFileTypes = () => {
      const contributions = loader.getNewFileMenuContributions();
      const fileTypes = contributions.map(c => contributionToExtensionFileType(c.contribution));
      setExtensionFileTypes(fileTypes);
    };

    // Initial load
    updateExtensionFileTypes();

    // Subscribe to changes
    const unsubscribe = loader.subscribe(updateExtensionFileTypes);
    return unsubscribe;
  }, []);

  // Listen for file-new-in-workspace IPC event from menu (Cmd+N in files mode)
  useEffect(() => {
    if (!window.electronAPI?.onFileNewInWorkspace) return undefined;

    const cleanup = window.electronAPI.onFileNewInWorkspace(() => {
      // Set the target directory to the selected folder if one is selected
      if (selectedFolderPath) {
        setNewFileDirectory(selectedFolderPath);
      }
      setIsNewFileDialogOpen(true);
    });

    return cleanup;
  }, [selectedFolderPath]);

  // NOTE: view-history IPC event (Cmd+Y) is handled in App.tsx which gates it by active mode
  // and calls editorModeRef.openHistoryDialog()

  // Listen for view-workspace-history IPC event from menu (Cmd+Shift+H)
  useEffect(() => {
    if (!window.electronAPI?.onViewWorkspaceHistory) return undefined;

    const cleanup = window.electronAPI.onViewWorkspaceHistory(() => {
      // Open workspace history dialog for the entire workspace
      setWorkspaceHistoryPath(workspacePath);
      setIsWorkspaceHistoryDialogOpen(true);
    });

    return cleanup;
  }, [workspacePath]);

  // Listen for file-new-mockup IPC event from menu
  useEffect(() => {
    const handleNewMockup = async () => {
      if (!workspacePath || !window.electronAPI) return;

      try {
        // Create a default mockup file name
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const fileName = `mockup-${timestamp}.mockup.html`;
        const directory = selectedFolderPath || workspacePath;
        const filePath = `${directory}/${fileName}`;

        // Create basic mockup HTML content
        const content = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mockup</title>
    <style>
        body {
            margin: 0;
            padding: 20px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        h1 {
            color: #333;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>New Mockup</h1>
        <p>Edit this mockup using the AI chat or edit the HTML directly.</p>
    </div>
</body>
</html>`;

        await window.electronAPI.createFile(filePath, content);

        // Open the new mockup file
        await handleWorkspaceFileSelect(filePath);
      } catch (error) {
        console.error('Error creating new mockup:', error);
      }
    };

    if (window.electronAPI?.on) {
      const cleanup = window.electronAPI.on('file-new-mockup', handleNewMockup);
      return cleanup;
    }

    return undefined;
  }, [workspacePath, selectedFolderPath, handleWorkspaceFileSelect]);

  // Handle new file creation with file type support
  const handleNewFile = useCallback(async (fileName: string, fileType: NewFileType) => {
    if (!workspacePath || !window.electronAPI) return;

    try {
      const directory = newFileDirectory || workspacePath;

      // Determine full filename and content based on type
      let fullFileName: string;
      let content: string;

      if (fileType === 'markdown') {
        // Add .md extension if not present
        fullFileName = fileName.endsWith('.md') || fileName.endsWith('.markdown') ? fileName : `${fileName}.md`;
        content = createInitialFileContent(fullFileName);
      } else if (fileType === 'mockup') {
        // Add .mockup.html extension if not present
        fullFileName = fileName.endsWith('.mockup.html') ? fileName : `${fileName}.mockup.html`;
        content = createMockupContent();
      } else if (fileType?.startsWith('ext:')) {
        // Extension-provided file type
        const extName = fileType.slice(4); // Remove 'ext:' prefix
        const extType = extensionFileTypes.find(e => e.extension === extName);
        if (extType) {
          fullFileName = fileName.endsWith(extName) ? fileName : `${fileName}${extName}`;
          content = extType.defaultContent;
        } else {
          // Fallback
          fullFileName = fileName;
          content = '';
        }
      } else {
        // Any type - keep filename as-is
        fullFileName = fileName;
        content = createInitialFileContent(fullFileName);
      }

      const filePath = `${directory}/${fullFileName}`;
      await window.electronAPI.createFile(filePath, content);

      // Open the new file
      await handleWorkspaceFileSelect(filePath);

      setIsNewFileDialogOpen(false);
      setNewFileDirectory(null);
    } catch (error) {
      console.error('Error creating new file:', error);
    }
  }, [workspacePath, newFileDirectory, handleWorkspaceFileSelect, extensionFileTypes]);

  // Handle restoring content from history
  const handleRestoreFromHistory = useCallback(async (content: string) => {
    if (!currentFilePath) {
      return;
    }

    try {
      // Write restored content to disk
      await window.electronAPI.saveFile(content, currentFilePath);

      // Update tab state to reflect saved state
      const store = tabsActions.getSnapshot();
      if (store.activeTabId) {
        tabsActions.updateTab(store.activeTabId, {
          isDirty: false,
          lastSaved: new Date()
        });
      }
    } catch (error) {
      console.error('[EditorMode] Failed to restore content from history:', error);
    }

    // Close the history dialog
    setIsHistoryDialogOpen(false);
  }, [currentFilePath, tabsActions]);

  return (
    <>
      {/* Main content area */}
      <div className="editor-mode__content" style={{ flex: 1, display: 'flex', flexDirection: 'row', overflow: 'hidden', minWidth: 0 }}>
        {/* Left sidebar - file tree */}
        <div style={{ width: sidebarWidth, position: 'relative' }}>
          <WorkspaceSidebar
            workspaceName={workspaceName || ''}
            workspacePath={workspacePath}
            currentFilePath={currentFilePath}
            currentView="files"
            onFileSelect={handleWorkspaceFileSelect}
            onCloseWorkspace={onCloseWorkspace || (() => {})}
            onOpenQuickSearch={onOpenQuickSearch}
            onViewHistory={(filePath) => {
              setIsHistoryDialogOpen(true);
            }}
            onViewWorkspaceHistory={(folderPath) => {
              setWorkspaceHistoryPath(folderPath);
              setIsWorkspaceHistoryDialogOpen(true);
            }}
            onSelectedFolderChange={setSelectedFolderPath}
            currentAISessionId={null}
          />
        </div>

        {/* Resize handle */}
        <div
          onMouseDown={handleMouseDown}
          style={{
            width: '4px',
            cursor: 'col-resize',
            flexShrink: 0,
            position: 'relative',
            zIndex: 10
          }}
        >
          <div
            className="sidebar-resize-handle"
            style={{
              width: '3px',
              height: '100%',
              margin: '0 auto',
              transition: 'background-color 0.2s'
            }}
          />
        </div>

        {/* Center - editor tabs and content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          {/* Always render both - visibility controlled imperatively via refs */}
          <div
            ref={tabsContainerRef}
            className="file-tabs-container"
            style={{ flex: 1, display: 'none', flexDirection: 'column', overflow: 'hidden' }}
          >
            <TabManager
              onTabClose={handleTabClose}
              onNewTab={() => setIsNewFileDialogOpen(true)}
              onViewHistory={(tabId) => {
                const tab = tabsActions.getTabState(tabId);
                if (tab && tab.filePath) {
                  setIsHistoryDialogOpen(true);
                }
              }}
              hideTabBar={false}
              isActive={isActive}
              onToggleAIChat={() => setIsAIChatCollapsed(prev => !prev)}
              isAIChatCollapsed={isAIChatCollapsed}
            >
              <TabContent
                onManualSaveReady={(saveFn) => {
                  handleSaveRef.current = saveFn;
                }}
                onSaveTabByIdReady={(saveFn) => {
                  saveTabByIdRef.current = saveFn;
                }}
                onSaveComplete={(filePath) => {
                  isDirtyRef.current = false;

                  const store = tabsActions.getSnapshot();
                  if (store.activeTabId) {
                    tabsActions.updateTab(store.activeTabId, {
                      isDirty: false,
                      lastSaved: new Date()
                    });
                  }
                }}
                onGetContentReady={(tabId, getContentFn) => {
                  const store = tabsActions.getSnapshot();
                  if (tabId === store.activeTabId) {
                    getContentRef.current = getContentFn;
                    aiToolService.setGetContentFunction(getContentFn);
                    if (onGetContentReady) {
                      onGetContentReady(getContentFn);
                    }
                  }
                }}
                onViewHistory={() => {
                  setIsHistoryDialogOpen(true);
                }}
                onRenameDocument={() => {
                  console.log('Rename document requested');
                }}
                onSwitchToAgentMode={onSwitchToAgentMode}
                onOpenSessionInChat={handleOpenSessionInChat}
                onTabClose={handleTabClose}
                workspaceId={workspacePath}
              />
            </TabManager>
          </div>
          <div
            ref={welcomeContainerRef}
            style={{ display: 'flex', flex: 1 }}
          >
            <WorkspaceWelcome workspaceName={workspaceName || 'Open a file to get started'} />
          </div>
        </div>

        {/* Right sidebar - AI Chat */}
        {workspacePath && (
          <ChatSidebar
            ref={chatSidebarRef}
            workspacePath={workspacePath}
            isCollapsed={isAIChatCollapsed}
            onToggleCollapse={() => setIsAIChatCollapsed(prev => !prev)}
            width={aiChatWidth}
            onWidthChange={setAIChatWidth}
            getDocumentContext={getDocumentContext}
            onFileOpen={handleWorkspaceFileSelect}
            onSwitchToAgentMode={onSwitchToAgentMode ? () => onSwitchToAgentMode() : undefined}
          />
        )}
      </div>

      {/* Dialogs */}
      {isNewFileDialogOpen && (
        <NewFileDialog
          isOpen={isNewFileDialogOpen}
          onClose={() => {
            setIsNewFileDialogOpen(false);
            setNewFileDirectory(null);
          }}
          currentDirectory={newFileDirectory || workspacePath}
          workspacePath={workspacePath}
          onCreateFile={handleNewFile}
          extensionFileTypes={extensionFileTypes}
          onDirectoryChange={setNewFileDirectory}
        />
      )}

      {isHistoryDialogOpen && currentFilePath && (
        <HistoryDialog
          isOpen={isHistoryDialogOpen}
          onClose={() => setIsHistoryDialogOpen(false)}
          filePath={currentFilePath}
          onRestore={handleRestoreFromHistory}
          theme={theme === 'auto' ? 'dark' : theme}
          workspacePath={workspacePath}
          onOpenSessionInChat={handleOpenSessionInChat}
        />
      )}

      {isWorkspaceHistoryDialogOpen && workspaceHistoryPath && (
        <WorkspaceHistoryDialog
          isOpen={isWorkspaceHistoryDialogOpen}
          onClose={() => {
            setIsWorkspaceHistoryDialogOpen(false);
            setWorkspaceHistoryPath(null);
          }}
          workspacePath={workspaceHistoryPath}
          theme={theme === 'auto' ? 'dark' : theme}
        />
      )}
    </>
  );
});

export default EditorMode;
