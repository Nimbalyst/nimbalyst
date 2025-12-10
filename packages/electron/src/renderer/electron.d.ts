interface FileTreeItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeItem[];
}

interface ElectronAPI {
  // File menu callbacks
  onFileNew: (callback: () => void) => () => void;
  onFileNewInWorkspace?: (callback: () => void) => () => void;
  onAgentNewSession?: (callback: () => void) => () => void;
  onFileOpen: (callback: () => void) => () => void;
  onFileSave: (callback: () => void) => () => void;
  onFileSaveAs: (callback: () => void) => () => void;
  onNewUntitledDocument: (callback: (data: { untitledName: string }) => void) => () => void;

  // Workspace callbacks
  onWorkspaceOpened: (callback: (data: { workspacePath: string; workspaceName: string; fileTree: FileTreeItem[] }) => void) => () => void;
  onOpenWorkspaceFile?: (callback: (filePath: string) => void) => () => void;
  onOpenDocument?: (callback: (data: { path: string }) => void) => () => void;
  onOpenWorkspaceFromCLI?: (callback: (workspacePath: string) => void) => () => void;
  onWorkspaceFileTreeUpdated: (callback: (data: { fileTree: FileTreeItem[]; addedPath?: string; removedPath?: string }) => void) => () => void;

  // File event callbacks
  onFileDeleted: (callback: (data: { filePath: string }) => void) => () => void;
  onFileRenamed: (callback: (data: { oldPath: string; newPath: string }) => void) => () => void;
  onFileMoved: (callback: (data: { sourcePath: string; destinationPath: string }) => void) => () => void;
  onFileCopied?: (callback: (data: { sourcePath: string; destinationPath: string }) => void) => () => void;
  onFileChangedOnDisk?: (callback: (data: { path: string }) => void) => () => void;

  // UI callbacks
  onToggleSearch: (callback: () => void) => () => void;
  onToggleSearchReplace: (callback: () => void) => () => void;
  onThemeChange: (callback: (theme: string) => void) => () => void;
  onShowAbout: (callback: () => void) => () => void;
  onViewHistory?: (callback: () => void) => () => void;
  onViewWorkspaceHistory?: (callback: () => void) => () => void;
  onShowPreferences?: (callback: () => void) => () => void;
  onApproveAction?: (callback: () => void) => () => void;
  onRejectAction?: (callback: () => void) => () => void;
  onCopyAsMarkdown?: (callback: () => void) => () => void;

  // Tab callbacks
  onNextTab?: (callback: () => void) => () => void;
  onPreviousTab?: (callback: () => void) => () => void;

  // Session callbacks
  onLoadSessionFromManager?: (callback: (data: { sessionId: string; workspacePath?: string }) => void) => () => void;

  // File operations
  getTheme: () => Promise<string>;
  openFile: () => Promise<{ filePath: string; content: string } | null>;
  saveFile: (
    content: string,
    filePath: string,
    lastKnownContent?: string
  ) => Promise<{ success: boolean; filePath: string; conflict?: boolean; diskContent?: string } | null>;
  saveFileAs: (content: string) => Promise<{ success: boolean; filePath: string } | null>;

  setDocumentEdited: (edited: boolean) => void;
  setTitle: (title: string) => void;
  setCurrentFile: (filePath: string | null) => void;

  // Get initial window state
  getInitialState?: () => Promise<{ mode: string; workspacePath?: string; workspaceName?: string; fileTree?: FileTreeItem[] } | null>;

