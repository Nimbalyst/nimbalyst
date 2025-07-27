import { app, BrowserWindow, Menu, dialog, ipcMain } from 'electron';
import { join } from 'path';
import { readFileSync, writeFileSync, appendFileSync } from 'fs';

let mainWindow: BrowserWindow | null = null;
let currentFilePath: string | null = null;
let documentEdited: boolean = false;

// Reset file path when creating new window
function resetFileState() {
  currentFilePath = null;
  documentEdited = false;
  console.log('Reset file state, currentFilePath:', currentFilePath);
}

function createWindow() {
  // Reset state when creating new window
  resetFileState();
  
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // In development, load from vite dev server
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5273');
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load built files
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
    mainWindow.webContents.openDevTools(); // Enable dev tools
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
    if (currentFilePath) {
      loadFileIntoWindow(currentFilePath);
    }
  });
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
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle file opening from OS (file associations)
app.on('open-file', (event, path) => {
  event.preventDefault();
  
  if (mainWindow) {
    // If window already exists, load the file
    loadFileIntoWindow(path);
  } else {
    // Store the file path to open after window is created
    currentFilePath = path;
  }
});

function loadFileIntoWindow(filePath: string) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    currentFilePath = filePath;
    mainWindow?.webContents.send('file-opened-from-os', { filePath, content });
  } catch (error) {
    console.error('Error loading file from OS:', error);
  }
}

// Create application menu
const template = [
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
  }
];

Menu.setApplicationMenu(Menu.buildFromTemplate(template as any));

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
    return { success: true, filePath: currentFilePath };
  } catch (error) {
    console.error('Error saving file:', error);
    return null;
  }
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