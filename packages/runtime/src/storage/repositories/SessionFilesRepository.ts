import { v4 as uuidv4 } from 'uuid';
import type { FileLink, FileLinkType } from '../../ai/server/types';

/**
 * Session file link store interface
 */
export interface SessionFileStore {
  ensureReady(): Promise<void>;
  addFileLink(link: Omit<FileLink, 'id'>): Promise<FileLink>;
  getFilesBySession(sessionId: string, linkType?: FileLinkType): Promise<FileLink[]>;
  getSessionsByFile(workspaceId: string, filePath: string, linkType?: FileLinkType): Promise<string[]>;
  deleteFileLink(id: string): Promise<void>;
  deleteSessionLinks(sessionId: string): Promise<void>;
  hasFileLink(sessionId: string, filePath: string, linkType: FileLinkType): Promise<boolean>;
}

let activeSessionFileStore: SessionFileStore | null = null;

export function setSessionFileStore(store: SessionFileStore | null): void {
  activeSessionFileStore = store;
}

export function hasSessionFileStore(): boolean {
  return activeSessionFileStore !== null;
}

export function getSessionFileStore(): SessionFileStore {
  if (!activeSessionFileStore) {
    throw new Error('Session file store adapter has not been configured');
  }
  return activeSessionFileStore;
}

function requireStore(): SessionFileStore {
  if (!hasSessionFileStore()) {
    throw new Error('Session file store adapter has not been provided to the runtime');
  }
  return getSessionFileStore();
}

/**
 * Repository for managing file-session relationships
 */
export const SessionFilesRepository = {
  setStore(store: SessionFileStore): void {
    setSessionFileStore(store);
  },

  registerStore(store: SessionFileStore): void {
    setSessionFileStore(store);
  },

  clearStore(): void {
    setSessionFileStore(null);
  },

  getStore(): SessionFileStore {
    return requireStore();
  },

  async ensureReady(): Promise<void> {
    await requireStore().ensureReady();
  },

  /**
   * Add a file link to a session
   * Automatically generates ID and prevents duplicates
   */
  async addFileLink(link: Omit<FileLink, 'id'>): Promise<FileLink> {
    const store = requireStore();

    // Check if link already exists
    const exists = await store.hasFileLink(link.sessionId, link.filePath, link.linkType);
    if (exists) {
      // Return existing link without creating duplicate
      const existing = await store.getFilesBySession(link.sessionId, link.linkType);
      const match = existing.find(l => l.filePath === link.filePath && l.linkType === link.linkType);
      if (match) {
        return match;
      }
    }

    return await store.addFileLink(link);
  },

  /**
   * Get all file links for a session, optionally filtered by type
   */
  async getFilesBySession(sessionId: string, linkType?: FileLinkType): Promise<FileLink[]> {
    return await requireStore().getFilesBySession(sessionId, linkType);
  },

  /**
   * Get all sessions that have links to a specific file
   */
  async getSessionsByFile(workspaceId: string, filePath: string, linkType?: FileLinkType): Promise<string[]> {
    return await requireStore().getSessionsByFile(workspaceId, filePath, linkType);
  },

  /**
   * Delete a specific file link
   */
  async deleteFileLink(id: string): Promise<void> {
    await requireStore().deleteFileLink(id);
  },

  /**
   * Delete all file links for a session
   */
  async deleteSessionLinks(sessionId: string): Promise<void> {
    await requireStore().deleteSessionLinks(sessionId);
  },

  /**
   * Check if a file link already exists
   */
  async hasFileLink(sessionId: string, filePath: string, linkType: FileLinkType): Promise<boolean> {
    return await requireStore().hasFileLink(sessionId, filePath, linkType);
  }
};

export type {
  FileLink,
  FileLinkType
};
