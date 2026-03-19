import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { safeHandle } from '../utils/ipcRegistry';
import { getPreloadPath } from '../utils/appPaths';
import { getTheme } from '../utils/store';
import { getBackgroundColor } from '../theme/ThemeManager';
import { windows } from './windowState';

let developerDashboardWindow: BrowserWindow | null = null;

/**
 * Find a main app window (not dashboard, not database-browser, etc.)
 * to query for renderer-side state.
 */
function findMainAppWindow(): BrowserWindow | null {
    // The windows map contains the main app windows (keyed by id)
    for (const [, win] of windows) {
        if (!win.isDestroyed() && win !== developerDashboardWindow) {
            return win;
        }
    }
    return null;
}

/**
 * Register IPC handler for fetching atomFamily stats from the main app window.
 * The dashboard window calls this, and we relay to the main app window via executeJavaScript.
 */
safeHandle('dev:get-atomfamily-stats', async () => {
    const mainWin = findMainAppWindow();
    if (!mainWin) return [];

    try {
        return await mainWin.webContents.executeJavaScript(
            `window.__atomFamilyStats ? window.__atomFamilyStats() : []`
        );
    } catch {
        return [];
    }
});

export function createDeveloperDashboardWindow() {
    if (developerDashboardWindow) {
        developerDashboardWindow.focus();
        return;
    }

    developerDashboardWindow = new BrowserWindow({
        width: 900,
        height: 700,
        title: 'Developer Dashboard',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: getPreloadPath(),
            webviewTag: false
        },
        show: false,
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
        trafficLightPosition: { x: 10, y: 10 },
        vibrancy: 'sidebar',
        backgroundColor: getBackgroundColor()
    });

    const currentTheme = getTheme();
    const queryParams = `mode=developer-dashboard&theme=${currentTheme}`;
    if (process.env.NODE_ENV === 'development') {
        const devPort = process.env.VITE_PORT || '5273';
        developerDashboardWindow.loadURL(`http://localhost:${devPort}/?${queryParams}`);
    } else {
        const appPath = app.getAppPath();
        let htmlPath: string;
        if (app.isPackaged) {
            htmlPath = join(appPath, 'out/renderer/index.html');
        } else if (appPath.includes('/out/main') || appPath.includes('\\out\\main')) {
            htmlPath = join(appPath, '../renderer/index.html');
        } else {
            htmlPath = join(appPath, 'out/renderer/index.html');
        }
        developerDashboardWindow.loadFile(htmlPath, {
            query: { mode: 'developer-dashboard', theme: currentTheme }
        });
    }

    developerDashboardWindow.once('ready-to-show', () => {
        developerDashboardWindow?.show();
    });

    developerDashboardWindow.on('closed', () => {
        developerDashboardWindow = null;
    });

    return developerDashboardWindow;
}

export function updateDeveloperDashboardWindowTheme() {
    if (developerDashboardWindow && !developerDashboardWindow.isDestroyed()) {
        const currentTheme = getTheme();
        const backgroundColor = getBackgroundColor();

        developerDashboardWindow.setBackgroundColor(backgroundColor);

        developerDashboardWindow.webContents.executeJavaScript(`
            localStorage.setItem('theme', '${currentTheme}');
            window.dispatchEvent(new StorageEvent('storage', {
                key: 'theme',
                newValue: '${currentTheme}',
                url: window.location.href
            }));
        `).catch(err => {
            console.error('Failed to update Developer Dashboard window theme:', err);
        });
    }
}
