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
  onFileNewInWorkspace: (callback: () => void) => {
    ipcRenderer.on('file-new-in-workspace', callback);
    return () => ipcRenderer.removeListener('file-new-in-workspace', callback);
  },
  onFileOpen: (callback: () => void) => {
    ipcRenderer.on('file-open', callback);
    return () => ipcRenderer.removeListener('file-open', callback);
  },
  onWorkspaceOpened: (callback: (data: { workspacePath: string; workspaceName: string; fileTree: any[] }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('workspace-opened', handler);
    return () => ipcRenderer.removeListener('workspace-opened', handler);
  },
  onOpenWorkspaceFile: (callback: (filePath: string) => void) => {
    const handler = (_event: any, filePath: string) => callback(filePath);
    ipcRenderer.on('open-workspace-file', handler);
    return () => ipcRenderer.removeListener('open-workspace-file', handler);
  },
  onOpenDocument: (callback: (data: { path: string }) => void) => {
    const handler = (_event: any, data: { path: string }) => callback(data);
    ipcRenderer.on('open-document', handler);
    return () => ipcRenderer.removeListener('open-document', handler);
  },
  onOpenWorkspaceFromCLI: (callback: (workspacePath: string) => void) => {
    const handler = (_event: any, workspacePath: string) => callback(workspacePath);
    ipcRenderer.on('open-workspace-from-cli', handler);
    return () => ipcRenderer.removeListener('open-workspace-from-cli', handler);
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
  onToggleAgentPalette: (callback: () => void) => {
    ipcRenderer.on('toggle-agent-palette', callback);
    return () => ipcRenderer.removeListener('toggle-agent-palette', callback);
  },
  onOpenWelcomeTab: (callback: () => void) => {
    ipcRenderer.on('open-welcome-tab', callback);
    return () => ipcRenderer.removeListener('open-welcome-tab', callback);
  },
  onOpenPlansTab: (callback: () => void) => {
    ipcRenderer.on('open-plans-tab', callback);
    return () => ipcRenderer.removeListener('open-plans-tab', callback);
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

  onNextTab: (callback: () => void) => {
    ipcRenderer.on('next-tab', callback);
    return () => ipcRenderer.removeListener('next-tab', callback);
  },

  onPreviousTab: (callback: () => void) => {
    ipcRenderer.on('previous-tab', callback);
    return () => ipcRenderer.removeListener('previous-tab', callback);
  },

  onApproveAction: (callback: () => void) => {
    ipcRenderer.on('approve-action', callback);
    return () => ipcRenderer.removeListener('approve-action', callback);
  },

  onRejectAction: (callback: () => void) => {
    ipcRenderer.on('reject-action', callback);
    return () => ipcRenderer.removeListener('reject-action', callback);
  },

  onLoadSessionFromManager: (callback: (data: { sessionId: string; workspacePath?: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('load-session-from-manager', handler);
    return () => ipcRenderer.removeListener('load-session-from-manager', handler);
  },

  // Theme operations
  getTheme: () => ipcRenderer.invoke('get-theme'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  setTheme: (theme: string) => ipcRenderer.invoke('set-theme', theme),

  // File operations
  openFile: () => ipcRenderer.invoke('open-file'),
  saveFile: (content: string, filePath: string) => {
    if (!filePath) {
      throw new Error('saveFile requires a filePath parameter. Use saveFileAs for save dialogs.');
    }
    return ipcRenderer.invoke('save-file', content, filePath);
  },
  saveFileAs: (content: string) => ipcRenderer.invoke('save-file-as', content),
  showErrorDialog: (title: string, message: string) => ipcRenderer.invoke('show-error-dialog', title, message),

  // Window operations
  setDocumentEdited: (edited: boolean) => ipcRenderer.send('set-document-edited', edited),
  setTitle: (title: string) => ipcRenderer.send('set-title', title),
  setCurrentFile: (filePath: string | null) => ipcRenderer.send('set-current-file', filePath),

  // Get initial window state
  getInitialState: () => ipcRenderer.invoke('get-initial-state'),
  // Workspace operations
  getFolderContents: (dirPath: string) => ipcRenderer.invoke('get-folder-contents', dirPath),
  createFile: (filePath: string, content: string) => ipcRenderer.invoke('create-file', filePath, content),
  createFolder: (folderPath: string) => ipcRenderer.invoke('create-folder', folderPath),
  switchWorkspaceFile: (filePath: string) => ipcRenderer.invoke('switch-workspace-file', filePath),
  readFileContent: (filePath: string) => ipcRenderer.invoke('read-file-content', filePath),

  // File context menu operations
  renameFile: (oldPath: string, newName: string) => ipcRenderer.invoke('rename-file', oldPath, newName),
  deleteFile: (filePath: string) => ipcRenderer.invoke('delete-file', filePath),
  openFileInNewWindow: (filePath: string) => ipcRenderer.invoke('open-file-in-new-window', filePath),
  openSessionManager: (filterWorkspace?: string) => ipcRenderer.invoke('open-session-manager', filterWorkspace),
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

  onWorkspaceFileTreeUpdated: (callback: (data: { fileTree: any[]; addedPath?: string; removedPath?: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('workspace-file-tree-updated', handler);
    return () => ipcRenderer.removeListener('workspace-file-tree-updated', handler);
  },

  onFileChangedOnDisk: (callback: (data: { path: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('file-changed-on-disk', handler);
    return () => ipcRenderer.removeListener('file-changed-on-disk', handler);
  },

  // Settings operations
  getSidebarWidth: (workspacePath: string) => ipcRenderer.invoke('get-sidebar-width', workspacePath),
  setSidebarWidth: (workspacePath: string, width: number) => ipcRenderer.send('set-sidebar-width', { workspacePath, width }),
  getAIChatState: (workspacePath: string) => ipcRenderer.invoke('get-ai-chat-state', workspacePath),
  setAIChatState: (state: { collapsed: boolean; width: number; sessionId?: string; workspacePath: string }) => ipcRenderer.send('set-ai-chat-state', state),

  // QuickOpen operations
  searchWorkspaceFiles: (workspacePath: string, query: string) => ipcRenderer.invoke('search-workspace-files', workspacePath, query),
  searchWorkspaceFileNames: (workspacePath: string, query: string) => ipcRenderer.invoke('search-workspace-file-names', workspacePath, query),
  searchWorkspaceFileContent: (workspacePath: string, query: string) => ipcRenderer.invoke('search-workspace-file-content', workspacePath, query),
  getRecentWorkspaceFiles: () => ipcRenderer.invoke('get-recent-workspace-files'),
  addToWorkspaceRecentFiles: (filePath: string) => ipcRenderer.send('add-to-workspace-recent-files', filePath),

  // Tab state operations (includes navigation history)
  getWorkspaceTabState: () => ipcRenderer.invoke('get-workspace-tab-state'),
  saveWorkspaceTabState: (tabState: any) => ipcRenderer.send('save-workspace-tab-state', tabState),
  clearWorkspaceTabState: () => ipcRenderer.send('clear-workspace-tab-state'),

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
  aiHasApiKey: () => ipcRenderer.invoke('ai:hasApiKey'),
  aiInitialize: (provider?: string, apiKey?: string) => ipcRenderer.invoke('ai:initialize', provider, apiKey),
  aiCreateSession: (provider: 'claude' | 'claude-code' | 'openai' | 'lmstudio', documentContext?: any, workspacePath?: string, modelId?: string) =>
    ipcRenderer.invoke('ai:createSession', provider, documentContext, workspacePath, modelId),
  aiSendMessage: (message: string, documentContext?: any, sessionId?: string, workspacePath?: string) =>
    ipcRenderer.invoke('ai:sendMessage', message, documentContext, sessionId, workspacePath),
  aiGetSessions: (workspacePath?: string) => ipcRenderer.invoke('ai:getSessions', workspacePath),
  aiLoadSession: (sessionId: string, workspacePath?: string) => ipcRenderer.invoke('ai:loadSession', sessionId, workspacePath),
  aiClearSession: () => ipcRenderer.invoke('ai:clearSession'),
  aiUpdateSessionMessages: (sessionId: string, messages: any[], workspacePath?: string) =>
    ipcRenderer.invoke('ai:updateSessionMessages', sessionId, messages, workspacePath),
  aiSaveDraftInput: (sessionId: string, draftInput: string, workspacePath?: string) =>
    ipcRenderer.invoke('ai:saveDraftInput', sessionId, draftInput, workspacePath),
  aiDeleteSession: (sessionId: string, workspacePath?: string) => ipcRenderer.invoke('ai:deleteSession', sessionId, workspacePath),
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

  // CLI management
  cliCheckInstallation: (tool: string) => ipcRenderer.invoke('cli:checkInstallation', tool),
  cliInstall: (tool: string, options: any) => ipcRenderer.invoke('cli:install', tool, options),
  cliUninstall: (tool: string) => ipcRenderer.invoke('cli:uninstall', tool),
  cliUpgrade: (tool: string) => ipcRenderer.invoke('cli:upgrade', tool),
  cliCheckNpmAvailable: () => ipcRenderer.invoke('cli:checkNpmAvailable'),
  cliInstallNodeJs: () => ipcRenderer.invoke('cli:installNodeJs'),

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
  onAIApplyDiff: (callback: (data: { replacements: any[], resultChannel: string, targetFilePath?: string }) => void) => {
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
  onAIPerformanceMetrics: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('ai:performanceMetrics', handler);
    return () => ipcRenderer.removeListener('ai:performanceMetrics', handler);
  },
  onAIGetDocumentContent: (callback: (data: { resultChannel: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('ai:getDocumentContent', handler);
    return () => ipcRenderer.removeListener('ai:getDocumentContent', handler);
  },
  onAIUpdateFrontmatter: (callback: (data: { updates: Record<string, any>, resultChannel: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('ai:updateFrontmatter', handler);
    return () => ipcRenderer.removeListener('ai:updateFrontmatter', handler);
  },
  onAICreateDocument: (callback: (data: { filePath: string; initialContent?: string; switchToFile?: boolean; resultChannel: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('ai:createDocument', handler);
    return () => ipcRenderer.removeListener('ai:createDocument', handler);
  },

  // AI result senders
  sendAIApplyDiffResult: (resultChannel: string, result: any) => {
    ipcRenderer.send(resultChannel, result);
  },
  sendAIGetDocumentContentResult: (resultChannel: string, result: any) => {
    ipcRenderer.send(resultChannel, result);
  },
  sendAIUpdateFrontmatterResult: (resultChannel: string, result: any) => {
    ipcRenderer.send(resultChannel, result);
  },
  sendAICreateDocumentResult: (resultChannel: string, result: any) => {
    ipcRenderer.send(resultChannel, result);
  },

  // Additional AI operations that weren't in the first block
  aiCancelRequest: () => ipcRenderer.invoke('ai:cancelRequest'),
  aiApplyEdit: (edit: any) => ipcRenderer.invoke('ai:applyEdit', edit),
  onAIEditRequest: (callback: (edit: any) => void) => {
    const handler = (_event: any, edit: any) => callback(edit);
    ipcRenderer.on('ai:editRequest', handler);
    return () => ipcRenderer.removeListener('ai:editRequest', handler);
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
    hasApiKey: () => ipcRenderer.invoke('ai:hasApiKey'),
    initialize: (provider?: string, apiKey?: string) => ipcRenderer.invoke('ai:initialize', provider, apiKey),
    createSession: (provider: 'claude' | 'claude-code' | 'openai' | 'lmstudio', documentContext?: any, workspacePath?: string, modelId?: string) =>
      ipcRenderer.invoke('ai:createSession', provider, documentContext, workspacePath, modelId),
    sendMessage: (message: string, documentContext?: any, sessionId?: string, workspacePath?: string) =>
      ipcRenderer.invoke('ai:sendMessage', message, documentContext, sessionId, workspacePath),
    getSessions: (workspacePath?: string) => ipcRenderer.invoke('ai:getSessions', workspacePath),
    loadSession: (sessionId: string, workspacePath?: string) => ipcRenderer.invoke('ai:loadSession', sessionId, workspacePath),
    clearSession: () => ipcRenderer.invoke('ai:clearSession'),
    updateSessionMessages: (sessionId: string, messages: any[], workspacePath?: string) =>
      ipcRenderer.invoke('ai:updateSessionMessages', sessionId, messages, workspacePath),
    saveDraftInput: (sessionId: string, draftInput: string, workspacePath?: string) =>
      ipcRenderer.invoke('ai:saveDraftInput', sessionId, draftInput, workspacePath),
    deleteSession: (sessionId: string, workspacePath?: string) => ipcRenderer.invoke('ai:deleteSession', sessionId, workspacePath),
    getSettings: () => ipcRenderer.invoke('ai:getSettings'),
    saveSettings: (settings: any) => ipcRenderer.invoke('ai:saveSettings', settings),
    testConnection: (provider: string) => ipcRenderer.invoke('ai:testConnection', provider),
    getModels: () => ipcRenderer.invoke('ai:getModels'),

    // Session Manager specific methods
    getAllSessions: () => ipcRenderer.invoke('session-manager:get-all-sessions'),
    openSessionInWindow: (sessionId: string, workspacePath?: string) =>
      ipcRenderer.invoke('session-manager:open-session', sessionId, workspacePath),
    exportSession: (session: any) => ipcRenderer.invoke('session-manager:export-session', session),
  },

  // Workspace Manager
  workspaceManager: {
    getRecentWorkspaces: () => ipcRenderer.invoke('workspace-manager:get-recent-workspaces'),
    getWorkspaceStats: (workspacePath: string) => ipcRenderer.invoke('workspace-manager:get-workspace-stats', workspacePath),
    openFolderDialog: () => ipcRenderer.invoke('workspace-manager:open-folder-dialog'),
    createWorkspaceDialog: () => ipcRenderer.invoke('workspace-manager:create-workspace-dialog'),
    openWorkspace: (workspacePath: string) => ipcRenderer.invoke('workspace-manager:open-workspace', workspacePath),
    removeRecent: (workspacePath: string) => ipcRenderer.invoke('workspace-manager:remove-recent', workspacePath),
  },


  // Document Service
  documentService: {
    list: () => ipcRenderer.invoke('document-service:list'),
    search: (query: string) => ipcRenderer.invoke('document-service:search', query),
    get: (id: string) => ipcRenderer.invoke('document-service:get', id),
    getByPath: (path: string) => ipcRenderer.invoke('document-service:get-by-path', path),
    open: (id: string, fallback?: { path?: string; name?: string }) => ipcRenderer.invoke('document-service:open', { documentId: id, fallback }),
    watch: () => ipcRenderer.send('document-service:watch'),
    onDocumentsChanged: (callback: (documents: any[]) => void) => {
      const handler = (_event: any, documents: any[]) => callback(documents);
      ipcRenderer.on('document-service:documents-changed', handler);
      return () => ipcRenderer.removeListener('document-service:documents-changed', handler);
    },
    loadVirtual: (virtualPath: string) => ipcRenderer.invoke('document-service:load-virtual', virtualPath)
  },
  // Open AI Models window
  openAIModels: () => ipcRenderer.invoke('window:open-ai-models'),

  // Open external links
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),

  // Generic IPC methods for services that need them
  invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
  send: (channel: string, ...args: any[]) => ipcRenderer.send(channel, ...args),
  on: (channel: string, callback: (...args: any[]) => void) => {
    const handler = (_event: any, ...args: any[]) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  off: (channel: string, callback: (...args: any[]) => void) => {
    ipcRenderer.removeListener(channel, callback);
  }
});
