/**
 * Synced wrapper for AgentMessagesStore that syncs messages to remote.
 *
 * IMPORTANT: The timestamp (message.createdAt) must originate from the message source
 * (e.g., AIProvider.logAgentMessage). This wrapper just passes it through to both
 * local DB and sync - it does NOT create its own timestamp.
 */

import type { AgentMessagesStore } from '@nimbalyst/runtime/storage/repositories/AgentMessagesRepository';
import type { CreateAgentMessageInput, AgentMessage } from '@nimbalyst/runtime';
import { getMessageSyncHandler } from './SyncManager';
import { logger } from '../utils/logger';

/**
 * Wraps an AgentMessagesStore to sync messages to the SessionsIndex.
 */
export function createSyncedAgentMessagesStore(
  baseStore: AgentMessagesStore
): AgentMessagesStore {
  return {
    async create(message: CreateAgentMessageInput): Promise<void> {
      // message.createdAt MUST be set by the caller (AIProvider)
      // This ensures the same timestamp is used everywhere
      if (!message.createdAt) {
        throw new Error('message.createdAt is required for sync consistency');
      }

      const timestamp = message.createdAt instanceof Date
        ? message.createdAt
        : new Date(message.createdAt);

      // Create in base store (uses message.createdAt for both message and session updated_at)
      await baseStore.create(message);

      // Push to sync with the SAME timestamp
      const messageSyncHandler = getMessageSyncHandler();
      if (messageSyncHandler) {
        try {
          const syncMessage: AgentMessage = {
            id: 0, // ID not needed for sync
            sessionId: message.sessionId,
            createdAt: timestamp,
            source: message.source,
            direction: message.direction,
            content: message.content,
            metadata: message.metadata,
            hidden: message.hidden ?? false,
          };

          // Pass the same timestamp for session index update
          messageSyncHandler.onMessageCreated(syncMessage, timestamp.getTime());
        } catch (error) {
          logger.main.warn('[SyncedAgentMessagesStore] Failed to sync message:', error);
        }
      }
    },

    async list(sessionId: string, options?: { limit?: number; offset?: number; includeHidden?: boolean }): Promise<AgentMessage[]> {
      return baseStore.list(sessionId, options);
    },
  };
}
