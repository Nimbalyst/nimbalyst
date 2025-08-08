import { contextBridge, ipcRenderer } from 'electron';

// Capture console logs in development
if (process.env.NODE_ENV !== 'production') {
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug
  };

  const captureLog = (level: string, ...args: any[]) => {
    // Still log to original console
    originalConsole[level as keyof typeof originalConsole](...args);

    // Send to main process for file logging
    const timestamp = new Date().toISOString();
    const message = args.map(arg =>
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');

    ipcRenderer.send('console-log', {
      timestamp,
      level,
      message,
      source: 'renderer'
    });
  };

  console.log = (...args) => captureLog('log', ...args);
  console.warn = (...args) => captureLog('warn', ...args);
  console.error = (...args) => captureLog('error', ...args);
  console.info = (...args) => captureLog('info', ...args);
  console.debug = (...args) => captureLog('debug', ...args);
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  onFileNew: (callback: () => void) => {
    ipcRenderer.on('file-new', callback);
    return () => ipcRenderer.removeListener('file-new', callback);
  },
  onFileOpen: (callback: () => void) => {
    ipcRenderer.on('file-open', callback);
    return () => ipcRenderer.removeListener('file-open', callback);
  },
  onProjectOpened: (callback: (data: { projectPath: string; projectName: string; fileTree: any[] }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('project-opened', handler);
    return () => ipcRenderer.removeListener('project-opened', handler);
  },
  onFileSave: (callback: () => void) => {
    ipcRenderer.on('file-save', callback);
    return () => ipcRenderer.removeListener('file-save', callback);
  },
  onFileSaveAs: (callback: () => void) => {
    ipcRenderer.on('file-save-as', callback);
    return () => ipcRenderer.removeListener('file-save-as', callback);
  },
  onFileOpenedFromOS: (callback: (data: { filePath: string; content: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('file-opened-from-os', handler);
    return () => ipcRenderer.removeListener('file-opened-from-os', handler);
  },
  onNewUntitledDocument: (callback: (data: { untitledName: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('new-untitled-document', handler);
    return () => ipcRenderer.removeListener('new-untitled-document', handler);
  },
  onToggleSearch: (callback: () => void) => {
    ipcRenderer.on('toggle-search', callback);
    return () => ipcRenderer.removeListener('toggle-search', callback);
  },
  onToggleSearchReplace: (callback: () => void) => {
    ipcRenderer.on('toggle-search-replace', callback);
    return () => ipcRenderer.removeListener('toggle-search-replace', callback);
  },
  onFileDeleted: (callback: (data: { filePath: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('file-deleted', handler);
    return () => ipcRenderer.removeListener('file-deleted', handler);
  },
  onThemeChange: (callback: (theme: string) => void) => {
    const handler = (_event: any, theme: string) => callback(theme);
    ipcRenderer.on('theme-change', handler);
    return () => ipcRenderer.removeListener('theme-change', handler);
  },
  onShowAbout: (callback: () => void) => {
    ipcRenderer.on('show-about', callback);
    return () => ipcRenderer.removeListener('show-about', callback);
  },

  // Theme operations
  getTheme: () => ipcRenderer.invoke('get-theme'),

  // File operations
  openFile: () => ipcRenderer.invoke('open-file'),
  saveFile: (content: string) => ipcRenderer.invoke('save-file', content),
  saveFileAs: (content: string) => ipcRenderer.invoke('save-file-as', content),

  // Window operations
  setDocumentEdited: (edited: boolean) => ipcRenderer.send('set-document-edited', edited),
  setTitle: (title: string) => ipcRenderer.send('set-title', title),
  setCurrentFile: (filePath: string | null) => ipcRenderer.send('set-current-file', filePath),

  // Project operations
  getFolderContents: (dirPath: string) => ipcRenderer.invoke('get-folder-contents', dirPath),
  switchProjectFile: (filePath: string) => ipcRenderer.invoke('switch-project-file', filePath),
  
  // File context menu operations
  renameFile: (oldPath: string, newName: string) => ipcRenderer.invoke('rename-file', oldPath, newName),
  deleteFile: (filePath: string) => ipcRenderer.invoke('delete-file', filePath),
  openFileInNewWindow: (filePath: string) => ipcRenderer.invoke('open-file-in-new-window', filePath),
  showInFinder: (filePath: string) => ipcRenderer.invoke('show-in-finder', filePath),
  
  // File change event listeners
  onFileRenamed: (callback: (data: { oldPath: string; newPath: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('file-renamed', handler);
    return () => ipcRenderer.removeListener('file-renamed', handler);
  },
  
  onProjectFileTreeUpdated: (callback: (data: { fileTree: any[]; addedPath?: string; removedPath?: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('project-file-tree-updated', handler);
    return () => ipcRenderer.removeListener('project-file-tree-updated', handler);
  },
  
  // Settings operations
  getSidebarWidth: () => ipcRenderer.invoke('get-sidebar-width'),
  setSidebarWidth: (width: number) => ipcRenderer.send('set-sidebar-width', width),
});
