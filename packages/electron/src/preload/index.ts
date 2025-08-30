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
  onOpenProjectFromCLI: (callback: (projectPath: string) => void) => {
    const handler = (_event: any, projectPath: string) => callback(projectPath);
    ipcRenderer.on('open-project-from-cli', handler);
    return () => ipcRenderer.removeListener('open-project-from-cli', handler);
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
  onViewHistory: (callback: () => void) => {
    ipcRenderer.on('view-history', callback);
    return () => ipcRenderer.removeListener('view-history', callback);
  },
  
  onLoadSessionFromManager: (callback: (data: { sessionId: string; projectPath?: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('load-session-from-manager', handler);
    return () => ipcRenderer.removeListener('load-session-from-manager', handler);
  },

  // Theme operations
  getTheme: () => ipcRenderer.invoke('get-theme'),
  setTheme: (theme: string) => ipcRenderer.invoke('set-theme', theme),

  // File operations
  openFile: () => ipcRenderer.invoke('open-file'),
  saveFile: (content: string) => ipcRenderer.invoke('save-file', content),
  saveFileAs: (content: string) => ipcRenderer.invoke('save-file-as', content),
  showErrorDialog: (title: string, message: string) => ipcRenderer.invoke('show-error-dialog', title, message),

  // Window operations
  setDocumentEdited: (edited: boolean) => ipcRenderer.send('set-document-edited', edited),
  setTitle: (title: string) => ipcRenderer.send('set-title', title),
  setCurrentFile: (filePath: string | null) => ipcRenderer.send('set-current-file', filePath),

  // Project operations
  getFolderContents: (dirPath: string) => ipcRenderer.invoke('get-folder-contents', dirPath),
  createFile: (filePath: string, content: string) => ipcRenderer.invoke('create-file', filePath, content),
  createFolder: (folderPath: string) => ipcRenderer.invoke('create-folder', folderPath),
  switchProjectFile: (filePath: string) => ipcRenderer.invoke('switch-project-file', filePath),
  
  // File context menu operations
  renameFile: (oldPath: string, newName: string) => ipcRenderer.invoke('rename-file', oldPath, newName),
  deleteFile: (filePath: string) => ipcRenderer.invoke('delete-file', filePath),
  openFileInNewWindow: (filePath: string) => ipcRenderer.invoke('open-file-in-new-window', filePath),
  openSessionManager: (filterProject?: string) => ipcRenderer.invoke('open-session-manager', filterProject),
  showInFinder: (filePath: string) => ipcRenderer.invoke('show-in-finder', filePath),
  moveFile: (sourcePath: string, targetPath: string) => ipcRenderer.invoke('move-file', sourcePath, targetPath),
  copyFile: (sourcePath: string, targetPath: string) => ipcRenderer.invoke('copy-file', sourcePath, targetPath),
  
  // File change event listeners
  onFileRenamed: (callback: (data: { oldPath: string; newPath: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('file-renamed', handler);
    return () => ipcRenderer.removeListener('file-renamed', handler);
  },
  
  onFileMoved: (callback: (data: { sourcePath: string; destinationPath: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('file-moved', handler);
    return () => ipcRenderer.removeListener('file-moved', handler);
  },
  
  onFileCopied: (callback: (data: { sourcePath: string; destinationPath: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('file-copied', handler);
    return () => ipcRenderer.removeListener('file-copied', handler);
  },
  
  onProjectFileTreeUpdated: (callback: (data: { fileTree: any[]; addedPath?: string; removedPath?: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('project-file-tree-updated', handler);
    return () => ipcRenderer.removeListener('project-file-tree-updated', handler);
  },
  
  // Settings operations
  getSidebarWidth: () => ipcRenderer.invoke('get-sidebar-width'),
  setSidebarWidth: (width: number) => ipcRenderer.send('set-sidebar-width', width),
  getAIChatState: () => ipcRenderer.invoke('get-ai-chat-state'),
  setAIChatState: (state: { collapsed: boolean; width: number }) => ipcRenderer.send('set-ai-chat-state', state),
  
  // QuickOpen operations
  searchProjectFiles: (projectPath: string, query: string) => ipcRenderer.invoke('search-project-files', projectPath, query),
  getRecentProjectFiles: () => ipcRenderer.invoke('get-recent-project-files'),
  addToProjectRecentFiles: (filePath: string) => ipcRenderer.send('add-to-project-recent-files', filePath),
  
  // History operations
  history: {
    createSnapshot: (filePath: string, state: string, type: string, description?: string) => 
      ipcRenderer.invoke('history:create-snapshot', filePath, state, type, description),
    listSnapshots: (filePath: string) => 
      ipcRenderer.invoke('history:list-snapshots', filePath),
    loadSnapshot: (filePath: string, timestamp: string) => 
      ipcRenderer.invoke('history:load-snapshot', filePath, timestamp),
    deleteSnapshot: (filePath: string, timestamp: string) => 
      ipcRenderer.invoke('history:delete-snapshot', filePath, timestamp),
  },
  
  // Session operations
  session: {
    create: (filePath: string, type: string, source?: any) => 
      ipcRenderer.invoke('session:create', filePath, type, source),
    load: (sessionId: string) => 
      ipcRenderer.invoke('session:load', sessionId),
    save: (session: any) => 
      ipcRenderer.invoke('session:save', session),
    delete: (sessionId: string) => 
      ipcRenderer.invoke('session:delete', sessionId),
    getActive: (filePath: string) => 
      ipcRenderer.invoke('session:get-active', filePath),
    setActive: (filePath: string, sessionId: string, type: string) => 
      ipcRenderer.invoke('session:set-active', filePath, sessionId, type),
    checkConflicts: (session: any, currentMarkdownHash: string) => 
      ipcRenderer.invoke('session:check-conflicts', session, currentMarkdownHash),
    resolveConflict: (session: any, resolution: string, newBaseHash?: string) => 
      ipcRenderer.invoke('session:resolve-conflict', session, resolution, newBaseHash),
    createCheckpoint: (sessionId: string, state: string) => 
      ipcRenderer.invoke('session:create-checkpoint', sessionId, state),
  },

  // AI operations (new unified interface)
  aiInitialize: (provider?: string, apiKey?: string) => ipcRenderer.invoke('ai:initialize', provider, apiKey),
  aiCreateSession: (provider: 'claude' | 'claude-code' | 'openai' | 'lmstudio', documentContext?: any, projectPath?: string, modelId?: string) => 
    ipcRenderer.invoke('ai:createSession', provider, documentContext, projectPath, modelId),
  aiSendMessage: (message: string, documentContext?: any, sessionId?: string, projectPath?: string) => 
    ipcRenderer.invoke('ai:sendMessage', message, documentContext, sessionId, projectPath),
  aiGetSessions: (projectPath?: string) => ipcRenderer.invoke('ai:getSessions', projectPath),
  aiLoadSession: (sessionId: string, projectPath?: string) => ipcRenderer.invoke('ai:loadSession', sessionId, projectPath),
  aiClearSession: () => ipcRenderer.invoke('ai:clearSession'),
  aiUpdateSessionMessages: (sessionId: string, messages: any[], projectPath?: string) => 
    ipcRenderer.invoke('ai:updateSessionMessages', sessionId, messages, projectPath),
  aiSaveDraftInput: (sessionId: string, draftInput: string, projectPath?: string) => 
    ipcRenderer.invoke('ai:saveDraftInput', sessionId, draftInput, projectPath),
  aiDeleteSession: (sessionId: string, projectPath?: string) => ipcRenderer.invoke('ai:deleteSession', sessionId, projectPath),
  getAISettings: () => ipcRenderer.invoke('ai:getSettings'),
  saveAISettings: (settings: any) => ipcRenderer.invoke('ai:saveSettings', settings),
  testAIConnection: (provider: 'claude' | 'claude-code' | 'openai' | 'lmstudio') => ipcRenderer.invoke('ai:testConnection', provider),
  getAIModels: () => ipcRenderer.invoke('ai:getModels'),
  // Aliases for consistency with component naming
  aiGetSettings: () => ipcRenderer.invoke('ai:getSettings'),
  aiSaveSettings: (settings: any) => ipcRenderer.invoke('ai:saveSettings', settings),
  aiTestConnection: (provider: string) => ipcRenderer.invoke('ai:testConnection', provider),
  aiGetModels: () => ipcRenderer.invoke('ai:getModels'),
  aiGetAllModels: () => ipcRenderer.invoke('ai:getAllModels'),
  aiClearModelCache: () => ipcRenderer.invoke('ai:clearModelCache'),
  
  // AI event listeners (new)
  onAIStreamResponse: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('ai:streamResponse', handler);
    return () => ipcRenderer.removeListener('ai:streamResponse', handler);
  },
  onAIError: (callback: (error: any) => void) => {
    const handler = (_event: any, error: any) => callback(error);
    ipcRenderer.on('ai:error', handler);
    return () => ipcRenderer.removeListener('ai:error', handler);
  },
  onAIApplyDiff: (callback: (data: { replacements: any[], resultChannel: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('ai:applyDiff', handler);
    return () => ipcRenderer.removeListener('ai:applyDiff', handler);
  },
  onAIStreamEditStart: (callback: (config: any) => void) => {
    const handler = (_event: any, config: any) => callback(config);
    ipcRenderer.on('ai:streamEditStart', handler);
    return () => ipcRenderer.removeListener('ai:streamEditStart', handler);
  },
  onAIStreamEditContent: (callback: (content: string) => void) => {
    const handler = (_event: any, content: string) => callback(content);
    ipcRenderer.on('ai:streamEditContent', handler);
    return () => ipcRenderer.removeListener('ai:streamEditContent', handler);
  },
  onAIStreamEditEnd: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('ai:streamEditEnd', handler);
    return () => ipcRenderer.removeListener('ai:streamEditEnd', handler);
  },
  
  // AI operations
  aiSendMessage: (message: string, documentContext?: any, sessionId?: string, projectPath?: string) => 
    ipcRenderer.invoke('ai:sendMessage', message, documentContext, sessionId, projectPath),
  aiGetSessions: (projectPath?: string) => ipcRenderer.invoke('ai:getSessions', projectPath),
  aiLoadSession: (sessionId: string, projectPath?: string) => ipcRenderer.invoke('ai:loadSession', sessionId, projectPath),
  aiClearSession: () => ipcRenderer.invoke('ai:clearSession'),
  aiUpdateSessionMessages: (sessionId: string, messages: any[], projectPath?: string) => 
    ipcRenderer.invoke('ai:updateSessionMessages', sessionId, messages, projectPath),
  aiSaveDraftInput: (sessionId: string, draftInput: string, projectPath?: string) => 
    ipcRenderer.invoke('ai:saveDraftInput', sessionId, draftInput, projectPath),
  aiDeleteSession: (sessionId: string, projectPath?: string) => ipcRenderer.invoke('ai:deleteSession', sessionId, projectPath),
  aiCancelRequest: () => ipcRenderer.invoke('ai:cancelRequest'),
  aiApplyEdit: (edit: any) => ipcRenderer.invoke('ai:applyEdit', edit),
  
  // AI event listeners
  onAIStreamResponse: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('ai:streamResponse', handler);
    return () => ipcRenderer.removeListener('ai:streamResponse', handler);
  },
  onAIEditRequest: (callback: (edit: any) => void) => {
    const handler = (_event: any, edit: any) => callback(edit);
    ipcRenderer.on('ai:editRequest', handler);
    return () => ipcRenderer.removeListener('ai:editRequest', handler);
  },

  // Preferences operations
  openDataFolder: () => ipcRenderer.invoke('preferences:openDataFolder'),
  onShowPreferences: (callback: () => void) => {
    ipcRenderer.on('show-preferences', callback);
    return () => ipcRenderer.removeListener('show-preferences', callback);
  },

  // MCP Server operations
  onMcpApplyDiff: (callback: (data: { replacements: any[], resultChannel: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('mcp:applyDiff', handler);
    return () => ipcRenderer.removeListener('mcp:applyDiff', handler);
  },
  onMcpStreamContent: (callback: (data: { streamId: string, content: string, position: string, insertAfter?: string, mode?: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('mcp:streamContent', handler);
    return () => ipcRenderer.removeListener('mcp:streamContent', handler);
  },
  onMcpNavigateTo: (callback: (data: { line: number, column: number }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('mcp:navigateTo', handler);
    return () => ipcRenderer.removeListener('mcp:navigateTo', handler);
  },
  sendMcpApplyDiffResult: (resultChannel: string, result: any) => {
    // Ensure result has the required structure
    const safeResult = {
      success: result?.success ?? false,
      error: result?.error || (result?.success === false ? 'Unknown error' : undefined)
    };
    ipcRenderer.send(resultChannel, safeResult);
  },
  updateMcpDocumentState: (state: any) => 
    ipcRenderer.send('mcp:updateDocumentState', state),
  clearMcpDocumentState: () => ipcRenderer.invoke('mcp:clearDocumentState'),

  // AI object wrapper for cleaner component access
  ai: {
    initialize: (provider?: string, apiKey?: string) => ipcRenderer.invoke('ai:initialize', provider, apiKey),
    createSession: (provider: 'claude' | 'claude-code' | 'openai' | 'lmstudio', documentContext?: any, projectPath?: string, modelId?: string) => 
      ipcRenderer.invoke('ai:createSession', provider, documentContext, projectPath, modelId),
    sendMessage: (message: string, documentContext?: any, sessionId?: string, projectPath?: string) => 
      ipcRenderer.invoke('ai:sendMessage', message, documentContext, sessionId, projectPath),
    getSessions: (projectPath?: string) => ipcRenderer.invoke('ai:getSessions', projectPath),
    loadSession: (sessionId: string, projectPath?: string) => ipcRenderer.invoke('ai:loadSession', sessionId, projectPath),
    clearSession: () => ipcRenderer.invoke('ai:clearSession'),
    updateSessionMessages: (sessionId: string, messages: any[], projectPath?: string) => 
      ipcRenderer.invoke('ai:updateSessionMessages', sessionId, messages, projectPath),
    saveDraftInput: (sessionId: string, draftInput: string, projectPath?: string) => 
      ipcRenderer.invoke('ai:saveDraftInput', sessionId, draftInput, projectPath),
    deleteSession: (sessionId: string, projectPath?: string) => ipcRenderer.invoke('ai:deleteSession', sessionId, projectPath),
    getSettings: () => ipcRenderer.invoke('ai:getSettings'),
    saveSettings: (settings: any) => ipcRenderer.invoke('ai:saveSettings', settings),
    testConnection: (provider: string) => ipcRenderer.invoke('ai:testConnection', provider),
    getModels: () => ipcRenderer.invoke('ai:getModels'),
    
    // Session Manager specific methods
    getAllSessions: () => ipcRenderer.invoke('session-manager:get-all-sessions'),
    openSessionInWindow: (sessionId: string, projectPath?: string) => 
      ipcRenderer.invoke('session-manager:open-session', sessionId, projectPath),
    exportSession: (session: any) => ipcRenderer.invoke('session-manager:export-session', session),
  },

  // Project Manager
  projectManager: {
    getRecentProjects: () => ipcRenderer.invoke('project-manager:get-recent-projects'),
    getProjectStats: (projectPath: string) => ipcRenderer.invoke('project-manager:get-project-stats', projectPath),
    openFolderDialog: () => ipcRenderer.invoke('project-manager:open-folder-dialog'),
    createProjectDialog: () => ipcRenderer.invoke('project-manager:create-project-dialog'),
    openProject: (projectPath: string) => ipcRenderer.invoke('project-manager:open-project', projectPath),
    removeRecent: (projectPath: string) => ipcRenderer.invoke('project-manager:remove-recent', projectPath),
  }
});
