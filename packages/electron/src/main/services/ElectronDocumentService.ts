import { ipcMain, BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import {
  Document,
  DocumentService,
  DocumentOpenOptions,
  DocumentMetadataEntry,
  MetadataChangeEvent
} from '@stravu/runtime';
import crypto from 'crypto';
import { extractFrontmatter, extractCommonFields } from '../utils/frontmatterReader';

export class ElectronDocumentService implements DocumentService {
  private workspacePath: string;
  private documents: Document[] = [];
  private watchers: Map<string, (documents: Document[]) => void> = new Map();
  private watchInterval: NodeJS.Timeout | null = null;

  // Metadata cache
  private metadataCache: Map<string, DocumentMetadataEntry> = new Map();
  private metadataByPath: Map<string, DocumentMetadataEntry> = new Map();
  private metadataWatchers: Map<string, (change: MetadataChangeEvent) => void> = new Map();
  private fileStateCache: Map<string, { mtime: number; size: number; hash?: string }> = new Map();
  private initializationPromise: Promise<void> | null = null;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;

    // Start async initial load (non-blocking)
    this.initializationPromise = this.initializeAsync();

    // Start polling for changes every 2 seconds after a short delay
    // This ensures the initial scan doesn't conflict with the first poll
    setTimeout(() => {
      this.watchInterval = setInterval(() => {
        this.refreshDocuments();
      }, 2000);
    }, 500);
  }

  private async initializeAsync(): Promise<void> {
    try {
      // Perform initial document scan and metadata extraction
      await this.refreshDocuments();
      console.log(`[DocumentService] Initial metadata cache loaded: ${this.metadataCache.size} documents`);
      // console.log('[DocumentService] Sample metadata:', Array.from(this.metadataCache.values()).slice(0, 3).map(m => ({
      //   path: m.path,
      //   hasFrontmatter: Object.keys(m.frontmatter).length > 0,
      //   frontmatterKeys: Object.keys(m.frontmatter)
      // })));
    } catch (error) {
      console.error('[DocumentService] Failed to initialize metadata cache:', error);
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initializationPromise) {
      await this.initializationPromise;
    }
  }

  private async refreshDocuments() {
    const oldDocuments = this.documents;
    this.documents = await this.scanDocuments();

    // Update metadata cache
    await this.updateMetadataCache(oldDocuments, this.documents);

    // Notify all watchers
    this.watchers.forEach(callback => callback(this.documents));
  }

  private async updateMetadataCache(oldDocs: Document[], newDocs: Document[]) {
    const added: DocumentMetadataEntry[] = [];
    const updated: DocumentMetadataEntry[] = [];
    const removed: string[] = [];

    // Create maps for easier lookup
    const oldDocsMap = new Map(oldDocs.map(d => [d.id, d]));
    const newDocsMap = new Map(newDocs.map(d => [d.id, d]));

    // Check for removed documents
    for (const oldDoc of oldDocs) {
      if (!newDocsMap.has(oldDoc.id)) {
        removed.push(oldDoc.id);
        this.metadataCache.delete(oldDoc.id);
        this.metadataByPath.delete(oldDoc.path);
        this.fileStateCache.delete(oldDoc.path);
      }
    }

    // Check for added or updated documents
    for (const newDoc of newDocs) {
      const oldDoc = oldDocsMap.get(newDoc.id);
      const fullPath = path.join(this.workspacePath, newDoc.path);

      // Get current file state
      const stats = newDoc.lastModified ? { mtime: newDoc.lastModified.getTime(), size: 0 } : null;

      if (!stats) continue;

      const cachedState = this.fileStateCache.get(newDoc.path);
      const needsUpdate = !oldDoc || !cachedState ||
                         cachedState.mtime !== stats.mtime;

      if (needsUpdate) {
        try {
          // Extract frontmatter
          // console.log(`[DocumentService] Extracting frontmatter from: ${fullPath}`);
          const { data, hash, parseErrors } = await extractFrontmatter(fullPath);

          if (parseErrors) {
            console.warn(`[DocumentService] Parse errors for ${newDoc.path}:`, parseErrors);
          }

          // Debug: Log what we extracted for plan files
          if (newDoc.path.includes('plan')) {
            // console.log(`[DocumentService] Extracted data for ${newDoc.path}:`, data ? Object.keys(data) : 'null');
            if (data && data.planStatus) {
              // console.log(`[DocumentService] Found planStatus:`, data.planStatus);
            }
          }

          // Check if frontmatter actually changed
          if (!cachedState || cachedState.hash !== hash) {
            const commonFields = data ? extractCommonFields(data) : {};

            const metadata: DocumentMetadataEntry = {
              id: newDoc.id,
              path: newDoc.path,
              workspace: newDoc.workspace,
              frontmatter: data || {},
              summary: commonFields.summary,
              tags: commonFields.tags,
              lastModified: newDoc.lastModified || new Date(),
              lastIndexed: new Date(),
              hash: hash || undefined,
              parseErrors
            };

            // Update caches
            this.metadataCache.set(newDoc.id, metadata);
            this.metadataByPath.set(newDoc.path, metadata);
            this.fileStateCache.set(newDoc.path, {
              mtime: stats.mtime,
              size: stats.size || 0,
              hash: hash || undefined
            });

            if (!oldDoc) {
              added.push(metadata);
            } else {
              updated.push(metadata);
            }
          }
        } catch (error) {
          console.error(`[DocumentService] Failed to extract metadata for ${newDoc.path}:`, error);
        }
      }
    }

    // Notify metadata watchers if there are changes
    if (added.length > 0 || updated.length > 0 || removed.length > 0) {
      const changeEvent: MetadataChangeEvent = {
        added,
        updated,
        removed,
        timestamp: new Date()
      };

      this.metadataWatchers.forEach(callback => callback(changeEvent));
    }
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

  async openDocument(documentId: string, fallback?: DocumentOpenOptions): Promise<void> {
    let doc: Document | null = null;

    if (documentId) {
      doc = await this.getDocument(documentId);
    }

    if (!doc && fallback?.path) {
      doc = await this.getDocumentByPath(fallback.path);
    }

    if (!doc && fallback?.name) {
      const documents = await this.listDocuments();
      doc =
        documents.find(d => d.name === fallback.name) ||
        documents.find(d => d.path.split(/[\\/]/).pop() === fallback.name) ||
        null;
    }

    if (!doc) {
      throw new Error(
        `Document not found (id=${documentId || 'n/a'}, path=${fallback?.path ?? 'n/a'}, name=${fallback?.name ?? 'n/a'})`
      );
    }

    // Send message to renderer to open the document
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      window.webContents.send('open-document', {
        path: path.join(this.workspacePath, doc.path)
      });
    }
  }

  // Metadata API methods
  async getDocumentMetadata(id: string): Promise<DocumentMetadataEntry | null> {
    await this.ensureInitialized();
    return this.metadataCache.get(id) || null;
  }

  async getDocumentMetadataByPath(path: string): Promise<DocumentMetadataEntry | null> {
    await this.ensureInitialized();
    return this.metadataByPath.get(path) || null;
  }

  async listDocumentMetadata(): Promise<DocumentMetadataEntry[]> {
    await this.ensureInitialized();
    const metadata = Array.from(this.metadataCache.values());
    // console.log(`[DocumentService] listDocumentMetadata returning ${metadata.length} entries`);
    if (metadata.length > 0) {
      const planDocs = metadata.filter(m => m.path.includes('plan'));
      // console.log(`[DocumentService] Found ${planDocs.length} plan documents`);
      if (planDocs.length > 0) {
        // console.log('[DocumentService] Sample plan doc:', {
        //   path: planDocs[0].path,
        //   hasFrontmatter: !!planDocs[0].frontmatter,
        //   frontmatterKeys: Object.keys(planDocs[0].frontmatter || {}),
        //   hasPlanStatus: !!(planDocs[0].frontmatter && planDocs[0].frontmatter.planStatus)
        // });
      }
    }
    return metadata;
  }

  watchDocumentMetadata(listener: (change: MetadataChangeEvent) => void): () => void {
    const id = Date.now().toString();
    this.metadataWatchers.set(id, listener);

    // Return unsubscribe function
    return () => {
      this.metadataWatchers.delete(id);
    };
  }

  notifyFrontmatterChanged(path: string, frontmatter: Record<string, unknown>): void {
    const metadata = this.metadataByPath.get(path);
    if (!metadata) return;

    // Generate new hash
    const dataString = JSON.stringify(frontmatter, Object.keys(frontmatter).sort());
    const hash = crypto.createHash('sha256').update(dataString).digest('hex');

    // Check if frontmatter actually changed
    if (metadata.hash === hash) return;

    // Extract common fields
    const commonFields = extractCommonFields(frontmatter);

    // Update metadata
    const updatedMetadata: DocumentMetadataEntry = {
      ...metadata,
      frontmatter,
      summary: commonFields.summary,
      tags: commonFields.tags,
      lastIndexed: new Date(),
      hash
    };

    // Update caches
    this.metadataCache.set(metadata.id, updatedMetadata);
    this.metadataByPath.set(path, updatedMetadata);

    // Update file state cache
    const cachedState = this.fileStateCache.get(path);
    if (cachedState) {
      cachedState.hash = hash;
    }

    // Notify watchers
    const changeEvent: MetadataChangeEvent = {
      added: [],
      updated: [updatedMetadata],
      removed: [],
      timestamp: new Date()
    };

    this.metadataWatchers.forEach(callback => callback(changeEvent));
  }

  destroy() {
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = null;
    }
    this.watchers.clear();
    this.metadataWatchers.clear();
    this.metadataCache.clear();
    this.metadataByPath.clear();
    this.fileStateCache.clear();
  }
}

