export interface TabState {
    id: string;                  // Unique tab identifier
    filePath: string;            // Full file path
    fileName: string;            // Display name
    content?: string;            // Cached content (for inactive tabs)
    isDirty: boolean;            // Unsaved changes
    scrollPosition?: number;     // Preserve scroll position
    cursorPosition?: {          // Preserve cursor position
        line: number;
        column: number;
    };
    editorState?: any;          // Serialized Lexical state
    lastSaved?: Date;           // Last save timestamp
    isPinned?: boolean;         // Pinned tabs don't auto-close
}

export interface WindowState {
    mode: 'document' | 'workspace';
    filePath: string | null;
    workspacePath: string | null;
    documentEdited: boolean;
    
    // Tab management (optional for backward compatibility)
    tabs?: TabState[];
    activeTabId?: string;
    tabsEnabled?: boolean;
}

export interface RecentItem {
    path: string;
    name: string;
    timestamp: number;
}

export interface SessionWindow {
    mode: 'document' | 'workspace';
    filePath?: string;
    workspacePath?: string;
    bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    focusOrder?: number; // Track window focus order (higher = more recently focused)
    devToolsOpen?: boolean; // Track if developer tools are open
}

export interface SessionState {
    windows: SessionWindow[];
    lastUpdated: number;
}

export interface FileTreeItem {
    name: string;
    type: 'file' | 'directory';
    path: string;
    children?: FileTreeItem[];
}