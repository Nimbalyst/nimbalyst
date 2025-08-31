import { BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';

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
            preload: join(__dirname, '../preload/index.js')
        },
        show: false,
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
        trafficLightPosition: { x: 10, y: 10 },
        vibrancy: 'sidebar',
        backgroundColor: '#1e1e1e'
    });

    // Load the main app with a query parameter to indicate AI Models mode
    if (process.env.NODE_ENV === 'development') {
        aiModelsWindow.loadURL('http://localhost:5273/?mode=ai-models');
    } else {
        aiModelsWindow.loadFile(join(__dirname, '../renderer/index.html'), {
            query: { mode: 'ai-models' }
        });
    }

    // Show window when ready
    aiModelsWindow.once('ready-to-show', () => {
        aiModelsWindow?.show();
    });

    // Clean up on close
    aiModelsWindow.on('closed', () => {
        aiModelsWindow = null;
    });

    return aiModelsWindow;
}

// Handle IPC events for AI Models
export function setupAIModelsHandlers() {
    // This is already handled in AIService, but we can add window-specific handlers here if needed
}