/**
 * Database Initialization Module
 * Handles PGLite database setup and migration on app startup
 */

import { app } from 'electron';
import { database } from './PGLiteDatabaseWorker';
import { logger } from '../utils/logger';
import { useExternalDB } from '@stravu/runtime/storage/pglite';
import { createPgliteSessionStore } from '@stravu/runtime';
import type { SessionStore } from '@stravu/runtime';

/**
 * Initialize the database system
 * Should be called when the app is ready
 */
let cachedSessionStore: SessionStore | null = null;

export async function initializeDatabase(): Promise<SessionStore> {
  if (cachedSessionStore && database.isInitialized()) {
    return cachedSessionStore;
  }
  logger.main.info('[Database] Initializing PGLite database system...');

  try {
    // Initialize PGLite database
    await database.initialize();
    logger.main.info('[Database] PGLite initialized successfully');

    // Share worker-backed database with runtime storage helpers
    await useExternalDB({
      query: database.query.bind(database),
      exec: database.exec.bind(database),
    });

    const sessionStore = createPgliteSessionStore(
      {
        query: database.query.bind(database),
      },
      async () => {
        if (!database.isInitialized()) {
          await database.initialize();
        }
      }
    );
    cachedSessionStore = sessionStore;
    logger.main.info('[Database] Runtime storage initialized');

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
  return cachedSessionStore;
}

/**
 * Get database instance (for other modules)
 */
export function getDatabase() {
  return database;
}

// Export database directly for protocol server
export { database };
