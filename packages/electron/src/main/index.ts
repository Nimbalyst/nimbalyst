import { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage } from 'electron';
import { join } from 'path';
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';

let mainWindow: BrowserWindow | null = null;
let currentFilePath: string | null = null;
let documentEdited: boolean = false;
let pendingFilePath: string | null = null;

// Function to load file into window
function loadFileIntoWindow(filePath: string) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    currentFilePath = filePath;
    console.log('Loading file into window:', filePath);
    mainWindow?.webContents.send('file-opened-from-os', { filePath, content });
  } catch (error) {
    console.error('Error loading file from OS:', error);
  }
}

// Handle file opening from OS (file associations and dock drops)
// This needs to be registered early to catch files dropped on dock
app.on('open-file', (event, path) => {
  event.preventDefault();
  console.log('open-file event received:', path);
  
  if (app.isReady() && mainWindow && !mainWindow.isDestroyed()) {
    // If window already exists, load the file
    loadFileIntoWindow(path);
  } else {
    // Store the file path to open after window is created
    pendingFilePath = path;
    // If app is ready but no window exists, create one
    if (app.isReady() && !mainWindow) {
      createWindow();
    }
  }
});

// Reset file path when creating new window
function resetFileState() {
  currentFilePath = null;
  documentEdited = false;
  console.log('Reset file state, currentFilePath:', currentFilePath);
}

function createWindow() {
  try {
    console.log('Creating window...');
    // Reset state when creating new window
    resetFileState();
  
  // Set up icon path based on platform
  let icon;
  try {
    if (process.platform === 'darwin') {
      // On macOS in dev, we need to use a PNG file, not the iconset
      const iconPath = join(__dirname, '../../../../assets/crystal-editor-iconset/icon.iconset/icon_512x512.png');
      console.log('Window icon path:', iconPath);
      if (existsSync(iconPath)) {
        icon = nativeImage.createFromPath(iconPath);
      }
    } else if (process.platform === 'win32') {
      const iconPath = join(__dirname, '../../icon.ico');
      if (existsSync(iconPath)) {
        icon = iconPath;
      }
    } else {
      // Linux
      const iconPath = join(__dirname, '../../icon.png');
      if (existsSync(iconPath)) {
        icon = iconPath;
      }
    }
  } catch (error) {
    console.error('Error loading icon:', error);
  }
  
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // In development, load from vite dev server
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5273');
  } else {
    // In production, load built files
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Handle window close with unsaved changes
  mainWindow.on('close', (event) => {
    if (documentEdited) {
      event.preventDefault();
      
      const choice = dialog.showMessageBoxSync(mainWindow!, {
        type: 'question',
        buttons: ['Save', "Don't Save", 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        message: 'Do you want to save the changes you made?',
        detail: 'Your changes will be lost if you close without saving.'
      });
      
      if (choice === 0) {
        // Save
        mainWindow!.webContents.send('file-save');
        // Wait a bit for save to complete
        setTimeout(() => {
          if (!documentEdited) {
            mainWindow!.destroy();
          }
        }, 100);
      } else if (choice === 1) {
        // Don't save
        mainWindow!.destroy();
      }
      // If Cancel (choice === 2), do nothing
    }
  });
  
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // If a file was requested to be opened before window was ready, open it now
  mainWindow.webContents.once('did-finish-load', () => {
    if (pendingFilePath) {
      loadFileIntoWindow(pendingFilePath);
      pendingFilePath = null;
    } else if (currentFilePath) {
      loadFileIntoWindow(currentFilePath);
    }
  });
  
  console.log('Window created successfully');
  } catch (error) {
    console.error('Error creating window:', error);
    throw error;
  }
}

// Set up console logging in development
if (process.env.NODE_ENV !== 'production') {
  const debugLogPath = join(app.getPath('userData'), 'stravu-editor-debug.log');
  
  // Clear log on startup
  try {
    writeFileSync(debugLogPath, `=== Stravu Editor Debug Log Started ${new Date().toISOString()} ===\n`);
  } catch (error) {
    console.error('Failed to initialize debug log:', error);
  }

  // Listen for console logs from renderer
  ipcMain.on('console-log', (_event, data) => {
    const logEntry = `[${data.timestamp}] [${data.level.toUpperCase()}] [${data.source}] ${data.message}\n`;
    try {
      appendFileSync(debugLogPath, logEntry);
    } catch (error) {
      console.error('Failed to write to debug log:', error);
    }
  });

  // Also capture main process logs
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug
  };

  const captureMainLog = (level: string, ...args: any[]) => {
    originalConsole[level as keyof typeof originalConsole](...args);
    
    const timestamp = new Date().toISOString();
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    
    const logEntry = `[${timestamp}] [${level.toUpperCase()}] [main] ${message}\n`;
    try {
      appendFileSync(debugLogPath, logEntry);
    } catch (error) {
      // Don't log this error to avoid infinite loop
    }
  };

  console.log = (...args) => captureMainLog('log', ...args);
  console.warn = (...args) => captureMainLog('warn', ...args);
  console.error = (...args) => captureMainLog('error', ...args);
  console.info = (...args) => captureMainLog('info', ...args);
  console.debug = (...args) => captureMainLog('debug', ...args);

  console.log('Debug logging enabled. Logs will be written to:', debugLogPath);
}

