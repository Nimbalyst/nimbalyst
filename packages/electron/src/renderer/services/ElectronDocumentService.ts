import { Document, DocumentService, DocumentOpenOptions } from '@nimbalyst/runtime';

// Access the electronAPI exposed by the preload script
declare global {
  interface Window {
    electronAPI: {
      documentService: {
        list: () => Promise<Document[]>;
        search: (query: string) => Promise<Document[]>;
        get: (id: string) => Promise<Document | null>;
        open: (id: string, fallback?: DocumentOpenOptions) => Promise<void>;
        watch: () => void;
        onDocumentsChanged: (callback: (documents: Document[]) => void) => () => void;
        loadVirtual: (virtualPath: string) => Promise<string | null>;
      };
    };
  }
}

/**
 * Electron renderer-side implementation of DocumentService
 * This connects to the main process document service via IPC
 */
export class ElectronRendererDocumentService implements DocumentService {
  async listDocuments(): Promise<Document[]> {
    return window.electronAPI.documentService.list();
  }

  async searchDocuments(query: string): Promise<Document[]> {
    return window.electronAPI.documentService.search(query);
  }

  async getDocument(id: string): Promise<Document | null> {
    return window.electronAPI.documentService.get(id);
  }

  async getDocumentByPath(path: string): Promise<Document | null> {
    // For virtual documents, we need to create a synthetic document
    if (path.startsWith('virtual://')) {
      return {
        id: path,
        name: path.split('://')[1],
        path: path
      };
    }
    return null;
  }

  async openDocument(documentId: string, fallback?: DocumentOpenOptions): Promise<void> {
    return window.electronAPI.documentService.open(documentId, fallback);
  }

  watchDocuments(callback: (documents: Document[]) => void): () => void {
    // Start watching
    window.electronAPI.documentService.watch();

    // Set up the listener
    const unsubscribe = window.electronAPI.documentService.onDocumentsChanged(callback);

    // Return unsubscribe function
    return unsubscribe;
  }

  /**
   * Load a virtual document's content
   */
  async loadVirtualDocument(virtualPath: string): Promise<string | null> {
    return window.electronAPI.documentService.loadVirtual(virtualPath);
  }
}
