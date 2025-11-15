/**
 * IPC handlers for Claude Code session discovery and sync
 */

import { ipcMain } from 'electron';
import { logger } from '../utils/logger';
import { AISessionsRepository, AgentMessagesRepository } from '@nimbalyst/runtime';
import {
  scanAllSessions,
  isSessionImportEnabled,
  type SessionMetadata,
} from '../services/ClaudeCodeSessionScanner';
import {
  checkSyncStatus,
  syncSession,
  syncSessions,
  type SyncStatus,
} from '../services/ClaudeCodeSessionSync';

const log = logger.ipc;

/**
 * Build a map of providerSessionId -> session for a workspace
 * This batches the lookups to avoid N+1 queries
 */
async function buildProviderSessionIdMap(workspacePath: string): Promise<Map<string, any>> {
  try {
    const sessionStore = AISessionsRepository.getStore();
    const allSessions = await sessionStore.list(workspacePath);
    const map = new Map();

    // Batch load all sessions for this workspace
    await Promise.all(
      allSessions.map(async (sessionItem) => {
        const fullSession = await sessionStore.get(sessionItem.id);
        if (fullSession?.providerSessionId) {
          map.set(fullSession.providerSessionId, fullSession);
        }
      })
    );

    return map;
  } catch (error) {
    log.error(`Error building providerSessionId map for ${workspacePath}:`, error);
    return new Map();
  }
}

/**
 * Initialize the IPC handlers
 */
export function initializeClaudeCodeSessionHandlers() {

  // Scan for Claude Code sessions
  ipcMain.handle('claude-code:scan-sessions', async (event, { workspacePath }: { workspacePath?: string }) => {
    try {
      // Check if feature is enabled (dev mode only for now)
      if (!isSessionImportEnabled()) {
        return {
          success: false,
          error: 'Session import is only available in development mode',
        };
      }

      // Scan filesystem for sessions (optionally filtered by workspace)
      const sessionMetadata = await scanAllSessions(workspacePath);

      log.info(`Found ${sessionMetadata.length} sessions`);

      // Get store references from repositories
      const sessionStore = AISessionsRepository.getStore();
      const messagesStore = AgentMessagesRepository.getStore();

      // Build maps of providerSessionId -> session for each workspace (batch query optimization)
      const workspaceSessionMaps = new Map<string, Map<string, any>>();
      const uniqueWorkspaces = [...new Set(sessionMetadata.map(s => s.workspacePath))];

      await Promise.all(
        uniqueWorkspaces.map(async (workspace) => {
          const map = await buildProviderSessionIdMap(workspace);
          workspaceSessionMaps.set(workspace, map);
        })
      );

      // Deduplicate sessions by sessionId (in case scanner returns duplicates)
      const uniqueMetadata = Array.from(
        new Map(sessionMetadata.map(m => [m.sessionId, m])).values()
      );

      log.info(`After deduplication: ${uniqueMetadata.length} unique sessions`);

      // Check sync status for each session using the batched maps
      const sessionsWithStatus = await Promise.all(
        uniqueMetadata.map(async (metadata) => {
          // First check by direct ID (for already-imported sessions)
          let existingSession = await sessionStore.get(metadata.sessionId);

          // If not found, check the batched providerSessionId map
          if (!existingSession) {
            const workspaceMap = workspaceSessionMaps.get(metadata.workspacePath);
            existingSession = workspaceMap?.get(metadata.sessionId) || null;
          }

          let status: 'new' | 'up-to-date' | 'needs-update' = 'new';
          let dbMessageCount = 0;

          if (existingSession) {
            const messages = await messagesStore.list(existingSession.id);
            dbMessageCount = messages.length;

            if (dbMessageCount === metadata.messageCount) {
              status = 'up-to-date';
            } else if (dbMessageCount < metadata.messageCount) {
              status = 'needs-update';
            }
          }

          return {
            sessionId: metadata.sessionId,
            workspacePath: metadata.workspacePath,
            title: metadata.title || 'Untitled Session',
            createdAt: metadata.createdAt,
            updatedAt: metadata.updatedAt,
            messageCount: metadata.messageCount,
            tokenUsage: metadata.tokenUsage,
            syncStatus: status,
            dbMessageCount: dbMessageCount,
          };
        })
      );

      return {
        success: true,
        sessions: sessionsWithStatus,
      };
    } catch (error) {
      log.error('Failed to scan sessions:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // Sync specific sessions
  ipcMain.handle('claude-code:sync-sessions', async (event, { sessionIds, workspacePath }: { sessionIds: string[]; workspacePath?: string }) => {
    try {
      if (!isSessionImportEnabled()) {
        return {
          success: false,
          error: 'Session import is only available in development mode',
        };
      }

      log.info(`Syncing ${sessionIds.length} sessions...`);

      // Get store references from repositories
      const sessionStore = AISessionsRepository.getStore();
      const messagesStore = AgentMessagesRepository.getStore();

      // Scan for metadata - use workspace path if provided to avoid scanning all workspaces
      const allSessions = await scanAllSessions(workspacePath);
      const sessionsToSync = allSessions.filter(s => sessionIds.includes(s.sessionId));

      if (sessionsToSync.length === 0) {
        return {
          success: false,
          error: 'No sessions found to sync',
        };
      }

      // Sync sessions
      const results = await syncSessions(
        sessionStore,
        messagesStore,
        sessionsToSync,
        (current, total, sessionId) => {
          log.info(`Syncing session ${current}/${total}: ${sessionId}`);
          // TODO: Send progress updates to renderer
        }
      );

      const successCount = results.filter(r => r.success).length;
      const failureCount = results.length - successCount;

      log.info(`Sync complete: ${successCount} succeeded, ${failureCount} failed`);

      return {
        success: true,
        results,
        successCount,
        failureCount,
      };
    } catch (error) {
      log.error('Failed to sync sessions:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  log.info('Claude Code session handlers initialized');
}

/**
 * Clean up handlers
 */
export function cleanupClaudeCodeSessionHandlers() {
  ipcMain.removeHandler('claude-code:scan-sessions');
  ipcMain.removeHandler('claude-code:sync-sessions');
}
