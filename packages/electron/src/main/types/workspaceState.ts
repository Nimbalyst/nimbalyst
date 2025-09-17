/**
 * Comprehensive Workspace State type definition
 * Holds all workspace-specific state including windows, tabs, recent files, and UI settings
 */

export interface WorkspaceState {
  // Workspace identification
  workspacePath: string;
  lastOpened: Date;

  // Window state for this workspace
  windowState: {
    x?: number;
    y?: number;
    width: number;
    height: number;
    isMaximized?: boolean;
    isFullScreen?: boolean;
    devToolsOpen?: boolean;
  };

  // UI layout state
  uiState: {
    sidebarWidth: number;
    sidebarCollapsed: boolean;
    aiChatWidth: number;
    aiChatCollapsed: boolean;
    theme?: string; // Workspace-specific theme override
  };

  // Document and tab management
  documents: {
    recentDocuments: Array<{
      path: string;
      name: string;
      timestamp: number;
    }>;
    openTabs: Array<{
      id: string;
      filePath: string;
      fileName: string;
      isDirty: boolean;
      isPinned: boolean;
      lastSaved?: string;
      scrollPosition?: number;
      cursorPosition?: { line: number; column: number };
    }>;
    activeTabId: string | null;
    tabOrder: string[]; // Tab IDs in order
  };

  // File tree state
  fileTree: {
    expandedFolders: string[];
    selectedFile?: string;
    scrollPosition?: number;
  };

  // AI Chat state for this workspace
  aiChat: {
    currentSessionId?: string;
    draftInput?: string;
    sessionHistory: string[]; // Recent session IDs
  };

  // Editor settings specific to this workspace
  editorSettings?: {
    fontSize?: number;
    tabSize?: number;
    wordWrap?: boolean;
    lineNumbers?: boolean;
    minimap?: boolean;
  };

  // Workspace-specific preferences
  preferences: {
    autoSave?: boolean;
    autoSaveInterval?: number;
    defaultFileExtension?: string;
    excludePatterns?: string[];
  };

  // Metadata
  metadata: {
    version: string;
    createdAt: Date;
    updatedAt: Date;
  };
}
