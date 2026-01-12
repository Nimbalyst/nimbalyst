interface FileTreeItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeItem[];
}

interface ClaudeForWindowsInstallation {
  isPlatformWindows: boolean;
  gitVersion?: string;
  claudeCodeVersion?: string;
}

interface HistoryTag {
  id: string;
  filePath: string;
  content: string;
  sessionId: string;
  toolUseId: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

interface ElectronAPI {
  // File menu callbacks
  onFileNew: (callback: () => void) => () => void;
  onFileNewInWorkspace: (callback: () => void) => () => void;
  onAgentNewSession: (callback: () => void) => () => void;
  onFileOpen: (callback: () => void) => () => void;
  onFileSave: (callback: () => void) => () => void;
  onFileSaveAs: (callback: () => void) => () => void;
  onNewUntitledDocument: (callback: (data: { untitledName: string }) => void) => () => void;

  // Workspace callbacks
  onWorkspaceOpened: (callback: (data: { workspacePath: string; workspaceName: string; fileTree: FileTreeItem[] }) => void) => () => void;
  onOpenWorkspaceFile: (callback: (filePath: string) => void) => () => void;
  onOpenDocument: (callback: (data: { path: string }) => void) => () => void;
  onOpenWorkspaceFromCLI: (callback: (workspacePath: string) => void) => () => void;
  onWorkspaceFileTreeUpdated: (callback: (data: { fileTree: FileTreeItem[]; addedPath?: string; removedPath?: string }) => void) => () => void;

  // File event callbacks
  onFileDeleted: (callback: (data: { filePath: string }) => void) => () => void;
  onFileRenamed: (callback: (data: { oldPath: string; newPath: string }) => void) => () => void;
  onFileMoved: (callback: (data: { sourcePath: string; destinationPath: string }) => void) => () => void;
  onFileCopied: (callback: (data: { sourcePath: string; destinationPath: string }) => void) => () => void;
  onFileChangedOnDisk: (callback: (data: { path: string }) => void) => () => void;

  // UI callbacks
  onToggleSearch: (callback: () => void) => () => void;
  onToggleSearchReplace: (callback: () => void) => () => void;
  onToggleAgentPalette: (callback: () => void) => () => void;
  onOpenWelcomeTab: (callback: () => void) => () => void;
  onOpenPlansTab: (callback: () => void) => () => void;
  onOpenKeyboardShortcuts: (callback: () => void) => () => void;
  onThemeChange: (callback: (theme: string) => void) => () => void;
  onShowAbout: (callback: () => void) => () => void;
  onViewHistory: (callback: () => void) => () => void;
  onViewWorkspaceHistory: (callback: () => void) => () => void;
  onShowPreferences?: (callback: () => void) => () => void;
  onApproveAction: (callback: () => void) => () => void;
  onRejectAction: (callback: () => void) => () => void;
  onCopyAsMarkdown: (callback: () => void) => () => void;

  // Tab callbacks
  onNextTab: (callback: () => void) => () => void;
  onPreviousTab: (callback: () => void) => () => void;

  // Session callbacks
  onLoadSessionFromManager: (callback: (data: { sessionId: string; workspacePath?: string }) => void) => () => void;

  // Theme operations
  getTheme: () => Promise<string>;
  getThemeSync: () => string;
  getAppVersion: () => Promise<string>;
  setTheme: (theme: string) => Promise<void>;

  // File operations
  openFile: () => Promise<{ filePath: string; content: string } | null>;
  saveFile: (content: string, filePath: string) => Promise<{ success: boolean; filePath: string; conflict?: boolean; diskContent?: string } | null>;
  saveFileAs: (content: string) => Promise<{ success: boolean; filePath: string } | null>;
  showErrorDialog: (title: string, message: string) => Promise<void>;

  setDocumentEdited: (edited: boolean) => void;
  setTitle: (title: string) => void;
  setCurrentFile: (filePath: string | null) => void;
  sendToMainWindow?: (channel: string, data: unknown) => Promise<void>;

  // Get initial window state
  getInitialState: () => Promise<{ mode: string; workspacePath?: string; workspaceName?: string; fileTree?: FileTreeItem[] } | null>;

