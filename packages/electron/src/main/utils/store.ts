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
export async function getRecentItems(type: 'projects' | 'documents'): Promise<RecentItem[]> {
    const items = await getAsync(`recent.${type}`, []);

    // Ensure we have an array
    if (!Array.isArray(items)) {
        logger.store.warn(`Recent items for ${type} is not an array:`, items);
        return [];
    }

    // Sort by timestamp, most recent first
    return items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

export async function addToRecentItems(type: 'projects' | 'documents', path: string, name: string, maxItems: number = 10) {
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

export async function clearRecentItems(type: 'projects' | 'documents') {
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

// Project-specific window state management
export async function getProjectWindowState(projectPath: string): Promise<SessionWindow | undefined> {
    const projectState = await getAsync(`projectState:${projectPath}`, {});
    return projectState.windowState;
}

export async function saveProjectWindowState(projectPath: string, windowState: SessionWindow) {
    const projectState = await getAsync(`projectState:${projectPath}`, {});
    projectState.windowState = windowState;
    await setAsync(`projectState:${projectPath}`, projectState);
}

export async function clearProjectWindowState(projectPath: string) {
    if (usePGLite && database.isInitialized()) {
        await database.query('DELETE FROM project_state WHERE project_path = $1', [projectPath]);
    } else {
        const projectStates = store.get('projectWindowStates', {}) as Record<string, SessionWindow>;
        delete projectStates[projectPath];
        store.set('projectWindowStates', projectStates);
    }
}

// Theme management
export async function getTheme(): Promise<string> {
    return await getAsync('theme', 'system') as string;
}

export async function setTheme(theme: string) {
    await setAsync('theme', theme);
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

// Project recent files
export async function getProjectRecentFiles(projectPath: string): Promise<string[]> {
    const projectState = await getAsync(`projectState:${projectPath}`, {});

    // Check both new schema (documents.recentDocuments) and old schema (recentFiles) for backward compatibility
    if (projectState.documents?.recentDocuments) {
        return projectState.documents.recentDocuments.map((doc: any) =>
            typeof doc === 'string' ? doc : doc.path
        );
    }
    return projectState.recentFiles || [];
}

export async function addProjectRecentFile(projectPath: string, filePath: string) {
    const projectState = await getAsync(`projectState:${projectPath}`, {});

    // Initialize documents structure if it doesn't exist
    if (!projectState.documents) {
        projectState.documents = {
            recentDocuments: [],
            openTabs: [],
            activeTabId: null,
            tabOrder: []
        };
    }

    let recentDocs = projectState.documents.recentDocuments || [];

    // Remove if already exists and add to beginning
    recentDocs = recentDocs.filter((doc: any) => {
        const path = typeof doc === 'string' ? doc : doc.path;
        return path !== filePath;
    });

    // Add as simple string for now (can be enhanced to object with metadata later)
    recentDocs.unshift(filePath);

    // Keep only 50 most recent
    recentDocs = recentDocs.slice(0, 50);

    projectState.documents.recentDocuments = recentDocs;
    await setAsync(`projectState:${projectPath}`, projectState);
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

export async function getProjectTabState(projectPath: string): Promise<TabManagerState | null> {
    const projectState = await getAsync(`projectState:${projectPath}`, {});
    logger.store.debug(`[DEBUG] getProjectTabState for ${projectPath}:`, JSON.stringify(projectState));

    // Check new schema (documents.openTabs)
    if (projectState.documents?.openTabs) {
        logger.store.debug(`[DEBUG] Found openTabs:`, JSON.stringify(projectState.documents.openTabs));
        return {
            tabs: projectState.documents.openTabs,
            activeTabId: projectState.documents.activeTabId || null,
            tabOrder: projectState.documents.tabOrder || []
        };
    }

    // Fall back to old schema
    return projectState.tabState || null;
}

export async function saveProjectTabState(projectPath: string, state: TabManagerState) {
    const projectState = await getAsync(`projectState:${projectPath}`, {});

    // Initialize documents structure if it doesn't exist
    if (!projectState.documents) {
        projectState.documents = {
            recentDocuments: [],
            openTabs: [],
            activeTabId: null,
            tabOrder: []
        };
    }

    // Save to new schema location
    projectState.documents.openTabs = state.tabs;
    projectState.documents.activeTabId = state.activeTabId;
    projectState.documents.tabOrder = state.tabOrder;

    await setAsync(`projectState:${projectPath}`, projectState);
}

export async function clearProjectTabState(projectPath: string) {
    const projectState = await getAsync(`projectState:${projectPath}`, {});

    // Clear from new schema location
    if (projectState.documents) {
        projectState.documents.openTabs = [];
        projectState.documents.activeTabId = null;
        projectState.documents.tabOrder = [];
    }

    // Also clear old schema for backward compatibility
    delete projectState.tabState;

    await setAsync(`projectState:${projectPath}`, projectState);
}

// Sync versions for backward compatibility (will use electron-store)
export function getThemeSync(): string {
    return store.get('theme', 'system') as string;
}

export function setThemeSync(theme: string) {
    store.set('theme', theme);
}

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
