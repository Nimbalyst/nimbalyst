/**
 * File service interface for handling file operations in different environments.
 * Supports web File System Access API, Origin Private File System, and Electron.
 */

export interface FileService {
  loadFile(): Promise<string>;
  saveFile(content: string): Promise<void>;
  canAutoSave: boolean;
  canAutoLoad: boolean; // Whether the service can load files without user interaction
  getCurrentFileName(): string | null;
}

/**
 * Web implementation using File System Access API
 * Requires user interaction for each save operation
 */
export class WebFileService implements FileService {
  private fileHandle: FileSystemFileHandle | null = null;
  canAutoSave = false; // Requires user interaction each time
  canAutoLoad = false; // Requires user interaction to select file

  getCurrentFileName(): string | null {
    return this.fileHandle?.name || null;
  }

  async loadFile(): Promise<string> {
    if (!('showOpenFilePicker' in window)) {
      throw new Error('File System Access API not supported');
    }

    const [fileHandle] = await window.showOpenFilePicker({
      types: [{
        description: 'Markdown files',
        accept: { 'text/markdown': ['.md', '.markdown'] }
      }, {
        description: 'Text files',
        accept: { 'text/plain': ['.txt'] }
      }]
    });
    
    this.fileHandle = fileHandle;
    const file = await fileHandle.getFile();
    return await file.text();
  }

  async saveFile(content: string): Promise<void> {
    if (!this.fileHandle) {
      if (!('showSaveFilePicker' in window)) {
        throw new Error('File System Access API not supported');
      }

      this.fileHandle = await window.showSaveFilePicker({
        suggestedName: 'document.md',
        types: [{
          description: 'Markdown files',
          accept: { 'text/markdown': ['.md'] }
        }, {
          description: 'Text files',
          accept: { 'text/plain': ['.txt'] }
        }]
      });
    }

    const writable = await this.fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  }
}

/**
 * Origin Private File System implementation for auto-save
 * Files are stored in browser's private storage
 */
export class OPFSFileService implements FileService {
  canAutoSave = true;
  canAutoLoad = true; // Can load files without user interaction
  private fileName: string;

  constructor(fileName: string = 'draft.md') {
    this.fileName = fileName;
  }

  getCurrentFileName(): string {
    return this.fileName;
  }

  async loadFile(): Promise<string> {
    try {
      if (!('storage' in navigator)) {
        throw new Error('Origin Private File System not supported');
      }

      const opfsRoot = await navigator.storage.getDirectory();
      const fileHandle = await opfsRoot.getFileHandle(this.fileName);
      const file = await fileHandle.getFile();
      return await file.text();
    } catch {
      return ''; // File doesn't exist yet
    }
  }

  async saveFile(content: string): Promise<void> {
    if (!('storage' in navigator)) {
      throw new Error('Origin Private File System not supported');
    }

    const opfsRoot = await navigator.storage.getDirectory();
    const fileHandle = await opfsRoot.getFileHandle(this.fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  }
}

/**
 * Electron implementation using IPC
 * Requires main process handlers for file operations
 */
export class ElectronFileService implements FileService {
  canAutoSave = true;
  canAutoLoad = true; // Can load files without user interaction
  private filePath: string;
  
  constructor(filePath: string) {
    this.filePath = filePath;
  }

  getCurrentFileName(): string {
    return this.filePath.split('/').pop() || this.filePath;
  }

  async loadFile(): Promise<string> {
    if (!window.electronAPI) {
      throw new Error('Electron API not available');
    }
    return window.electronAPI.loadFile(this.filePath);
  }

  async saveFile(content: string): Promise<void> {
    if (!window.electronAPI) {
      throw new Error('Electron API not available');
    }
    await window.electronAPI.saveFile(this.filePath, content);
  }
}

/**
 * Factory function to create appropriate file service based on environment
 */
export function createFileService(options?: {
  type?: 'web' | 'opfs' | 'electron';
  filePath?: string;
  fileName?: string;
}): FileService {
  const { type, filePath, fileName } = options || {};

  // If type is specified, use it
  if (type === 'web') {
    return new WebFileService();
  }
  if (type === 'opfs') {
    return new OPFSFileService(fileName);
  }
  if (type === 'electron' && filePath) {
    return new ElectronFileService(filePath);
  }

  // Auto-detect best available service
  if (window.electronAPI) {
    return new ElectronFileService(filePath || 'untitled.md');
  }
  
  if ('showOpenFilePicker' in window) {
    return new WebFileService();
  }
  
  if ('storage' in navigator) {
    return new OPFSFileService(fileName);
  }

  throw new Error('No file service implementation available');
}

// Type declarations for Electron API
declare global {
  interface Window {
    electronAPI?: {
      loadFile: (filePath: string) => Promise<string>;
      saveFile: (filePath: string, content: string) => Promise<void>;
    };
  }
}