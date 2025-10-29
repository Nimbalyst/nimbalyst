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
}

export interface EditorModeProps {
  workspacePath: string;
  workspaceName: string | null;
  theme: ConfigTheme;
  isActive: boolean;
  onModeChange?: (mode: string) => void;
  onCurrentFileChange?: (filePath: string | null, fileName: string | null, isDirty: boolean) => void;
  onCloseWorkspace?: () => void;
}

const EditorMode = forwardRef<EditorModeRef, EditorModeProps>(function EditorMode({
  workspacePath,
  workspaceName,
  theme,
  isActive,
  onModeChange,
  onCurrentFileChange,
  onCloseWorkspace
}, ref) {
  // File tree state
  const [fileTree, setFileTree] = useState<FileTreeItem[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState<number>(250);

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

        // Update main process
        if (window.electronAPI) {
          window.electronAPI.setCurrentFile(tab.filePath);
        }
      }
    },
    onTabClose: (tab) => {
      // EditorContainer handles save-on-close
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

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    closeActiveTab: () => {
      if (tabs.activeTabId) {
        tabs.removeTab(tabs.activeTabId);
      }
    }
  }), [tabs]);

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

    // Listen for file tree updates
    if (window.electronAPI?.on) {
      const handleFileTreeUpdate = (newTree: FileTreeItem[]) => {
        setFileTree(newTree);
      };

      window.electronAPI.on('file-tree-updated', handleFileTreeUpdate);

      return () => {
        window.electronAPI?.off?.('file-tree-updated', handleFileTreeUpdate);
      };
    }

    return undefined;
  }, [workspacePath]);

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
            onOpenQuickSearch={() => {
              // TODO: Wire up quick search if needed
            }}
            onRefreshFileTree={handleRefreshFileTree}
            onViewHistory={(filePath) => {
              setIsHistoryDialogOpen(true);
            }}
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
        />
      )}
    </>
  );
});

export default EditorMode;