  // Workspace operations
  getFolderContents: (dirPath: string) => Promise<FileTreeItem[]>;
  refreshFolderContents: (folderPath: string) => Promise<FileTreeItem[]>;
  switchWorkspaceFile: (filePath: string) => Promise<{ filePath: string; content: string } | null>;
  readFileContent: (filePath: string) => Promise<{ content: string } | null>;
  createFile: (filePath: string, content: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;

  // File context menu operations
  renameFile: (oldPath: string, newName: string) => Promise<{ success: boolean; newPath?: string; error?: string }>;
  deleteFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  openFileInNewWindow: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  showInFinder: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  moveFile: (sourcePath: string, targetPath: string) => Promise<{ success: boolean; newPath?: string; error?: string }>;
  copyFile: (sourcePath: string, targetPath: string) => Promise<{ success: boolean; newPath?: string; error?: string }>;

  // Settings operations
  getSidebarWidth: (workspacePath: string) => Promise<number>;
  setSidebarWidth: (workspacePath: string, width: number) => void;
  getAIChatState: (workspacePath: string) => Promise<{ collapsed: boolean; width: number; currentSessionId?: string; draftInput?: string; planningModeEnabled?: boolean } | null>;
  setAIChatState: (state: { workspacePath: string; collapsed: boolean; width: number; currentSessionId?: string; draftInput?: string; planningModeEnabled?: boolean }) => void;

  // QuickOpen operations
  buildQuickOpenCache?: (workspacePath: string) => Promise<{ success: boolean; fileCount?: number; error?: string }>;
  searchWorkspaceFiles?: (workspacePath: string, query: string) => Promise<any[]>;
  searchWorkspaceFileNames?: (workspacePath: string, query: string) => Promise<any[]>;
  searchWorkspaceFileContent?: (workspacePath: string, query: string) => Promise<any[]>;
  getRecentWorkspaceFiles?: () => Promise<string[]>;
  addToWorkspaceRecentFiles?: (filePath: string) => void;

  // Tab state operations
  getWorkspaceTabState?: () => Promise<any>;
  saveWorkspaceTabState?: (tabState: any) => void;
  clearWorkspaceTabState?: () => void;

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

  // CLI management
  cliCheckClaudeCodeWindowsInstallation: () => Promise<ClaudeForWindowsInstallation>;

  // AI operations
  aiSendMessage?: (message: string, documentContext?: any, sessionId?: string, workspacePath?: string) => Promise<any>;
  aiGetSessions?: (workspacePath?: string) => Promise<any>;
  aiLoadSession?: (sessionId: string, workspacePath?: string, trackAsResume?: boolean) => Promise<any>;
  aiClearSession?: () => Promise<any>;
  aiUpdateSessionMessages?: (sessionId: string, messages: any[], workspacePath?: string) => Promise<{ success: boolean; error?: string }>;
  aiSaveDraftInput?: (sessionId: string, draftInput: string, workspacePath?: string) => Promise<{ success: boolean; error?: string }>;
  aiDeleteSession?: (sessionId: string, workspacePath?: string) => Promise<{ success: boolean }>;
  aiCancelRequest?: () => Promise<{ success: boolean; error?: string }>;
  aiApplyEdit?: (edit: any) => Promise<any>;

  // AI event listeners
  onAIStreamResponse?: (callback: (data: any) => void) => () => void;
  onAIEditRequest?: (callback: (edit: any) => void) => () => void;
  onAIError?: (callback: (error: any) => void) => () => void;

  // MCP Server operations
  onMcpApplyDiff?: (callback: (data: { replacements: any[], resultChannel: string, targetFilePath?: string }) => void) => () => void;
  onMcpStreamContent?: (callback: (data: { streamId: string, content: string, position: string, insertAfter?: string, mode?: string, targetFilePath?: string }) => void) => () => void;
  onMcpNavigateTo?: (callback: (data: { line: number, column: number }) => void) => () => void;
  sendMcpApplyDiffResult?: (resultChannel: string, result: any) => void;
  updateMcpDocumentState?: (state: any) => Promise<void>;
  clearMcpDocumentState?: () => Promise<void>;

  // Workspace Manager operations
  workspaceManager?: {
    getRecentWorkspaces: () => Promise<any[]>;
    getWorkspaceStats: (workspacePath: string) => Promise<any>;
    openFolderDialog: () => Promise<{ success: boolean; path?: string }>;
    createWorkspaceDialog: () => Promise<{ success: boolean; path?: string; error?: string }>;
    openWorkspace: (workspacePath: string) => Promise<{ success: boolean }>;
    removeRecent: (workspacePath: string) => Promise<{ success: boolean }>;
  };

  // AI operations
  aiGetSettings: () => Promise<any>;
  aiGetModels: () => Promise<{ success: boolean; models: any[]; grouped: Record<string, any[]> }>;
  onAIPerformanceMetrics: (callback: (data: any) => void) => () => void;

  // CLI operations
  cliCheckNpmAvailable: () => Promise<{ available: boolean; version?: string }>;
  cliCheckInstallation: (tool: string) => Promise<{ installed: boolean; version?: string; path?: string }>;
  cliInstall: (tool: string, options?: any) => Promise<{ success: boolean; error?: string }>;
  cliUninstall: (tool: string) => Promise<{ success: boolean; error?: string }>;
  cliUpgrade: (tool: string) => Promise<{ success: boolean; error?: string }>;
  cliInstallNodeJs: () => Promise<{ success: boolean; error?: string }>;

  // analytics
  analytics?: {
    allowedToSendAnalytics: () => Promise<boolean>;
    getDistinctId: () => Promise<string>;
    optIn: () => Promise<void>;
    optOut: () => Promise<void>;
    setSessionId: (sessionId: string) => void;
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
    // Dev only: switch between test and live Stytch environments
    switchEnvironment: (environment: 'development' | 'production') => Promise<{ success: boolean; error?: string }>;
  }

  // Document Service
  documentService: import('@nimbalyst/runtime').DocumentService;

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

  interface Window {
    electronAPI: ElectronAPI;
    electron: ElectronAPI; // Alias for compatibility
    PLAYWRIGHT?: boolean;
    IS_OFFICIAL_BUILD?: boolean;
    IS_DEV_MODE?: boolean;
  }
