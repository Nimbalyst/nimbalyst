import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { getTheme } from '../utils/store';
import { getBackgroundColor } from '../theme/ThemeManager';

let databaseBrowserWindow: BrowserWindow | null = null;

export function createDatabaseBrowserWindow() {
    // If window already exists, focus it
    if (databaseBrowserWindow) {
        databaseBrowserWindow.focus();
        return;
    }

    // Create the window
    databaseBrowserWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        title: 'Database Browser',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            // Use app.getAppPath() for dev mode (not __dirname) because bundled chunks may be in nested directories
            preload: app.isPackaged
                ? join(__dirname, '../preload/index.js')
                : join(app.getAppPath(), 'out/preload/index.js'),
            webviewTag: false
        },
        show: false,
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
        trafficLightPosition: { x: 10, y: 10 },
        vibrancy: 'sidebar',
        backgroundColor: getBackgroundColor()
    });

    // Load the main app with a query parameter to indicate Database Browser mode
    const currentTheme = getTheme();
    const queryParams = `mode=database-browser&theme=${currentTheme}`;
    if (process.env.NODE_ENV === 'development') {
        databaseBrowserWindow.loadURL(`http://localhost:5273/?${queryParams}`);
    } else {
        databaseBrowserWindow.loadFile(join(__dirname, '../renderer/index.html'), {
            query: { mode: 'database-browser', theme: currentTheme }
        });
    }

    // Show window when ready
    databaseBrowserWindow.once('ready-to-show', () => {
        databaseBrowserWindow?.show();
    });

    // Clean up on close
    databaseBrowserWindow.on('closed', () => {
        databaseBrowserWindow = null;
    });

    return databaseBrowserWindow;
}

// Update Database Browser window theme
export function updateDatabaseBrowserWindowTheme() {
    if (databaseBrowserWindow && !databaseBrowserWindow.isDestroyed()) {
        const currentTheme = getTheme();
        const backgroundColor = getBackgroundColor();

        // Update background color
        databaseBrowserWindow.setBackgroundColor(backgroundColor);

        // Inject theme into localStorage and trigger React update
        databaseBrowserWindow.webContents.executeJavaScript(`
            localStorage.setItem('theme', '${currentTheme}');
            // Dispatch storage event to trigger React component update
            window.dispatchEvent(new StorageEvent('storage', {
                key: 'theme',
                newValue: '${currentTheme}',
                url: window.location.href
            }));
            console.log('[DatabaseBrowserWindow] Updated theme to:', '${currentTheme}');
        `).catch(err => {
            console.error('Failed to update Database Browser window theme:', err);
        });
    }
}
