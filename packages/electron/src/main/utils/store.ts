import Store from 'electron-store';
import { RecentItem, SessionState, SessionWindow } from '../types';
import { pgliteStore } from '../database/PGLiteStore';
import { database } from '../database/PGLiteDatabaseWorker';
import { logger } from './logger';

// Keep electron-store as fallback for now
let _store: Store | null = null;
let usePGLite = false;

// NOTE: usePGLite is set to true by calling enablePGLite() after database initialization
// Do NOT set it based on database.isInitialized() here as the database isn't initialized yet at module load

function getStore(): Store {
    if (!_store) {
        _store = new Store();
    }
    return _store;
}

// Export a proxy that can handle both sync (electron-store) and async (PGLite) operations
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

// Async wrapper for get operations
async function getAsync(key: string, defaultValue?: any): Promise<any> {
    if (usePGLite && database.isInitialized()) {
        try {
            return await pgliteStore.get(key, defaultValue);
        } catch (error) {
            logger.store.error('PGLite get failed, falling back to electron-store:', error);
        }
    }
    return store.get(key, defaultValue);
}

// Async wrapper for set operations
async function setAsync(key: string, value: any): Promise<void> {
    if (usePGLite && database.isInitialized()) {
        try {
            await pgliteStore.set(key, value);
            return;
        } catch (error) {
            logger.store.error('PGLite set failed, falling back to electron-store:', error);
        }
    }
    store.set(key, value);
}

