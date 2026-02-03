import { BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent, app } from 'electron';
import { safeHandle, safeOn } from '../utils/ipcRegistry';
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
import { isPathInWorkspace, getRelativeWorkspacePath } from '../utils/workspaceDetection';

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

  // Performance limits - balance between completeness and performance
  private static readonly MAX_FILES_TO_SCAN = 2000;   // Stop adding regular files after 2000
  private static readonly MAX_SCAN_TIME_MS = 10000;   // Stop scanning after 10 seconds (increased to allow full scan)
  private static readonly MAX_DEPTH = 8;              // Maximum directory depth

  private isScanning = false; // Prevent concurrent scans

  /**
   * Quick check if a markdown file contains tracker-relevant frontmatter
   * This reads only the first ~4KB of the file for performance
   */
  private hasTrackerFrontmatter(fullPath: string): boolean {
    try {
      // Read only the first 4KB - frontmatter should be at the top
      const fd = fsSync.openSync(fullPath, 'r');
      const buffer = Buffer.alloc(4096);
      const bytesRead = fsSync.readSync(fd, buffer, 0, 4096, 0);
      fsSync.closeSync(fd);

      const content = buffer.toString('utf-8', 0, bytesRead);

      // Check for YAML frontmatter with plan/bug/tracker content
      // Look for patterns like planStatus:, or inline tracker items like #bug[, #task[, etc.
      const hasPlanStatus = /^---[\s\S]*?planStatus:/m.test(content);
      const hasInlineTracker = /#(bug|task|plan|idea|decision)\[/.test(content);

      return hasPlanStatus || hasInlineTracker;
    } catch {
      return false;
    }
  }

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;

    console.log(`[DocumentService] Constructor called for workspace: ${workspacePath}`);
    console.log(`[DocumentService] SKIPPING initial scan - scan will happen on-demand only`);

    // DON'T scan on startup - it freezes the app for large projects
    // Scanning will happen lazily when documents are actually requested
    this.initializationPromise = Promise.resolve();

    // Disable automatic background scanning - only scan on-demand
    // Background scanning was causing performance issues with large projects
    // Documents will be scanned when listDocuments() is called (e.g., when @ mention is triggered)
  }

  private async initializeAsync(): Promise<void> {
    try {
      // Perform initial document scan and metadata extraction
      await this.refreshDocuments();
      // console.log(`[DocumentService] Initial metadata cache loaded: ${this.metadataCache.size} documents`);
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

  // Public method to trigger a full refresh (for tracker panel initialization, etc.)
  async refreshWorkspaceData() {
    await this.refreshDocuments();
  }

  private async refreshDocuments() {
    // Prevent concurrent scans
    if (this.isScanning) {
      return;
    }

    this.isScanning = true;
    try {
      const oldDocuments = this.documents;
      this.documents = await this.scanDocuments();

      // console.log(`[DocumentService] refreshDocuments: found ${this.documents.length} documents`);
      // if (this.documents.length > 0) {
      //   console.log(`[DocumentService] Sample documents:`, this.documents.slice(0, 3).map(d => d.path));
      // }

      // Update metadata cache
      await this.updateMetadataCache(oldDocuments, this.documents);

      // Only notify watchers if the document list actually changed
      if (this.hasDocumentListChanged(oldDocuments, this.documents)) {
        this.watchers.forEach(callback => callback(this.documents));
      }
    } finally {
      this.isScanning = false;
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
        // Skip directories - they don't have frontmatter
        if (newDoc.type === 'directory') {
          continue;
        }

        // TODO: Debug logging - uncomment if needed for troubleshooting
        // console.log(`[DocumentService] File needs update: ${newDoc.path} (oldDoc=${!!oldDoc}, cachedState=${!!cachedState}, mtimeChanged=${cachedState?.mtime !== stats.mtime})`);
        try {
          // Extract frontmatter
          // TODO: Debug logging - uncomment if needed for troubleshooting
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
          // This only runs for files that actually changed, not all files
          await this.updateTrackerItemsCache(newDoc.path);
        } catch (error) {
          console.error(`[DocumentService] Failed to extract metadata for ${newDoc.path}:`, error);
        }
      } else {
        // console.log(`[DocumentService] Skipping file (no update needed): ${newDoc.path}`);
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

  private scanDirectory(
    dirPath: string,
    basePath: string = '',
    depth: number = 0,
    scanState: { count: number; trackerCount: number; startTime: number; stopped: boolean } = { count: 0, trackerCount: 0, startTime: Date.now(), stopped: false }
  ): Document[] {
    const documents: Document[] = [];

    // Check time limit BEFORE scanning this directory
    if (scanState.stopped) {
      return documents;
    }

    const elapsed = Date.now() - scanState.startTime;
    if (elapsed > ElectronDocumentService.MAX_SCAN_TIME_MS) {
      scanState.stopped = true;
      return documents;
    }

    if (depth > ElectronDocumentService.MAX_DEPTH) {
      // console.warn(`[DocumentService] Stopped scanning at depth ${depth} (limit: ${ElectronDocumentService.MAX_DEPTH})`);
      return documents;
    }

    // Support all common text-based file types for @ mentions
    const supportedExtensions = [
      // Markdown
      '.md', '.markdown',
      // Web
      '.html', '.htm', '.css', '.scss', '.sass', '.less',
      // JavaScript/TypeScript
      '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
      // Other programming languages
      '.py', '.rb', '.php', '.java', '.c', '.cpp', '.cc', '.h', '.hpp',
      '.cs', '.go', '.rs', '.swift', '.kt', '.scala', '.r',
      // Scripting and config
      '.sh', '.bash', '.zsh', '.fish', '.ps1',
      '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
      '.xml', '.graphql', '.proto',
      // Documentation
      '.txt', '.rst', '.adoc', '.tex',
      // SQL
      '.sql',
      // Other
      '.vue', '.svelte', '.astro'
    ];

    // Markdown extensions for tracker content check
    const markdownExtensions = ['.md', '.markdown'];

    try {
      const items = fsSync.readdirSync(dirPath);

      for (const item of items) {
        // Check time limit on EVERY iteration to bail out quickly
        if (Date.now() - scanState.startTime > ElectronDocumentService.MAX_SCAN_TIME_MS) {
          scanState.stopped = true;
          break;
        }

        if (scanState.stopped) {
          break;
        }

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

        try {
          const stats = fsSync.statSync(fullPath);

          if (stats.isDirectory()) {
            // Add directory as a mentionable document for @ mentions
            const dirId = crypto.createHash('md5').update(relativePath + '/').digest('hex');
            documents.push({
              id: dirId,
              name: item,
              path: relativePath,
              workspace: undefined,
              lastModified: stats.mtime,
              type: 'directory'
            });
            // Recursively scan subdirectories with incremented depth
            documents.push(...this.scanDirectory(fullPath, relativePath, depth + 1, scanState));
          } else if (stats.isFile()) {
            const ext = path.extname(item).toLowerCase();
            if (supportedExtensions.includes(ext)) {
              const isMarkdown = markdownExtensions.includes(ext);
              const underLimit = scanState.count < ElectronDocumentService.MAX_FILES_TO_SCAN;

              // Determine if we should add this file:
              // - Always add if under the limit
              // - For markdown files above the limit, check if they have tracker frontmatter
              let shouldAdd = underLimit;
              if (!underLimit && isMarkdown) {
                shouldAdd = this.hasTrackerFrontmatter(fullPath);
                if (shouldAdd) {
                  scanState.trackerCount++;
                }
              }

              if (shouldAdd) {
                scanState.count++;

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
          // Skip files/dirs we can't stat (permissions, broken symlinks, etc.)
        }
      }
    } catch (error) {
      // Silent - directory scanning errors are not critical
    }

    return documents;
  }

  private async scanDocuments(): Promise<Document[]> {
    try {
      // Use synchronous file system operations like the file tree
      const scanState = { count: 0, trackerCount: 0, startTime: Date.now(), stopped: false };
      const docs = this.scanDirectory(this.workspacePath, '', 0, scanState);

      // Log info about scan results
      const elapsed = Date.now() - scanState.startTime;
      if (scanState.stopped) {
        console.warn(
          `[DocumentService] Scan stopped early: scanned ${scanState.count} files in ${elapsed}ms. ` +
          `Time limit: ${ElectronDocumentService.MAX_SCAN_TIME_MS}ms, depth limit: ${ElectronDocumentService.MAX_DEPTH}. ` +
          `Some files may not appear in @ mentions.`
        );
      } else if (scanState.trackerCount > 0) {
        console.log(
          `[DocumentService] Scan complete: ${scanState.count} files in ${elapsed}ms ` +
          `(${scanState.trackerCount} tracker files found beyond ${ElectronDocumentService.MAX_FILES_TO_SCAN} file limit)`
        );
      }

      return docs;
    } catch (err) {
      // Silent - document scanning errors are not critical
      console.error('[DocumentService] Scan error:', err);
      return [];
    }
  }

  private lastScanTime = 0;
  private readonly SCAN_CACHE_MS = 30000; // Only rescan every 30 seconds max

  async listDocuments(): Promise<Document[]> {
    const now = Date.now();
    const timeSinceLastScan = now - this.lastScanTime;

    // Only scan if we have no documents OR it's been > 30 seconds since last scan
    if (this.documents.length === 0 || timeSinceLastScan > this.SCAN_CACHE_MS) {
      // Debug logging - comment out for production
      // console.log('[DocumentService] Scanning workspace (cache expired or empty)...');
      this.documents = await this.scanDocuments();
      this.lastScanTime = now;
      // console.log(`[DocumentService] Scan complete: found ${this.documents.length} documents`);
    } else {
      // Debug logging - comment out for production
      // console.log(`[DocumentService] Using cached documents: ${this.documents.length} (scanned ${Math.round(timeSinceLastScan/1000)}s ago)`);
    }
    return this.documents;
  }

  async searchDocuments(query: string): Promise<Document[]> {
    const documents = await this.listDocuments();
    const lowerQuery = query.toLowerCase();

    // Debug logging - comment out for production
    // console.log(`[DocumentService] searchDocuments: query="${query}", total docs=${documents.length}`);

    const results = documents.filter(doc =>
      doc.name.toLowerCase().includes(lowerQuery) ||
      doc.path.toLowerCase().includes(lowerQuery) ||
      (doc.workspace && doc.workspace.toLowerCase().includes(lowerQuery))
    );

    // Debug logging - comment out for production
    // console.log(`[DocumentService] searchDocuments: found ${results.length} matching documents`);
    return results;
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
    // Use proper path boundary checking to avoid matching snake_worktrees when workspace is snake
    const relativeFromWorkspace = getRelativeWorkspacePath(filePath, this.workspacePath);
    const relativePath = relativeFromWorkspace !== null ? relativeFromWorkspace : filePath;

    // Only process markdown files
    if (!relativePath.endsWith('.md')) {
      return;
    }

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

        // Find the document entry, or create one if it doesn't exist
        // (this can happen for files beyond the scan limit or newly created files)
        let doc = this.documents.find(d => d.path === relativePath);
        if (!doc) {
          // Create a document entry for this file
          const fileName = path.basename(relativePath);
          const ext = path.extname(fileName).toLowerCase();
          const id = crypto.createHash('md5').update(relativePath).digest('hex');

          const dirname = path.dirname(relativePath);
          doc = {
            id,
            name: fileName,
            path: relativePath,
            workspace: dirname && dirname !== '.' ? dirname : undefined,
            lastModified: stats.mtime,
            type: ext.slice(1)
          };

          // Add to documents list so future lookups work
          this.documents.push(doc);
          console.log(`[DocumentService] Added document entry for agent-edited file: ${relativePath}`);
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

      // Also update tracker items for markdown files
      // This ensures inline tracker items (#bug, #task, etc.) are kept in sync
      await this.updateTrackerItemsCache(relativePath);
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
        // In development, use app.getAppPath() to get the package root reliably
        // (can't use __dirname because bundled chunks may be in nested directories)
        assetPath = path.join(app.getAppPath(), virtualDoc.assetPath);
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
      // console.log(`[DocumentService] listTrackerItems called for workspace: ${this.workspacePath}`);
      const result = await database.query<any>(
        `SELECT * FROM tracker_items WHERE workspace = $1 ORDER BY last_indexed DESC`,
        [this.workspacePath]
      );
      // console.log(`[DocumentService] Query returned ${result.rows.length} tracker items`);
      const items = result.rows.map(row => this.rowToTrackerItem(row));
      // console.log(`[DocumentService] Returning ${items.length} tracker items`);
      return items;
    } catch (error) {
      console.error('[DocumentService] Failed to list tracker items:', error);
      return [];
    }
  }

  async getTrackerItemsByType(type: TrackerItemType): Promise<TrackerItem[]> {
    try {
      // console.log(`[DocumentService] getTrackerItemsByType(${type}) for workspace: ${this.workspacePath}`);
      const result = await database.query<any>(
        `SELECT * FROM tracker_items WHERE workspace = $1 AND type = $2 ORDER BY last_indexed DESC`,
        [this.workspacePath, type]
      );
      // console.log(`[DocumentService] Query returned ${result.rows.length} items for type ${type}`);
      return result.rows.map(row => this.rowToTrackerItem(row));
    } catch (error) {
      console.error('[DocumentService] Failed to get tracker items by type:', error);
      return [];
    }
  }

  async getTrackerItemsByModule(module: string): Promise<TrackerItem[]> {
    try {
      const result = await database.query<any>(
        `SELECT * FROM tracker_items WHERE workspace = $1 AND document_path = $2 ORDER BY line_number ASC`,
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
    // Parse JSONB data field
    const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;

    return {
      id: row.id,
      type: row.type,
      title: data.title || row.title, // Fallback to generated column
      description: data.description || undefined,
      status: data.status || row.status, // Fallback to generated column
      priority: data.priority || undefined,
      owner: data.owner || undefined,
      module: row.document_path, // Use new column name
      lineNumber: row.line_number || undefined,
      workspace: row.workspace,
      tags: data.tags || undefined,
      created: data.created || row.created || undefined,
      updated: data.updated || row.updated || undefined,
      dueDate: data.dueDate || undefined,
      lastIndexed: new Date(row.last_indexed)
    };
  }

  /**
   * Parse tracker items from markdown content
   * Note: This function is only called for .md and .markdown files
   */
  private async parseTrackerItems(filePath: string, relativePath: string): Promise<TrackerItem[]> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const items: TrackerItem[] = [];
      const lines = content.split('\n');

      // Regex to match: text #type[id:... status:...]
      const trackerRegex = /(.+?)\s+#(bug|task|plan|idea|decision)\[(.+?)\]/;

      // Track whether we're inside a code block
      let inCodeBlock = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Check for code block fences (``` or ~~~)
        if (line.trim().startsWith('```') || line.trim().startsWith('~~~')) {
          inCodeBlock = !inCodeBlock;
          continue;
        }

        // Skip lines inside code blocks
        if (inCodeBlock) {
          continue;
        }

        // Skip lines that are indented code blocks (4+ spaces or tab at start)
        if (line.match(/^(\s{4,}|\t)/)) {
          continue;
        }

        const match = line.match(trackerRegex);

        if (match) {
          // Additional check: ensure the match is not inside inline code (backticks)
          // This prevents matching `#bug[...]` within inline code blocks
          const matchIndex = line.indexOf(match[0]);
          const beforeMatch = line.substring(0, matchIndex);
          const backtickCount = (beforeMatch.match(/`/g) || []).length;

          // If odd number of backticks before the match, we're inside inline code
          if (backtickCount % 2 !== 0) {
            continue;
          }
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

      // console.log(`[DocumentService] Parsed ${items.length} tracker items from ${relativePath}`);
      return items;
    } catch (error) {
      console.error(`[DocumentService] Failed to parse tracker items from ${relativePath}:`, error);
      return [];
    }
  }

  /**
   * Update tracker items cache for a file
   * Only processes markdown files - tracker items are not parsed from code files
   */
  private async updateTrackerItemsCache(relativePath: string): Promise<void> {
    // Only parse tracker items from markdown files
    const ext = path.extname(relativePath).toLowerCase();
    if (ext !== '.md' && ext !== '.markdown') {
      return;
    }

    const fullPath = path.join(this.workspacePath, relativePath);

    // TODO: Debug logging - uncomment if needed for troubleshooting
    // console.log(`[DocumentService] updateTrackerItemsCache called for: ${relativePath}`);
    // console.log(`[DocumentService] Full path: ${fullPath}`);

    try {
      // Parse tracker items from the file
      const items = await this.parseTrackerItems(fullPath, relativePath);
      // TODO: Debug logging - uncomment if needed for troubleshooting
      // console.log(`[DocumentService] Found ${items.length} tracker items in ${relativePath}`);
      // if (items.length > 0) {
      //   console.log(`[DocumentService] Sample tracker item:`, items[0]);
      // }

      // Get existing items for this module
      // console.log(`[DocumentService] Querying database for existing tracker items...`);
      const existingResult = await database.query<any>(
        `SELECT id FROM tracker_items WHERE workspace = $1 AND document_path = $2`,
        [this.workspacePath, relativePath]
      );
      // console.log(`[DocumentService] Found ${existingResult.rows.length} existing tracker items in database`);
      const existingIds = new Set(existingResult.rows.map(row => row.id));
      const newIds = new Set(items.map(item => item.id));

      // Find items to remove (existed before but not anymore)
      const removedIds = Array.from(existingIds).filter(id => !newIds.has(id));

      // Remove old items
      if (removedIds.length > 0) {
        // console.log(`[DocumentService] Removing ${removedIds.length} tracker items from database`);
        await database.query(
          `DELETE FROM tracker_items WHERE id = ANY($1)`,
          [removedIds]
        );
      }

      // Upsert new/updated items
      // console.log(`[DocumentService] Upserting ${items.length} tracker items to database`);
      for (const item of items) {
        // Build JSONB data object
        const data = {
          title: item.title,
          description: item.description,
          status: item.status,
          priority: item.priority,
          owner: item.owner,
          tags: item.tags || [],
          dueDate: item.dueDate,
          created: item.created,
          updated: item.updated
        };

        // console.log(`[DocumentService] Inserting tracker item: ${item.id} (${item.type})`);
        const result = await database.query(
          `INSERT INTO tracker_items (
            id, type, data, workspace, document_path, line_number, created, updated, last_indexed
          ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), $7)
          ON CONFLICT (id) DO UPDATE SET
            type = $2, data = $3, workspace = $4, document_path = $5, line_number = $6, updated = NOW(), last_indexed = $7`,
          [
            item.id,
            item.type,
            JSON.stringify(data),
            item.workspace,
            item.module, // document_path
            item.lineNumber || null,
            item.lastIndexed
          ]
        );
        // console.log(`[DocumentService] Insert result:`, result);
      }

      // Notify watchers if there are changes
      if (items.length > 0 || removedIds.length > 0) {
        const changeEvent: TrackerItemChangeEvent = {
          added: items.filter(item => !existingIds.has(item.id)),
          updated: items.filter(item => existingIds.has(item.id)),
          removed: removedIds,
          timestamp: new Date()
        };

        // console.log(`[DocumentService] Notifying ${this.trackerItemWatchers.size} watchers of tracker item changes`);
        this.trackerItemWatchers.forEach(callback => callback(changeEvent));
      }

      // console.log(`[DocumentService] updateTrackerItemsCache completed successfully for ${relativePath}`);
    } catch (error) {
      console.error(`[DocumentService] Failed to update tracker items cache for ${relativePath}:`, error);
    }
  }

  // Asset management methods
  async storeAsset(buffer: Buffer, mimeType: string, documentPath?: string): Promise<{ hash: string, extension: string, relativePath: string }> {
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
    const filename = `${hash}.${extension}`;

    // Determine asset storage location based on document path
    let assetsDir: string;
    let relativePath: string;

    if (documentPath) {
      // Store in assets/ folder adjacent to the document
      const documentDir = path.dirname(documentPath);
      assetsDir = path.join(documentDir, 'assets');
      relativePath = `assets/${filename}`;
    } else {
      // Fallback to workspace-level storage (for backward compatibility)
      assetsDir = path.join(this.workspacePath, '.nimbalyst', 'assets');
      relativePath = `.nimbalyst/assets/${filename}`;
    }

    // Ensure assets directory exists
    await fs.mkdir(assetsDir, { recursive: true });

    // Write file with hash as name
    const assetPath = path.join(assetsDir, filename);

    // Only write if file doesn't already exist (deduplication)
    try {
      await fs.access(assetPath);
      console.log(`[DocumentService] Asset ${filename} already exists at ${assetsDir}, skipping write`);
    } catch {
      await fs.writeFile(assetPath, buffer);
      console.log(`[DocumentService] Stored asset ${filename} at ${assetsDir} (${buffer.length} bytes)`);
    }

    return { hash, extension, relativePath };
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

  safeHandle('document-service:list', async (event) => {
    try {
      // Debug logging - comment out for production
      // console.log('[DocumentService IPC] list handler called');
      const docs = await requireDocumentService(event).listDocuments();
      // console.log('[DocumentService IPC] list returning', docs.length, 'documents');
      return docs;
    } catch (error) {
      console.error('[DocumentService] list failed:', error);
      return [];
    }
  });

  safeHandle('document-service:search', async (event, query: string) => {
    try {
      // Debug logging - comment out for production
      // console.log('[DocumentService IPC] search handler called with query:', query);
      const results = await requireDocumentService(event).searchDocuments(query);
      // console.log('[DocumentService IPC] search returning', results.length, 'results');
      return results;
    } catch (error) {
      console.error('[DocumentService] search failed:', error);
      return [];
    }
  });

  safeHandle('document-service:get', async (event, id: string) => {
    try {
      return await requireDocumentService(event).getDocument(id);
    } catch (error) {
      console.error('[DocumentService] get failed:', error);
      return null;
    }
  });

  safeHandle('document-service:get-by-path', async (event, path: string) => {
    try {
      return await requireDocumentService(event).getDocumentByPath(path);
    } catch (error) {
      console.error('[DocumentService] getByPath failed:', error);
      return null;
    }
  });

  safeHandle('document-service:open', async (event, payload: { documentId: string; fallback?: DocumentOpenOptions }) => {
    try {
      const { documentId, fallback } = payload ?? { documentId: '' };
      return await requireDocumentService(event).openDocument(documentId, fallback);
    } catch (error) {
      console.error('[DocumentService] open failed:', error);
      throw error;
    }
  });

  // Handle watch subscriptions
  safeOn('document-service:watch', (event) => {
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
  safeHandle('document-service:metadata-get', async (event, id: string) => {
    try {
      return await requireDocumentService(event).getDocumentMetadata(id);
    } catch (error) {
      console.error('[DocumentService] metadata-get failed:', error);
      return null;
    }
  });

  safeHandle('document-service:metadata-get-by-path', async (event, path: string) => {
    try {
      return await requireDocumentService(event).getDocumentMetadataByPath(path);
    } catch (error) {
      console.error('[DocumentService] metadata-get-by-path failed:', error);
      return null;
    }
  });

  safeHandle('document-service:metadata-list', async (event) => {
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

  safeHandle('document-service:notify-frontmatter-changed', async (event, payload: { path: string; frontmatter: Record<string, unknown> }) => {
    try {
      const { path, frontmatter } = payload;
      requireDocumentService(event).notifyFrontmatterChanged(path, frontmatter);
      return { success: true };
    } catch (error) {
      console.error('[DocumentService] notify-frontmatter-changed failed:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  safeHandle('document-service:refresh-file-metadata', async (event, filePath: string) => {
    try {
      await requireDocumentService(event).refreshFileMetadata(filePath);
      return { success: true };
    } catch (error) {
      console.error('[DocumentService] refresh-file-metadata failed:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Handle metadata watch subscriptions
  safeOn('document-service:metadata-watch', (event) => {
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

  // Refresh workspace data (scan documents and update tracker/metadata caches)
  safeHandle('document-service:refresh-workspace', async (event) => {
    try {
      await requireDocumentService(event).refreshWorkspaceData();
      return { success: true };
    } catch (error) {
      console.error('[DocumentService] refresh-workspace failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // Virtual document handler
  safeHandle('document-service:load-virtual', async (event, virtualPath: string) => {
    try {
      return await requireDocumentService(event).loadVirtualDocument(virtualPath);
    } catch (error) {
      console.error('[DocumentService] load-virtual failed:', error);
      return null;
    }
  });

  // Tracker items handlers
  safeHandle('document-service:tracker-items-list', async (event) => {
    try {
      return await requireDocumentService(event).listTrackerItems();
    } catch (error) {
      console.error('[DocumentService] tracker-items-list failed:', error);
      return [];
    }
  });

  safeHandle('document-service:tracker-items-by-type', async (event, type: TrackerItemType) => {
    try {
      return await requireDocumentService(event).getTrackerItemsByType(type);
    } catch (error) {
      console.error('[DocumentService] tracker-items-by-type failed:', error);
      return [];
    }
  });

  safeHandle('document-service:tracker-items-by-module', async (event, module: string) => {
    try {
      return await requireDocumentService(event).getTrackerItemsByModule(module);
    } catch (error) {
      console.error('[DocumentService] tracker-items-by-module failed:', error);
      return [];
    }
  });

  // Handle tracker item watch subscriptions
  safeOn('document-service:tracker-items-watch', (event) => {
    // console.log('[DocumentService IPC] tracker-items-watch subscription requested');
    let unsubscribe: (() => void) | undefined;
    try {
      const service = requireDocumentService(event);
      unsubscribe = service.watchTrackerItems((change: TrackerItemChangeEvent) => {
        // console.log('[DocumentService IPC] Sending tracker-items-changed event to renderer:', {
        //   added: change.added?.length || 0,
        //   updated: change.updated?.length || 0,
        //   removed: change.removed?.length || 0
        // });
        event.sender.send('document-service:tracker-items-changed', change);
      });
      // console.log('[DocumentService IPC] tracker-items-watch subscription successful');
    } catch (error) {
      console.error('[DocumentService] tracker-items-watch failed to start:', error);
    }

    if (unsubscribe) {
      // Clean up when renderer is destroyed
      event.sender.once('destroyed', unsubscribe);
    }
  });

  // Asset management handlers
  safeHandle('document-service:store-asset', async (event, payload: { buffer: number[]; mimeType: string; documentPath?: string }) => {
    try {
      const { buffer, mimeType, documentPath } = payload;
      const bufferObj = Buffer.from(buffer);
      return await requireDocumentService(event).storeAsset(bufferObj, mimeType, documentPath);
    } catch (error) {
      console.error('[DocumentService] store-asset failed:', error);
      throw error;
    }
  });

  safeHandle('document-service:get-asset-path', async (event, hash: string) => {
    try {
      return await requireDocumentService(event).getAssetPath(hash);
    } catch (error) {
      console.error('[DocumentService] get-asset-path failed:', error);
      return null;
    }
  });

  safeHandle('document-service:gc-assets', async (event) => {
    try {
      return await requireDocumentService(event).garbageCollectAssets();
    } catch (error) {
      console.error('[DocumentService] gc-assets failed:', error);
      return 0;
    }
  });
}
