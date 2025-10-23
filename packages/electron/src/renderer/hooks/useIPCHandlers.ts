import { useEffect, useRef } from 'react';
import type { LexicalCommand, TextReplacement } from 'rexical';
import {
  APPROVE_DIFF_COMMAND,
  REJECT_DIFF_COMMAND,
  COPY_AS_MARKDOWN_COMMAND,
  parseFrontmatter,
  serializeWithFrontmatter,
  type FrontmatterData,
} from 'rexical';
import { editorRegistry } from '@nimbalyst/runtime/ai/EditorRegistry';
import { aiApi } from '../services/aiApi';

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

  // State setters
  setIsApiKeyDialogOpen: (open: boolean) => void;
  setWorkspaceMode: (mode: boolean) => void;
  setWorkspacePath: (path: string | null) => void;
  setWorkspaceName: (name: string | null) => void;
  setFileTree: (tree: FileTreeItem[]) => void;
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
  setIsKeyboardShortcutsDialogOpen: (open: boolean) => void;
  setIsAgentPaletteVisible: (visible: boolean) => void;
  setTheme: (theme: any) => void;
  setAIPlanningMode?: (enabled: boolean) => void;

  // Refs
  // NOTE: initialContentRef removed - TabEditor tracks initialContent per-tab
  isInitializedRef: React.MutableRefObject<boolean>;
  isDirtyRef: React.MutableRefObject<boolean>;
  // NOTE: contentVersionRef removed - EditorContainer doesn't need version bumping
  getContentRef: React.MutableRefObject<(() => string) | null>;
  editorRef: React.MutableRefObject<any>;
  searchCommandRef: React.MutableRefObject<LexicalCommand<undefined> | null>;

  // State values
  currentFilePath: string | null;
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

    // State setters
    setIsApiKeyDialogOpen,
    setWorkspaceMode,
    setWorkspacePath,
    setWorkspaceName,
    setFileTree,
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
    setIsKeyboardShortcutsDialogOpen,
    setIsAgentPaletteVisible,
    setAIPlanningMode,
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
    setIsAgentPaletteVisible,
    setAIPlanningMode,
    tabs,  // Add tabs so IPC handlers can create/modify tabs
  });

  const stateRef = useRef({
    currentFilePath,
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
    setAIPlanningMode,
    setTheme,
    tabs,  // Keep tabs updated in ref
  };

  stateRef.current = {
    currentFilePath,
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
      // Clear current document (EditorContainer manages content now)
      handlersRef.current.setCurrentFilePath(null);
      handlersRef.current.setCurrentFileName(null);
      isDirtyRef.current = false;
      handlersRef.current.setIsDirty(false);
      // NOTE: contentVersion removed - EditorContainer handles remounting via destroy/create
      isInitializedRef.current = false;

      // Restore AI Chat state when opening a workspace
      try {
        const workspaceState = await window.electronAPI.invoke('workspace:get-state', data.workspacePath);
        const aiChatState = workspaceState?.aiPanel;
        console.log('Restoring AI Chat state for workspace:', aiChatState);
        if (aiChatState) {
          handlersRef.current.setIsAIChatCollapsed(aiChatState.collapsed);
          handlersRef.current.setAIChatWidth(aiChatState.width);
          if (handlersRef.current.setAIPlanningMode) {
            handlersRef.current.setAIPlanningMode(aiChatState.planningModeEnabled ?? true);
          }
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
      // NOTE: initialContentRef removed - TabEditor tracks this per-tab

      // Add tab for the opened file (works for both single-file and workspace modes)
      console.log('[FILE_OPS] Checking tabs object:', !!handlersRef.current.tabs);
      if (handlersRef.current.tabs) {
        console.log('[FILE_OPS] Adding tab for file opened from OS:', data.filePath);

        // TabContent/TabEditor will handle editor creation and state management
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
      // NOTE: initialContentRef removed - TabEditor tracks this per-tab
      // Update the window title immediately
      if (window.electronAPI) {
        window.electronAPI.setTitle(`${data.untitledName} • - Nimbalyst`);
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
      }
    }));

    // NOTE: File watching is now handled by TabEditor component for each individual tab.
    // The legacy file change handler has been removed as it's no longer needed.
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

      // Apply theme immediately - theme changes are purely visual and don't affect content
      if (handlersRef.current.setTheme) {
        handlersRef.current.setTheme(editorTheme);
      }

      // NOTE: We do NOT reload from disk on theme change. Theme is purely CSS.
      // The TabEditor component manages its own content state and will preserve it across theme changes.
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
      console.log('[FILE_TREE] Workspace file tree updated, refreshing...');
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

    // Copy as Markdown handler
    if (window.electronAPI.onCopyAsMarkdown) {
      cleanupFns.push(window.electronAPI.onCopyAsMarkdown(() => {
        console.log('Copy as Markdown triggered from menu');
        // Trigger copy as markdown in the editor
        const editor = editorRef.current;
        if (editor) {
          // Create a synthetic keyboard event to pass to the command
          const syntheticEvent = new KeyboardEvent('keydown', {
            code: 'KeyC',
            shiftKey: true,
            metaKey: true,
            bubbles: true,
            cancelable: true
          });
          editor.dispatchCommand(COPY_AS_MARKDOWN_COMMAND, syntheticEvent);
        }
      }));
    }

    // MCP Server handlers
    if (window.electronAPI.onMcpApplyDiff) {
      cleanupFns.push(window.electronAPI.onMcpApplyDiff(async ({ replacements, resultChannel, targetFilePath }) => {
        try {
          // Use the explicit targetFilePath from the IPC message, or fall back to first registered editor
          const filePath = targetFilePath || editorRegistry.getFilePaths()[0];

          if (!filePath) {
            console.error('[MCP] No target file path available for applyDiff');
            return;
          }

          // Validate that the file is a markdown file
          if (!filePath.endsWith('.md')) {
            console.error('[MCP] applyDiff can only modify markdown files:', filePath);
            if (window.electronAPI.sendMcpApplyDiffResult) {
              window.electronAPI.sendMcpApplyDiffResult(resultChannel, {
                success: false,
                error: `applyDiff can only modify markdown files (.md). Attempted to modify: ${filePath}`
              });
            }
            return;
          }

          // If the file isn't registered (not open), open it in the background
          if (!editorRegistry.has(filePath)) {
            console.log('[MCP] File not open, opening in background:', filePath);

            // Read the file content
            const fileContent = await window.electronAPI.readFileContent(filePath);

            // Open the file using editorRegistry's file opener
            await editorRegistry.openFileInBackground(filePath, fileContent);
          }

          // Use the editor registry to apply replacements to the target file
          // Pass the resultChannel as a unique ID so the event can be correlated
          const result = await editorRegistry.applyReplacements(filePath, replacements, resultChannel);

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

    // Handle open keyboard shortcuts dialog from menu
    if ((window.electronAPI as any).onOpenKeyboardShortcuts) {
      cleanupFns.push((window.electronAPI as any).onOpenKeyboardShortcuts(() => {
        console.log('Open keyboard shortcuts dialog command received from menu');
        handlersRef.current.setIsKeyboardShortcutsDialogOpen(true);
      }));
    }

    // Handle open plans tab from menu
    if ((window.electronAPI as any).onOpenPlansTab) {
      // Open plans tab handler removed - use bottom panel instead
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

    // Set up AI streaming event listeners
    // These connect the aiApi events to the editorRegistry methods
    const handleStreamEditStart = (config: any) => {
      console.log('[AI Streaming] Stream edit started:', config);
      const filePath = editorRegistry.getActiveFilePath();
      if (!filePath) {
        console.error('[AI Streaming] No active editor for streaming');
        return;
      }

      editorRegistry.startStreaming(filePath, {
        id: config.id || 'ai-stream',
        position: config.position || 'end',
        mode: config.mode,
        insertAfter: config.insertAfter,
        insertAtEnd: config.insertAtEnd ?? true
      });
    };

    const handleStreamEditContent = (content: string) => {
      console.log('[AI Streaming] Stream edit content:', content.substring(0, 50));
      const filePath = editorRegistry.getActiveFilePath();
      if (!filePath) {
        console.error('[AI Streaming] No active editor for streaming');
        return;
      }

      editorRegistry.streamContent(filePath, 'ai-stream', content);
    };

    const handleStreamEditEnd = (data: any) => {
      console.log('[AI Streaming] Stream edit ended:', data);
      const filePath = editorRegistry.getActiveFilePath();
      if (!filePath) {
        console.error('[AI Streaming] No active editor for streaming');
        return;
      }

      editorRegistry.endStreaming(filePath, 'ai-stream');
    };

    aiApi.on('streamEditStart', handleStreamEditStart);
    aiApi.on('streamEditContent', handleStreamEditContent);
    aiApi.on('streamEditEnd', handleStreamEditEnd);

    // Clean up listeners when dependencies change
    return () => {
      // console.log('Cleaning up IPC listeners');
      cleanupFns.forEach(cleanup => cleanup());

      // Clean up AI streaming listeners
      aiApi.off('streamEditStart', handleStreamEditStart);
      aiApi.off('streamEditContent', handleStreamEditContent);
      aiApi.off('streamEditEnd', handleStreamEditEnd);
    };
  }, []); // Empty dependency array - handlers use refs to access current values
}
