import { BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { getTheme } from '../utils/store';
import { getBackgroundColor } from '../theme/ThemeManager';
import { AnalyticsService } from '../services/analytics/AnalyticsService';

let aiModelsWindow: BrowserWindow | null = null;

export function createAIModelsWindow() {
    // If window already exists, focus it
    if (aiModelsWindow) {
        aiModelsWindow.focus();
        return;
    }

    // Create the window
    aiModelsWindow = new BrowserWindow({
        width: 900,
        height: 700,
        title: 'AI Models',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: join(__dirname, '../preload/index.js'),
            webviewTag: false
        },
        show: false,
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
        trafficLightPosition: { x: 10, y: 10 },
        vibrancy: 'sidebar',
        backgroundColor: getBackgroundColor()
    });

    // Load the main app with a query parameter to indicate AI Models mode
    const currentTheme = getTheme();
    const queryParams = `mode=ai-models&theme=${currentTheme}`;
    if (process.env.NODE_ENV === 'development') {
        aiModelsWindow.loadURL(`http://localhost:5273/?${queryParams}`);
    } else {
        aiModelsWindow.loadFile(join(__dirname, '../renderer/index.html'), {
            query: { mode: 'ai-models', theme: currentTheme }
        });
    }

    // Show window when ready
    aiModelsWindow.once('ready-to-show', () => {
        aiModelsWindow?.show();

        // Track settings opened
        AnalyticsService.getInstance().sendEvent('global_settings_opened', {
            source: 'direct',
            section: 'general',
        });
    });

    // Clean up on close
    aiModelsWindow.on('closed', () => {
        aiModelsWindow = null;
    });

    return aiModelsWindow;
}

// Update AI Models window theme
export function updateAIModelsWindowTheme() {
    if (aiModelsWindow && !aiModelsWindow.isDestroyed()) {
        const currentTheme = getTheme();
        const backgroundColor = getBackgroundColor();

        // Update background color
        aiModelsWindow.setBackgroundColor(backgroundColor);

        // Inject theme into localStorage and trigger React update
        aiModelsWindow.webContents.executeJavaScript(`
            localStorage.setItem('theme', '${currentTheme}');
            // Dispatch storage event to trigger React component update
            window.dispatchEvent(new StorageEvent('storage', {
                key: 'theme',
                newValue: '${currentTheme}',
                url: window.location.href
            }));
            console.log('[AIModelsWindow] Updated theme to:', '${currentTheme}');
        `).catch(err => {
            console.error('Failed to update AI Models window theme:', err);
        });
    }
}

// Handle IPC events for AI Models
export function setupAIModelsHandlers() {
    // This is already handled in AIService, but we can add window-specific handlers here if needed
}