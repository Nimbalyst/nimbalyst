/**
 * Central repository manager for the Electron app
 * Provides concrete implementations of all runtime interfaces
 */

import type {
  SessionStore,
  SessionFileStore,
  DocumentsRepository
} from '@stravu/runtime';
import type { WorkspaceRepository } from '../types/workspace';
import { AISessionsRepository, SessionFilesRepository } from '@stravu/runtime';
import { createPGLiteSessionStore } from './PGLiteSessionStore';
import { createPGLiteSessionFileStore } from './PGLiteSessionFileStore';
import { createPGLiteWorkspaceRepository } from './PGLiteWorkspaceRepository';
import { createPGLiteDocumentsRepository } from './PGLiteDocumentsRepository';
import { database } from '../database/PGLiteDatabaseWorker';
import { logger } from '../utils/logger';

class RepositoryManager {
  private sessionStore: SessionStore | null = null;
  private sessionFileStore: SessionFileStore | null = null;
  private workspaceRepository: WorkspaceRepository | null = null;
  private documentsRepository: DocumentsRepository | null = null;
  private initialized = false;

  /**
   * Initialize all repositories with PGLite database
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      logger.main.info('[RepositoryManager] Initializing repositories...');

      // Ensure database is ready
      if (!database.isInitialized()) {
        await database.initialize();
      }

      // Create database adapter
      const dbAdapter = {
        query: database.query.bind(database),
      };

      // Create session store
      this.sessionStore = createPGLiteSessionStore(
        dbAdapter,
        async () => {
          if (!database.isInitialized()) {
            await database.initialize();
          }
        }
      );

      // Register session store with runtime's AISessionsRepository
      AISessionsRepository.setStore(this.sessionStore);

      // Create session file store
      this.sessionFileStore = createPGLiteSessionFileStore(
        dbAdapter,
        async () => {
          if (!database.isInitialized()) {
            await database.initialize();
          }
        }
      );

      // Register session file store with runtime's SessionFilesRepository
      SessionFilesRepository.setStore(this.sessionFileStore);

      // Create workspace repository
      this.workspaceRepository = createPGLiteWorkspaceRepository(dbAdapter);

      // Create documents repository
      this.documentsRepository = createPGLiteDocumentsRepository(dbAdapter);

      this.initialized = true;
      logger.main.info('[RepositoryManager] All repositories initialized successfully');
    } catch (error) {
      logger.main.error('[RepositoryManager] Failed to initialize repositories:', error);
      throw error;
    }
  }

  /**
   * Get the session store instance
   */
  getSessionStore(): SessionStore {
    if (!this.sessionStore) {
      throw new Error('RepositoryManager not initialized. Call initialize() first.');
    }
    return this.sessionStore;
  }

  /**
   * Get the workspace repository instance
   */
  getWorkspaceRepository(): WorkspaceRepository {
    if (!this.workspaceRepository) {
      throw new Error('RepositoryManager not initialized. Call initialize() first.');
    }
    return this.workspaceRepository;
  }

  /**
   * Get the documents repository instance
   */
  getDocumentsRepository(): DocumentsRepository {
    if (!this.documentsRepository) {
      throw new Error('RepositoryManager not initialized. Call initialize() first.');
    }
    return this.documentsRepository;
  }

  /**
   * Check if repositories are initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the session file store instance
   */
  getSessionFileStore(): SessionFileStore {
    if (!this.sessionFileStore) {
      throw new Error('RepositoryManager not initialized. Call initialize() first.');
    }
    return this.sessionFileStore;
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    if (this.sessionStore) {
      AISessionsRepository.clearStore();
    }
    if (this.sessionFileStore) {
      SessionFilesRepository.clearStore();
    }
    this.sessionStore = null;
    this.sessionFileStore = null;
    this.workspaceRepository = null;
    this.documentsRepository = null;
    this.initialized = false;
  }
}

// Export singleton instance
export const repositoryManager = new RepositoryManager();

// Export convenience getters
export function getSessionStore(): SessionStore {
  return repositoryManager.getSessionStore();
}

export function getWorkspaceRepository(): WorkspaceRepository {
  return repositoryManager.getWorkspaceRepository();
}

export function getDocumentsRepository(): DocumentsRepository {
  return repositoryManager.getDocumentsRepository();
}

export function getSessionFileStore(): SessionFileStore {
  return repositoryManager.getSessionFileStore();
}