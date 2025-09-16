import { Document, DocumentService } from '@stravu/runtime';
import { Filesystem, Directory } from '@capacitor/filesystem';

/**
 * Capacitor implementation of DocumentService for mobile/web platforms
 */
export class CapacitorDocumentService implements DocumentService {
  private documents: Document[] = [];
  private watchers: Map<string, (documents: Document[]) => void> = new Map();
  private watchInterval: any;
  private basePath: string = '';

  constructor(basePath: string = '') {
    this.basePath = basePath;
    this.startWatching();
  }

  private startWatching() {
    // Capacitor doesn't have real-time file watching, so we poll
    this.watchInterval = setInterval(() => {
      this.refreshDocuments();
    }, 5000); // Poll every 5 seconds

    // Initial load
    this.refreshDocuments();
  }

  private async refreshDocuments() {
    this.documents = await this.scanDocuments();
    // Notify all watchers
    this.watchers.forEach(callback => callback(this.documents));
  }

  private async scanDocuments(): Promise<Document[]> {
    try {
      const documents: Document[] = [];

      // Recursively scan directories
      const scanDirectory = async (path: string) => {
        try {
          const result = await Filesystem.readdir({
            path: path || this.basePath,
            directory: Directory.Documents
          });

          for (const file of result.files) {
            const fullPath = path ? `${path}/${file.name}` : file.name;

            if (file.type === 'directory') {
              // Recursively scan subdirectories
              await scanDirectory(fullPath);
            } else {
              // Check if it's a supported file type
              const supportedExtensions = [
                '.md', '.txt', '.tsx', '.ts', '.jsx', '.js',
                '.json', '.html', '.css', '.scss', '.yaml', '.yml'
              ];

              const hasSupported = supportedExtensions.some(ext =>
                file.name.toLowerCase().endsWith(ext)
              );

              if (hasSupported) {
                // Generate a stable ID from the path
                const id = btoa(fullPath).replace(/[^a-zA-Z0-9]/g, '');

                documents.push({
                  id,
                  name: file.name,
                  path: fullPath,
                  workspace: path || undefined,
                  lastModified: file.mtime ? new Date(file.mtime) : undefined,
                  type: file.name.split('.').pop() || 'unknown',
                  size: file.size
                });
              }
            }
          }
        } catch (err) {
          console.error(`Error scanning directory ${path}:`, err);
        }
      };

      await scanDirectory('');
      return documents;
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

    // In Capacitor, we might trigger a custom event or use a plugin
    // to open the document in an appropriate viewer/editor
    // For now, we'll just dispatch a custom event
    window.dispatchEvent(new CustomEvent('open-document', {
      detail: { path: doc.path, document: doc }
    }));
  }

  /**
   * Read the content of a document
   */
  async readDocument(documentId: string): Promise<string> {
    const doc = await this.getDocument(documentId);
    if (!doc) {
      throw new Error(`Document with id ${documentId} not found`);
    }

    try {
      const result = await Filesystem.readFile({
        path: doc.path,
        directory: Directory.Documents
      });

      // Result.data might be base64 encoded
      if (typeof result.data === 'string') {
        // Check if it's base64
        if (result.data.includes('base64,')) {
          return atob(result.data.split('base64,')[1]);
        }
        return result.data;
      }

      return '';
    } catch (err) {
      console.error(`Error reading document ${doc.path}:`, err);
      throw err;
    }
  }

  /**
   * Write content to a document
   */
  async writeDocument(documentId: string, content: string): Promise<void> {
    const doc = await this.getDocument(documentId);
    if (!doc) {
      throw new Error(`Document with id ${documentId} not found`);
    }

    try {
      await Filesystem.writeFile({
        path: doc.path,
        data: content,
        directory: Directory.Documents
      });

      // Refresh documents after write
      await this.refreshDocuments();
    } catch (err) {
      console.error(`Error writing document ${doc.path}:`, err);
      throw err;
    }
  }

  /**
   * Create a new document
   */
  async createDocument(path: string, content: string = ''): Promise<Document> {
    try {
      await Filesystem.writeFile({
        path,
        data: content,
        directory: Directory.Documents
      });

      // Refresh and find the new document
      await this.refreshDocuments();
      const newDoc = await this.getDocumentByPath(path);

      if (!newDoc) {
        throw new Error('Failed to create document');
      }

      return newDoc;
    } catch (err) {
      console.error(`Error creating document ${path}:`, err);
      throw err;
    }
  }

  /**
   * Delete a document
   */
  async deleteDocument(documentId: string): Promise<void> {
    const doc = await this.getDocument(documentId);
    if (!doc) {
      throw new Error(`Document with id ${documentId} not found`);
    }

    try {
      await Filesystem.deleteFile({
        path: doc.path,
        directory: Directory.Documents
      });

      // Refresh documents after delete
      await this.refreshDocuments();
    } catch (err) {
      console.error(`Error deleting document ${doc.path}:`, err);
      throw err;
    }
  }

  destroy() {
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
    }
    this.watchers.clear();
  }
}

// Factory function for creating the service
export function createCapacitorDocumentService(basePath?: string): DocumentService {
  return new CapacitorDocumentService(basePath);
}
