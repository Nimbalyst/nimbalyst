console.log('[RENDERER] App.tsx loading at', new Date().toISOString());

import React, { useEffect, useState, useCallback, useRef } from 'react';

console.log('[RENDERER] About to import StravuEditor at', new Date().toISOString());
import { StravuEditor, TOGGLE_SEARCH_COMMAND } from 'stravu-editor';
import type { LexicalCommand, ConfigTheme } from 'stravu-editor';
import '../../../stravu-editor/dist/style.css';
console.log('[RENDERER] StravuEditor imported at', new Date().toISOString());
import { ProjectSidebar } from './components/ProjectSidebar';
import { ProjectWelcome } from './components/ProjectWelcome';
import { QuickOpen } from './components/QuickOpen';
import { AIChat } from './components/AIChat';
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
  onFileSave: (callback: () => void) => () => void;
  onFileSaveAs: (callback: () => void) => () => void;
  onFileOpenedFromOS: (callback: (data: { filePath: string; content: string }) => void) => () => void;
  onNewUntitledDocument: (callback: (data: { untitledName: string }) => void) => () => void;
  onToggleSearch: (callback: () => void) => () => void;
  onToggleSearchReplace: (callback: () => void) => () => void;
  onFileDeleted: (callback: (data: { filePath: string }) => void) => () => void;
  onFileRenamed: (callback: (data: { oldPath: string; newPath: string }) => void) => () => void;
  onProjectFileTreeUpdated: (callback: (data: { fileTree: FileTreeItem[]; addedPath?: string; removedPath?: string }) => void) => () => void;
  onThemeChange: (callback: (theme: string) => void) => () => void;
  onShowAbout: (callback: () => void) => () => void;
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
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}


export default function App() {
  console.log('[RENDERER] App component rendering at', new Date().toISOString());
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
  const getContentRef = useRef<(() => string) | null>(null);
  const initialContentRef = useRef<string>('');
  const editorRef = useRef<any>(null);
  const searchCommandRef = useRef<LexicalCommand<undefined> | null>(null);
  const contentVersionRef = useRef<number>(0);
  const isInitializedRef = useRef<boolean>(false);
  const autoSaveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isResizingRef = useRef<boolean>(false);

  // Log mount/unmount
  useEffect(() => {
    console.log('[RENDERER] App component mounted at', new Date().toISOString());
    return () => {
      console.log('[RENDERER] App component unmounting at', new Date().toISOString());
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
      
      window.electronAPI.getAIChatState?.().then((state) => {
        if (state) {
          setIsAIChatCollapsed(state.collapsed);
          setAIChatWidth(state.width);
        }
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
    if (!projectMode) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+E (Mac) or Ctrl+E (Windows/Linux) for Quick Open
      if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
        e.preventDefault();
        setIsQuickOpenVisible(true);
      }
      // Cmd+Shift+A (Mac) or Ctrl+Shift+A (Windows/Linux) for AI Chat
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'a') {
        e.preventDefault();
        setIsAIChatCollapsed(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [projectMode]);

  // Save AI Chat state when it changes
  useEffect(() => {
    if (window.electronAPI?.setAIChatState) {
      window.electronAPI.setAIChatState({ collapsed: isAIChatCollapsed, width: aiChatWidth });
    }
  }, [isAIChatCollapsed, aiChatWidth]);

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

  // Autosave functionality
  useEffect(() => {
    // Clear any existing interval
    if (autoSaveIntervalRef.current) {
      clearInterval(autoSaveIntervalRef.current);
      autoSaveIntervalRef.current = null;
    }

    // Set up autosave if we have a file path and the document is dirty
    if (currentFilePath && isDirty && getContentRef.current) {
      console.log('Starting autosave interval');
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
              console.log('[AUTOSAVE] Save returned null');
            }
          } catch (error) {
            console.error('[AUTOSAVE] Autosave failed:', error);
          }
        } else {
          console.log('[AUTOSAVE] Skipping autosave:', {
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
  }, [currentFilePath, isDirty]);

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
    cleanupFns.push(window.electronAPI.onProjectOpened((data) => {
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
    }));
    cleanupFns.push(window.electronAPI.onFileOpenedFromOS((data) => {
      console.log('File opened from OS:', data.filePath);
      contentVersionRef.current += 1;
      isInitializedRef.current = false;
      setContent(data.content);
      setCurrentFilePath(data.filePath);
      setCurrentFileName(data.filePath.split('/').pop() || data.filePath);
      setIsDirty(false);
      initialContentRef.current = data.content;
    }));
    cleanupFns.push(window.electronAPI.onNewUntitledDocument((data) => {
      console.log('[RENDERER] Received new-untitled-document event:', data.untitledName);
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
    cleanupFns.push(window.electronAPI.onThemeChange((newTheme) => {
      console.log('Theme changed to:', newTheme);
      // Map 'system' to 'auto' for the editor
      const editorTheme = newTheme === 'system' ? 'auto' : newTheme;
      setTheme(editorTheme as ConfigTheme);
      console.log('Editor theme set to:', editorTheme);
    }));
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

    // Clean up listeners when dependencies change
    return () => {
      console.log('Cleaning up IPC listeners');
      cleanupFns.forEach(cleanup => cleanup());
    };
  }, [handleNew, handleOpen, handleSave, handleSaveAs, currentFilePath]);

  console.log('Rendering App with config:', {
    contentLength: content.length,
    currentFileName,
    theme
  });

  console.log('[RENDERER] About to render StravuEditor at', new Date().toISOString());

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
            console.log('Content changed:', newContent.length, 'initialized:', isInitializedRef.current);

            // Mark as initialized after first content change
            if (!isInitializedRef.current) {
              isInitializedRef.current = true;
              // Update initial content reference on first change
              if (getContentRef.current) {
                initialContentRef.current = getContentRef.current();
                console.log('Set initial content on first change');
              }
              return;
            }

            // Check if content actually changed from initial
            if (getContentRef.current) {
              const currentContent = getContentRef.current();
              const hasChanged = currentContent !== initialContentRef.current;
              if (hasChanged !== isDirty) {
                console.log('Dirty state changed to:', hasChanged);
                setIsDirty(hasChanged);
              }
            }
          },
          onGetContent: (getContentFn) => {
            console.log('[RENDERER] Received getContent function at', new Date().toISOString());
            getContentRef.current = getContentFn;
          },
          onEditorReady: (editor) => {
            console.log('[RENDERER] Editor ready at', new Date().toISOString());
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
    </div>
  );
}
