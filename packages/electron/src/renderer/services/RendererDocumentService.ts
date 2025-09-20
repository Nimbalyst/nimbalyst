import {
  Document,
  DocumentService,
  DocumentOpenOptions,
  DocumentMetadataEntry,
  MetadataChangeEvent
} from '@stravu/runtime';

/**
 * Renderer-side DocumentService that communicates with the main process
 */
export class RendererDocumentService implements DocumentService {
  private changeListeners: Map<string, (documents: Document[]) => void> = new Map();
  private metadataChangeListeners: Map<string, (change: MetadataChangeEvent) => void> = new Map();

  constructor() {
    // Listen for document change events from main process
    window.api.on('document-service:documents-changed', (documents: Document[]) => {
      this.changeListeners.forEach(callback => callback(documents));
    });

    // Listen for metadata change events from main process
    window.api.on('document-service:metadata-changed', (change: MetadataChangeEvent) => {
      this.metadataChangeListeners.forEach(callback => callback(change));
    });
  }

  async listDocuments(): Promise<Document[]> {
    return window.api.invoke('document-service:list');
  }

  async searchDocuments(query: string): Promise<Document[]> {
    return window.api.invoke('document-service:search', query);
  }

  async getDocument(id: string): Promise<Document | null> {
    return window.api.invoke('document-service:get', id);
  }

  async getDocumentByPath(path: string): Promise<Document | null> {
    return window.api.invoke('document-service:get-by-path', path);
  }

  watchDocuments(callback: (documents: Document[]) => void): () => void {
    const id = Date.now().toString();
    this.changeListeners.set(id, callback);

    // Start watching if this is the first listener
    if (this.changeListeners.size === 1) {
      window.api.send('document-service:watch');
    }

    // Return unsubscribe function
    return () => {
      this.changeListeners.delete(id);
    };
  }

  async openDocument(documentId: string, fallback?: DocumentOpenOptions): Promise<void> {
    return window.api.invoke('document-service:open', { documentId, fallback });
  }

  // Metadata API methods
  async getDocumentMetadata(id: string): Promise<DocumentMetadataEntry | null> {
    return window.api.invoke('document-service:metadata-get', id);
  }

  async getDocumentMetadataByPath(path: string): Promise<DocumentMetadataEntry | null> {
    return window.api.invoke('document-service:metadata-get-by-path', path);
  }

  async listDocumentMetadata(): Promise<DocumentMetadataEntry[]> {
    return window.api.invoke('document-service:metadata-list');
  }

  watchDocumentMetadata(listener: (change: MetadataChangeEvent) => void): () => void {
    const id = Date.now().toString();
    this.metadataChangeListeners.set(id, listener);

    // Start watching if this is the first listener
    if (this.metadataChangeListeners.size === 1) {
      window.api.send('document-service:metadata-watch');
    }

    // Return unsubscribe function
    return () => {
      this.metadataChangeListeners.delete(id);
    };
  }

  async notifyFrontmatterChanged(path: string, frontmatter: Record<string, unknown>): Promise<void> {
    const result = await window.api.invoke('document-service:notify-frontmatter-changed', { path, frontmatter });
    if (!result.success) {
      throw new Error(result.error || 'Failed to notify frontmatter change');
    }
  }
}

// Singleton instance
let documentService: RendererDocumentService | null = null;

export function getDocumentService(): DocumentService {
  if (!documentService) {
    documentService = new RendererDocumentService();
  }
  return documentService;
}
