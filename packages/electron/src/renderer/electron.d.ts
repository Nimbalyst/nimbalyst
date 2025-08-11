interface FileTreeItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeItem[];
}

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
  onFileMoved: (callback: (data: { sourcePath: string; destinationPath: string }) => void) => () => void;
  onFileCopied: (callback: (data: { sourcePath: string; destinationPath: string }) => void) => () => void;
  onThemeChange: (callback: (theme: string) => void) => () => void;
  onShowAbout: (callback: () => void) => () => void;
  onViewHistory?: (callback: () => void) => () => void;
  onLoadSessionFromManager?: (callback: (data: { sessionId: string; projectPath?: string }) => void) => () => void;
  
  getTheme: () => Promise<string>;
  openFile: () => Promise<{ filePath: string; content: string } | null>;
  saveFile: (content: string) => Promise<{ success: boolean; filePath: string } | null>;
  saveFileAs: (content: string) => Promise<{ success: boolean; filePath: string } | null>;
  
  setDocumentEdited: (edited: boolean) => void;
  setTitle: (title: string) => void;
  setCurrentFile: (filePath: string | null) => void;
  
  getFolderContents: (dirPath: string) => Promise<FileTreeItem[]>;
  switchProjectFile: (filePath: string) => Promise<{ filePath: string; content: string } | null>;
  
  // File context menu operations
  renameFile: (oldPath: string, newName: string) => Promise<{ success: boolean; newPath?: string; error?: string }>;
  deleteFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  openFileInNewWindow: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  showInFinder: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  moveFile: (sourcePath: string, targetPath: string) => Promise<{ success: boolean; newPath?: string; error?: string }>;
  copyFile: (sourcePath: string, targetPath: string) => Promise<{ success: boolean; newPath?: string; error?: string }>;
  
  // Settings operations
  getSidebarWidth: () => Promise<number>;
  setSidebarWidth: (width: number) => void;
  getAIChatState: () => Promise<{ collapsed: boolean; width: number }>;
  setAIChatState: (state: { collapsed: boolean; width: number }) => void;
  
  // QuickOpen operations
  searchProjectFiles: (projectPath: string, query: string) => Promise<string[]>;
  getRecentProjectFiles: () => Promise<string[]>;
  addToProjectRecentFiles: (filePath: string) => void;
  
  // Project file tree operations
  onProjectFileTreeUpdated: (callback: (data: { fileTree: FileTreeItem[]; addedPath?: string; removedPath?: string }) => void) => () => void;
  
  // Claude AI operations
  claudeInitialize?: (apiKey?: string) => Promise<any>;
  claudeCreateSession?: (documentContext?: any, projectPath?: string) => Promise<any>;
  claudeSendMessage?: (message: string, documentContext?: any) => Promise<any>;
  claudeGetSessions?: (projectPath?: string) => Promise<any>;
  claudeLoadSession?: (sessionId: string, projectPath?: string) => Promise<any>;
  claudeClearSession?: () => Promise<any>;
  claudeUpdateSessionMessages?: (sessionId: string, messages: any[], projectPath?: string) => Promise<{ success: boolean; error?: string }>;
  claudeSaveDraftInput?: (sessionId: string, draftInput: string, projectPath?: string) => Promise<{ success: boolean; error?: string }>;
  claudeDeleteSession?: (sessionId: string, projectPath?: string) => Promise<{ success: boolean }>;
  claudeApplyEdit?: (edit: any) => Promise<any>;
  getClaudeSettings?: () => Promise<any>;
  saveClaudeSettings?: (settings: any) => Promise<any>;
  testClaudeConnection?: () => Promise<any>;
  getClaudeModels?: () => Promise<{ success: boolean; models: Array<{ id: string; display_name: string }>; error?: string }>;
  
  // Claude AI event listeners
  onClaudeStreamResponse?: (callback: (data: any) => void) => () => void;
  onClaudeEditRequest?: (callback: (edit: any) => void) => () => void;
  
  // Preferences operations
  openDataFolder?: () => Promise<{ success: boolean }>;
  onShowPreferences?: (callback: () => void) => () => void;
}

interface Window {
  electronAPI: ElectronAPI;
  electron: ElectronAPI; // Alias for compatibility
}