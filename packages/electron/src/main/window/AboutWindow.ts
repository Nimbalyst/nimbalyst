import { BrowserWindow, nativeTheme } from 'electron';
import { join } from 'path';
import { getTheme } from '../utils/store';

let aboutWindow: BrowserWindow | null = null;

export function createAboutWindow() {
    if (aboutWindow && !aboutWindow.isDestroyed()) {
        aboutWindow.focus();
        return;
    }

    const currentTheme = getTheme();
    const isDarkTheme = nativeTheme.shouldUseDarkColors || currentTheme === 'dark' || currentTheme === 'crystal-dark';

    aboutWindow = new BrowserWindow({
        width: 650,
        height: 650,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        title: 'About Preditor',
        show: false,
        backgroundColor: isDarkTheme ? '#2a2a2a' : '#ffffff',
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
        webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webviewTag: false
        }
    });

    // Load the about.html file
    aboutWindow.loadFile(join(__dirname, '../renderer/about.html'));

    aboutWindow.once('ready-to-show', () => {
        aboutWindow?.show();
        // Send initial theme
        aboutWindow?.webContents.send('theme-change', currentTheme);
    });

    aboutWindow.on('closed', () => {
        aboutWindow = null;
    });
}

export function updateAboutWindowTheme() {
    if (aboutWindow && !aboutWindow.isDestroyed()) {
        const currentTheme = getTheme();
        const isDarkTheme = nativeTheme.shouldUseDarkColors || currentTheme === 'dark' || currentTheme === 'crystal-dark';
        aboutWindow.setBackgroundColor(isDarkTheme ? '#2a2a2a' : '#ffffff');
        aboutWindow.webContents.send('theme-change', currentTheme);
    }
}

export function getAboutWindow(): BrowserWindow | null {
    return aboutWindow;
}