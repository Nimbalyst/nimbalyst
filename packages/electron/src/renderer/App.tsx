import React, { useEffect, useState, useCallback, useRef } from 'react';
import { logger } from './utils/logger';

logger.log('ui', 'App.tsx loading at', new Date().toISOString());
logger.log('ui', 'About to import StravuEditor at', new Date().toISOString());
import { StravuEditor, TOGGLE_SEARCH_COMMAND, MARKDOWN_TRANSFORMERS, aiChatBridge } from 'stravu-editor';
import type { LexicalCommand, ConfigTheme, TextReplacement } from 'stravu-editor';
// Import styles - handled by vite plugin for both dev and prod
import 'stravu-editor/styles';
logger.log('ui', 'StravuEditor imported at', new Date().toISOString());
import { ProjectSidebar } from './components/ProjectSidebar';
import { ProjectWelcome } from './components/ProjectWelcome';
import { QuickOpen } from './components/QuickOpen';
import { AIChat } from './components/AIChat';
import { HistoryDialog } from './components/HistoryDialog';
import { PreferencesDialog } from './components/Preferences/PreferencesDialog';
import { ErrorDialog } from './components/ErrorDialog/ErrorDialog';
import { ApiKeyDialog } from './components/ApiKeyDialog';
import './ProjectWelcome.css';

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
  onFileOpen: (callback: () => void) => () => void;
  onProjectOpened: (callback: (data: { projectPath: string; projectName: string; fileTree: FileTreeItem[] }) => void) => () => void;
  onOpenProjectFromCLI?: (callback: (projectPath: string) => void) => () => void;
  onFileSave: (callback: () => void) => () => void;
  onFileSaveAs: (callback: () => void) => () => void;
  onFileOpenedFromOS: (callback: (data: { filePath: string; content: string }) => void) => () => void;
  onNewUntitledDocument: (callback: (data: { untitledName: string }) => void) => () => void;
  onToggleSearch: (callback: () => void) => () => void;
  onToggleSearchReplace: (callback: () => void) => () => void;
  onFileDeleted: (callback: (data: { filePath: string }) => void) => () => void;
  onFileRenamed: (callback: (data: { oldPath: string; newPath: string }) => void) => () => void;
  onFileMoved: (callback: (data: { sourcePath: string; destinationPath: string }) => void) => () => void;
  onProjectFileTreeUpdated: (callback: (data: { fileTree: FileTreeItem[]; addedPath?: string; removedPath?: string }) => void) => () => void;
  onThemeChange: (callback: (theme: string) => void) => () => void;
  onShowAbout: (callback: () => void) => () => void;
  onViewHistory?: (callback: () => void) => () => void;
  onLoadSessionFromManager?: (callback: (data: { sessionId: string; projectPath?: string }) => void) => () => void;
  onShowPreferences?: (callback: () => void) => () => void;
  openFile: () => Promise<{ filePath: string; content: string } | null>;
  saveFile: (content: string) => Promise<{ success: boolean; filePath: string } | null>;
  saveFileAs: (content: string) => Promise<{ success: boolean; filePath: string } | null>;
  setDocumentEdited: (edited: boolean) => void;
  setTitle: (title: string) => void;
  setCurrentFile: (filePath: string | null) => void;
  // Project operations
  getFolderContents: (dirPath: string) => Promise<FileTreeItem[]>;
  switchProjectFile: (filePath: string) => Promise<{ filePath: string; content: string } | null>;
  // Settings
  getSidebarWidth: () => Promise<number | null>;
  setSidebarWidth: (width: number) => void;
  getAIChatState: () => Promise<{ collapsed: boolean; width: number } | null>;
  setAIChatState: (state: { collapsed: boolean; width: number }) => void;
  getRecentProjectFiles?: () => Promise<string[]>;
  addToProjectRecentFiles?: (filePath: string) => void;
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


