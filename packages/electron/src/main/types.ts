export interface WindowState {
    mode: 'document' | 'project';
    filePath: string | null;
    projectPath: string | null;
    documentEdited: boolean;
}

export interface RecentItem {
    path: string;
    name: string;
    timestamp: number;
}

export interface SessionWindow {
    mode: 'document' | 'project';
    filePath?: string;
    projectPath?: string;
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