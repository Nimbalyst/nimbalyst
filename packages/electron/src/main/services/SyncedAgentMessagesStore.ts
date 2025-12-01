/**
 * Synced wrapper for AgentMessagesStore that updates the SessionsIndex when messages are added
 */

import type { AgentMessagesStore } from '@nimbalyst/runtime/storage/repositories/AgentMessagesRepository';
import type { CreateAgentMessageInput, AgentMessage } from '@nimbalyst/runtime';
import { getMessageSyncHandler } from './SyncManager';
import { logger } from '../utils/logger';

/**
 * Wraps an AgentMessagesStore to sync messages to the SessionsIndex via Y.js
 */
export function createSyncedAgentMessagesStore(
  baseStore: AgentMessagesStore
): AgentMessagesStore {
  return {
    async create(message: CreateAgentMessageInput): Promise<void> {
      // Create in base store first
      await baseStore.create(message);

      // Then push to sync if enabled (including hidden flag so mobile can filter)
      const messageSyncHandler = getMessageSyncHandler();
      if (messageSyncHandler) {
        try {
          // Convert CreateAgentMessageInput to AgentMessage format for sync
          const syncMessage: AgentMessage = {
            id: 0, // ID not needed for sync
            sessionId: message.sessionId,
            createdAt: message.createdAt,
            source: message.source,
            direction: message.direction,
            content: message.content,
            metadata: message.metadata,
            hidden: message.hidden ?? false,
          };

          messageSyncHandler.onMessageCreated(syncMessage);
        } catch (error) {
          // Sync is optional - log but don't fail
          logger.main.warn('[SyncedAgentMessagesStore] Failed to sync message:', error);
        }
      }
    },

    async list(sessionId: string, options?: { limit?: number; offset?: number; includeHidden?: boolean }): Promise<AgentMessage[]> {
      // List is read-only, just delegate
      return baseStore.list(sessionId, options);
    },
  };
}