export default function App() {
  logger.log('ui', 'App component rendering at', new Date().toISOString());
  const [content, setContent] = useState('');
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
  const [currentFileName, setCurrentFileName] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [projectMode, setProjectMode] = useState(false);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<FileTreeItem[]>([]);
  const [theme, setTheme] = useState<ConfigTheme>('auto');
  const [sidebarWidth, setSidebarWidth] = useState<number>(250);
  const [isQuickOpenVisible, setIsQuickOpenVisible] = useState(false);
  const [recentProjectFiles, setRecentProjectFiles] = useState<string[]>([]);
  const [isAIChatCollapsed, setIsAIChatCollapsed] = useState(false);
  const [aiChatWidth, setAIChatWidth] = useState<number>(350);
  const [isHistoryDialogOpen, setIsHistoryDialogOpen] = useState(false);
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  const [isAIChatStateLoaded, setIsAIChatStateLoaded] = useState(false);
  const [isApiKeyDialogOpen, setIsApiKeyDialogOpen] = useState(false);
  const [sessionToLoad, setSessionToLoad] = useState<{ sessionId: string; projectPath?: string } | null>(null);
  const [diffError, setDiffError] = useState<{ isOpen: boolean; title: string; message: string; details?: any }>({
    isOpen: false,
    title: '',
    message: '',
    details: undefined
  });
  const [lastPrompt, setLastPrompt] = useState<string>('');
  const [lastClaudeResponse, setLastClaudeResponse] = useState<string>('');
  const getContentRef = useRef<(() => string) | null>(null);
  const initialContentRef = useRef<string>('');
  const editorRef = useRef<any>(null);
  const searchCommandRef = useRef<LexicalCommand<undefined> | null>(null);
  const contentVersionRef = useRef<number>(0);
  const isInitializedRef = useRef<boolean>(false);
  const autoSaveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const autoSnapshotIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSnapshotContentRef = useRef<string>('');
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isResizingRef = useRef<boolean>(false);

  // Log mount/unmount
  useEffect(() => {
    logger.log('ui', 'App component mounted at', new Date().toISOString());
    return () => {
      logger.log('ui', 'App component unmounting at', new Date().toISOString());
    };
  }, []);

  // Restore state during development HMR (only on mount)
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      // Restore state from session storage on mount
      const savedState = sessionStorage.getItem('stravu-editor-dev-state');
      if (savedState) {
        try {
          const state = JSON.parse(savedState);
          console.log('[HMR] Restoring dev state:', state);

          // Restore the state
          if (state.projectMode) {
            setProjectMode(true);
            setProjectPath(state.projectPath);
            setProjectName(state.projectName);
            setFileTree(state.fileTree || []);
          }

          if (state.filePath) {
            setCurrentFilePath(state.filePath);
            setCurrentFileName(state.fileName);
            setContent(state.content || '');
            initialContentRef.current = state.content || '';
            contentVersionRef.current += 1;
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
          sessionStorage.removeItem('stravu-editor-dev-state');
        } catch (error) {
          console.error('[HMR] Failed to restore dev state:', error);
        }
      }
    }
  }, []); // Empty dependency array - only run on mount

  // Save state before HMR in development
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      const saveDevState = () => {
        const state = {
          projectMode,
          projectPath,
          projectName,
          fileTree,
          filePath: currentFilePath,
          fileName: currentFileName,
          content: getContentRef.current ? getContentRef.current() : content,
          sidebarWidth: sidebarWidth,
          isDirty: isDirty,
          theme: theme
        };
        console.log('[HMR] Saving dev state:', state);
        sessionStorage.setItem('stravu-editor-dev-state', JSON.stringify(state));
      };

      // Save state on beforeunload (catches HMR)
      window.addEventListener('beforeunload', saveDevState);

      return () => {
        window.removeEventListener('beforeunload', saveDevState);
      };
    }
  }, [projectMode, projectPath, projectName, fileTree, currentFilePath, currentFileName, content, sidebarWidth, isDirty, theme]);

  // Load saved sidebar width and AI chat state on mount
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getSidebarWidth().then((width) => {
        if (width) {
          setSidebarWidth(width);
        }
      });

      window.electronAPI.getAIChatState().then((state) => {
        console.log('Loaded AI Chat state:', state);
        if (state) {
          setIsAIChatCollapsed(state.collapsed);
          setAIChatWidth(state.width);
        }
        setIsAIChatStateLoaded(true);
      }).catch(error => {
        console.error('Failed to load AI Chat state:', error);
        setIsAIChatStateLoaded(true);
      });
    }
  }, []);

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
      if (window.electronAPI) {
        window.electronAPI.setSidebarWidth(sidebarWidth);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [sidebarWidth]);

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement;

    if (theme === 'dark') {
      root.classList.add('dark-theme');
      root.classList.remove('light-theme', 'crystal-dark-theme');
    } else if (theme === 'light') {
      root.classList.add('light-theme');
      root.classList.remove('dark-theme', 'crystal-dark-theme');
    } else if (theme === 'crystal-dark') {
      root.classList.add('crystal-dark-theme');
      root.classList.remove('light-theme', 'dark-theme');
    } else {
      // Auto theme - let CSS handle it with prefers-color-scheme
      root.classList.remove('dark-theme', 'light-theme', 'crystal-dark-theme');
    }
  }, [theme]);

  // Handle new file
  const handleNew = useCallback(() => {
    contentVersionRef.current += 1;
    isInitializedRef.current = false;
    setContent('');
    setCurrentFilePath(null);
    setCurrentFileName(null);
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
        isInitializedRef.current = false;
        setContent(result.content);
        setCurrentFilePath(result.filePath);
        setCurrentFileName(result.filePath.split('/').pop() || result.filePath);
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
    console.log('handleSaveAs called');
    if (!window.electronAPI || !getContentRef.current) return;

    const content = getContentRef.current();

    try {
      console.log('Calling electronAPI.saveFileAs');
      const result = await window.electronAPI.saveFileAs(content);
      console.log('Save as result:', result);
      if (result) {
        console.log('Setting current file path to:', result.filePath);
        setCurrentFilePath(result.filePath);
        setCurrentFileName(result.filePath.split('/').pop() || result.filePath);
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
    console.log('handleSave called, currentFilePath:', currentFilePath);
    if (!window.electronAPI || !getContentRef.current) return;

    const content = getContentRef.current();
    console.log('Saving content:', { contentLength: content.length, hasFilePath: !!currentFilePath, currentFilePath });

    if (!currentFilePath) {
      console.log('No file path, triggering save as');
      // No file loaded, for Cmd+S we should trigger save as
      // This matches typical editor behavior
      await handleSaveAs();
      return;
    }

    try {
      console.log('Calling electronAPI.saveFile');
      const result = await window.electronAPI.saveFile(content);
      console.log('Save result:', result);
      if (result) {
        setCurrentFilePath(result.filePath);
        setCurrentFileName(result.filePath.split('/').pop() || result.filePath);
        setIsDirty(false);
        // Update initial content ref to the saved content
        if (getContentRef.current) {
          initialContentRef.current = getContentRef.current();
        }

        // Create a history snapshot for manual save
        console.log('Checking history API:', !!window.electronAPI?.history);
        if (window.electronAPI?.history) {
          try {
            console.log('Creating snapshot for:', result.filePath, 'content length:', content.length);
            await window.electronAPI.history.createSnapshot(
              result.filePath,
              content,
              'manual',
              'Manual save'
            );
            console.log('Created history snapshot for manual save');
          } catch (error) {
            console.error('Failed to create history snapshot:', error);
          }
        } else {
          console.log('History API not available');
        }

        console.log('File saved successfully');
      } else {
        console.log('Save returned null - no current file in main process');
      }
    } catch (error) {
      console.error('Failed to save file:', error);
    }
  }, [currentFilePath, handleSaveAs]);

  // Handle close project
  const handleCloseProject = useCallback(async () => {
    // Auto-save current file if dirty (no prompt needed with autosave)
    if (isDirty && getContentRef.current) {
      console.log('[CLOSE_PROJECT] Auto-saving current file before closing');
      await handleSave();
    }

    // Close the window
    window.close();
  }, [isDirty, handleSave]);

  // Handle file selection in project
  const handleProjectFileSelect = useCallback(async (filePath: string) => {
    if (!window.electronAPI) return;

    // Auto-save current file if dirty (no prompt needed with autosave)
    if (isDirty && getContentRef.current && currentFilePath && currentFilePath !== filePath) {
      console.log('[PROJECT_FILE_SELECT] Auto-saving current file before switching');
      await handleSave();
    }

    try {
      const result = await window.electronAPI.switchProjectFile(filePath);
      if (result) {
        contentVersionRef.current += 1;
        isInitializedRef.current = false;
        setContent(result.content);
        setCurrentFilePath(result.filePath);
        setCurrentFileName(result.filePath.split('/').pop() || result.filePath);
        setIsDirty(false);
        initialContentRef.current = result.content;

        // Update the current file in main process
        window.electronAPI.setCurrentFile(filePath);

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
      console.error('Failed to switch project file:', error);
    }
  }, [isDirty, currentFilePath, handleSave]);

  // Update window title and dirty state
  useEffect(() => {
    if (!window.electronAPI) return;

    let title = 'Stravu Editor';
    if (projectMode && projectName) {
      if (currentFileName) {
        title = `${currentFileName}${isDirty ? ' •' : ''} - ${projectName} - Stravu Editor`;
      } else {
        title = `${projectName} - Stravu Editor`;
      }
    } else if (currentFileName) {
      title = `${currentFileName}${isDirty ? ' •' : ''} - Stravu Editor`;
    }

    window.electronAPI.setTitle(title);
    window.electronAPI.setDocumentEdited(isDirty);
  }, [currentFileName, isDirty, projectMode, projectName]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+E (Mac) or Ctrl+E (Windows/Linux) for Quick Open
      if (projectMode && (e.metaKey || e.ctrlKey) && e.key === 'e') {
        e.preventDefault();
        setIsQuickOpenVisible(true);
      }
      // Cmd+Shift+A (Mac) or Ctrl+Shift+A (Windows/Linux) for AI Chat
      if (projectMode && (e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'a') {
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

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [projectMode, currentFilePath]);

  // Save AI Chat state when it changes (but only after initial load)
  useEffect(() => {
    if (isAIChatStateLoaded && window.electronAPI.setAIChatState) {
      const state = { collapsed: isAIChatCollapsed, width: aiChatWidth };
      console.log('Saving AI Chat state:', state);
      window.electronAPI.setAIChatState(state);
    }
  }, [isAIChatCollapsed, aiChatWidth, isAIChatStateLoaded]);

  // Load recent project files when in project mode
  useEffect(() => {
    if (!projectMode || !window.electronAPI) return;

    const loadRecentFiles = async () => {
      try {
        if (window.electronAPI.getRecentProjectFiles) {
          const files = await window.electronAPI.getRecentProjectFiles();
          setRecentProjectFiles(files);
        }
      } catch (error) {
        console.error('Failed to load recent project files:', error);
      }
    };

    loadRecentFiles();
  }, [projectMode, currentFilePath]); // Reload when current file changes

  // Handle QuickOpen file selection
  const handleQuickOpenFileSelect = useCallback(async (filePath: string) => {
    await handleProjectFileSelect(filePath);

    // Add to recent files
    if (window.electronAPI?.addToProjectRecentFiles) {
      window.electronAPI.addToProjectRecentFiles(filePath);
    }
  }, [handleProjectFileSelect]);

  // Handle restoring content from history
  const handleRestoreFromHistory = useCallback((content: string) => {
    contentVersionRef.current += 1;
    isInitializedRef.current = false;
    setContent(content);
    setIsDirty(true);
    // Close the history dialog
    setIsHistoryDialogOpen(false);
  }, []);

  // Sync current file path with backend whenever it changes
  useEffect(() => {
    if (window.electronAPI && currentFilePath !== null) {
      console.log('[APP] Syncing current file path to backend:', currentFilePath);
      window.electronAPI.setCurrentFile(currentFilePath);
    }
  }, [currentFilePath]);

  // Autosave functionality
  useEffect(() => {
    // Clear any existing interval
    if (autoSaveIntervalRef.current) {
      clearInterval(autoSaveIntervalRef.current);
      autoSaveIntervalRef.current = null;
    }

    // Set up autosave if we have a file path and the document is dirty
    if (currentFilePath && isDirty && getContentRef.current) {
      logger.log('autosave', 'Starting autosave interval');
      autoSaveIntervalRef.current = setInterval(async () => {
        if (isDirty && currentFilePath && getContentRef.current && window.electronAPI) {
          console.log('[AUTOSAVE] Autosaving...', {
            isDirty,
            currentFilePath,
            hasGetContent: !!getContentRef.current
          });
          try {
            const content = getContentRef.current();
            console.log('[AUTOSAVE] Content length:', content.length);
            const result = await window.electronAPI.saveFile(content);
            console.log('[AUTOSAVE] Save result:', result);
            if (result) {
              setIsDirty(false);
              initialContentRef.current = content;
              console.log('[AUTOSAVE] Autosaved successfully');
            } else {
              console.error('[AUTOSAVE] Save failed - returned null');
              // Show user notification about save failure
              if (window.electronAPI?.showErrorDialog) {
                window.electronAPI.showErrorDialog(
                  'Auto-save Failed',
                  'Failed to auto-save document. Your changes may not be saved.'
                );
              }
            }
          } catch (error) {
            console.error('[AUTOSAVE] Autosave failed:', error);
            // Show user notification about save failure
            if (window.electronAPI?.showErrorDialog) {
              window.electronAPI.showErrorDialog(
                'Auto-save Error',
                `Failed to save document: ${error.message}`
              );
            }
          }
        } else {
          logger.log('autosave', 'Skipping autosave:', {
            isDirty,
            currentFilePath,
            hasGetContent: !!getContentRef.current,
            hasElectronAPI: !!window.electronAPI
          });
        }
      }, 10000); // Autosave every 10 seconds
    }

    // Cleanup on unmount or when dependencies change
    return () => {
      if (autoSaveIntervalRef.current) {
        clearInterval(autoSaveIntervalRef.current);
        autoSaveIntervalRef.current = null;
      }
    };
  }, [currentFilePath, isDirty])

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
              console.log('[AUTO-SNAPSHOT] Creating periodic snapshot');
              await window.electronAPI.history.createSnapshot(
                currentFilePath,
                content,
                'auto',
                'Periodic auto-save'
              );
              lastSnapshotContentRef.current = content;
            }
          } catch (error) {
            console.error('[AUTO-SNAPSHOT] Failed to create snapshot:', error);
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

  // Set up IPC listeners
  useEffect(() => {
    if (!window.electronAPI) return;

    console.log('Setting up IPC listeners, currentFilePath:', currentFilePath);

    // Set up listeners and store cleanup functions
    const cleanupFns: Array<() => void> = [];

    cleanupFns.push(window.electronAPI.onFileNew(handleNew));
    cleanupFns.push(window.electronAPI.onFileOpen(handleOpen));
    cleanupFns.push(window.electronAPI.onFileSave(handleSave));
    cleanupFns.push(window.electronAPI.onFileSaveAs(handleSaveAs));
    cleanupFns.push(window.electronAPI.onProjectOpened(async (data) => {
      console.log('Project opened:', data);
      setProjectMode(true);
      setProjectPath(data.projectPath);
      setProjectName(data.projectName);
      setFileTree(data.fileTree);
      // Clear current document
      setContent('');
      setCurrentFilePath(null);
      setCurrentFileName(null);
      setIsDirty(false);
      contentVersionRef.current += 1;
      isInitializedRef.current = false;

      // Restore AI Chat state when opening a project
      try {
        const aiChatState = await window.electronAPI.getAIChatState();
        console.log('Restoring AI Chat state for project:', aiChatState);
        if (aiChatState) {
          setIsAIChatCollapsed(aiChatState.collapsed);
          setAIChatWidth(aiChatState.width);
        }
        // Make sure the loaded flag is set so future changes will be saved
        setIsAIChatStateLoaded(true);
      } catch (error) {
        console.error('Failed to restore AI Chat state:', error);
        setIsAIChatStateLoaded(true);
      }
    }));

    // Handle project open from CLI
    if (window.electronAPI.onOpenProjectFromCLI) {
      cleanupFns.push(window.electronAPI.onOpenProjectFromCLI(async (projectPath) => {
        console.log('Opening project from CLI:', projectPath);
        // Open the project using the existing openProject API
        if (window.electronAPI.openProject) {
          await window.electronAPI.openProject(projectPath);
        }
      }));
    }

    cleanupFns.push(window.electronAPI.onFileOpenedFromOS(async (data) => {
      console.log('File opened from OS:', data.filePath);
      contentVersionRef.current += 1;
      isInitializedRef.current = false;
      setContent(data.content);
      setCurrentFilePath(data.filePath);
      setCurrentFileName(data.filePath.split('/').pop() || data.filePath);
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
      logger.log('file', 'Received new-untitled-document event:', data.untitledName);
      setContent('');
      setCurrentFilePath(null);
      setCurrentFileName(data.untitledName);
      // setIsDirty(true); // New documents start as dirty
      initialContentRef.current = '';
      // Update the window title immediately
      if (window.electronAPI) {
        window.electronAPI.setTitle(`${data.untitledName} • - Stravu Editor`);
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
        setIsDirty(true);
        // Optionally show a notification to the user
        alert('The file has been deleted from disk.');
      }
    }));
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
      console.log('Theme changed to:', newTheme);
      // Map 'system' to 'auto' for the editor
      const editorTheme = newTheme === 'system' ? 'auto' : newTheme;
      setTheme(editorTheme as ConfigTheme);
      console.log('Editor theme set to:', editorTheme);
    }));

    // Listen for show preferences event
    if (window.electronAPI.onShowPreferences) {
      cleanupFns.push(window.electronAPI.onShowPreferences(() => {
        console.log('Show preferences requested');
        setIsPreferencesOpen(true);
      }));
    }
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
    cleanupFns.push(window.electronAPI.onProjectFileTreeUpdated((data) => {
      console.log('Project file tree updated:', data);
      setFileTree(data.fileTree);
    }));

    // Load session from Session Manager
    if (window.electronAPI.onLoadSessionFromManager) {
      cleanupFns.push(window.electronAPI.onLoadSessionFromManager(async (data: { sessionId: string; projectPath?: string }) => {
        console.log('Loading session from manager:', data);

        // If there's a project path and we're not in project mode, open the project first
        if (data.projectPath && !projectMode) {
          // Open the project
          const projectName = data.projectPath.split('/').pop() || 'Project';
          const fileTree = await window.electronAPI.getFolderContents(data.projectPath);
          setProjectMode(true);
          setProjectPath(data.projectPath);
          setProjectName(projectName);
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
  }, [handleNew, handleOpen, handleSave, handleSaveAs, currentFilePath, isDirty, getContentRef.current]);

  logger.log('ui', 'Rendering App with config:', {
    contentLength: content.length,
    currentFileName,
    theme
  });

  logger.log('ui', 'About to render StravuEditor at', new Date().toISOString());

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: projectMode ? 'row' : 'column' }}>
      {projectMode && projectName && (
        <>
          <div ref={sidebarRef} style={{ width: sidebarWidth, position: 'relative' }}>
            <ProjectSidebar
              projectName={projectName}
              projectPath={projectPath || ''}
              fileTree={fileTree}
              currentFilePath={currentFilePath}
              onFileSelect={handleProjectFileSelect}
              onCloseProject={handleCloseProject}
              onOpenQuickSearch={() => setIsQuickOpenVisible(true)}
              onRefreshFileTree={async () => {
                if (projectPath && window.electronAPI) {
                  const tree = await window.electronAPI.getFolderContents(projectPath);
                  setFileTree(tree);
                }
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
        {projectMode && !currentFilePath ? (
          <ProjectWelcome projectName={projectName || 'Project'} />
        ) : (
          <StravuEditor
            key={`${contentVersionRef.current}-${theme}`}
            config={{
              initialContent: content,
              onContentChange: (newContent) => {
            logger.log('editor', 'Content changed:', newContent.length, 'initialized:', isInitializedRef.current);

            // Check if content actually changed from initial
            if (getContentRef.current) {
              const currentContent = getContentRef.current();
              const hasChanged = currentContent !== initialContentRef.current;

              // On first onChange, mark as initialized
              if (!isInitializedRef.current) {
                isInitializedRef.current = true;
                // If content is different on first change, it's a real user edit
                if (hasChanged) {
                  logger.log('editor', 'First change is a real user edit');
                  setIsDirty(true);
                }
                // If content is same, it's just initialization - no need to set dirty
                return;
              }

              // After initialization, normal dirty checking
              if (hasChanged !== isDirty) {
                logger.log('editor', 'Dirty state changed to:', hasChanged);
                setIsDirty(hasChanged);
              }
            }
          },
          onGetContent: (getContentFn) => {
            logger.log('ui', 'Received getContent function at', new Date().toISOString());
            getContentRef.current = getContentFn;
          },
          onEditorReady: (editor) => {
            logger.log('ui', 'Editor ready at', new Date().toISOString());
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
      {projectMode && (
        <AIChat
          isCollapsed={isAIChatCollapsed}
          onToggleCollapse={() => setIsAIChatCollapsed(prev => !prev)}
          width={aiChatWidth}
          onWidthChange={setAIChatWidth}
          projectPath={projectPath || undefined}
          sessionToLoad={sessionToLoad}
          onSessionLoaded={() => setSessionToLoad(null)}
          onShowApiKeyError={() => setIsApiKeyDialogOpen(true)}
          documentContext={{
            filePath: currentFilePath || '',
            fileType: 'markdown',
            content: getContentRef.current ? getContentRef.current() : content,
            cursorPosition: undefined, // TODO: Get from Lexical editor
            selection: undefined, // TODO: Get selected text from Lexical
            getLatestContent: getContentRef.current // Pass the function itself
          }}
          onApplyEdit={(edit, prompt, claudeResponse) => {
            console.log('Edit already applied by AIChat component, updating UI state');
            // Store the prompt and response for error reporting
            setLastPrompt(prompt || '');
            setLastClaudeResponse(claudeResponse || '');

            // The edit has already been applied by AIChat.tsx through claudeApi.applyEdit()
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
      {projectMode && projectPath && (
        <QuickOpen
          isOpen={isQuickOpenVisible}
          onClose={() => setIsQuickOpenVisible(false)}
          projectPath={projectPath}
          recentFiles={recentProjectFiles}
          onFileSelect={handleQuickOpenFileSelect}
        />
      )}
      <HistoryDialog
        isOpen={isHistoryDialogOpen}
        onClose={() => setIsHistoryDialogOpen(false)}
        filePath={currentFilePath}
        onRestore={handleRestoreFromHistory}
      />
      <PreferencesDialog
        isOpen={isPreferencesOpen}
        onClose={() => setIsPreferencesOpen(false)}
      />
      <ApiKeyDialog
        isOpen={isApiKeyDialogOpen}
        onClose={() => setIsApiKeyDialogOpen(false)}
        onOpenPreferences={() => {
          setIsApiKeyDialogOpen(false);
          setIsPreferencesOpen(true);
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
