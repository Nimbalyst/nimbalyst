/**
 * MobileSyncHandler - Watches for mobile-originated messages via Y.js sync.
 *
 * When a mobile device sends a message:
 * 1. Mobile pushes message to Y.Doc messages array
 * 2. Mobile sets pendingExecution metadata
 * 3. Desktop detects pendingExecution via Y.js observer
 * 4. Desktop processes the message through AIService
 * 5. Desktop clears pendingExecution flag
 */

import type { SyncProvider } from '@nimbalyst/runtime/sync';
import type { SessionChange } from '@nimbalyst/runtime/sync/types';
import { logger } from '../../utils/logger';

interface PendingExecution {
  messageId: string;
  sentAt: number;
  sentBy: string;
}

export class MobileSyncHandler {
  private syncProvider: SyncProvider;
  private unsubscribers = new Map<string, () => void>();
  private processingMessages = new Set<string>(); // Track which messages are being processed

  constructor(syncProvider: SyncProvider) {
    this.syncProvider = syncProvider;
    logger.main.info('[MobileSyncHandler] Initialized');
  }

  /**
   * Start watching a session for mobile-originated messages.
   * Call this when a session is opened/resumed on desktop.
   */
  async watchSession(
    sessionId: string,
    onMessageReceived: (sessionId: string, messageId: string) => Promise<void>
  ): Promise<void> {
    // Don't double-watch
    if (this.unsubscribers.has(sessionId)) {
      logger.main.debug('[MobileSyncHandler] Already watching session:', sessionId);
      return;
    }

    logger.main.info('[MobileSyncHandler] Starting to watch session:', sessionId);

    // Connect to sync if not already connected
    try {
      await this.syncProvider.connect(sessionId);
    } catch (error) {
      logger.main.error('[MobileSyncHandler] Failed to connect to sync:', error);
      return;
    }

    // Subscribe to remote changes
    const unsubscribe = this.syncProvider.onRemoteChange(sessionId, async (change: SessionChange) => {
      // Handle new messages from mobile - save them to database
      if (change.type === 'message_added') {
        logger.main.info('[MobileSyncHandler] Received message from mobile, saving to database...');

        try {
          // Save message to database
          const { AgentMessagesRepository } = await import('@nimbalyst/runtime');
          await AgentMessagesRepository.create({
            sessionId,
            source: change.message.source,
            direction: change.message.direction,
            content: change.message.content,
            metadata: change.message.metadata,
            hidden: change.message.hidden,
            createdAt: change.message.createdAt,
          });

          logger.main.info('[MobileSyncHandler] Mobile message saved to database');
        } catch (error) {
          logger.main.error('[MobileSyncHandler] Failed to save mobile message to database:', error);
        }
      }

      // Handle pending execution requests
      if (change.type === 'metadata_updated' && change.metadata?.pendingExecution) {
        const pending = change.metadata.pendingExecution as PendingExecution;

        logger.main.info('[MobileSyncHandler] Detected pendingExecution:', {
          sessionId,
          messageId: pending.messageId,
          sentBy: pending.sentBy,
        });

        // Ignore if we're already processing this message
        if (this.processingMessages.has(pending.messageId)) {
          logger.main.debug('[MobileSyncHandler] Already processing message:', pending.messageId);
          return;
        }

        // Ignore if this is from desktop (shouldn't happen, but defensive)
        if (pending.sentBy !== 'mobile') {
          logger.main.debug('[MobileSyncHandler] Ignoring non-mobile message:', pending.sentBy);
          return;
        }

        // Mark as processing
        this.processingMessages.add(pending.messageId);

        try {
          // Call the handler to process the message
          await onMessageReceived(sessionId, pending.messageId);

          // Clear the pendingExecution flag
          this.syncProvider.pushChange(sessionId, {
            type: 'metadata_updated',
            metadata: {
              pendingExecution: undefined,
            } as any,
          });

          logger.main.info('[MobileSyncHandler] Processed mobile message:', pending.messageId);
        } catch (error) {
          logger.main.error('[MobileSyncHandler] Failed to process mobile message:', error);
          // Don't clear pendingExecution on error - mobile can retry
        } finally {
          this.processingMessages.delete(pending.messageId);
        }
      }
    });

    this.unsubscribers.set(sessionId, unsubscribe);
  }

  /**
   * Stop watching a session.
   * Call this when a session is closed/no longer active.
   */
  unwatchSession(sessionId: string): void {
    const unsubscribe = this.unsubscribers.get(sessionId);
    if (unsubscribe) {
      unsubscribe();
      this.unsubscribers.delete(sessionId);
      logger.main.info('[MobileSyncHandler] Stopped watching session:', sessionId);
    }
  }

  /**
   * Stop watching all sessions.
   */
  unwatchAll(): void {
    for (const [sessionId, unsubscribe] of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers.clear();
    this.processingMessages.clear();
    logger.main.info('[MobileSyncHandler] Stopped watching all sessions');
  }
}
