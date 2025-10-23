import { ipcMain, BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent, app } from 'electron';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import {
  Document,
  DocumentService,
  DocumentOpenOptions,
  DocumentMetadataEntry,
  MetadataChangeEvent,
  TrackerItem,
  TrackerItemChangeEvent,
  TrackerItemType
} from '@nimbalyst/runtime';
import crypto from 'crypto';
import { extractFrontmatter, extractCommonFields } from '../utils/frontmatterReader';
import { VIRTUAL_DOCS, isVirtualPath } from '@nimbalyst/runtime';
import { database } from '../database/PGLiteDatabaseWorker';
import { shouldExcludeDir } from '../utils/fileFilters';

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

  // Tracker items cache
  private trackerItemWatchers: Map<string, (change: TrackerItemChangeEvent) => void> = new Map();

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

    // Only notify watchers if the document list actually changed
    if (this.hasDocumentListChanged(oldDocuments, this.documents)) {
      this.watchers.forEach(callback => callback(this.documents));
    }
  }

  private hasDocumentListChanged(oldDocs: Document[], newDocs: Document[]): boolean {
    if (oldDocs.length !== newDocs.length) return true;

    // Create a Set of document IDs for fast lookup
    const oldIds = new Set(oldDocs.map(d => d.id));
    const newIds = new Set(newDocs.map(d => d.id));

    // Check if any documents were added or removed
    if (oldIds.size !== newIds.size) return true;

    for (const id of newIds) {
      if (!oldIds.has(id)) return true;
    }

    return false;
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
          } else {
            // Frontmatter didn't change, but file mtime did - update mtime in cache
            this.fileStateCache.set(newDoc.path, {
              mtime: stats.mtime,
              size: stats.size || 0,
              hash: hash || undefined
            });
          }

          // Update tracker items cache whenever file content changes (mtime changed)
          // This ensures tracker items are updated even if frontmatter didn't change
          await this.updateTrackerItemsCache(newDoc.path);
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
        // Skip hidden files and excluded directories (including worktrees)
        if (item.startsWith('.') && item !== '.nimbalyst') {
          continue;
        }

        // Use centralized directory exclusion logic
        if (shouldExcludeDir(item)) {
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

    // Generate new hash - sort keys recursively for consistent hashing
    const sortedData = JSON.parse(JSON.stringify(frontmatter, (key, value) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return Object.keys(value).sort().reduce((sorted, key) => {
          sorted[key] = value[key];
          return sorted;
        }, {} as Record<string, any>);
      }
      return value;
    }));
    const dataString = JSON.stringify(sortedData);
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

  async refreshFileMetadata(filePath: string): Promise<void> {
    await this.ensureInitialized();

    // Convert to relative path if absolute
    const relativePath = filePath.startsWith(this.workspacePath)
      ? filePath.substring(this.workspacePath.length + 1)
      : filePath;

    const fullPath = path.join(this.workspacePath, relativePath);

    try {
      const stats = await fs.stat(fullPath);
      const { data, hash, parseErrors } = await extractFrontmatter(fullPath);

      if (parseErrors) {
        console.warn(`[DocumentService] Parse errors for ${relativePath}:`, parseErrors);
      }

      const cachedState = this.fileStateCache.get(relativePath);

      // Always update if hash changed or no cache exists
      if (!cachedState || cachedState.hash !== hash) {
        const commonFields = data ? extractCommonFields(data) : {};

        // Find the document entry
        const doc = this.documents.find(d => d.path === relativePath);
        if (!doc) {
          console.warn(`[DocumentService] Document not found for path: ${relativePath}`);
          return;
        }

        const metadata: DocumentMetadataEntry = {
          id: doc.id,
          path: relativePath,
          workspace: doc.workspace,
          frontmatter: data || {},
          summary: commonFields.summary,
          tags: commonFields.tags,
          lastModified: new Date(stats.mtime),
          lastIndexed: new Date(),
          hash: hash || undefined,
          parseErrors
        };

        // Update caches
        this.metadataCache.set(doc.id, metadata);
        this.metadataByPath.set(relativePath, metadata);
        this.fileStateCache.set(relativePath, {
          mtime: stats.mtimeMs,
          size: stats.size,
          hash: hash || undefined
        });

        // Notify watchers
        const changeEvent: MetadataChangeEvent = {
          added: [],
          updated: [metadata],
          removed: [],
          timestamp: new Date()
        };

        this.metadataWatchers.forEach(callback => callback(changeEvent));
      }
    } catch (error) {
      console.error(`[DocumentService] Failed to refresh metadata for ${relativePath}:`, error);
    }
  }

  /**
   * Load a virtual document by its path
   */
  async loadVirtualDocument(virtualPath: string): Promise<string | null> {
    if (!isVirtualPath(virtualPath)) {
      return null;
    }

    // Find the virtual document descriptor
    const virtualDoc = Object.values(VIRTUAL_DOCS).find(doc => doc.virtualPath === virtualPath);
    if (!virtualDoc) {
      console.error(`[DocumentService] Unknown virtual document: ${virtualPath}`);
      return null;
    }

    try {
      // Determine asset path - in development use source path, in production use app resources
      let assetPath: string;
      if (app.isPackaged) {
        assetPath = path.join(process.resourcesPath, virtualDoc.assetPath);
      } else {
        // In development, __dirname is out/main or out/main/services
        // Go up to packages/electron then add the asset path
        // out/main -> out -> packages/electron
        assetPath = path.join(__dirname, '../../', virtualDoc.assetPath);
      }

      console.log('[DocumentService] Loading virtual document:', {
        virtualPath,
        assetPath,
        __dirname,
        exists: await fs.access(assetPath).then(() => true).catch(() => false)
      });

      const content = await fs.readFile(assetPath, 'utf-8');
      return content;
    } catch (error) {
      console.error(`[DocumentService] Failed to load virtual document ${virtualPath}:`, error);
      return null;
    }
  }

  // Tracker Items API methods
  async listTrackerItems(): Promise<TrackerItem[]> {
    try {
      const result = await database.query<any>(
        `SELECT * FROM tracker_items WHERE workspace = $1 ORDER BY last_indexed DESC`,
        [this.workspacePath]
      );
      return result.rows.map(row => this.rowToTrackerItem(row));
    } catch (error) {
      console.error('[DocumentService] Failed to list tracker items:', error);
      return [];
    }
  }

  async getTrackerItemsByType(type: TrackerItemType): Promise<TrackerItem[]> {
    try {
      const result = await database.query<any>(
        `SELECT * FROM tracker_items WHERE workspace = $1 AND type = $2 ORDER BY last_indexed DESC`,
        [this.workspacePath, type]
      );
      return result.rows.map(row => this.rowToTrackerItem(row));
    } catch (error) {
      console.error('[DocumentService] Failed to get tracker items by type:', error);
      return [];
    }
  }

  async getTrackerItemsByModule(module: string): Promise<TrackerItem[]> {
    try {
      const result = await database.query<any>(
        `SELECT * FROM tracker_items WHERE workspace = $1 AND module = $2 ORDER BY line_number ASC`,
        [this.workspacePath, module]
      );
      return result.rows.map(row => this.rowToTrackerItem(row));
    } catch (error) {
      console.error('[DocumentService] Failed to get tracker items by module:', error);
      return [];
    }
  }

  watchTrackerItems(listener: (change: TrackerItemChangeEvent) => void): () => void {
    const id = Date.now().toString();
    this.trackerItemWatchers.set(id, listener);

    // Return unsubscribe function
    return () => {
      this.trackerItemWatchers.delete(id);
    };
  }

  private rowToTrackerItem(row: any): TrackerItem {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      description: row.description || undefined,
      status: row.status,
      priority: row.priority || undefined,
      owner: row.owner || undefined,
      module: row.module,
      lineNumber: row.line_number || undefined,
      workspace: row.workspace,
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      created: row.created || undefined,
      updated: row.updated || undefined,
      dueDate: row.due_date || undefined,
      lastIndexed: new Date(row.last_indexed)
    };
  }

  /**
   * Parse tracker items from markdown content
   */
  private async parseTrackerItems(filePath: string, relativePath: string): Promise<TrackerItem[]> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const items: TrackerItem[] = [];
      const lines = content.split('\n');

      // Regex to match: text @type[id:... status:...]
      const trackerRegex = /(.+?)\s+@(bug|task|plan|idea|decision)\[(.+?)\]/;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(trackerRegex);

        if (match) {
          const [, title, type, propsStr] = match;

          // Parse key:value pairs
          const props: Record<string, string> = {};
          const propRegex = /(\w+):((?:"[^"]*")|(?:[^\s\]]+))/g;
          let propMatch;
          while ((propMatch = propRegex.exec(propsStr)) !== null) {
            const [, key, value] = propMatch;
            props[key] = value.startsWith('"') ? value.slice(1, -1).replace(/\\"/g, '"') : value;
          }

          // Extract description from indented lines below
          let description: string | undefined;
          const descriptionLines: string[] = [];
          let j = i + 1;
          while (j < lines.length) {
            const nextLine = lines[j];
            // Check if line is indented (starts with 2+ spaces or a tab)
            if (nextLine.match(/^(\s{2,}|\t)/)) {
              // Remove leading indentation and add to description
              descriptionLines.push(nextLine.replace(/^(\s{2,}|\t)/, ''));
              j++;
            } else {
              break;
            }
          }
          if (descriptionLines.length > 0) {
            description = descriptionLines.join('\n').trim();
          }

          items.push({
            id: props.id || `${type}_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`,
            type: type as TrackerItemType,
            title: title.trim().replace(/^- /, '').replace(/^\[ \] /, '').replace(/^\[x\] /, ''),
            description,
            status: (props.status || 'to-do') as any,
            priority: props.priority as any,
            owner: props.owner,
            module: relativePath,
            lineNumber: i + 1,
            workspace: this.workspacePath,
            tags: props.tags ? props.tags.split(',') : undefined,
            created: props.created,
            updated: props.updated,
            dueDate: props.due || undefined,
            lastIndexed: new Date()
          });
        }
      }

      return items;
    } catch (error) {
      console.error(`[DocumentService] Failed to parse tracker items from ${relativePath}:`, error);
      return [];
    }
  }

  /**
   * Update tracker items cache for a file
   */
  private async updateTrackerItemsCache(relativePath: string): Promise<void> {
    const fullPath = path.join(this.workspacePath, relativePath);

    try {
      // Parse tracker items from the file
      const items = await this.parseTrackerItems(fullPath, relativePath);

      // Get existing items for this module
      const existingResult = await database.query<any>(
        `SELECT id FROM tracker_items WHERE workspace = $1 AND module = $2`,
        [this.workspacePath, relativePath]
      );
      const existingIds = new Set(existingResult.rows.map(row => row.id));
      const newIds = new Set(items.map(item => item.id));

      // Find items to remove (existed before but not anymore)
      const removedIds = Array.from(existingIds).filter(id => !newIds.has(id));

      // Remove old items
      if (removedIds.length > 0) {
        await database.query(
          `DELETE FROM tracker_items WHERE id = ANY($1)`,
          [removedIds]
        );
      }

      // Upsert new/updated items
      for (const item of items) {
        await database.query(
          `INSERT INTO tracker_items (
            id, type, title, description, status, priority, owner, module, line_number,
            workspace, tags, created, updated, due_date, last_indexed
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          ON CONFLICT (id) DO UPDATE SET
            type = $2, title = $3, description = $4, status = $5, priority = $6, owner = $7,
            module = $8, line_number = $9, tags = $11, updated = $13, due_date = $14, last_indexed = $15`,
          [
            item.id,
            item.type,
            item.title,
            item.description || null,
            item.status,
            item.priority || null,
            item.owner || null,
            item.module,
            item.lineNumber || null,
            item.workspace,
            item.tags ? JSON.stringify(item.tags) : null,
            item.created || null,
            item.updated || null,
            item.dueDate || null,
            item.lastIndexed
          ]
        );
      }

      // Notify watchers if there are changes
      if (items.length > 0 || removedIds.length > 0) {
        const changeEvent: TrackerItemChangeEvent = {
          added: items.filter(item => !existingIds.has(item.id)),
          updated: items.filter(item => existingIds.has(item.id)),
          removed: removedIds,
          timestamp: new Date()
        };

        this.trackerItemWatchers.forEach(callback => callback(changeEvent));
      }
    } catch (error) {
      console.error(`[DocumentService] Failed to update tracker items cache for ${relativePath}:`, error);
    }
  }

  // Asset management methods
  async storeAsset(buffer: Buffer, mimeType: string): Promise<{ hash: string, extension: string }> {
    // Hash the image buffer
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');

    // Determine file extension from MIME type
    const extensionMap: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg'
    };
    const extension = extensionMap[mimeType] || 'png';

    // Ensure .nimbalyst/assets directory exists
    const assetsDir = path.join(this.workspacePath, '.nimbalyst', 'assets');
    await fs.mkdir(assetsDir, { recursive: true });

    // Write file with hash as name
    const filename = `${hash}.${extension}`;
    const assetPath = path.join(assetsDir, filename);

    // Only write if file doesn't already exist (deduplication)
    try {
      await fs.access(assetPath);
      console.log(`[DocumentService] Asset ${hash}.${extension} already exists, skipping write`);
    } catch {
      await fs.writeFile(assetPath, buffer);
      console.log(`[DocumentService] Stored asset ${hash}.${extension} (${buffer.length} bytes)`);
    }

    return { hash, extension };
  }

  async getAssetPath(hash: string): Promise<string | null> {
    const assetsDir = path.join(this.workspacePath, '.nimbalyst', 'assets');

    // Try common extensions
    const extensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];
    for (const ext of extensions) {
      const assetPath = path.join(assetsDir, `${hash}.${ext}`);
      try {
        await fs.access(assetPath);
        return assetPath;
      } catch {
        // File doesn't exist, try next extension
      }
    }

    return null;
  }

  async garbageCollectAssets(): Promise<number> {
    const assetsDir = path.join(this.workspacePath, '.nimbalyst', 'assets');

    try {
      // Check if assets directory exists
      await fs.access(assetsDir);
    } catch {
      // No assets directory, nothing to collect
      return 0;
    }

    // Scan all markdown files for asset references
    const referencedHashes = new Set<string>();
    const assetRegex = /\.nimbalyst\/assets\/([a-f0-9]+)\./g;

    for (const doc of this.documents) {
      const fullPath = path.join(this.workspacePath, doc.path);
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        let match;
        while ((match = assetRegex.exec(content)) !== null) {
          referencedHashes.add(match[1]);
        }
      } catch (error) {
        console.error(`[DocumentService] Failed to scan ${doc.path} for asset refs:`, error);
      }
    }

    // Get all asset files
    const assetFiles = await fs.readdir(assetsDir);
    let deletedCount = 0;

    for (const file of assetFiles) {
      // Extract hash from filename (before the extension)
      const hash = file.split('.')[0];

      if (!referencedHashes.has(hash)) {
        const assetPath = path.join(assetsDir, file);
        await fs.unlink(assetPath);
        console.log(`[DocumentService] Deleted unreferenced asset: ${file}`);
        deletedCount++;
      }
    }

    return deletedCount;
  }

  destroy() {
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = null;
    }
    this.watchers.clear();
    this.metadataWatchers.clear();
    this.trackerItemWatchers.clear();
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

  ipcMain.handle('document-service:refresh-file-metadata', async (event, filePath: string) => {
    try {
      await requireDocumentService(event).refreshFileMetadata(filePath);
      return { success: true };
    } catch (error) {
      console.error('[DocumentService] refresh-file-metadata failed:', error);
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

  // Virtual document handler
  ipcMain.handle('document-service:load-virtual', async (event, virtualPath: string) => {
    try {
      return await requireDocumentService(event).loadVirtualDocument(virtualPath);
    } catch (error) {
      console.error('[DocumentService] load-virtual failed:', error);
      return null;
    }
  });

  // Tracker items handlers
  ipcMain.handle('document-service:tracker-items-list', async (event) => {
    try {
      return await requireDocumentService(event).listTrackerItems();
    } catch (error) {
      console.error('[DocumentService] tracker-items-list failed:', error);
      return [];
    }
  });

  ipcMain.handle('document-service:tracker-items-by-type', async (event, type: TrackerItemType) => {
    try {
      return await requireDocumentService(event).getTrackerItemsByType(type);
    } catch (error) {
      console.error('[DocumentService] tracker-items-by-type failed:', error);
      return [];
    }
  });

  ipcMain.handle('document-service:tracker-items-by-module', async (event, module: string) => {
    try {
      return await requireDocumentService(event).getTrackerItemsByModule(module);
    } catch (error) {
      console.error('[DocumentService] tracker-items-by-module failed:', error);
      return [];
    }
  });

  // Handle tracker item watch subscriptions
  ipcMain.on('document-service:tracker-items-watch', (event) => {
    let unsubscribe: (() => void) | undefined;
    try {
      const service = requireDocumentService(event);
      unsubscribe = service.watchTrackerItems((change: TrackerItemChangeEvent) => {
        event.sender.send('document-service:tracker-items-changed', change);
      });
    } catch (error) {
      console.error('[DocumentService] tracker-items-watch failed to start:', error);
    }

    if (unsubscribe) {
      // Clean up when renderer is destroyed
      event.sender.once('destroyed', unsubscribe);
    }
  });

  // Asset management handlers
  ipcMain.handle('document-service:store-asset', async (event, payload: { buffer: number[]; mimeType: string }) => {
    try {
      const { buffer, mimeType } = payload;
      const bufferObj = Buffer.from(buffer);
      return await requireDocumentService(event).storeAsset(bufferObj, mimeType);
    } catch (error) {
      console.error('[DocumentService] store-asset failed:', error);
      throw error;
    }
  });

  ipcMain.handle('document-service:get-asset-path', async (event, hash: string) => {
    try {
      return await requireDocumentService(event).getAssetPath(hash);
    } catch (error) {
      console.error('[DocumentService] get-asset-path failed:', error);
      return null;
    }
  });

  ipcMain.handle('document-service:gc-assets', async (event) => {
    try {
      return await requireDocumentService(event).garbageCollectAssets();
    } catch (error) {
      console.error('[DocumentService] gc-assets failed:', error);
      return 0;
    }
  });
}
