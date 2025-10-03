import { useEffect, useRef } from 'react';
import type { LexicalCommand, TextReplacement } from 'rexical';
import {
  APPROVE_DIFF_COMMAND,
  REJECT_DIFF_COMMAND,
  parseFrontmatter,
  serializeWithFrontmatter,
  type FrontmatterData,
} from 'rexical';
import { editorRegistry } from '@stravu/runtime/ai/EditorRegistry';
import { getEditorPool } from '../services/EditorPool';

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

interface UseIPCHandlersProps {
  // Handlers passed in from parent
  handleNew: () => void;
  handleOpen: () => Promise<void>;
  handleSave: () => Promise<void>;
  handleSaveAs: () => Promise<void>;
  handleWorkspaceFileSelect: (filePath: string) => Promise<void>;
  openWelcomeTab: () => Promise<void>;
  openPlansTab: () => Promise<void>;

  // State setters
  setIsApiKeyDialogOpen: (open: boolean) => void;
  setWorkspaceMode: (mode: boolean) => void;
  setWorkspacePath: (path: string | null) => void;
  setWorkspaceName: (name: string | null) => void;
  setFileTree: (tree: FileTreeItem[]) => void;
  setCurrentDirectory: (dir: string | null) => void;
  setCurrentFilePath: (path: string | null) => void;
  setCurrentFileName: (name: string | null) => void;
  setIsDirty: (dirty: boolean) => void;
  // NOTE: setContentVersion removed - EditorContainer doesn't need version bumping
  setIsNewFileDialogOpen: (open: boolean) => void;
  setIsAIChatCollapsed: (collapsed: boolean) => void;
  setAIChatWidth: (width: number) => void;
  setIsAIChatStateLoaded: (loaded: boolean) => void;
  setSessionToLoad: (session: { sessionId: string; workspacePath?: string } | null) => void;
  setIsHistoryDialogOpen: (open: boolean) => void;
  setIsAgentPaletteVisible: (visible: boolean) => void;
  setTheme: (theme: any) => void;

  // Refs
  // NOTE: initialContentRef removed - EditorPool tracks initialContent per-file
  isInitializedRef: React.MutableRefObject<boolean>;
  isDirtyRef: React.MutableRefObject<boolean>;
  // NOTE: contentVersionRef removed - EditorContainer doesn't need version bumping
  getContentRef: React.MutableRefObject<(() => string) | null>;
  editorRef: React.MutableRefObject<any>;
  searchCommandRef: React.MutableRefObject<LexicalCommand<undefined> | null>;

  // State values
  currentFilePath: string | null;
  currentDirectory: string | null;
  workspaceMode: boolean;
  workspacePath: string | null;
  sessionToLoad: { sessionId: string; workspacePath?: string } | null;
  isDirty: boolean;

  // Tabs object
  tabs: any;

  // Logging configuration
  LOG_CONFIG: {
    IPC_LISTENERS: boolean;
    WORKSPACE_OPS: boolean;
    FILE_OPS: boolean;
    FILE_WATCH: boolean;
    THEME: boolean;
  };
}

/**
 * Hook to set up all IPC handlers and listeners for communication with the main process.
 * This is a large effect that registers many event handlers for file operations, workspace management,
 * AI features, MCP server communication, and more.
 */
