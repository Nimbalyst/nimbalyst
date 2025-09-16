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

export interface DocumentService {
  /**
   * List all documents in the current project
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
  openDocument(documentId: string): Promise<void>;
}

/**
 * Factory interface for creating platform-specific document service instances
 */
export interface DocumentServiceFactory {
  createDocumentService(): DocumentService;
}