app.whenReady().then(() => {
  try {
    // Set dock icon for macOS
    if (process.platform === 'darwin' && app.dock) {
      const iconPath = join(__dirname, '../../../../assets/crystal-editor-iconset/icon.iconset/icon_512x512.png');
      console.log('Looking for icon at:', iconPath);
      if (existsSync(iconPath)) {
        const dockIcon = nativeImage.createFromPath(iconPath);
        app.dock.setIcon(dockIcon);
        console.log('Dock icon set successfully');
      } else {
        console.log('Icon file not found');
      }
    }
    
    createWindow();
    createApplicationMenu();

    app.on('activate', () => {
      // On macOS, re-create window when dock icon is clicked
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
    
  } catch (error) {
    console.error('Error during app initialization:', error);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
  // On macOS, keep the app running even when all windows are closed
  // This allows dropping files on the dock icon
});


// Function to create application menu
function createApplicationMenu() {
  const template: any[] = [
  {
    label: 'File',
    submenu: [
      { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => mainWindow?.webContents.send('file-new') },
      { label: 'Open', accelerator: 'CmdOrCtrl+O', click: () => mainWindow?.webContents.send('file-open') },
      { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => mainWindow?.webContents.send('file-save') },
      { label: 'Save As', accelerator: 'CmdOrCtrl+Shift+S', click: () => mainWindow?.webContents.send('file-save-as') },
      { type: 'separator' },
      { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }
    ]
  },
  {
    label: 'Edit',
    submenu: [
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
      { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', role: 'redo' },
      { type: 'separator' },
      { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
      { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
      { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' }
    ]
  },
  {
    label: 'View',
    submenu: [
      { label: 'Toggle Developer Tools', accelerator: 'CmdOrCtrl+Shift+I', click: () => mainWindow?.webContents.toggleDevTools() },
      { type: 'separator' },
      { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.webContents.reload() },
      { label: 'Force Reload', accelerator: 'CmdOrCtrl+Shift+R', click: () => mainWindow?.webContents.reloadIgnoringCache() },
      { type: 'separator' },
      { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => mainWindow?.webContents.setZoomFactor(1) },
      { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => {
        const currentZoom = mainWindow?.webContents.getZoomFactor() || 1;
        mainWindow?.webContents.setZoomFactor(currentZoom + 0.1);
      }},
      { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => {
        const currentZoom = mainWindow?.webContents.getZoomFactor() || 1;
        mainWindow?.webContents.setZoomFactor(Math.max(0.5, currentZoom - 0.1));
      }}
    ]
  }
];

// Add app menu on macOS
if (process.platform === 'darwin') {
  template.unshift({
    label: app.getName(),
    submenu: [
      {
        label: 'About Stravu Editor',
        click: () => {
          dialog.showMessageBox(mainWindow!, {
            type: 'info',
            title: 'About Stravu Editor',
            message: 'Stravu Editor',
            detail: `Version 0.33.1\n\nA powerful rich text editor made with ❤️ by Stravu\n\nBuilt with Lexical - Meta's extensible text editor framework\n\nCredits:\n• Lexical Framework by Meta\n• Based on Lexical Playground\n• Icons and design by Stravu\n\n© 2024 Stravu. All rights reserved.`,
            buttons: ['OK'],
            icon: process.platform === 'darwin' 
              ? nativeImage.createFromPath(join(__dirname, '../../../../assets/crystal-editor-iconset/icon.iconset/icon_512x512.png'))
              : undefined
          });
        }
      },
      { type: 'separator' },
      { label: 'Preferences...', accelerator: 'CmdOrCtrl+,', enabled: false },
      { type: 'separator' },
      { label: 'Services', submenu: [] },
      { type: 'separator' },
      { label: 'Hide ' + app.getName(), accelerator: 'Command+H', role: 'hide' },
      { label: 'Hide Others', accelerator: 'Command+Shift+H', role: 'hideothers' },
      { label: 'Show All', role: 'unhide' },
      { type: 'separator' },
      { label: 'Quit', accelerator: 'Command+Q', click: () => app.quit() }
    ]
  });
} else {
  // Windows and Linux
  template.push({
    label: 'Help',
    submenu: [
      {
        label: 'About Stravu Editor',
        click: () => {
          dialog.showMessageBox(mainWindow!, {
            type: 'info',
            title: 'About Stravu Editor',
            message: 'Stravu Editor',
            detail: `Version 0.33.1\n\nA powerful rich text editor made with ❤️ by Stravu\n\nBuilt with Lexical - Meta's extensible text editor framework\n\nCredits:\n• Lexical Framework by Meta\n• Based on Lexical Playground\n• Icons and design by Stravu\n\n© 2024 Stravu. All rights reserved.`,
            buttons: ['OK']
          });
        }
      }
    ]
  });
}

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// IPC handlers for file operations
ipcMain.handle('open-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: [
      { name: 'Markdown Files', extensions: ['md', 'markdown'] },
      { name: 'Text Files', extensions: ['txt'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (!result.canceled && result.filePaths.length > 0) {
    currentFilePath = result.filePaths[0];
    const content = readFileSync(currentFilePath, 'utf-8');
    return { filePath: currentFilePath, content };
  }
  
  return null;
});

ipcMain.handle('save-file', async (_event, content: string) => {
  console.log('save-file handler called, currentFilePath:', currentFilePath);
  try {
    if (!currentFilePath) {
      console.log('No current file path in main process');
      // No file is currently open - the renderer should handle this
      // by calling save-file-as instead
      return null;
    }
    
    console.log('Writing to file:', currentFilePath);
    writeFileSync(currentFilePath, content, 'utf-8');
    documentEdited = false; // Reset dirty state after save
    return { success: true, filePath: currentFilePath };
  } catch (error) {
    console.error('Error saving file:', error);
    return null;
  }
});

// IPC handler to update current file path from renderer (for drag-drop)
ipcMain.on('set-current-file', (_event, filePath: string | null) => {
  currentFilePath = filePath;
  console.log('Current file path updated from renderer:', currentFilePath);
});

ipcMain.handle('save-file-as', async (_event, content: string) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow!, {
      filters: [
        { name: 'Markdown Files', extensions: ['md'] },
        { name: 'Text Files', extensions: ['txt'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      defaultPath: currentFilePath || 'untitled.md'
    });

    if (!result.canceled && result.filePath) {
      currentFilePath = result.filePath;
      writeFileSync(currentFilePath, content, 'utf-8');
      return { success: true, filePath: currentFilePath };
    }
    
    return null;
  } catch (error) {
    console.error('Error saving file as:', error);
    return null;
  }
});

// IPC handlers for window operations
ipcMain.on('set-document-edited', (_event, edited: boolean) => {
  documentEdited = edited;
  if (mainWindow) {
    mainWindow.setDocumentEdited(edited);
  }
});

ipcMain.on('set-title', (_event, title: string) => {
  if (mainWindow) {
    mainWindow.setTitle(title);
  }
});