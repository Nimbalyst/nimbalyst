/**
 * IPC handlers for the multi-project rail.
 *
 * The rail lets a single Electron window host several workspace projects
 * side by side. Switching between them must not tear down the inactive
 * projects' main-process services (file watchers, document caches, MCP
 * config watchers); these handlers manage the per-window registration so
 * services for warm projects stay alive.
 *
 * - `workspace:register-additional` -- start tracking a path as warm in
 *   this window. Creates DocumentService / FileSystemService /
 *   WorkspaceEventBus subscriptions if they don't already exist.
 * - `workspace:unregister-additional` -- the user closed the project from
 *   the rail. Drops services only if no other window references the path.
 * - `workspace:set-active` -- update the visible project in a window
 *   without spawning a new BrowserWindow (the legacy `project-selected`
 *   path stays for the "open in new window" escape hatch).
 */

import { BrowserWindow } from 'electron';
import { basename } from 'path';
import { existsSync } from 'fs';
import { safeHandle } from '../utils/ipcRegistry';
import {
    getWindowId,
    windowStates,
    documentServices,
} from '../window/WindowManager';
import { startWorkspaceWatcher, stopWorkspaceWatcher } from '../file/WorkspaceWatcher.ts';
import { anyWindowReferencesWorkspace } from '../window/windowState';
import { ElectronDocumentService, setupDocumentServiceHandlers } from '../services/ElectronDocumentService';
import { ElectronFileSystemService } from '../services/ElectronFileSystemService';
import { addNimAssetRoot } from '../protocols/nimAssetProtocol';
import { getMcpConfigService } from '../index';
import { addToRecentItems, getWorkspaceNavigationHistory } from '../utils/store';
import { navigationHistoryService } from '../services/NavigationHistoryService';
import { setFileSystemService, clearFileSystemService } from '@nimbalyst/runtime';
import { logger } from '../utils/logger';

// Re-uses the same Maps that WindowManager populates. WindowManager exports
// `documentServices` only; the file-system service map lives module-internal
// there. We expose it via a pair of accessor functions on WindowManager
// (added below in this PR).
import { fileSystemServices, getFileSystemService } from '../window/serviceRegistry';

function resolveDocumentServiceForEvent(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): ElectronDocumentService | null {
    const browserWindow = BrowserWindow.fromWebContents(event.sender);
    if (!browserWindow) return null;
    const windowId = getWindowId(browserWindow);
    if (windowId === null) return null;
    const state = windowStates.get(windowId);
    const path = state?.activeWorkspacePath ?? state?.workspacePath ?? null;
    if (!path) return null;
    return documentServices.get(path) ?? null;
}

/**
 * Ensure all services are running for `workspacePath`. Idempotent — if
 * another window already created the services, just makes sure this window
 * shows up in the additional-paths list.
 */
function ensureServicesForPath(window: BrowserWindow, workspacePath: string): void {
    if (!existsSync(workspacePath)) {
        logger.main.warn('[MultiProject] Refusing to register non-existent path:', workspacePath);
        return;
    }

    addNimAssetRoot(workspacePath);

    if (!documentServices.has(workspacePath)) {
        const docService = new ElectronDocumentService(workspacePath);
        documentServices.set(workspacePath, docService);
        setupDocumentServiceHandlers(resolveDocumentServiceForEvent);
    }

    if (!fileSystemServices.has(workspacePath)) {
        const fileSystemService = new ElectronFileSystemService(workspacePath);
        fileSystemServices.set(workspacePath, fileSystemService);
        setFileSystemService(fileSystemService);
    }

    // Workspace watcher is per-window; start one for this path so the
    // current window receives change events for the warm project.
    startWorkspaceWatcher(window, workspacePath);

    // Restore navigation history (no-op if already restored for this window).
    const windowId = getWindowId(window);
    if (windowId !== null) {
        const navHistory = getWorkspaceNavigationHistory(workspacePath);
        if (navHistory) {
            navigationHistoryService.restoreNavigationState(windowId, navHistory);
        }
    }
}

export function registerMultiProjectRailHandlers(): void {
    safeHandle('workspace:register-additional', async (event, data: { workspacePath: string }) => {
        const { workspacePath } = data;
        if (!workspacePath || typeof workspacePath !== 'string') {
            return { success: false, error: 'workspacePath required' };
        }

        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) return { success: false, error: 'No window for event sender' };
        const windowId = getWindowId(window);
        if (windowId === null) return { success: false, error: 'No windowId' };

        const state = windowStates.get(windowId);
        if (!state) return { success: false, error: 'No window state' };

        // Skip if this window already references the path (primary or additional).
        if (state.workspacePath === workspacePath || state.additionalWorkspacePaths?.includes(workspacePath)) {
            return { success: true, alreadyRegistered: true };
        }

        const additional = state.additionalWorkspacePaths ?? [];
        state.additionalWorkspacePaths = [...additional, workspacePath];

        ensureServicesForPath(window, workspacePath);
        addToRecentItems('workspaces', workspacePath, basename(workspacePath));

        return { success: true };
    });

    safeHandle('workspace:unregister-additional', async (event, data: { workspacePath: string }) => {
        const { workspacePath } = data;
        if (!workspacePath || typeof workspacePath !== 'string') {
            return { success: false, error: 'workspacePath required' };
        }

        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) return { success: false, error: 'No window for event sender' };
        const windowId = getWindowId(window);
        if (windowId === null) return { success: false, error: 'No windowId' };

        const state = windowStates.get(windowId);
        if (!state) return { success: false, error: 'No window state' };

        if (state.additionalWorkspacePaths?.includes(workspacePath)) {
            state.additionalWorkspacePaths = state.additionalWorkspacePaths.filter((p) => p !== workspacePath);
        }

        // If this window still references the path as primary, leave services alone.
        if (state.workspacePath === workspacePath) {
            return { success: true, stillPrimary: true };
        }

        // Free services only if no other window references the path.
        if (!anyWindowReferencesWorkspace(workspacePath)) {
            const docService = documentServices.get(workspacePath);
            if (docService) {
                docService.destroy();
                documentServices.delete(workspacePath);
            }

            const fsService = getFileSystemService(workspacePath);
            if (fsService) {
                fsService.destroy();
                fileSystemServices.delete(workspacePath);
                clearFileSystemService();
            }

            try {
                const mcpService = getMcpConfigService();
                mcpService?.stopWatchingWorkspaceConfig(workspacePath);
            } catch (error) {
                logger.main.error('[MultiProject] Error stopping MCP config watcher:', error);
            }
        }

        // Stop the workspace watcher tied to this window for this path.
        stopWorkspaceWatcher(windowId);

        return { success: true };
    });

    safeHandle('workspace:set-active', async (event, data: { workspacePath: string }) => {
        const { workspacePath } = data;
        if (!workspacePath || typeof workspacePath !== 'string') {
            return { success: false, error: 'workspacePath required' };
        }

        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) return { success: false, error: 'No window for event sender' };
        const windowId = getWindowId(window);
        if (windowId === null) return { success: false, error: 'No windowId' };

        const state = windowStates.get(windowId);
        if (!state) return { success: false, error: 'No window state' };

        // Path must be registered in this window before it can be active.
        if (state.workspacePath !== workspacePath && !state.additionalWorkspacePaths?.includes(workspacePath)) {
            return { success: false, error: 'workspacePath not registered in this window' };
        }

        state.activeWorkspacePath = workspacePath;
        return { success: true };
    });
}
