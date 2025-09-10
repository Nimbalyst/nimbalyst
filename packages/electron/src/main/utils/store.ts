import Store from 'electron-store';
import { RecentItem, SessionState, SessionWindow } from '../types';

// Lazy-initialize store to ensure app is ready
let _store: Store | null = null;

function getStore(): Store {
    if (!_store) {
        _store = new Store();
    }
    return _store;
}

// Export a proxy that lazy-loads the store
export const store = new Proxy({} as Store, {
    get(target, prop, receiver) {
        const actualStore = getStore();
        const value = Reflect.get(actualStore, prop, actualStore);
        if (typeof value === 'function') {
            return value.bind(actualStore);
        }
        return value;
    },
    set(target, prop, value, receiver) {
        const actualStore = getStore();
        return Reflect.set(actualStore, prop, value, actualStore);
    }
});

// Recent items management
export function getRecentItems(type: 'projects' | 'documents'): RecentItem[] {
    const items = store.get(`recent.${type}`, []) as RecentItem[];
    // Sort by timestamp, most recent first
    return items.sort((a, b) => b.timestamp - a.timestamp);
}

export function addToRecentItems(type: 'projects' | 'documents', path: string, name: string, maxItems: number = 10) {
    const items = getRecentItems(type);
    
    // Remove if already exists
    const filtered = items.filter(item => item.path !== path);
    
    // Add new item at the beginning
    filtered.unshift({
        path,
        name,
        timestamp: Date.now()
    });
    
    // Limit to maxItems
    const limited = filtered.slice(0, maxItems);
    
    // Save back to store
    store.set(`recent.${type}`, limited);
}

export function clearRecentItems(type: 'projects' | 'documents') {
    store.set(`recent.${type}`, []);
}

// Session management
export function getSessionState(): SessionState | undefined {
    return store.get('session') as SessionState | undefined;
}

export function saveSessionState(state: SessionState) {
    store.set('session', state);
}

// Project-specific window state management
export function getProjectWindowState(projectPath: string): SessionWindow | undefined {
    const projectStates = store.get('projectWindowStates', {}) as Record<string, SessionWindow>;
    return projectStates[projectPath];
}

export function saveProjectWindowState(projectPath: string, windowState: SessionWindow) {
    const projectStates = store.get('projectWindowStates', {}) as Record<string, SessionWindow>;
    projectStates[projectPath] = windowState;
    store.set('projectWindowStates', projectStates);
}

export function clearProjectWindowState(projectPath: string) {
    const projectStates = store.get('projectWindowStates', {}) as Record<string, SessionWindow>;
    delete projectStates[projectPath];
    store.set('projectWindowStates', projectStates);
}

// Theme management
export function getTheme(): string {
    return store.get('theme', 'system') as string;
}

export function setTheme(theme: string) {
    store.set('theme', theme);
}

// Settings
export function getSidebarWidth(): number {
    return store.get('sidebarWidth', 240) as number;
}

export function setSidebarWidth(width: number) {
    store.set('sidebarWidth', width);
}

// AI Chat settings
export function getAIChatState(): { collapsed: boolean; width: number; sessionId?: string } {
    return store.get('aiChatState', { collapsed: false, width: 350 }) as { collapsed: boolean; width: number; sessionId?: string };
}

export function setAIChatState(state: { collapsed: boolean; width: number; sessionId?: string }) {
    store.set('aiChatState', state);
}

// Project recent files
export function getProjectRecentFiles(projectPath: string): string[] {
    const key = `projectRecentFiles.${projectPath}`;
    return store.get(key, []) as string[];
}

export function addProjectRecentFile(projectPath: string, filePath: string) {
    const key = `projectRecentFiles.${projectPath}`;
    let recentFiles = store.get(key, []) as string[];
    
    // Remove if already exists and add to beginning
    recentFiles = recentFiles.filter(f => f !== filePath);
    recentFiles.unshift(filePath);
    
    // Keep only 50 most recent
    recentFiles = recentFiles.slice(0, 50);
    
    store.set(key, recentFiles);
}

// Tab state persistence
export interface TabState {
    id: string;
    filePath: string;
    fileName: string;
    isDirty: boolean;
    isPinned: boolean;
    lastSaved?: string;
}

export interface TabManagerState {
    tabs: TabState[];
    activeTabId: string | null;
    tabOrder: string[];
}

export function getProjectTabState(projectPath: string): TabManagerState | null {
    const key = `projectTabs.${projectPath}`;
    const state = store.get(key, null) as TabManagerState | null;
    return state;
}

export function saveProjectTabState(projectPath: string, state: TabManagerState) {
    const key = `projectTabs.${projectPath}`;
    store.set(key, state);
}

export function clearProjectTabState(projectPath: string) {
    const key = `projectTabs.${projectPath}`;
    store.delete(key);
}