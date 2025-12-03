/**
 * Central repository manager for the Electron app
 * Provides concrete implementations of all runtime interfaces
 */

import type {
  SessionStore,
  SessionFileStore,
  DocumentsRepository
} from '@nimbalyst/runtime';
import type { WorkspaceRepository } from '../types/workspace';
import type { AgentMessagesStore } from '@nimbalyst/runtime/storage/repositories/AgentMessagesRepository';
import { AISessionsRepository, SessionFilesRepository, AgentMessagesRepository } from '@nimbalyst/runtime';
import { createPGLiteSessionStore } from './PGLiteSessionStore';
import { createPGLiteSessionFileStore } from './PGLiteSessionFileStore';
import { createPGLiteAgentMessagesStore } from './PGLiteAgentMessagesStore';
import { createSyncedAgentMessagesStore } from './SyncedAgentMessagesStore';
import { createPGLiteWorkspaceRepository } from './PGLiteWorkspaceRepository';
import { createPGLiteDocumentsRepository } from './PGLiteDocumentsRepository';
import { createPGLiteQueuedPromptsStore, type QueuedPromptsStore } from './PGLiteQueuedPromptsStore';
import { database } from '../database/PGLiteDatabaseWorker';
import { logger } from '../utils/logger';
import { initializeSync, shutdownSync, isSyncEnabled, reinitializeSync } from './SyncManager';

class RepositoryManager {
  private sessionStore: SessionStore | null = null;
  private baseSessionStore: SessionStore | null = null; // Unwrapped store for sync reinitialization
  private sessionFileStore: SessionFileStore | null = null;
  private agentMessagesStore: AgentMessagesStore | null = null;
  private baseAgentMessagesStore: AgentMessagesStore | null = null; // Unwrapped store for sync reinitialization
  private workspaceRepository: WorkspaceRepository | null = null;
  private documentsRepository: DocumentsRepository | null = null;
  private queuedPromptsStore: QueuedPromptsStore | null = null;
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

      // Create base session store
      this.baseSessionStore = createPGLiteSessionStore(
        dbAdapter,
        async () => {
          if (!database.isInitialized()) {
            await database.initialize();
          }
        }
      );

      // Wrap with sync if configured (returns base store if sync not enabled)
      this.sessionStore = await initializeSync(this.baseSessionStore);

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

      // Create base agent messages store
      this.baseAgentMessagesStore = createPGLiteAgentMessagesStore(
        dbAdapter,
        async () => {
          if (!database.isInitialized()) {
            await database.initialize();
          }
        }
      );

      // Wrap with sync if enabled (must happen after initializeSync)
      this.agentMessagesStore = isSyncEnabled()
        ? createSyncedAgentMessagesStore(this.baseAgentMessagesStore)
        : this.baseAgentMessagesStore;

      // Register agent messages store with runtime's AgentMessagesRepository
      AgentMessagesRepository.setStore(this.agentMessagesStore);

      // Create workspace repository
      this.workspaceRepository = createPGLiteWorkspaceRepository(dbAdapter);

      // Create documents repository
      this.documentsRepository = createPGLiteDocumentsRepository(dbAdapter);

      // Create queued prompts store
      this.queuedPromptsStore = createPGLiteQueuedPromptsStore(
        dbAdapter,
        async () => {
          if (!database.isInitialized()) {
            await database.initialize();
          }
        }
      );

      this.initialized = true;
      logger.main.info('[RepositoryManager] All repositories initialized successfully');
    } catch (error) {
      logger.main.error('[RepositoryManager] Failed to initialize repositories:', error);
      throw error;
    }
  }

  /**
   * Get the session store instance (potentially wrapped with sync)
   */
  getSessionStore(): SessionStore {
    if (!this.sessionStore) {
      throw new Error('RepositoryManager not initialized. Call initialize() first.');
    }
    return this.sessionStore;
  }

  /**
   * Get the base session store (without sync wrapper)
   * Used for methods like claimQueuedPrompt that are specific to PGLite
   */
  getBaseSessionStore(): SessionStore {
    if (!this.baseSessionStore) {
      throw new Error('RepositoryManager not initialized. Call initialize() first.');
    }
    return this.baseSessionStore;
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
   * Get the agent messages store instance
   */
  getAgentMessagesStore(): AgentMessagesStore {
    if (!this.agentMessagesStore) {
      throw new Error('RepositoryManager not initialized. Call initialize() first.');
    }
    return this.agentMessagesStore;
  }

  /**
   * Get the base (unwrapped) agent messages store.
   * Use this when saving messages from sync to avoid feedback loops.
   */
  getBaseAgentMessagesStore(): AgentMessagesStore {
    if (!this.baseAgentMessagesStore) {
      throw new Error('RepositoryManager not initialized. Call initialize() first.');
    }
    return this.baseAgentMessagesStore;
  }

  /**
   * Get the queued prompts store instance.
   * Used for atomic prompt claiming and queue management.
   */
  getQueuedPromptsStore(): QueuedPromptsStore {
    if (!this.queuedPromptsStore) {
      throw new Error('RepositoryManager not initialized. Call initialize() first.');
    }
    return this.queuedPromptsStore;
  }

  /**
   * Reinitialize sync with new configuration.
   * Called when sync settings are changed at runtime.
   */
  async reinitializeSyncWithNewConfig(): Promise<void> {
    if (!this.initialized || !this.baseSessionStore || !this.baseAgentMessagesStore) {
      logger.main.warn('[RepositoryManager] Cannot reinitialize sync - not initialized yet');
      return;
    }

    logger.main.info('[RepositoryManager] Reinitializing sync with new configuration...');

    // Reinitialize sync (this shuts down existing sync and starts new one if enabled)
    this.sessionStore = await reinitializeSync(this.baseSessionStore);
    AISessionsRepository.setStore(this.sessionStore);

    // Rewrap agent messages store with sync if enabled
    this.agentMessagesStore = isSyncEnabled()
      ? createSyncedAgentMessagesStore(this.baseAgentMessagesStore)
      : this.baseAgentMessagesStore;
    AgentMessagesRepository.setStore(this.agentMessagesStore);

    logger.main.info('[RepositoryManager] Sync reinitialization complete, sync enabled:', isSyncEnabled());
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    // Shutdown sync first
    shutdownSync();

    if (this.sessionStore) {
      AISessionsRepository.clearStore();
    }
    if (this.sessionFileStore) {
      SessionFilesRepository.clearStore();
    }
    if (this.agentMessagesStore) {
      AgentMessagesRepository.clearStore();
    }
    this.sessionStore = null;
    this.sessionFileStore = null;
    this.agentMessagesStore = null;
    this.workspaceRepository = null;
    this.documentsRepository = null;
    this.queuedPromptsStore = null;
    this.initialized = false;
  }
}

// Export singleton instance
export const repositoryManager = new RepositoryManager();

// Export convenience getters
export function getSessionStore(): SessionStore {
  return repositoryManager.getSessionStore();
}

export function getBaseSessionStore(): SessionStore {
  return repositoryManager.getBaseSessionStore();
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

export function getAgentMessagesStore(): AgentMessagesStore {
  return repositoryManager.getAgentMessagesStore();
}

export function getBaseAgentMessagesStore(): AgentMessagesStore {
  return repositoryManager.getBaseAgentMessagesStore();
}

export function getQueuedPromptsStore(): QueuedPromptsStore {
  return repositoryManager.getQueuedPromptsStore();
}