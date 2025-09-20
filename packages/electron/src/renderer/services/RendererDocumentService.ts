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
    // Only set up listeners if window.electronAPI is available
    if (typeof window !== 'undefined' && window.electronAPI) {
      // Listen for document change events from main process
      window.electronAPI.on('document-service:documents-changed', (documents: Document[]) => {
        this.changeListeners.forEach(callback => callback(documents));
      });

      // Listen for metadata change events from main process
      window.electronAPI.on('document-service:metadata-changed', (change: MetadataChangeEvent) => {
        this.metadataChangeListeners.forEach(callback => callback(change));
      });
    }
  }

  async listDocuments(): Promise<Document[]> {
    if (!window.electronAPI) return [];
    return window.electronAPI.invoke('document-service:list');
  }

  async searchDocuments(query: string): Promise<Document[]> {
    if (!window.electronAPI) return [];
    return window.electronAPI.invoke('document-service:search', query);
  }

  async getDocument(id: string): Promise<Document | null> {
    if (!window.electronAPI) return null;
    return window.electronAPI.invoke('document-service:get', id);
  }

  async getDocumentByPath(path: string): Promise<Document | null> {
    if (!window.electronAPI) return null;
    return window.electronAPI.invoke('document-service:get-by-path', path);
  }

  watchDocuments(callback: (documents: Document[]) => void): () => void {
    const id = Date.now().toString();
    this.changeListeners.set(id, callback);

    // Start watching if this is the first listener
    if (this.changeListeners.size === 1 && window.electronAPI) {
      window.electronAPI.send('document-service:watch');
    }

    // Return unsubscribe function
    return () => {
      this.changeListeners.delete(id);
    };
  }

  async openDocument(documentId: string, fallback?: DocumentOpenOptions): Promise<void> {
    if (!window.electronAPI) return;
    return window.electronAPI.invoke('document-service:open', { documentId, fallback });
  }

  // Metadata API methods
  async getDocumentMetadata(id: string): Promise<DocumentMetadataEntry | null> {
    if (!window.electronAPI) return null;
    return window.electronAPI.invoke('document-service:metadata-get', id);
  }

  async getDocumentMetadataByPath(path: string): Promise<DocumentMetadataEntry | null> {
    if (!window.electronAPI) return null;
    return window.electronAPI.invoke('document-service:metadata-get-by-path', path);
  }

  async listDocumentMetadata(): Promise<DocumentMetadataEntry[]> {
    if (!window.electronAPI) return [];
    return window.electronAPI.invoke('document-service:metadata-list');
  }

  watchDocumentMetadata(listener: (change: MetadataChangeEvent) => void): () => void {
    const id = Date.now().toString();
    this.metadataChangeListeners.set(id, listener);

    // Start watching if this is the first listener
    if (this.metadataChangeListeners.size === 1 && window.electronAPI) {
      window.electronAPI.send('document-service:metadata-watch');
    }

    // Return unsubscribe function
    return () => {
      this.metadataChangeListeners.delete(id);
    };
  }

  async notifyFrontmatterChanged(path: string, frontmatter: Record<string, unknown>): Promise<void> {
    if (!window.electronAPI) return;
    const result = await window.electronAPI.invoke('document-service:notify-frontmatter-changed', { path, frontmatter });
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
