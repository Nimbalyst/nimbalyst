import { BrowserWindow, ipcMain, dialog, app } from 'electron';
import { join, basename } from 'path';
import { existsSync, mkdirSync, statSync, readdirSync } from 'fs';
import { getRecentItems, addToRecentItems, store, getProjectWindowState } from '../utils/store';
import { createWindow } from './WindowManager';

let projectManagerWindow: BrowserWindow | null = null;

export function createProjectManagerWindow() {
  // If window already exists, focus it
  if (projectManagerWindow && !projectManagerWindow.isDestroyed()) {
    projectManagerWindow.focus();
    return projectManagerWindow;
  }

  // Create the window
  projectManagerWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 900,
    minHeight: 600,
    title: 'Project Manager - Preditor',
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

  // Load the main app with a query parameter to indicate Project Manager mode
  if (process.env.NODE_ENV === 'development') {
    projectManagerWindow.loadURL('http://localhost:5273/?mode=project-manager');
  } else {
    projectManagerWindow.loadFile(join(__dirname, '../../renderer/index.html'), {
      query: { mode: 'project-manager' }
    });
  }

  // Show window when ready
  projectManagerWindow.once('ready-to-show', () => {
    projectManagerWindow?.show();
  });

  // Clean up when closed
  projectManagerWindow.on('closed', () => {
    projectManagerWindow = null;
  });
  
  return projectManagerWindow;
}

// Setup handlers once when module loads
let handlersRegistered = false;

export function setupProjectManagerHandlers() {
  // Only register handlers once
  if (handlersRegistered) {
    return;
  }
  handlersRegistered = true;
  // Get recent projects with additional info
  ipcMain.handle('project-manager:get-recent-projects', async () => {
    const recentProjects = getRecentItems('projects');
    
    // Add additional info for each project
    const projectsWithInfo = recentProjects.map(project => {
      try {
        if (existsSync(project.path)) {
          const stats = statSync(project.path);
          const files = getProjectFiles(project.path);
          
          return {
            ...project,
            lastOpened: project.timestamp, // Use the timestamp from the recent items
            lastModified: stats.mtime.getTime(),
            fileCount: files.length,
            markdownCount: files.filter(f => f.endsWith('.md') || f.endsWith('.markdown')).length,
            exists: true
          };
        }
      } catch (error) {
        console.error('Error getting project info:', error);
      }
      
      return {
        ...project,
        lastOpened: project.timestamp || Date.now(), // Fallback to now if no timestamp
        exists: false
      };
    }).filter(p => p.exists);
    
    return projectsWithInfo;
  });

  // Get project statistics
  ipcMain.handle('project-manager:get-project-stats', async (event, projectPath: string) => {
    try {
      const files = getProjectFiles(projectPath);
      let totalSize = 0;
      const markdownFiles = [];
      
      for (const file of files) {
        try {
          const filePath = join(projectPath, file);
          const stats = statSync(filePath);
          totalSize += stats.size;
          
          if (file.endsWith('.md') || file.endsWith('.markdown')) {
            markdownFiles.push(file);
          }
        } catch (error) {
          // Ignore files we can't stat
        }
      }
      
      // Get recent files for this project
      const recentFiles = store.get(`projectRecentFiles.${projectPath}`, []) as string[];
      
      return {
        fileCount: files.length,
        markdownCount: markdownFiles.length,
        totalSize,
        recentFiles: recentFiles.slice(0, 5)
      };
    } catch (error) {
      console.error('Failed to get project stats:', error);
      return {
        fileCount: 0,
        markdownCount: 0,
        totalSize: 0,
        recentFiles: []
      };
    }
  });

  // Open folder dialog
  ipcMain.handle('project-manager:open-folder-dialog', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
      return { success: true, path: result.filePaths[0] };
    }
    
    return { success: false };
  });

  // Create project dialog
  ipcMain.handle('project-manager:create-project-dialog', async () => {
    const result = await dialog.showSaveDialog({
      title: 'Create New Project',
      buttonLabel: 'Create',
      properties: ['createDirectory', 'showOverwriteConfirmation']
    });
    
    if (!result.canceled && result.filePath) {
      try {
        // Create the directory if it doesn't exist
        if (!existsSync(result.filePath)) {
          mkdirSync(result.filePath, { recursive: true });
        }
        
        // Create a README.md file
        const fs = require('fs');
        const readmePath = join(result.filePath, 'README.md');
        if (!existsSync(readmePath)) {
          fs.writeFileSync(readmePath, `# ${basename(result.filePath)}\n\nWelcome to your new project!\n`);
        }
        
        return { success: true, path: result.filePath };
      } catch (error) {
        console.error('Failed to create project:', error);
        return { success: false, error: error.message };
      }
    }
    
    return { success: false };
  });

  // Open project (always in new window)
  ipcMain.handle('project-manager:open-project', async (event, projectPath: string) => {
    // Add to recent projects
    addToRecentItems('projects', projectPath, basename(projectPath));
    
    // Check for saved project window state
    const savedState = getProjectWindowState(projectPath);
    
    // Create window with saved bounds if available
    const window = createWindow(false, true, projectPath, savedState?.bounds);
    
    // Restore dev tools if they were open
    if (savedState?.devToolsOpen) {
      window.webContents.once('did-finish-load', () => {
        window.webContents.openDevTools();
      });
    }
    
    // Close project manager after opening project
    if (projectManagerWindow && !projectManagerWindow.isDestroyed()) {
      projectManagerWindow.close();
    }
    
    return { success: true };
  });

  // Remove from recent projects
  ipcMain.handle('project-manager:remove-recent', async (event, projectPath: string) => {
    const items = getRecentItems('projects').filter(item => item.path !== projectPath);
    store.set('recent.projects', items);
    return { success: true };
  });
}

// Helper function to get all files in a project
function getProjectFiles(projectPath: string, relativePath: string = ''): string[] {
  const files: string[] = [];
  const fullPath = join(projectPath, relativePath);
  
  try {
    const items = readdirSync(fullPath);
    
    for (const item of items) {
      // Skip hidden files and common ignore patterns
      if (item.startsWith('.') || item === 'node_modules' || item === 'dist' || item === 'out') {
        continue;
      }
      
      const itemPath = join(relativePath, item);
      const fullItemPath = join(projectPath, itemPath);
      const stats = statSync(fullItemPath);
      
      if (stats.isDirectory()) {
        files.push(...getProjectFiles(projectPath, itemPath));
      } else {
        files.push(itemPath);
      }
    }
  } catch (error) {
    console.error('Error reading directory:', error);
  }
  
  return files;
}

export function closeProjectManagerWindow() {
  if (projectManagerWindow && !projectManagerWindow.isDestroyed()) {
    projectManagerWindow.close();
  }
}

export function isProjectManagerOpen(): boolean {
  return projectManagerWindow !== null && !projectManagerWindow.isDestroyed();
}