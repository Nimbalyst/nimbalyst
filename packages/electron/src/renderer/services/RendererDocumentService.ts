import { Document, DocumentService, DocumentOpenOptions } from '@stravu/runtime';

/**
 * Renderer-side DocumentService that communicates with the main process
 */
export class RendererDocumentService implements DocumentService {
  private changeListeners: Map<string, (documents: Document[]) => void> = new Map();

  constructor() {
    // Listen for document change events from main process
    window.api.on('document-service:documents-changed', (documents: Document[]) => {
      this.changeListeners.forEach(callback => callback(documents));
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
}

// Singleton instance
let documentService: RendererDocumentService | null = null;

export function getDocumentService(): DocumentService {
  if (!documentService) {
    documentService = new RendererDocumentService();
  }
  return documentService;
}
