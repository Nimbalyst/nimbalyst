import { ipcMain, BrowserWindow } from 'electron';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { windowStates } from '../window/WindowManager';
import { startFileWatcher, stopFileWatcher } from '../file/FileWatcher';
import { getFolderContents } from '../utils/FileTree';
import { getProjectRecentFiles, addProjectRecentFile, store } from '../utils/store';

export function registerProjectHandlers() {
    // Get folder contents
    ipcMain.handle('get-folder-contents', (event, dirPath: string) => {
        return getFolderContents(dirPath);
    });

    // Create new file
    ipcMain.handle('create-file', async (event, filePath: string, content: string = '') => {
        const { writeFile } = require('fs').promises;
        try {
            await writeFile(filePath, content, 'utf-8');
            return { success: true, filePath };
        } catch (error: any) {
            console.error('Error creating file:', error);
            return { success: false, error: error.message };
        }
    });

    // Create new folder
    ipcMain.handle('create-folder', async (event, folderPath: string) => {
        const { mkdir } = require('fs').promises;
        try {
            await mkdir(folderPath, { recursive: true });
            return { success: true, folderPath };
        } catch (error: any) {
            console.error('Error creating folder:', error);
            return { success: false, error: error.message };
        }
    });

    // Switch project file
    ipcMain.handle('switch-project-file', async (event, filePath: string) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) return null;

        try {
            const content = readFileSync(filePath, 'utf-8');
            const windowId = window.id;
            const state = windowStates.get(windowId);

            if (state) {
                // Stop watching the old file
                if (state.filePath && state.filePath !== filePath) {
                    stopFileWatcher(windowId);
                }

                state.filePath = filePath;
                state.documentEdited = false;
                
                // Add to recent project files
                if (state.projectPath) {
                    addProjectRecentFile(state.projectPath, filePath);
                }

                // Start watching the new file
                startFileWatcher(window, filePath);
            }

            // Set represented filename for macOS
            if (process.platform === 'darwin') {
                window.setRepresentedFilename(filePath);
            }

            return { filePath, content };
        } catch (error) {
            console.error('Error switching project file:', error);
            return null;
        }
    });

    // Search project files
    ipcMain.handle('search-project-files', async (event, projectPath: string, query: string) => {
        try {
            const results: string[] = [];
            const searchLower = query.toLowerCase();
            const maxResults = 50;
            
            // Recursive function to search files
            const searchDir = (dir: string) => {
                if (results.length >= maxResults) return;
                
                try {
                    const items = readdirSync(dir);
                    
                    for (const item of items) {
                        if (results.length >= maxResults) break;
                        
                        const fullPath = join(dir, item);
                        
                        // Skip node_modules, .git, and other common directories
                        if (item === 'node_modules' || item === '.git' || item === 'dist' || item === 'build' || item.startsWith('.')) {
                            continue;
                        }
                        
                        const stat = statSync(fullPath);
                        
                        if (stat.isDirectory()) {
                            searchDir(fullPath);
                        } else if (stat.isFile()) {
                            // Check if filename matches query and is a markdown file
                            if (item.toLowerCase().includes(searchLower) && 
                                (item.endsWith('.md') || item.endsWith('.markdown'))) {
                                results.push(fullPath);
                            }
                        }
                    }
                } catch (error) {
                    console.error(`Error searching directory ${dir}:`, error);
                }
            };
            
            searchDir(projectPath);
            return results;
        } catch (error) {
            console.error('Error searching project files:', error);
            return [];
        }
    });

    // Get recent project files
    ipcMain.handle('get-recent-project-files', (event) => {
        const windowId = BrowserWindow.fromWebContents(event.sender)?.id;
        if (!windowId) return [];
        
        const state = windowStates.get(windowId);
        if (!state || !state.projectPath) return [];
        
        // Get recent files for this project from store
        const projectRecentFiles = getProjectRecentFiles(state.projectPath);
        
        // Filter to only existing files
        return projectRecentFiles.filter(filePath => existsSync(filePath)).slice(0, 20);
    });

    // Add to project recent files
    ipcMain.on('add-to-project-recent-files', (event, filePath: string) => {
        const windowId = BrowserWindow.fromWebContents(event.sender)?.id;
        if (!windowId) return;
        
        const state = windowStates.get(windowId);
        if (!state || !state.projectPath) return;
        
        addProjectRecentFile(state.projectPath, filePath);
    });

    // File operations for project files
    ipcMain.handle('rename-file', async (event, oldPath: string, newName: string) => {
        const { rename } = require('fs').promises;
        const { dirname, join } = require('path');

        try {
            const newPath = join(dirname(oldPath), newName);
            await rename(oldPath, newPath);

            // Update windows that have this file open
            for (const [windowId, state] of windowStates) {
                if (state?.filePath === oldPath) {
                    state.filePath = newPath;
                    // Update represented filename for macOS
                    const window = BrowserWindow.getAllWindows().find(w => w.id === windowId);
                    if (window && process.platform === 'darwin') {
                        window.setRepresentedFilename(newPath);
                    }
                }
            }

            // Notify all windows about the file rename
            BrowserWindow.getAllWindows().forEach(window => {
                window.webContents.send('file-renamed', { oldPath, newPath });
            });

            return { success: true, newPath };
        } catch (error: any) {
            console.error('Error renaming file:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('delete-file', async (event, filePath: string) => {
        const { unlink, rm, stat } = require('fs').promises;

        try {
            const stats = await stat(filePath);

            if (stats.isDirectory()) {
                // For directories, use recursive removal
                await rm(filePath, { recursive: true, force: true });
            } else {
                await unlink(filePath);
            }

            // Clear file path for windows that have this file open
            for (const [windowId, state] of windowStates) {
                if (state?.filePath === filePath) {
                    state.filePath = null;
                    state.documentEdited = false;
                }
            }

            // Notify all windows about the file deletion
            BrowserWindow.getAllWindows().forEach(window => {
                window.webContents.send('file-deleted', { filePath });
            });

            return { success: true };
        } catch (error: any) {
            console.error('Error deleting file:', error);
            return { success: false, error: error.message };
        }
    });

    // Move file/folder
    ipcMain.handle('move-file', async (event, sourcePath: string, targetPath: string) => {
        const { rename, stat } = require('fs').promises;
        const { join, basename } = require('path');

        try {
            // Check if source exists
            const sourceStats = await stat(sourcePath);
            
            // Check if target is a directory
            let destinationPath = targetPath;
            try {
                const targetStats = await stat(targetPath);
                if (targetStats.isDirectory()) {
                    // If target is a directory, move source into it
                    destinationPath = join(targetPath, basename(sourcePath));
                }
            } catch {
                // Target doesn't exist, use it as the new path
            }

            // Perform the move
            await rename(sourcePath, destinationPath);

            // Update windows that have this file open
            if (!sourceStats.isDirectory()) {
                for (const [windowId, state] of windowStates) {
                    if (state?.filePath === sourcePath) {
                        state.filePath = destinationPath;
                        // Update represented filename for macOS
                        const window = BrowserWindow.getAllWindows().find(w => w.id === windowId);
                        if (window && process.platform === 'darwin') {
                            window.setRepresentedFilename(destinationPath);
                        }
                    }
                }
            }

            // Notify all windows about the file move
            BrowserWindow.getAllWindows().forEach(window => {
                window.webContents.send('file-moved', { sourcePath, destinationPath });
            });

            return { success: true, newPath: destinationPath };
        } catch (error: any) {
            console.error('Error moving file:', error);
            return { success: false, error: error.message };
        }
    });

    // Copy file/folder
    ipcMain.handle('copy-file', async (event, sourcePath: string, targetPath: string) => {
        const { cp, stat } = require('fs').promises;
        const { join, basename, extname } = require('path');

        try {
            // Check if source exists
            const sourceStats = await stat(sourcePath);
            
            // Check if target is a directory
            let destinationPath = targetPath;
            try {
                const targetStats = await stat(targetPath);
                if (targetStats.isDirectory()) {
                    // If target is a directory, copy source into it
                    let destName = basename(sourcePath);
                    destinationPath = join(targetPath, destName);
                    
                    // Check if file already exists and generate unique name
                    let counter = 1;
                    const nameWithoutExt = basename(sourcePath, extname(sourcePath));
                    const ext = extname(sourcePath);
                    
                    while (existsSync(destinationPath)) {
                        destName = `${nameWithoutExt} copy${counter > 1 ? ' ' + counter : ''}${ext}`;
                        destinationPath = join(targetPath, destName);
                        counter++;
                    }
                }
            } catch {
                // Target doesn't exist, use it as the new path
            }

            // Perform the copy
            await cp(sourcePath, destinationPath, { recursive: true });

            // Notify all windows about the file copy
            BrowserWindow.getAllWindows().forEach(window => {
                window.webContents.send('file-copied', { sourcePath, destinationPath });
            });

            return { success: true, newPath: destinationPath };
        } catch (error: any) {
            console.error('Error copying file:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('open-file-in-new-window', async (event, filePath: string) => {
        try {
            const { createWindow } = require('../window/WindowManager');
            const { loadFileIntoWindow } = require('../file/FileOperations');
            
            const newWindow = createWindow(true, false);
            newWindow.once('ready-to-show', () => {
                loadFileIntoWindow(newWindow, filePath);
            });
            return { success: true };
        } catch (error: any) {
            console.error('Error opening file in new window:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('show-in-finder', async (event, filePath: string) => {
        const { shell } = require('electron');

        try {
            shell.showItemInFolder(filePath);
            return { success: true };
        } catch (error: any) {
            console.error('Error showing in finder:', error);
            return { success: false, error: error.message };
        }
    });
}