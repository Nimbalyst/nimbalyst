interface FileTreeItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeItem[];
}

interface ElectronAPI {
  onFileNew: (callback: () => void) => () => void;
  onFileNewInWorkspace: (callback: () => void) => () => void;
  onFileOpen: (callback: () => void) => () => void;
  onWorkspaceOpened: (callback: (data: { workspacePath: string; workspaceName: string; fileTree: FileTreeItem[] }) => void) => () => void;
  onOpenWorkspaceFile: (callback: (filePath: string) => void) => () => void;
  onOpenWorkspaceFromCLI: (callback: (workspacePath: string) => void) => () => void;
  onFileSave: (callback: () => void) => () => void;
  onFileSaveAs: (callback: () => void) => () => void;
  onFileOpenedFromOS: (callback: (data: { filePath: string; content: string }) => void) => () => void;
  onNewUntitledDocument: (callback: (data: { untitledName: string }) => void) => () => void;
  onToggleSearch: (callback: () => void) => () => void;
  onToggleSearchReplace: (callback: () => void) => () => void;
  onFileDeleted: (callback: (data: { filePath: string }) => void) => () => void;
  onFileRenamed: (callback: (data: { oldPath: string; newPath: string }) => void) => () => void;
  onFileMoved: (callback: (data: { sourcePath: string; destinationPath: string }) => void) => () => void;
  onFileCopied: (callback: (data: { sourcePath: string; destinationPath: string }) => void) => () => void;
  onThemeChange: (callback: (theme: string) => void) => () => void;
  onShowAbout: (callback: () => void) => () => void;
  onViewHistory?: (callback: () => void) => () => void;
  onLoadSessionFromManager?: (callback: (data: { sessionId: string; workspacePath?: string }) => void) => () => void;

  getTheme: () => Promise<string>;
  openFile: () => Promise<{ filePath: string; content: string } | null>;
  saveFile: (content: string) => Promise<{ success: boolean; filePath: string } | null>;
  saveFileAs: (content: string) => Promise<{ success: boolean; filePath: string } | null>;

  setDocumentEdited: (edited: boolean) => void;
  setTitle: (title: string) => void;
  setCurrentFile: (filePath: string | null) => void;

  getFolderContents: (dirPath: string) => Promise<FileTreeItem[]>;
  switchWorkspaceFile: (filePath: string) => Promise<{ filePath: string; content: string } | null>;

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
  getAIChatState: (workspacePath: string) => Promise<{ collapsed: boolean; width: number; currentSessionId?: string; draftInput?: string }>;
  setAIChatState: (state: { workspacePath: string; collapsed: boolean; width: number; currentSessionId?: string; draftInput?: string }) => void;

  // QuickOpen operations
  searchWorkspaceFiles: (workspacePath: string, query: string) => Promise<any[]>;
  searchWorkspaceFileNames: (workspacePath: string, query: string) => Promise<any[]>;
  searchWorkspaceFileContent: (workspacePath: string, query: string) => Promise<any[]>;
  getRecentWorkspaceFiles: () => Promise<string[]>;
  addToWorkspaceRecentFiles: (filePath: string) => void;

  // Workspace file tree operations
  onWorkspaceFileTreeUpdated: (callback: (data: { fileTree: FileTreeItem[]; addedPath?: string; removedPath?: string }) => void) => () => void;

  // Tab state operations
  getWorkspaceTabState?: () => Promise<any>;
  saveWorkspaceTabState?: (tabState: any) => void;
  clearWorkspaceTabState?: () => void;

  // AI operations
  aiSendMessage?: (message: string, documentContext?: any, sessionId?: string, workspacePath?: string) => Promise<any>;
  aiGetSessions?: (workspacePath?: string) => Promise<any>;
  aiLoadSession?: (sessionId: string, workspacePath?: string) => Promise<any>;
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

  // Workspace Manager operations
  workspaceManager?: {
    getRecentWorkspaces: () => Promise<any[]>;
    getWorkspaceStats: (workspacePath: string) => Promise<any>;
    openFolderDialog: () => Promise<{ success: boolean; path?: string }>;
    createWorkspaceDialog: () => Promise<{ success: boolean; path?: string; error?: string }>;
    openWorkspace: (workspacePath: string) => Promise<{ success: boolean }>;
    removeRecent: (workspacePath: string) => Promise<{ success: boolean }>;
  };
}

interface Window {
  electronAPI: ElectronAPI;
  electron: ElectronAPI; // Alias for compatibility
}
