import React, { useCallback, useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import type { ConfigTheme } from 'rexical';
import { useTabs } from '../../hooks/useTabs';
import { useTabNavigation } from '../../hooks/useTabNavigation';
import { useDocumentContext } from '../../hooks/useDocumentContext';
import { handleWorkspaceFileSelect as handleWorkspaceFileSelectUtil } from '../../utils/workspaceFileOperations';
import { createInitialFileContent } from '../../utils/fileUtils';
import { aiToolService } from '../../services/AIToolService';
import { editorRegistry } from '@nimbalyst/runtime/ai/EditorRegistry';
import { WorkspaceSidebar } from '../WorkspaceSidebar';
import { WorkspaceWelcome } from '../WorkspaceWelcome';
import { TabManager } from '../TabManager/TabManager';
import { TabContent } from '../TabContent/TabContent';
import { AIChat } from '../AIChat';
import { NewFileDialog } from '../NewFileDialog';
import { HistoryDialog } from '../HistoryDialog';

export interface EditorModeRef {
  closeActiveTab: () => void;
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
  onCurrentFileChange?: (filePath: string | null, fileName: string | null, isDirty: boolean) => void;
  onGetContentReady?: (getContentFn: (() => string) | null) => void;
  onCloseWorkspace?: () => void;
  onOpenQuickSearch?: () => void;
}

const EditorMode = forwardRef<EditorModeRef, EditorModeProps>(function EditorMode({
  workspacePath,
  workspaceName,
  theme,
  isActive,
  onModeChange,
  onCurrentFileChange,
  onGetContentReady,
  onCloseWorkspace,
  onOpenQuickSearch
}, ref) {
  // File tree state
  const [fileTree, setFileTree] = useState<FileTreeItem[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState<number>(250);
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(null);

  // Current file state
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
  const [currentFileName, setCurrentFileName] = useState<string | null>(null);
  const isDirtyRef = useRef(false);
  const [isDirty, setIsDirty] = useState(false);

  // Tab states tracking
  const tabStatesRef = useRef<Map<string, { isDirty: boolean }>>(new Map());
  const tabsRef = useRef<any>(null);

  // Dialog states
  const [isNewFileDialogOpen, setIsNewFileDialogOpen] = useState(false);
  const [newFileDirectory, setNewFileDirectory] = useState<string | null>(null);
  const [isHistoryDialogOpen, setIsHistoryDialogOpen] = useState(false);

  // AI Chat panel state
  const [isAIChatCollapsed, setIsAIChatCollapsed] = useState(false);
  const [aiChatWidth, setAIChatWidth] = useState<number>(350);
  const [isAIChatStateLoaded, setIsAIChatStateLoaded] = useState(false);
  const [currentAISessionId, setCurrentAISessionId] = useState<string | null>(null);

  // Refs
  const getContentRef = useRef<(() => string) | null>(null);
  const handleSaveRef = useRef<(() => Promise<void>) | null>(null);
  const getNavigationStateRef = useRef<(() => any) | null>(null);
  const isInitializedRef = useRef<boolean>(false);
  const isResizingRef = useRef<boolean>(false);

  // Initialize tabs
  const tabs = useTabs({
    maxTabs: Infinity,
    enabled: true,
    workspacePath,
    getNavigationState: () => getNavigationStateRef.current?.(),
    onTabChange: async (tab) => {
      if (tab.filePath) {
        setCurrentFilePath(tab.filePath);
        setCurrentFileName(tab.fileName);
        setIsDirty(tab.isDirty || false);

        // Notify parent of file change
        if (onCurrentFileChange) {
          onCurrentFileChange(tab.filePath, tab.fileName, tab.isDirty || false);
        }
      }
    },
    onTabClose: (tab) => {
      // Clear currentFilePath if closing the currently active file
      // onTabChange will update it if switching to another tab
      if (tab.filePath === currentFilePath) {
        setCurrentFilePath(null);
        setCurrentFileName(null);
        setIsDirty(false);

        if (onCurrentFileChange) {
          onCurrentFileChange(null, null, false);
        }
      }
    }
  });

  // Keep tabsRef updated
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  // Build document context for AI features
  const documentContext = useDocumentContext({
    activeTab: tabs.activeTab,
    getContentRef
  });

  // Initialize tab navigation
  const navigation = useTabNavigation({
    enabled: true,
    tabs: tabs.tabs,
    activeTabId: tabs.activeTabId,
    switchTab: tabs.switchTab
  });

  // Handle opening a file via system dialog
  const handleOpen = useCallback(async () => {
    if (!window.electronAPI) return;

    try {
      const result = await window.electronAPI.openFile();
      if (result) {
        // Close any existing tabs first (single-file mode = one tab only)
        tabs.closeAllTabs();

        // Create a tab for the new file
        tabs.addTab(result.filePath, result.content);

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
  }, [tabs]);

  // Handle save as
  const handleSaveAs = useCallback(async () => {
    if (!window.electronAPI || !getContentRef.current) return;

    const content = getContentRef.current();

    try {
      const result = await window.electronAPI.saveFileAs(content);
      if (result) {
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

        // Notify parent of file change
        if (onCurrentFileChange) {
          onCurrentFileChange(result.filePath, result.filePath.split('/').pop() || result.filePath, false);
        }
      }
    } catch (error) {
      console.error('Failed to save file as:', error);
    }
  }, [tabs, onCurrentFileChange]);

  // Handle workspace file selection
  const handleWorkspaceFileSelect = useCallback(async (filePath: string) => {
    await handleWorkspaceFileSelectUtil({
      filePath,
      currentFilePath,
      tabs,
      isInitializedRef,
      setCurrentFilePath,
      setCurrentFileName
    });
  }, [currentFilePath, tabs]);

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    closeActiveTab: () => {
      if (tabs.activeTabId) {
        tabs.removeTab(tabs.activeTabId);
      }
    },
    handleOpen,
    handleSaveAs,
    selectFile: handleWorkspaceFileSelect,
    openHistoryDialog: () => setIsHistoryDialogOpen(true),
    tabs: {
      addTab: tabs.addTab,
      removeTab: tabs.removeTab,
      switchTab: tabs.switchTab,
      findTabByPath: tabs.findTabByPath,
      nextTab: () => {
        if (tabs.tabs.length > 1) {
          const currentIndex = tabs.tabs.findIndex(tab => tab.id === tabs.activeTabId);
          const nextIndex = (currentIndex + 1) % tabs.tabs.length;
          const nextTab = tabs.tabs[nextIndex];
          if (nextTab) {
            tabs.switchTab(nextTab.id);
          }
        }
      },
      previousTab: () => {
        if (tabs.tabs.length > 1) {
          const currentIndex = tabs.tabs.findIndex(tab => tab.id === tabs.activeTabId);
          const prevIndex = currentIndex <= 0 ? tabs.tabs.length - 1 : currentIndex - 1;
          const prevTab = tabs.tabs[prevIndex];
          if (prevTab) {
            tabs.switchTab(prevTab.id);
          }
        }
      },
      tabs: tabs.tabs,
      activeTabId: tabs.activeTabId,
    }
  }), [tabs, handleOpen, handleSaveAs, handleWorkspaceFileSelect]);

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

  // Load file tree
  useEffect(() => {
    if (!workspacePath || !window.electronAPI?.getFolderContents) return undefined;

    const loadFileTree = async () => {
      try {
        const tree = await window.electronAPI.getFolderContents(workspacePath);
        setFileTree(tree);
      } catch (error) {
        console.error('Error loading file tree:', error);
      }
    };

    loadFileTree();

    // Listen for file tree updates via the proper IPC handler
    if (window.electronAPI?.onWorkspaceFileTreeUpdated) {
      const cleanup = window.electronAPI.onWorkspaceFileTreeUpdated((data) => {
        setFileTree(data.fileTree);
      });

      return cleanup;
    }

    return undefined;
  }, [workspacePath]);

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

  // Handle new file creation
  const handleNewFile = useCallback(async (fileName: string) => {
    if (!workspacePath || !window.electronAPI) return;

    try {
      const directory = newFileDirectory || workspacePath;
      const filePath = `${directory}/${fileName}`;
      const content = createInitialFileContent(fileName);

      await window.electronAPI.createFile(filePath, content);

      // Open the new file
      await handleWorkspaceFileSelect(filePath);

      setIsNewFileDialogOpen(false);
      setNewFileDirectory(null);
    } catch (error) {
      console.error('Error creating new file:', error);
    }
  }, [workspacePath, newFileDirectory, handleWorkspaceFileSelect]);

  // Handle file tree refresh
  const handleRefreshFileTree = useCallback(async () => {
    if (workspacePath && window.electronAPI?.getFolderContents) {
      try {
        const tree = await window.electronAPI.getFolderContents(workspacePath);
        setFileTree(tree);
      } catch (error) {
        console.error('Error refreshing file tree:', error);
      }
    }
  }, [workspacePath]);

  // Handle restoring content from history
  const handleRestoreFromHistory = useCallback(async (content: string) => {
    if (!currentFilePath) {
      return;
    }

    try {
      // Write restored content to disk
      await window.electronAPI.saveFile(content, currentFilePath);

      // Update tab state to reflect saved state
      if (tabs.activeTabId) {
        tabs.updateTab(tabs.activeTabId, {
          isDirty: false,
          lastSaved: new Date()
        });
      }
    } catch (error) {
      console.error('[EditorMode] Failed to restore content from history:', error);
    }

    // Close the history dialog
    setIsHistoryDialogOpen(false);
  }, [currentFilePath, tabs]);

  return (
    <>
      {/* Main content area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row', overflow: 'hidden', minWidth: 0 }}>
        {/* Left sidebar - file tree */}
        <div style={{ width: sidebarWidth, position: 'relative' }}>
          <WorkspaceSidebar
            workspaceName={workspaceName || ''}
            workspacePath={workspacePath}
            fileTree={fileTree}
            currentFilePath={currentFilePath}
            currentView="files"
            onFileSelect={handleWorkspaceFileSelect}
            onCloseWorkspace={onCloseWorkspace || (() => {})}
            onOpenQuickSearch={onOpenQuickSearch}
            onRefreshFileTree={handleRefreshFileTree}
            onViewHistory={(filePath) => {
              setIsHistoryDialogOpen(true);
            }}
            onSelectedFolderChange={setSelectedFolderPath}
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
          {tabs.activeTab ? (
            <div className="file-tabs-container" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <TabManager
                tabs={tabs.tabs}
                activeTabId={tabs.activeTabId}
                onTabSelect={tabs.switchTab}
                onTabClose={tabs.removeTab}
                onNewTab={() => setIsNewFileDialogOpen(true)}
                onTogglePin={tabs.togglePin}
                onTabReorder={tabs.reorderTabs}
                onViewHistory={(tabId) => {
                  const tab = tabs.getTabState(tabId);
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
                      // Notify parent so App.tsx can update its getContentRef
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
              </TabManager>
            </div>
          ) : (
            <WorkspaceWelcome workspaceName={workspaceName || 'Open a file to get started'} />
          )}
        </div>

        {/* Right sidebar - AI Chat */}
        {workspacePath && (
          <AIChat
            isCollapsed={isAIChatCollapsed}
            onToggleCollapse={() => setIsAIChatCollapsed(prev => !prev)}
            width={aiChatWidth}
            onWidthChange={setAIChatWidth}
            planningModeEnabled={true} // Default ON
            onTogglePlanningMode={() => {}} // TODO: wire up if needed
            workspacePath={workspacePath}
            sessionToLoad={null}
            onSessionLoaded={() => {}}
            onSessionIdChange={setCurrentAISessionId}
            onShowApiKeyError={() => {}}
            documentContext={documentContext}
            onContentModeChange={onModeChange}
            onApplyEdit={(edit, prompt, aiResponse) => {
              console.log('Edit already applied by AIChat component, updating UI state');
            }}
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
        />
      )}

      {isHistoryDialogOpen && currentFilePath && (
        <HistoryDialog
          isOpen={isHistoryDialogOpen}
          onClose={() => setIsHistoryDialogOpen(false)}
          filePath={currentFilePath}
          onRestore={handleRestoreFromHistory}
        />
      )}
    </>
  );
});

export default EditorMode;