// Recent items management
export async function getRecentItems(type: 'workspaces' | 'documents'): Promise<RecentItem[]> {
    const items = await getAsync(`recent.${type}`, []);

    // Ensure we have an array
    if (!Array.isArray(items)) {
        logger.store.warn(`Recent items for ${type} is not an array:`, items);
        return [];
    }

    // Sort by timestamp, most recent first
    return items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

export async function addToRecentItems(type: 'workspaces' | 'documents', path: string, name: string, maxItems: number = 10) {
    const items = await getRecentItems(type);

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
    await setAsync(`recent.${type}`, limited);
}

export async function clearRecentItems(type: 'workspaces' | 'documents') {
    await setAsync(`recent.${type}`, []);
}

// Session management
export async function getSessionState(): Promise<SessionState | undefined> {
    // logger.store.debug('[DEBUG getSessionState] Getting session state...');
    const state = await getAsync('sessionState') as SessionState | undefined;
    logger.store.debug('[DEBUG getSessionState] Retrieved state:', JSON.stringify(state));
    return state;
}

export async function saveSessionState(state: SessionState) {
    // logger.store.info('[DEBUG saveSessionState] Saving session state:', JSON.stringify(state));
    await setAsync('sessionState', state);
    logger.store.debug('[DEBUG saveSessionState] Session state saved');
}

// Workspace-specific window state management
export async function getWorkspaceWindowState(workspacePath: string): Promise<SessionWindow | undefined> {
    const workspaceState = await getAsync(`workspaceState:${workspacePath}`, {});
    return workspaceState.windowState;
}

export async function saveWorkspaceWindowState(workspacePath: string, windowState: SessionWindow) {
    const workspaceState = await getAsync(`workspaceState:${workspacePath}`, {});
    workspaceState.windowState = windowState;
    await setAsync(`workspaceState:${workspacePath}`, workspaceState);
}

export async function clearWorkspaceWindowState(workspacePath: string) {
    if (usePGLite && database.isInitialized()) {
        await database.query('DELETE FROM workspace_state WHERE workspace_path = $1', [workspacePath]);
    } else {
        const workspaceStates = store.get('workspaceWindowStates', {}) as Record<string, SessionWindow>;
        delete workspaceStates[workspacePath];
        store.set('workspaceWindowStates', workspaceStates);
    }
}

// Theme management
export function getTheme(): string {
    // Only use electron-store for sync access
    return store.get('theme', 'system') as string;
}

export function setTheme(theme: string) {
    // Only save to electron-store
    store.set('theme', theme);
}

// Settings
export async function getSidebarWidth(): Promise<number> {
    return await getAsync('sidebarWidth', 240) as number;
}

export async function setSidebarWidth(width: number) {
    await setAsync('sidebarWidth', width);
}

// AI Chat settings
export async function getAIChatState(): Promise<{ collapsed: boolean; width: number; sessionId?: string }> {
    return await getAsync('aiChatState', { collapsed: false, width: 350 }) as { collapsed: boolean; width: number; sessionId?: string };
}

export async function setAIChatState(state: { collapsed: boolean; width: number; sessionId?: string }) {
    await setAsync('aiChatState', state);
}

// Workspace recent files
export async function getWorkspaceRecentFiles(workspacePath: string): Promise<string[]> {
    const workspaceState = await getAsync(`workspaceState:${workspacePath}`, {});

    // Check both new schema (documents.recentDocuments) and old schema (recentFiles) for backward compatibility
    if (workspaceState.documents?.recentDocuments) {
        return workspaceState.documents.recentDocuments.map((doc: any) =>
            typeof doc === 'string' ? doc : doc.path
        );
    }
    return workspaceState.recentFiles || [];
}

export async function addWorkspaceRecentFile(workspacePath: string, filePath: string) {
    const workspaceState = await getAsync(`workspaceState:${workspacePath}`, {});

    // Initialize documents structure if it doesn't exist
    if (!workspaceState.documents) {
        workspaceState.documents = {
            recentDocuments: [],
            openTabs: [],
            activeTabId: null,
            tabOrder: []
        };
    }

    let recentDocs = workspaceState.documents.recentDocuments || [];

    // Remove if already exists and add to beginning
    recentDocs = recentDocs.filter((doc: any) => {
        const path = typeof doc === 'string' ? doc : doc.path;
        return path !== filePath;
    });

    // Add as simple string for now (can be enhanced to object with metadata later)
    recentDocs.unshift(filePath);

    // Keep only 50 most recent
    recentDocs = recentDocs.slice(0, 50);

    workspaceState.documents.recentDocuments = recentDocs;
    await setAsync(`workspaceState:${workspacePath}`, workspaceState);
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

export async function getWorkspaceTabState(workspacePath: string): Promise<TabManagerState | null> {
    const workspaceState = await getAsync(`workspaceState:${workspacePath}`, {});
    logger.store.debug(`[DEBUG] getWorkspaceTabState for ${workspacePath}:`, JSON.stringify(workspaceState));

    // Check new schema (documents.openTabs)
    if (workspaceState.documents?.openTabs) {
        logger.store.debug(`[DEBUG] Found openTabs:`, JSON.stringify(workspaceState.documents.openTabs));
        return {
            tabs: workspaceState.documents.openTabs,
            activeTabId: workspaceState.documents.activeTabId || null,
            tabOrder: workspaceState.documents.tabOrder || []
        };
    }

    // Fall back to old schema
    return workspaceState.tabState || null;
}

export async function saveWorkspaceTabState(workspacePath: string, state: TabManagerState) {
    const workspaceState = await getAsync(`workspaceState:${workspacePath}`, {});

    // Initialize documents structure if it doesn't exist
    if (!workspaceState.documents) {
        workspaceState.documents = {
            recentDocuments: [],
            openTabs: [],
            activeTabId: null,
            tabOrder: []
        };
    }

    // Save to new schema location
    workspaceState.documents.openTabs = state.tabs;
    workspaceState.documents.activeTabId = state.activeTabId;
    workspaceState.documents.tabOrder = state.tabOrder;

    await setAsync(`workspaceState:${workspacePath}`, workspaceState);
}

export async function clearWorkspaceTabState(workspacePath: string) {
    const workspaceState = await getAsync(`workspaceState:${workspacePath}`, {});

    // Clear from new schema location
    if (workspaceState.documents) {
        workspaceState.documents.openTabs = [];
        workspaceState.documents.activeTabId = null;
        workspaceState.documents.tabOrder = [];
    }

    // Also clear old schema for backward compatibility
    delete workspaceState.tabState;

    await setAsync(`workspaceState:${workspacePath}`, workspaceState);
}

// Sync versions for backward compatibility (just aliases now)
export const getThemeSync = getTheme;
export const setThemeSync = setTheme;

export function getSidebarWidthSync(): number {
    return store.get('sidebarWidth', 240) as number;
}

export function setSidebarWidthSync(width: number) {
    store.set('sidebarWidth', width);
}

// Helper to check if PGLite is ready
export function isPGLiteReady(): boolean {
    return usePGLite && database.isInitialized();
}

// Helper to enable PGLite (called after database initialization)
export function enablePGLite() {
    usePGLite = true;
}
