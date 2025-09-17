import { ipcMain, BrowserWindow } from 'electron';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { Document, DocumentService } from '@stravu/runtime';
import crypto from 'crypto';

export class ElectronDocumentService implements DocumentService {
  private workspacePath: string;
  private documents: Document[] = [];
  private watchers: Map<string, (documents: Document[]) => void> = new Map();
  private watchInterval: NodeJS.Timeout | null = null;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
    // Initial load
    this.refreshDocuments();

    // Start polling for changes every 2 seconds
    this.watchInterval = setInterval(() => {
      this.refreshDocuments();
    }, 2000);
  }

  private async refreshDocuments() {
    this.documents = await this.scanDocuments();
    // Notify all watchers
    this.watchers.forEach(callback => callback(this.documents));
  }

  private scanDirectory(dirPath: string, basePath: string = ''): Document[] {
    const documents: Document[] = [];
    // Only support markdown files
    const supportedExtensions = ['.md', '.markdown'];

    try {
      const items = fsSync.readdirSync(dirPath);

      for (const item of items) {
        // Skip hidden files and ignored directories
        if (item.startsWith('.') ||
            item === 'node_modules' ||
            item === 'dist' ||
            item === 'build' ||
            item === 'out') {
          continue;
        }

        const fullPath = path.join(dirPath, item);
        const relativePath = basePath ? path.join(basePath, item) : item;
        const stats = fsSync.statSync(fullPath);

        if (stats.isDirectory()) {
          // Recursively scan subdirectories
          documents.push(...this.scanDirectory(fullPath, relativePath));
        } else if (stats.isFile()) {
          const ext = path.extname(item).toLowerCase();
          if (supportedExtensions.includes(ext)) {
            const id = crypto.createHash('md5').update(relativePath).digest('hex');

            documents.push({
              id,
              name: item,
              path: relativePath,
              workspace: basePath || undefined,
              lastModified: stats.mtime,
              type: ext.slice(1)
            });
          }
        }
      }
    } catch (error) {
      console.error('Error scanning directory:', dirPath, error);
    }

    return documents;
  }

  private async scanDocuments(): Promise<Document[]> {
    try {
      // Use synchronous file system operations like the file tree
      return this.scanDirectory(this.workspacePath);
    } catch (err) {
      console.error('Error scanning documents:', err);
      return [];
    }
  }

  async listDocuments(): Promise<Document[]> {
    if (this.documents.length === 0) {
      this.documents = await this.scanDocuments();
    }
    return this.documents;
  }

  async searchDocuments(query: string): Promise<Document[]> {
    const documents = await this.listDocuments();
    const lowerQuery = query.toLowerCase();

    return documents.filter(doc =>
      doc.name.toLowerCase().includes(lowerQuery) ||
      doc.path.toLowerCase().includes(lowerQuery) ||
      (doc.workspace && doc.workspace.toLowerCase().includes(lowerQuery))
    );
  }

  async getDocument(id: string): Promise<Document | null> {
    const documents = await this.listDocuments();
    return documents.find(doc => doc.id === id) || null;
  }

  async getDocumentByPath(path: string): Promise<Document | null> {
    const documents = await this.listDocuments();
    return documents.find(doc => doc.path === path) || null;
  }

  watchDocuments(callback: (documents: Document[]) => void): () => void {
    const id = Date.now().toString();
    this.watchers.set(id, callback);

    // Send initial documents
    callback(this.documents);

    // Return unsubscribe function
    return () => {
      this.watchers.delete(id);
    };
  }

  async openDocument(documentId: string): Promise<void> {
    const doc = await this.getDocument(documentId);
    if (!doc) {
      throw new Error(`Document with id ${documentId} not found`);
    }

    // Send message to renderer to open the document
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      window.webContents.send('open-document', {
        path: path.join(this.workspacePath, doc.path)
      });
    }
  }

  destroy() {
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = null;
    }
    this.watchers.clear();
  }
}

// Track if handlers have been registered
let handlersRegistered = false;

// IPC handler setup
export function setupDocumentServiceHandlers(documentService: ElectronDocumentService) {
  // Only register handlers once
  if (handlersRegistered) {
    console.log('[DocumentService] Handlers already registered, skipping');
    return;
  }
  handlersRegistered = true;

  ipcMain.handle('document-service:list', async () => {
    return documentService.listDocuments();
  });

  ipcMain.handle('document-service:search', async (event, query: string) => {
    return documentService.searchDocuments(query);
  });

  ipcMain.handle('document-service:get', async (event, id: string) => {
    return documentService.getDocument(id);
  });

  ipcMain.handle('document-service:get-by-path', async (event, path: string) => {
    return documentService.getDocumentByPath(path);
  });

  ipcMain.handle('document-service:open', async (event, id: string) => {
    return documentService.openDocument(id);
  });

  // Handle watch subscriptions
  ipcMain.on('document-service:watch', (event) => {
    const unsubscribe = documentService.watchDocuments((documents) => {
      event.sender.send('document-service:documents-changed', documents);
    });

    // Clean up when renderer is destroyed
    event.sender.once('destroyed', unsubscribe);
  });
}
