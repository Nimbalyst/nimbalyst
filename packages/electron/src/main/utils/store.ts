import Store from 'electron-store';
import { RecentItem, SessionState } from '../types';

// Create a singleton store instance
export const store = new Store();

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
export function getAIChatState(): { collapsed: boolean; width: number } {
    return store.get('aiChatState', { collapsed: false, width: 350 }) as { collapsed: boolean; width: number };
}

export function setAIChatState(state: { collapsed: boolean; width: number }) {
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