  // Workspace operations
  getFolderContents: (dirPath: string) => Promise<FileTreeItem[]>;
  refreshFolderContents: (folderPath: string) => Promise<FileTreeItem[]>;
  createFile: (filePath: string, content: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
  createFolder: (folderPath: string) => Promise<{ success: boolean; error?: string }>;
  switchWorkspaceFile: (filePath: string) => Promise<{ filePath: string; content: string } | { error: string } | null>;
  readFileContent: (filePath: string, options?: { binary?: boolean }) => Promise<
    | { success: true; content: string; isBinary: true }
    | { success: true; content: string; isBinary: false; detectedEncoding?: BufferEncoding }
    | { success: false; error: string }
    | null
  >;

  // File context menu operations
  renameFile: (oldPath: string, newName: string) => Promise<{ success: boolean; newPath?: string; error?: string }>;
  deleteFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  openInDefaultApp: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  openSessionManager: (filterWorkspace?: string) => Promise<void>;
  showInFinder: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  moveFile: (sourcePath: string, targetPath: string) => Promise<{ success: boolean; newPath?: string; error?: string }>;
  copyFile: (sourcePath: string, targetPath: string) => Promise<{ success: boolean; newPath?: string; error?: string }>;

  // Settings operations
  getSidebarWidth: (workspacePath: string) => Promise<number>;
  setSidebarWidth: (workspacePath: string, width: number) => void;

  // QuickOpen operations
  buildQuickOpenCache: (workspacePath: string) => Promise<{ success: boolean; fileCount?: number; error?: string }>;
  searchWorkspaceFiles: (workspacePath: string, query: string) => Promise<any[]>;
  searchWorkspaceFileNames: (workspacePath: string, query: string) => Promise<any[]>;
  searchWorkspaceFileContent: (workspacePath: string, query: string) => Promise<any[]>;
  getRecentWorkspaceFiles: () => Promise<string[]>;
  addToWorkspaceRecentFiles: (filePath: string) => void;

  // History operations
  history: {
    createSnapshot: (filePath: string, state: string, type: string, description?: string) => Promise<void>;
    listSnapshots: (filePath: string) => Promise<any[]>;
    loadSnapshot: (filePath: string, timestamp: string) => Promise<string>;
    deleteSnapshot: (filePath: string, timestamp: string) => Promise<void>;
    getPendingTags: (filePath?: string) => Promise<HistoryTag[]>;
    createTag: (filePath: string, tagId: string, content: string, sessionId: string, toolUseId: string) => Promise<void>;
    getTag: (filePath: string, tagId: string) => Promise<HistoryTag | null>;
    updateTagStatus: (filePath: string, tagId: string, status: string, workspacePath?: string) => Promise<void>;
    updateTagContent: (filePath: string, tagId: string, content: string) => Promise<void>;
    getPendingCount: (workspacePath: string) => Promise<number>;
    getPendingCountForSession: (workspacePath: string, sessionId: string) => Promise<number>;
    getPendingFilesForSession: (workspacePath: string, sessionId: string) => Promise<string[]>;
    clearAllPending: (workspacePath: string) => Promise<void>;
    clearPendingForSession: (workspacePath: string, sessionId: string) => Promise<void>;
    onPendingCountChanged: (callback: (data: { workspacePath: string; count: number }) => void) => () => void;
    onPendingCleared: (callback: (data: { workspacePath: string; sessionId?: string; clearedFiles: string[] }) => void) => () => void;
  };

  // Session operations
  session: {
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

  // Session state tracking operations
  sessionState: {
    getActiveSessionIds: () => Promise<{ success: boolean; sessionIds: string[]; error?: string }>;
    getSessionState: (sessionId: string) => Promise<any>;
    isSessionActive: (sessionId: string) => Promise<boolean>;
    subscribe: () => Promise<void>;
    unsubscribe: () => Promise<void>;
    startSession: (sessionId: string) => Promise<void>;
    updateActivity: (sessionId: string, status?: string, isStreaming?: boolean) => Promise<void>;
    endSession: (sessionId: string) => Promise<void>;
    interruptSession: (sessionId: string) => Promise<void>;
    onStateChange: (callback: (event: any) => void) => void;
    removeStateChangeListener: (callback: (event: any) => void) => void;
  };

  // AI operations (flat methods)
  aiHasApiKey: () => Promise<boolean>;
  aiInitialize: (provider?: string, apiKey?: string) => Promise<any>;
  aiCreateSession: (provider: 'claude' | 'claude-code' | 'openai' | 'lmstudio', documentContext?: any, workspacePath?: string, modelId?: string, sessionType?: 'chat' | 'planning' | 'coding' | 'terminal', worktreeId?: string) => Promise<any>;
  aiSendMessage: (message: string, documentContext?: any, sessionId?: string, workspacePath?: string) => Promise<any>;
  aiGetSessions: (workspacePath?: string) => Promise<any>;
  aiLoadSession: (sessionId: string, workspacePath?: string, trackAsResume?: boolean) => Promise<any>;
  aiClearSession: () => Promise<any>;
  aiUpdateSessionMessages: (sessionId: string, messages: any[], workspacePath?: string) => Promise<{ success: boolean; error?: string }>;
  aiSaveDraftInput: (sessionId: string, draftInput: string, workspacePath?: string) => Promise<{ success: boolean; error?: string }>;
  aiDeleteSession: (sessionId: string, workspacePath?: string) => Promise<{ success: boolean }>;
  aiCancelRequest: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
  aiApplyEdit: (edit: any) => Promise<any>;
  getAISettings: () => Promise<any>;
  saveAISettings: (settings: any) => Promise<void>;
  testAIConnection: (provider: 'claude' | 'claude-code' | 'openai' | 'lmstudio') => Promise<any>;
  getAIModels: () => Promise<{ success: boolean; models: any[]; grouped: Record<string, any[]> }>;
  aiGetSettings: () => Promise<any>;
  aiSaveSettings: (settings: any) => Promise<void>;
  aiTestConnection: (provider: string) => Promise<any>;
  aiGetModels: () => Promise<{ success: boolean; models: any[]; grouped: Record<string, any[]> }>;
  aiGetAllModels: () => Promise<any>;
  aiClearModelCache: () => Promise<void>;
  aiRefreshSessionProvider: (sessionId: string) => Promise<void>;

  // AI event listeners
  onAIStreamResponse: (callback: (data: any) => void) => () => void;
  onAIError: (callback: (error: any) => void) => () => void;
  onAIApplyDiff: (callback: (data: { replacements: any[], resultChannel: string, targetFilePath?: string }) => void) => () => void;
  onAIStreamEditStart: (callback: (config: any) => void) => () => void;
  onAIStreamEditContent: (callback: (data: any) => void) => () => void;
  onAIStreamEditEnd: (callback: (data: any) => void) => () => void;
  onAIPerformanceMetrics: (callback: (data: any) => void) => () => void;
  onAIGetDocumentContent: (callback: (data: { filePath?: string, resultChannel: string }) => void) => () => void;
  onAIUpdateFrontmatter: (callback: (data: { filePath?: string, updates: Record<string, any>, resultChannel: string }) => void) => () => void;
  onAICreateDocument: (callback: (data: { filePath: string; initialContent?: string; switchToFile?: boolean; resultChannel: string }) => void) => () => void;
  onAIEditRequest: (callback: (edit: any) => void) => () => void;

  // AI result senders
  sendAIApplyDiffResult: (resultChannel: string, result: any) => void;
  sendAIGetDocumentContentResult: (resultChannel: string, result: any) => void;
  sendAIUpdateFrontmatterResult: (resultChannel: string, result: any) => void;
  sendAICreateDocumentResult: (resultChannel: string, result: any) => void;

  // CLI management
  cliCheckInstallation: (tool: string) => Promise<{ installed: boolean; version?: string; path?: string }>;
  cliInstall: (tool: string, options?: any) => Promise<{ success: boolean; error?: string }>;
  cliUninstall: (tool: string) => Promise<{ success: boolean; error?: string }>;
  cliUpgrade: (tool: string) => Promise<{ success: boolean; error?: string }>;
  cliCheckNpmAvailable: () => Promise<{ available: boolean; version?: string }>;
  cliInstallNodeJs: () => Promise<{ success: boolean; error?: string }>;
  cliCheckClaudeCodeWindowsInstallation: () => Promise<ClaudeForWindowsInstallation>;

  // MCP Server operations
  onMcpApplyDiff: (callback: (data: { replacements: any[], resultChannel: string, targetFilePath?: string }) => void) => () => void;
  onMcpStreamContent: (callback: (data: { streamId: string, content: string, position: string, insertAfter?: string, mode?: string, targetFilePath?: string, resultChannel: string }) => void) => () => void;
  onMcpNavigateTo: (callback: (data: { line: number, column: number }) => void) => () => void;
  sendMcpApplyDiffResult: (resultChannel: string, result: any) => void;
  sendMcpStreamContentResult: (resultChannel: string, result: any) => void;
  updateMcpDocumentState: (state: any) => void;
  clearMcpDocumentState: () => Promise<void>;

  // Extension tool registration for MCP
  registerExtensionTools: (workspacePath: string, tools: any[]) => void;
  onExecuteExtensionTool: (callback: (data: { toolName: string; args: any; resultChannel: string; context: any }) => void) => () => void;
  sendExtensionToolResult: (resultChannel: string, result: any) => void;

  // AI object wrapper
  ai: {
    hasApiKey: () => Promise<boolean>;
    initialize: (provider?: string, apiKey?: string) => Promise<any>;
    createSession: (provider: 'claude' | 'claude-code' | 'openai' | 'lmstudio', documentContext?: any, workspacePath?: string, modelId?: string, sessionType?: 'chat' | 'planning' | 'coding' | 'terminal', worktreeId?: string) => Promise<any>;
    sendMessage: (message: string, documentContext?: any, sessionId?: string, workspacePath?: string) => Promise<any>;
    getSessions: (workspacePath?: string) => Promise<any>;
    getSessionList: (workspacePath?: string) => Promise<any>;
    loadSession: (sessionId: string, workspacePath?: string, trackAsResume?: boolean) => Promise<any>;
    clearSession: () => Promise<any>;
    updateSessionMessages: (sessionId: string, messages: any[], workspacePath?: string) => Promise<{ success: boolean; error?: string }>;
    saveDraftInput: (sessionId: string, draftInput: string, workspacePath?: string) => Promise<{ success: boolean; error?: string }>;
    deleteSession: (sessionId: string, workspacePath?: string) => Promise<{ success: boolean }>;
    getSettings: () => Promise<any>;
    saveSettings: (settings: any) => Promise<void>;
    testConnection: (provider: string) => Promise<any>;
    getModels: () => Promise<{ success: boolean; models: any[]; grouped: Record<string, any[]> }>;
    getAllSessions: () => Promise<any>;
    openSessionInWindow: (sessionId: string, workspacePath?: string) => Promise<void>;
    exportSession: (session: any) => Promise<any>;
  };

  // Workspace Manager operations
  workspaceManager: {
    getRecentWorkspaces: () => Promise<any[]>;
    getWorkspaceStats: (workspacePath: string) => Promise<any>;
    openFolderDialog: () => Promise<{ success: true; path: string } | { success: false }>;
    createWorkspaceDialog: () => Promise<{ success: true; path: string } | { success: false; error?: string }>;
    openWorkspace: (workspacePath: string) => Promise<{ success: boolean }>;
    removeRecent: (workspacePath: string) => Promise<{ success: boolean }>;
  };

  // Document Service
  documentService: {
    list: () => Promise<any[]>;
    search: (query: string) => Promise<any[]>;
    get: (id: string) => Promise<any>;
    getByPath: (path: string) => Promise<any>;
    open: (id: string, fallback?: { path?: string; name?: string }) => Promise<void>;
    watch: () => void;
    onDocumentsChanged: (callback: (documents: any[]) => void) => () => void;
    loadVirtual: (virtualPath: string) => Promise<any>;
  };

  // analytics
  analytics: {
    allowedToSendAnalytics: () => Promise<boolean>;
    getDistinctId: () => Promise<string>;
    optIn: () => Promise<void>;
    optOut: () => Promise<void>;
    setSessionId: (sessionId: string) => Promise<void>;
  };

  // Credentials (for E2E encryption key management)
  credentials: {
    get: () => Promise<{ encryptionKeySeed: string; createdAt: number; isSecure: boolean }>;
    reset: () => Promise<{ encryptionKeySeed: string; createdAt: number; isSecure: boolean }>;
    generateQRPayload: (serverUrl: string) => Promise<{
      version: number;
      serverUrl: string;
      encryptionKeySeed: string;
    }>;
    isSecure: () => Promise<boolean>;
  };

  // Network utilities
  network: {
    getLocalIP: () => Promise<string | null>;
  };

  // Stytch Authentication (for account-based sync)
  stytch: {
    getAuthState: () => Promise<{
      isAuthenticated: boolean;
      user: {
        user_id: string;
        emails: Array<{ email_id: string; email: string; verified: boolean }>;
        name?: { first_name?: string; last_name?: string };
        created_at: string;
        status: 'active' | 'pending';
      } | null;
      sessionToken: string | null;
      sessionJwt: string | null;
    }>;
    isAuthenticated: () => Promise<boolean>;
    signInWithGoogle: () => Promise<{ success: boolean; error?: string }>;
    sendMagicLink: (email: string) => Promise<{ success: boolean; error?: string }>;
    signOut: () => Promise<{ success: boolean }>;
    getSessionJwt: () => Promise<string | null>;
    refreshSession: () => Promise<boolean>;
    subscribeAuthState: () => Promise<any>;
    onAuthStateChange: (callback: (state: any) => void) => () => void;
    switchEnvironment: (environment: 'development' | 'production') => Promise<{ success: boolean; error?: string }>;
  };

  // Extensions API
  extensions: {
    listInstalled: () => Promise<Array<{ id: string; path: string; manifest: any; name: string; enabled: boolean }>>;
    getAllSettings: () => Promise<Record<string, { enabled: boolean; claudePluginEnabled?: boolean }>>;
    getEnabled: (extensionId: string) => Promise<boolean>;
    setEnabled: (extensionId: string, enabled: boolean) => Promise<{ success: boolean; error?: string }>;
    setClaudePluginEnabled: (extensionId: string, enabled: boolean) => Promise<{ success: boolean; error?: string }>;
    getClaudePluginCommands: () => Promise<Array<{
      extensionId: string;
      extensionName: string;
      pluginName: string;
      pluginNamespace: string;
      commandName: string;
      description: string;
    }>>;
    getConfig: (extensionId: string, scope?: 'user' | 'workspace', workspacePath?: string) => Promise<Record<string, unknown>>;
    setConfig: (extensionId: string, key: string, value: unknown, scope?: 'user' | 'workspace', workspacePath?: string) => Promise<{ success: boolean; error?: string }>;
    setConfigBulk: (extensionId: string, configuration: Record<string, unknown>, scope?: 'user' | 'workspace', workspacePath?: string) => Promise<{ success: boolean; error?: string }>;
    devInstall: (extensionPath: string) => Promise<{ success: boolean; extensionId?: string; symlinkPath?: string; error?: string }>;
    devUninstall: (extensionId: string) => Promise<{ success: boolean; error?: string }>;
    devReload: (extensionId: string, extensionPath: string) => Promise<{ success: boolean; error?: string }>;
    devUnload: (extensionId: string) => Promise<{ success: boolean; error?: string }>;
    onDevReload: (callback: (data: { extensionId: string; extensionPath: string }) => void) => () => void;
    onDevUnload: (callback: (data: { extensionId: string }) => void) => () => void;
  };

  // Claude Code API
  claudeCode: {
    getSettings: () => Promise<{ projectCommandsEnabled: boolean; userCommandsEnabled: boolean }>;
    setProjectCommandsEnabled: (enabled: boolean) => Promise<void>;
    setUserCommandsEnabled: (enabled: boolean) => Promise<void>;
  };

  // Extension Development Kit (EDK) API
  extensionDevTools: {
    isEnabled: () => Promise<boolean>;
    setEnabled: (enabled: boolean) => Promise<void>;
    getLogs: (filter?: {
      extensionId?: string;
      lastSeconds?: number;
      logLevel?: 'error' | 'warn' | 'info' | 'debug' | 'all';
      source?: 'renderer' | 'main' | 'build' | 'all';
    }) => Promise<{
      logs: Array<{
        timestamp: number;
        level: 'error' | 'warn' | 'info' | 'debug';
        source: 'renderer' | 'main' | 'build';
        extensionId?: string;
        message: string;
        stack?: string;
        line?: number;
        sourceFile?: string;
      }>;
      stats: {
        totalEntries: number;
        byLevel: Record<'error' | 'warn' | 'info' | 'debug', number>;
        bySource: Record<'renderer' | 'main' | 'build', number>;
      };
    }>;
    clearLogs: (extensionId?: string) => Promise<void>;
    getProcessInfo: () => Promise<{ startTime: number; uptimeSeconds: number }>;
  };

  // Terminal operations
  terminal: {
    createSession: (workspacePath: string, options?: { cwd?: string; worktreeId?: string; worktreePath?: string }) => Promise<{ success: boolean; sessionId: string; error?: string }>;
    initialize: (sessionId: string, options?: { cwd?: string; cols?: number; rows?: number }) => Promise<{ success: boolean; alreadyActive?: boolean; error?: string }>;
    isActive: (sessionId: string) => Promise<boolean>;
    write: (sessionId: string, data: string) => Promise<void>;
    resize: (sessionId: string, cols: number, rows: number) => Promise<void>;
    getScrollback: (sessionId: string) => Promise<string>;
    destroy: (sessionId: string) => Promise<void>;
    getInfo: (sessionId: string) => Promise<any>;
    onOutput: (callback: (data: { sessionId: string; data: string }) => void) => () => void;
    onExited: (callback: (data: { sessionId: string; exitCode: number }) => void) => () => void;
  };

  // Worktree operations
  worktreeCreate: (workspacePath: string, name?: string) => Promise<{
    success: boolean;
    error?: string;
    worktree?: {
      id: string;
      name: string;
      path: string;
      branch: string;
      baseBranch: string;
      projectPath: string;
      createdAt: number;
      updatedAt?: number;
    };
  }>;
  worktreeGetStatus: (worktreePath: string) => Promise<{
    success: boolean;
    error?: string;
    status?: {
      hasUncommittedChanges: boolean;
      modifiedFileCount: number;
      commitsAhead: number;
      commitsBehind: number;
      isMerged: boolean;
    };
  }>;
  worktreeDelete: (worktreeId: string, workspacePath: string) => Promise<{
    success: boolean;
    error?: string;
  }>;
  worktreeList: (workspacePath: string) => Promise<{
    success: boolean;
    error?: string;
    worktrees?: Array<{
      id: string;
      name: string;
      path: string;
      branch: string;
      baseBranch: string;
      projectPath: string;
      createdAt: number;
      updatedAt?: number;
    }>;
  }>;
  worktreeGet: (id: string) => Promise<{
    success: boolean;
    error?: string;
    worktree?: {
      id: string;
      name: string;
      path: string;
      branch: string;
      baseBranch: string;
      projectPath: string;
      createdAt: number;
      updatedAt?: number;
    } | null;
  }>;

  // Open external links
  openExternal: (url: string) => Promise<void>;

  // Image operations
  openImageInDefaultApp: (imagePath: string) => Promise<{ success: boolean; error?: string }>;
  startImageDrag: (imagePath: string) => Promise<{ success: boolean; error?: string }>;

  // Generic IPC methods for services
  invoke: (channel: string, ...args: any[]) => Promise<any>;
  send: (channel: string, ...args: any[]) => void;
  on: (channel: string, callback: (...args: any[]) => void) => () => void;
  off: (channel: string, callback: (...args: any[]) => void) => void;
}

interface InstalledExtension {
  id: string;
  path: string;
  manifest: any;
  name: string;
  enabled: boolean;
}

interface Window {
  electronAPI: ElectronAPI;
  electron: ElectronAPI; // Alias for compatibility
  PLAYWRIGHT?: boolean;
  IS_OFFICIAL_BUILD?: boolean;
  IS_DEV_MODE?: boolean;
}