export function useIPCHandlers(props: UseIPCHandlersProps) {
  const {
    // Handlers
    handleNew,
    handleOpen,
    handleSave,
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
    // NOTE: setContentVersion removed - not needed for EditorContainer
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
    // NOTE: contentVersionRef removed - not needed for EditorContainer
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
    LOG_CONFIG
  } = props;

  // Create refs for all handlers and state to avoid re-registering IPC handlers
  const handlersRef = useRef({
    handleNew,
    handleOpen,
    handleSave,
    handleSaveAs,
    handleWorkspaceFileSelect,
    openWelcomeTab,
    openPlansTab,
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
    tabs,  // Add tabs so IPC handlers can create/modify tabs
  });

  const stateRef = useRef({
    currentFilePath,
    currentDirectory,
    workspaceMode,
    workspacePath,
    sessionToLoad,
    isDirty,
    tabs,
  });

  // Update refs whenever values change
  handlersRef.current = {
    handleNew,
    handleOpen,
    handleSave,
    handleSaveAs,
    handleWorkspaceFileSelect,
    openWelcomeTab,
    openPlansTab,
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
    tabs,  // Keep tabs updated in ref
  };

  stateRef.current = {
    currentFilePath,
    currentDirectory,
    workspaceMode,
    workspacePath,
    sessionToLoad,
    isDirty,
    tabs,
  };

  useEffect(() => {
    if (!window.electronAPI) {
      return;
    }

    // Check for first launch (no API key configured)
    const checkFirstLaunch = async () => {
      try {
        const hasApiKey = await window.electronAPI.aiHasApiKey();
        if (!hasApiKey) {
          // Show API key dialog on first launch
          handlersRef.current.setIsApiKeyDialogOpen(true);
        }
      } catch (error) {
        console.error('Failed to check for API key:', error);
      }
    };

    // Only check on initial mount (when currentFilePath is null)
    if (!stateRef.current.currentFilePath && !stateRef.current.sessionToLoad) {
      checkFirstLaunch();
    }

    // Set up listeners and store cleanup functions
    const cleanupFns: Array<() => void> = [];

    cleanupFns.push(window.electronAPI.onFileNew(handlersRef.current.handleNew));

    // Handle new file in workspace mode
    if (window.electronAPI.onFileNewInWorkspace) {
      cleanupFns.push(window.electronAPI.onFileNewInWorkspace(() => {
        if (stateRef.current.workspaceMode) {
          // Use current directory or workspace root
          if (!stateRef.current.currentDirectory && stateRef.current.workspacePath) {
            handlersRef.current.setCurrentDirectory(stateRef.current.workspacePath);
          }
          handlersRef.current.setIsNewFileDialogOpen(true);
        }
      }));
    }
    cleanupFns.push(window.electronAPI.onFileOpen(handlersRef.current.handleOpen));
    cleanupFns.push(window.electronAPI.onFileSave(handlersRef.current.handleSave));
    cleanupFns.push(window.electronAPI.onFileSaveAs(handlersRef.current.handleSaveAs));
    cleanupFns.push(window.electronAPI.onWorkspaceOpened(async (data) => {
      if (LOG_CONFIG.WORKSPACE_OPS) console.log('[WORKSPACE] Workspace opened:', data);
      handlersRef.current.setWorkspaceMode(true);
      handlersRef.current.setWorkspacePath(data.workspacePath);
      handlersRef.current.setWorkspaceName(data.workspaceName);
      handlersRef.current.setFileTree(data.fileTree);
      // Set current directory to workspace root
      handlersRef.current.setCurrentDirectory(data.workspacePath);
      // Clear current document (EditorContainer manages content now)
      handlersRef.current.setCurrentFilePath(null);
      handlersRef.current.setCurrentFileName(null);
      isDirtyRef.current = false;
      handlersRef.current.setIsDirty(false);
      // NOTE: contentVersion removed - EditorContainer handles remounting via destroy/create
      isInitializedRef.current = false;

      // Restore AI Chat state when opening a workspace
      try {
        const aiChatState = await window.electronAPI.getAIChatState(data.workspacePath);
        console.log('Restoring AI Chat state for workspace:', aiChatState);
        if (aiChatState) {
          handlersRef.current.setIsAIChatCollapsed(aiChatState.collapsed);
          handlersRef.current.setAIChatWidth(aiChatState.width);
          if (aiChatState.currentSessionId) {
            handlersRef.current.setSessionToLoad({ sessionId: aiChatState.currentSessionId, workspacePath: data.workspacePath });
          }
        }
        handlersRef.current.setIsAIChatStateLoaded(true);
      } catch (error) {
        console.error('Failed to restore AI Chat state:', error);
        handlersRef.current.setIsAIChatStateLoaded(true);
      }

      // Open welcome tab if no tabs are open
      if (stateRef.current.tabs && stateRef.current.tabs.tabs.length === 0) {
        console.log('[WORKSPACE] No tabs open, opening welcome tab');
        // Delay slightly to ensure workspace state is fully set
        setTimeout(() => handlersRef.current.openWelcomeTab(), 100);
      }
    }));

    // Handle opening a specific file in a workspace (used when restoring workspace state)
    if (window.electronAPI.onOpenWorkspaceFile) {
      cleanupFns.push(window.electronAPI.onOpenWorkspaceFile(async (filePath) => {
        console.log('Opening workspace file from saved state:', filePath);
        // Use the existing file selection handler
        await handlersRef.current.handleWorkspaceFileSelect(filePath);
      }));
    }

    if (window.electronAPI.onOpenDocument) {
      cleanupFns.push(window.electronAPI.onOpenDocument(async ({ path }) => {
        console.log('[DOCUMENT_LINK] Renderer received open-document for path:', path);
        try {
          await handlersRef.current.handleWorkspaceFileSelect(path);
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
      console.log('[FILE_OPS] ✓✓✓ File opened from OS event received:', data.filePath);
      // NOTE: contentVersion removed - EditorContainer handles remounting via destroy/create
      isInitializedRef.current = false;
      handlersRef.current.setCurrentFilePath(data.filePath);
      handlersRef.current.setCurrentFileName(data.filePath.split('/').pop() || data.filePath);
      isDirtyRef.current = false;
      handlersRef.current.setIsDirty(false);
      // NOTE: initialContentRef removed - EditorPool tracks this per-file

      // Add tab for the opened file (works for both single-file and workspace modes)
      console.log('[FILE_OPS] Checking tabs object:', !!handlersRef.current.tabs);
      if (handlersRef.current.tabs) {
        console.log('[FILE_OPS] Adding tab for file opened from OS:', data.filePath);

        // Create EditorPool instance BEFORE creating tab
        // EditorContainer expects the instance to exist
        const editorPool = getEditorPool();

        if (!editorPool.has(data.filePath)) {
          console.log('[FILE_OPS] Creating EditorPool instance for:', data.filePath);
          editorPool.create(data.filePath, data.content);
        }

        const tabId = handlersRef.current.tabs.addTab(data.filePath, data.content);
        console.log('[FILE_OPS] addTab returned:', tabId);
        if (tabId) {
          console.log('[FILE_OPS] Tab added with ID:', tabId);
        } else {
          console.warn('[FILE_OPS] Failed to add tab - max tabs reached or addTab returned falsy');
        }
      } else {
        console.error('[FILE_OPS] tabs object not available in handlersRef!');
      }

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
      console.log('Received new-untitled-document event:', data.untitledName);
      handlersRef.current.setCurrentFilePath(null);
      handlersRef.current.setCurrentFileName(data.untitledName);
      // setIsDirty(true); // New documents start as dirty
      // NOTE: initialContentRef removed - EditorPool tracks this per-file
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
      console.log('[FILE_DELETED] File deleted event received:', data.filePath);
      // console.log('[FILE_DELETED] Tabs object:', stateRef.current.tabs);

      // Find and close the tab for this file
      if (stateRef.current.tabs) {
        const tabToClose = stateRef.current.tabs.findTabByPath(data.filePath);
        // console.log('[FILE_DELETED] Tab to close:', tabToClose);
        if (tabToClose) {
          // console.log('[FILE_DELETED] Closing tab for deleted file:', data.filePath, 'tab id:', tabToClose.id);

          // Show notification that file was deleted
          const fileName = data.filePath.split('/').pop() || data.filePath;
          alert(`The file "${fileName}" has been deleted from disk.`);

          // If this is the active tab, we need to immediately clear state to prevent autosave
          if (stateRef.current.tabs.activeTabId === tabToClose.id) {
            // console.log('[FILE_DELETED] This is the active tab, clearing file path immediately');
            // Clear the file path immediately to prevent autosave from recreating the file
            handlersRef.current.setCurrentFilePath(null);
            isDirtyRef.current = false;
            handlersRef.current.setIsDirty(false);
          }

          stateRef.current.tabs.removeTab(tabToClose.id);
          // console.log('[FILE_DELETED] Tab removed');
        } else {
          // console.log('[FILE_DELETED] No tab found for path:', data.filePath);
        }
      } else if (stateRef.current.currentFilePath === data.filePath) {
        // console.log('[FILE_DELETED] Single-file mode, current file deleted');
        // In single-file mode, current file was deleted, mark as dirty and clear the file path
        handlersRef.current.setCurrentFilePath(null);
        isDirtyRef.current = true;
        handlersRef.current.setIsDirty(true);
        // Optionally show a notification to the user
        alert('The file has been deleted from disk.');
      }
    }));

    // Handle file changes on disk
    // NOTE: EditorContainer now handles file watching for ALL open tabs (active and background)
    // with per-file lastSaveTime tracking. This legacy handler has been disabled to avoid
    // duplicate updates and excessive re-renders.
    //
    // Keeping the code here temporarily for reference.
    if (false && window.electronAPI.onFileChangedOnDisk) {
      cleanupFns.push(window.electronAPI.onFileChangedOnDisk(async (data) => {
        console.log('[FILE_WATCH] File changed on disk event received:', data.path);

        // Check if we should reload - tabs are always enabled now
        let shouldReload = false;
        let fileToCheck = stateRef.current.currentFilePath;

        if (stateRef.current.tabs && stateRef.current.tabs.activeTab) {
          // Check if it's the active tab's file
          fileToCheck = stateRef.current.tabs.activeTab.filePath;
          shouldReload = (fileToCheck === data.path);
          console.log('[FILE_WATCH] Active tab check:', {
            activeTabPath: fileToCheck,
            changedPath: data.path,
            shouldReload
          });
        } else {
          // Fallback: check against current file
          shouldReload = (stateRef.current.currentFilePath === data.path);
          console.log('[FILE_WATCH] Current file check:', {
            currentPath: stateRef.current.currentFilePath,
            changedPath: data.path,
            shouldReload
          });
        }

        if (shouldReload) {
          // NOTE: EditorContainer now handles file watching with per-file lastSaveTime tracking
          // This legacy handler is still here but should be removed in future cleanup

          // The current file was changed on disk
          try {
            // Read the file content without touching the watcher
            const result = window.electronAPI.readFileContent
              ? await window.electronAPI.readFileContent(data.path)
              : await window.electronAPI.switchWorkspaceFile(data.path);
            if (result && result.content !== undefined) {
              // Get current content from the editor
              const currentContent = getContentRef.current ? getContentRef.current() : '';

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
              // Check EditorPool for actual dirty state (more reliable than isDirtyRef)
              const editorPool = getEditorPool();
              const instance = editorPool.get(data.path);
              const isFileDirty = instance?.isDirty ?? false;

              if (!isFileDirty) {
                // File is not dirty, reload it automatically
                console.log('[FILE_WATCH] File is not dirty, reloading from disk');
                console.log('[FILE_WATCH] Loading content for path:', data.path, 'first 100 chars:', result.content.substring(0, 100));

                // Update EditorPool instance with new content and increment reload version
                if (editorPool.has(data.path)) {
                  const currentVersion = instance?.reloadVersion ?? 0;
                  console.log('[FILE_WATCH] Incrementing reloadVersion for:', data.path, 'from', currentVersion, 'to', currentVersion + 1);
                  editorPool.update(data.path, {
                    content: result.content,
                    initialContent: result.content,
                    isDirty: false,
                    reloadVersion: currentVersion + 1
                  });
                }

                // Reset the getContentRef since editor will remount
                getContentRef.current = null;
                // Ensure editor is not marked as dirty
                isDirtyRef.current = false;
                handlersRef.current.setIsDirty(false);
                // IMPORTANT: Update the tab's content so it doesn't reload and restart the watcher
                if (stateRef.current.tabs.activeTab && stateRef.current.tabs.activeTab.filePath === data.path) {
                  stateRef.current.tabs.updateTab(stateRef.current.tabs.activeTab.id, { content: result.content });
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
                  console.log('[FILE_WATCH] User chose to reload from disk, updating EditorPool');

                  // Update EditorPool instance with new content and increment reload version
                  const editorPool = getEditorPool();
                  if (editorPool.has(data.path)) {
                    const instance = editorPool.get(data.path);
                    const currentVersion = instance?.reloadVersion ?? 0;
                    console.log('[FILE_WATCH] Incrementing reloadVersion for:', data.path, 'from', currentVersion, 'to', currentVersion + 1);
                    editorPool.update(data.path, {
                      content: result.content,
                      initialContent: result.content,
                      isDirty: false,
                      reloadVersion: currentVersion + 1
                    });
                  }

                  // Reset the getContentRef since editor will remount
                  getContentRef.current = null;
                  isDirtyRef.current = false;
                  handlersRef.current.setIsDirty(false);

                  // Update the tab's content
                  if (stateRef.current.tabs.activeTab && stateRef.current.tabs.activeTab.filePath === data.path) {
                    stateRef.current.tabs.updateTab(stateRef.current.tabs.activeTab.id, { content: result.content });
                  }
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
      if (stateRef.current.currentFilePath === data.sourcePath) {
        // The current file was moved, update the path and reload it
        console.log('Current file was moved, updating to new path:', data.destinationPath);

        // Update the current file path
        handlersRef.current.setCurrentFilePath(data.destinationPath);
        handlersRef.current.setCurrentFileName(data.destinationPath.split('/').pop() || data.destinationPath);

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
      const editorTheme = newTheme === 'system' ? 'auto' : newTheme;

      // Apply theme immediately for instant visual feedback
      if (handlersRef.current.setTheme) {
        handlersRef.current.setTheme(editorTheme);
      }

      // Flush unsaved changes to disk before visual reset, when possible
      const flushAndReload = async () => {
        try {
          if (stateRef.current.currentFilePath && getContentRef.current) {
            if (isDirtyRef.current) {
              const content = getContentRef.current();
              if (LOG_CONFIG.THEME) console.log('[THEME] Dirty before theme switch. Saving to disk...');
              const result = await window.electronAPI?.saveFile(content, stateRef.current.currentFilePath);
              if (result?.success) {
                // NOTE: lastSaveTime now tracked in EditorPool per-file
                isDirtyRef.current = false;
                handlersRef.current.setIsDirty(false);
                // NOTE: initialContentRef removed - EditorPool tracks this per-file
                // Reflect clean state in active tab UI
                if (stateRef.current.tabs && stateRef.current.tabs.activeTabId) {
                  stateRef.current.tabs.updateTab(stateRef.current.tabs.activeTabId, { isDirty: false });
                }
                if (LOG_CONFIG.THEME) console.log('[THEME] Saved successfully before theme switch');
              } else if (LOG_CONFIG.THEME) {
                console.warn('[THEME] Save before theme switch did not succeed:', result);
              }
            }

            // Reload from disk to ensure we rehydrate with canonical content
            if (window.electronAPI?.readFileContent) {
              const res = await window.electronAPI.readFileContent(stateRef.current.currentFilePath);
              if (res?.content !== undefined) {
                // NOTE: initialContentRef removed - EditorPool tracks this per-file
                // NOTE: contentVersion removed - EditorContainer handles remounting via destroy/create
                // Keep tab content in sync
                if (stateRef.current.tabs && stateRef.current.tabs.activeTabId) {
                  stateRef.current.tabs.updateTab(stateRef.current.tabs.activeTabId, { content: res.content });
                }
              }
            } else if (window.electronAPI?.switchWorkspaceFile) {
              const res = await window.electronAPI.switchWorkspaceFile(stateRef.current.currentFilePath);
              if (res?.content !== undefined) {
                // NOTE: initialContentRef removed - EditorPool tracks this per-file
                // NOTE: contentVersion removed - EditorContainer handles remounting via destroy/create
                if (stateRef.current.tabs && stateRef.current.tabs.activeTabId) {
                  stateRef.current.tabs.updateTab(stateRef.current.tabs.activeTabId, { content: res.content });
                }
              }
            }
          }
        } catch (err) {
          console.error('[THEME] Error flushing/reloading content on theme change:', err);
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

      handlersRef.current.setFileTree(prevTree => updateFileTree(prevTree));

      // Update current file path if it was renamed
      if (stateRef.current.currentFilePath === data.oldPath) {
        handlersRef.current.setCurrentFilePath(data.newPath);
        handlersRef.current.setCurrentFileName(data.newPath.split('/').pop() || data.newPath);
      }
    }));
    cleanupFns.push(window.electronAPI.onWorkspaceFileTreeUpdated((data) => {
      // console.log('Workspace file tree updated:', data);
      handlersRef.current.setFileTree(data.fileTree);
    }));

    // Load session from Session Manager
    if (window.electronAPI.onLoadSessionFromManager) {
      cleanupFns.push(window.electronAPI.onLoadSessionFromManager(async (data: { sessionId: string; workspacePath?: string }) => {
        console.log('Loading session from manager:', data);

        // If there's a workspace path and we're not in workspace mode, open the workspace first
        if (data.workspacePath && !stateRef.current.workspaceMode) {
          // Open the workspace
          const workspaceName = data.workspacePath.split('/').pop() || 'Workspace';
          const fileTree = await window.electronAPI.getFolderContents(data.workspacePath);
          handlersRef.current.setWorkspaceMode(true);
          handlersRef.current.setWorkspacePath(data.workspacePath);
          handlersRef.current.setWorkspaceName(workspaceName);
          handlersRef.current.setFileTree(fileTree);
        }

        // Set the session to load - AIChat will pick this up
        handlersRef.current.setSessionToLoad(data);

        // Make sure AI Chat is visible
        handlersRef.current.setIsAIChatCollapsed(false);
      }));
    }

    // View history menu handler
    if (window.electronAPI.onViewHistory) {
      cleanupFns.push(window.electronAPI.onViewHistory(() => {
        console.log('View history menu triggered');
        // Save current state as manual snapshot before opening history (only if dirty)
        if (stateRef.current.isDirty && stateRef.current.currentFilePath && getContentRef.current && window.electronAPI?.history) {
          const content = getContentRef.current();
          window.electronAPI.history.createSnapshot(
            stateRef.current.currentFilePath,
            content,
            'manual',
            'Before viewing history'
          );
        }
        handlersRef.current.setIsHistoryDialogOpen(true);
      }));
    }

    // Tab navigation handlers
    if (window.electronAPI.onNextTab) {
      cleanupFns.push(window.electronAPI.onNextTab(() => {
        if (stateRef.current.tabs && stateRef.current.tabs.tabs.length > 1) {
          const currentIndex = stateRef.current.tabs.tabs.findIndex(tab => tab.id === stateRef.current.tabs.activeTabId);
          const nextIndex = (currentIndex + 1) % stateRef.current.tabs.tabs.length;
          const nextTab = stateRef.current.tabs.tabs[nextIndex];
          if (nextTab) {
            stateRef.current.tabs.switchTab(nextTab.id);
          }
        }
      }));
    }

    if (window.electronAPI.onPreviousTab) {
      cleanupFns.push(window.electronAPI.onPreviousTab(() => {
        if (stateRef.current.tabs && stateRef.current.tabs.tabs.length > 1) {
          const currentIndex = stateRef.current.tabs.tabs.findIndex(tab => tab.id === stateRef.current.tabs.activeTabId);
          const prevIndex = currentIndex <= 0 ? stateRef.current.tabs.tabs.length - 1 : currentIndex - 1;
          const prevTab = stateRef.current.tabs.tabs[prevIndex];
          if (prevTab) {
            stateRef.current.tabs.switchTab(prevTab.id);
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
      cleanupFns.push(window.electronAPI.onMcpApplyDiff(async ({ replacements, resultChannel, targetFilePath }) => {
        console.log('[MCP] applyDiff request:', replacements, 'targetFilePath:', targetFilePath);
        try {
          // Use the explicit targetFilePath from the IPC message, or fall back to first registered editor
          const filePath = targetFilePath || editorRegistry.getFilePaths()[0];

          if (!filePath) {
            console.error('[MCP] No target file path available for applyDiff');
            return;
          }
          // Use the editor registry to apply replacements to the target file
          const result = await editorRegistry.applyReplacements(filePath, replacements);

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
      cleanupFns.push(window.electronAPI.onMcpStreamContent(({ streamId, content, position, insertAfter, mode, targetFilePath }) => {
        console.log('[MCP] streamContent request:', { streamId, position, mode, targetFilePath });

        // Use the explicit targetFilePath from the IPC message, or fall back to first registered editor
        const filePath = targetFilePath || editorRegistry.getFilePaths()[0];

        if (!filePath) {
          console.error('[MCP] No target file path available for streamContent');
          return;
        }
        // Start streaming
        editorRegistry.startStreaming(filePath, {
          id: streamId,
          position: position || 'cursor',
          mode, // Don't default - let the plugin choose based on context (insertAtEnd, etc)
          insertAfter,
          // Handle both 'end' (from schema) and 'end of document' (AI sometimes ignores enum)
          insertAtEnd: position === 'end' || position === 'end of document'
        });
        // Stream the content
        editorRegistry.streamContent(filePath, streamId, content);
        // End streaming
        editorRegistry.endStreaming(filePath, streamId);
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
    // Note: onAIApplyDiff is handled by aiApi.ts to avoid duplicate applications

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
          if (!currentFilePath) {
            console.error('[AI] No file path available for updateFrontmatter');
            return;
          }
          const currentContent = editorRegistry.getContent(currentFilePath);
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
          const result = await editorRegistry.applyReplacements(currentFilePath, replacements);
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

    // Handle AI create document requests from main process
    if (window.electronAPI.onAICreateDocument) {
      cleanupFns.push(window.electronAPI.onAICreateDocument(async ({ filePath, initialContent, switchToFile, resultChannel }) => {
        console.log('AI createDocument request from main:', { filePath, switchToFile });
        try {
          // Create the document via IPC
          const result = await window.electronAPI.invoke('create-document', filePath, initialContent);

          if (result.success) {
            // Switch to the new file if requested
            if (switchToFile && result.filePath) {
              console.log('Switching to new file:', result.filePath);
              await handlersRef.current.handleWorkspaceFileSelect(result.filePath);
            }

            // Send success response back to main process
            if (window.electronAPI.sendAICreateDocumentResult) {
              window.electronAPI.sendAICreateDocumentResult(resultChannel, {
                success: true,
                filePath: result.filePath
              });
            } else {
              // Fallback to generic IPC send
              window.electronAPI.send(resultChannel, {
                success: true,
                filePath: result.filePath
              });
            }
          } else {
            throw new Error(result.error || 'Failed to create document');
          }
        } catch (error) {
          console.error('AI createDocument error:', error);
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';

          if (window.electronAPI.sendAICreateDocumentResult) {
            window.electronAPI.sendAICreateDocumentResult(resultChannel, {
              success: false,
              error: errorMessage
            });
          } else {
            // Fallback to generic IPC send
            window.electronAPI.send(resultChannel, {
              success: false,
              error: errorMessage
            });
          }
        }
      }));
    }

    // Handle toggle agent palette from menu
    if (window.electronAPI.onToggleAgentPalette) {
      cleanupFns.push(window.electronAPI.onToggleAgentPalette(() => {
        console.log('Toggle agent palette command received from menu');
        if (stateRef.current.workspaceMode) {
          handlersRef.current.setIsAgentPaletteVisible(true);
        } else {
          console.log('Not in workspace mode, agent palette not available');
        }
      }));
    }

    // Handle open welcome tab from menu
    if (window.electronAPI.onOpenWelcomeTab) {
      cleanupFns.push(window.electronAPI.onOpenWelcomeTab(() => {
        console.log('Open welcome tab command received from menu');
        handlersRef.current.openWelcomeTab();
      }));
    }

    // Handle open plans tab from menu
    if ((window.electronAPI as any).onOpenPlansTab) {
      cleanupFns.push((window.electronAPI as any).onOpenPlansTab(() => {
        console.log('Open plans tab command received from menu');
        handlersRef.current.openPlansTab();
      }));
    }

    // Update MCP document state whenever content or selection changes
    const updateDocumentState = () => {
      if (window.electronAPI?.updateMcpDocumentState && getContentRef.current) {
        const content = getContentRef.current();
        window.electronAPI.updateMcpDocumentState({
          content,
          filePath: stateRef.current.currentFilePath || 'untitled.md',
          fileType: 'markdown',
          // TODO: Get actual cursor position and selection from editor
          cursorPosition: undefined,
          selection: undefined
        });
      }
    };

    // Update document state when file is opened or content changes
    // We need to send the initial state when a file is opened, not just when it's dirty
    if (stateRef.current.currentFilePath || stateRef.current.isDirty) {
      updateDocumentState();
    }

    // Clean up listeners when dependencies change
    return () => {
      // console.log('Cleaning up IPC listeners');
      cleanupFns.forEach(cleanup => cleanup());
    };
  }, []); // Empty dependency array - handlers use refs to access current values
}