type DocumentServiceResolver = (event: IpcMainEvent | IpcMainInvokeEvent) => ElectronDocumentService | null;

let handlersRegistered = false;
let resolveDocumentService: DocumentServiceResolver | null = null;

function requireDocumentService(event: IpcMainEvent | IpcMainInvokeEvent): ElectronDocumentService {
  if (!resolveDocumentService) {
    throw new Error('[DocumentService] Resolver not registered');
  }
  const service = resolveDocumentService(event);
  if (!service) {
    throw new Error('[DocumentService] No document service available for sender');
  }
  return service;
}

// IPC handler setup
export function setupDocumentServiceHandlers(resolver: DocumentServiceResolver) {
  resolveDocumentService = resolver;

  if (handlersRegistered) {
    return;
  }
  handlersRegistered = true;

  ipcMain.handle('document-service:list', async (event) => {
    try {
      return await requireDocumentService(event).listDocuments();
    } catch (error) {
      console.error('[DocumentService] list failed:', error);
      return [];
    }
  });

  ipcMain.handle('document-service:search', async (event, query: string) => {
    try {
      return await requireDocumentService(event).searchDocuments(query);
    } catch (error) {
      console.error('[DocumentService] search failed:', error);
      return [];
    }
  });

  ipcMain.handle('document-service:get', async (event, id: string) => {
    try {
      return await requireDocumentService(event).getDocument(id);
    } catch (error) {
      console.error('[DocumentService] get failed:', error);
      return null;
    }
  });

  ipcMain.handle('document-service:get-by-path', async (event, path: string) => {
    try {
      return await requireDocumentService(event).getDocumentByPath(path);
    } catch (error) {
      console.error('[DocumentService] getByPath failed:', error);
      return null;
    }
  });

  ipcMain.handle('document-service:open', async (event, payload: { documentId: string; fallback?: DocumentOpenOptions }) => {
    try {
      const { documentId, fallback } = payload ?? { documentId: '' };
      return await requireDocumentService(event).openDocument(documentId, fallback);
    } catch (error) {
      console.error('[DocumentService] open failed:', error);
      throw error;
    }
  });

  // Handle watch subscriptions
  ipcMain.on('document-service:watch', (event) => {
    let unsubscribe: (() => void) | undefined;
    try {
      const service = requireDocumentService(event);
      unsubscribe = service.watchDocuments((documents) => {
        event.sender.send('document-service:documents-changed', documents);
      });
    } catch (error) {
      console.error('[DocumentService] watch failed to start:', error);
      event.sender.send('document-service:documents-changed', []);
    }

    if (unsubscribe) {
      // Clean up when renderer is destroyed
      event.sender.once('destroyed', unsubscribe);
    }
  });

  // Metadata IPC handlers
  ipcMain.handle('document-service:metadata-get', async (event, id: string) => {
    try {
      return await requireDocumentService(event).getDocumentMetadata(id);
    } catch (error) {
      console.error('[DocumentService] metadata-get failed:', error);
      return null;
    }
  });

  ipcMain.handle('document-service:metadata-get-by-path', async (event, path: string) => {
    try {
      return await requireDocumentService(event).getDocumentMetadataByPath(path);
    } catch (error) {
      console.error('[DocumentService] metadata-get-by-path failed:', error);
      return null;
    }
  });

  ipcMain.handle('document-service:metadata-list', async (event) => {
    try {
      // console.log('[DocumentService] metadata-list IPC handler called');
      const service = requireDocumentService(event);
      // console.log('[DocumentService] Got service:', !!service);
      const result = await service.listDocumentMetadata();
      // console.log('[DocumentService] Returning metadata:', result.length);
      return result;
    } catch (error) {
      console.error('[DocumentService] metadata-list failed:', error);
      return [];
    }
  });

  ipcMain.handle('document-service:notify-frontmatter-changed', async (event, payload: { path: string; frontmatter: Record<string, unknown> }) => {
    try {
      const { path, frontmatter } = payload;
      requireDocumentService(event).notifyFrontmatterChanged(path, frontmatter);
      return { success: true };
    } catch (error) {
      console.error('[DocumentService] notify-frontmatter-changed failed:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Handle metadata watch subscriptions
  ipcMain.on('document-service:metadata-watch', (event) => {
    let unsubscribe: (() => void) | undefined;
    try {
      const service = requireDocumentService(event);
      unsubscribe = service.watchDocumentMetadata((change) => {
        event.sender.send('document-service:metadata-changed', change);
      });
    } catch (error) {
      console.error('[DocumentService] metadata-watch failed to start:', error);
    }

    if (unsubscribe) {
      // Clean up when renderer is destroyed
      event.sender.once('destroyed', unsubscribe);
    }
  });
}
