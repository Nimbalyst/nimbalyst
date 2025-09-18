/**
 * Database Initialization Module
 * Handles PGLite database setup and migration on app startup
 */

import { app } from 'electron';
import { database } from './PGLiteDatabaseWorker';
import { logger } from '../utils/logger';
import type { SessionStore } from '@stravu/runtime';
import { repositoryManager } from '../services/RepositoryManager';

/**
 * Initialize the database system
 * Should be called when the app is ready
 */
export async function initializeDatabase(): Promise<SessionStore> {
  if (repositoryManager.isInitialized()) {
    return repositoryManager.getSessionStore();
  }
  logger.main.info('[Database] Initializing PGLite database system...');

  try {
    // Initialize PGLite database
    await database.initialize();
    logger.main.info('[Database] PGLite initialized successfully');

    // Initialize all repositories
    await repositoryManager.initialize();
    const sessionStore = repositoryManager.getSessionStore();
    logger.main.info('[Database] All repositories initialized');

    // Get database stats
    const stats = await database.getStats();
    logger.main.info('[Database] Database stats:', stats);

    // Set up cleanup on app quit
    app.on('before-quit', async () => {
      logger.main.info('[Database] Closing database connection...');
      await database.close();
    });

    logger.main.info('[Database] Database system ready');

    return sessionStore;
  } catch (error) {
    logger.main.error('[Database] Failed to initialize database:', error);
    // Don't throw in production - fall back to electron-store
    if (process.env.NODE_ENV === 'development') {
      throw error;
    }
    throw error;
  }
}

export function getRuntimeSessionStore(): SessionStore | null {
  return repositoryManager.isInitialized() ? repositoryManager.getSessionStore() : null;
}

/**
 * Get database instance (for other modules)
 */
export function getDatabase() {
  return database;
}

// Export database directly for protocol server
export { database };
