/**
 * Platform-agnostic document service interface for listing and managing documents
 */

export interface Document {
  id: string;
  name: string;
  path: string;
  workspace?: string;
  lastModified?: Date;
  type?: string;
  size?: number;
}

export interface DocumentOpenOptions {
  path?: string;
  name?: string;
}

/**
 * Metadata entry for a document's frontmatter and derived attributes
 */
export interface DocumentMetadataEntry {
  id: string;           // matches Document.id
  path: string;         // relative path within workspace
  workspace?: string;
  frontmatter: Record<string, unknown>;
  summary?: string;     // AI generated summary (if present in frontmatter)
  tags?: string[];      // convenience extraction for common fields
  lastModified: Date;   // from filesystem mtime
  lastIndexed: Date;    // when cache parsed frontmatter
  hash?: string;        // frontmatter sha hash
  parseErrors?: string[]; // warnings captured during parsing
}

/**
 * Event emitted when metadata changes
 */
export interface MetadataChangeEvent {
  added: DocumentMetadataEntry[];
  updated: DocumentMetadataEntry[];
  removed: string[];    // Just IDs for removed entries
  timestamp: Date;
}

/**
 * Tracker item types
 */
export type TrackerItemType = 'bug' | 'task' | 'plan' | 'idea' | 'decision';
export type TrackerItemStatus = 'to-do' | 'in-progress' | 'in-review' | 'done' | 'blocked' | 'proposed' | 'in-discussion' | 'decided' | 'implemented' | 'rejected' | 'superseded';
export type TrackerItemPriority = 'low' | 'medium' | 'high' | 'critical';

/**
 * Tracker item entry in the database cache
 */
export interface TrackerItem {
  id: string;
  type: TrackerItemType;
  title: string;
  description?: string;   // Optional description from indented content
  status: TrackerItemStatus;
  priority?: TrackerItemPriority;
  owner?: string;
  module: string;         // file path where item is defined
  lineNumber?: number;
  workspace: string;
  tags?: string[];
  created?: string;
  updated?: string;
  dueDate?: string;
  lastIndexed: Date;
}

/**
 * Event emitted when tracker items change
 */
export interface TrackerItemChangeEvent {
  added: TrackerItem[];
  updated: TrackerItem[];
  removed: string[];    // Just IDs for removed entries
  timestamp: Date;
}

export interface DocumentService {
  /**
   * List all documents in the current workspace
   */
  listDocuments(): Promise<Document[]>;

  /**
   * Search documents by query string
   */
  searchDocuments(query: string): Promise<Document[]>;

  /**
   * Get a specific document by ID
   */
  getDocument(id: string): Promise<Document | null>;

  /**
   * Get a document by path
   */
  getDocumentByPath(path: string): Promise<Document | null>;

  /**
   * Watch for document changes
   */
  watchDocuments(callback: (documents: Document[]) => void): () => void;

  /**
   * Open a document (platform-specific implementation)
   */
  openDocument(documentId: string, fallback?: DocumentOpenOptions): Promise<void>;

  /**
   * Get metadata for a specific document by ID
   */
  getDocumentMetadata?(id: string): Promise<DocumentMetadataEntry | null>;

  /**
   * Get metadata for a specific document by path
   */
  getDocumentMetadataByPath?(path: string): Promise<DocumentMetadataEntry | null>;

  /**
   * List metadata for all documents
   */
  listDocumentMetadata?(): Promise<DocumentMetadataEntry[]>;

  /**
   * Watch for metadata changes
   */
  watchDocumentMetadata?(
    listener: (change: MetadataChangeEvent) => void
  ): () => void;

  /**
   * Notify that a document's frontmatter has changed (e.g., from AI summary generation)
   */
  notifyFrontmatterChanged?(path: string, frontmatter: Record<string, unknown>): void;

  /**
   * List all tracker items in the workspace
   */
  listTrackerItems?(): Promise<TrackerItem[]>;

  /**
   * Get tracker items by type
   */
  getTrackerItemsByType?(type: TrackerItemType): Promise<TrackerItem[]>;

  /**
   * Get tracker items by module (file path)
   */
  getTrackerItemsByModule?(module: string): Promise<TrackerItem[]>;

  /**
   * Watch for tracker item changes
   */
  watchTrackerItems?(
    listener: (change: TrackerItemChangeEvent) => void
  ): () => void;
}

/**
 * Factory interface for creating platform-specific document service instances
 */
export interface DocumentServiceFactory {
  createDocumentService(): DocumentService;
}
