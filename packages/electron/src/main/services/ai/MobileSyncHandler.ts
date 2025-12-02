/**
 * MobileSyncHandler - Watches for mobile-originated messages via sync.
 *
 * When a mobile device sends a message:
 * 1. Mobile pushes message to sync server
 * 2. Mobile sets pendingExecution metadata
 * 3. Desktop detects pendingExecution via metadata broadcast
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
  private messageHandler: ((sessionId: string, messageId: string) => Promise<void>) | null = null;

  constructor(syncProvider: SyncProvider) {
    this.syncProvider = syncProvider;
    logger.main.info('[MobileSyncHandler] Initialized');
  }

  /**
   * Set the global message handler for processing mobile messages.
   * This allows us to watch sessions without knowing the handler upfront.
   */
  setMessageHandler(handler: (sessionId: string, messageId: string) => Promise<void>): void {
    this.messageHandler = handler;
    logger.main.info('[MobileSyncHandler] Message handler set');
  }

  /**
   * Start listening for index changes that indicate pending mobile messages.
   * This is more efficient than connecting to every session's WebSocket.
   */
  async startIndexListener(): Promise<void> {
    if (!this.messageHandler) {
      logger.main.error('[MobileSyncHandler] Cannot start index listener - no message handler set');
      return;
    }

    // Subscribe to index changes if available
    if (this.syncProvider.onIndexChange) {
      logger.main.info('[MobileSyncHandler] Starting index listener for pending executions');
      this.syncProvider.onIndexChange((sessionId, entry) => {
        if (entry.pendingExecution && entry.pendingExecution.sentBy === 'mobile') {
          logger.main.info('[MobileSyncHandler] Index shows pending execution for session:', sessionId);
          // Connect to this session and process the message
          this.handlePendingSession(sessionId, entry.pendingExecution);
        }
      });
    } else {
      logger.main.info('[MobileSyncHandler] onIndexChange not available, falling back to polling');
      this.startPolling();
    }
  }

  /**
   * Handle a session that has a pending execution from mobile.
   */
  private async handlePendingSession(
    sessionId: string,
    pendingExecution: { messageId: string; sentAt: number; sentBy: string }
  ): Promise<void> {
    if (!this.messageHandler) return;

    // Skip if already processing
    if (this.processingMessages.has(pendingExecution.messageId)) {
      return;
    }

    this.processingMessages.add(pendingExecution.messageId);

    try {
      // Connect to the session to get the full message
      await this.syncProvider.connect(sessionId);

      // Process the message
      await this.messageHandler(sessionId, pendingExecution.messageId);

      // Clear pendingExecution
      this.syncProvider.pushChange(sessionId, {
        type: 'metadata_updated',
        metadata: { pendingExecution: undefined } as any,
      });

      logger.main.info('[MobileSyncHandler] Processed pending message:', pendingExecution.messageId);
    } catch (error) {
      logger.main.error('[MobileSyncHandler] Failed to process pending session:', error);
    } finally {
      this.processingMessages.delete(pendingExecution.messageId);
    }
  }

  private pollingInterval: NodeJS.Timeout | null = null;

  /**
   * Fallback: Poll the index periodically to check for pending executions.
   */
  private startPolling(): void {
    if (this.pollingInterval) return;

    const pollIndex = async () => {
      if (!this.syncProvider.fetchIndex || !this.messageHandler) return;

      try {
        const indexData = await this.syncProvider.fetchIndex();
        if (!indexData?.sessions) return;

        for (const session of indexData.sessions) {
          // Check if this session has a pending execution from mobile
          // Note: This requires pendingExecution to be in the index response
          const entry = session as any;
          if (entry.pendingExecution?.sentBy === 'mobile') {
            await this.handlePendingSession(session.session_id, entry.pendingExecution);
          }
        }
      } catch (error) {
        logger.main.error('[MobileSyncHandler] Poll failed:', error);
      }
    };

    // Poll every 5 seconds
    this.pollingInterval = setInterval(pollIndex, 5000);
    // Also poll immediately
    pollIndex();

    logger.main.info('[MobileSyncHandler] Started polling for pending executions');
  }

  private stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
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
      // Only log metadata changes, not message floods
      if (change.type !== 'message_added') {
        logger.main.info('[MobileSyncHandler] Received remote change:', change.type, 'for session:', sessionId);
      }

      // NOTE: We intentionally do NOT save message_added events here.
      // Messages from mobile are saved when they trigger pendingExecution processing.
      // Trying to save all message_added events causes feedback loops and floods
      // because the sync server broadcasts all historical messages on connect.

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
   * Stop watching all sessions and cleanup.
   */
  unwatchAll(): void {
    this.stopPolling();
    for (const [, unsubscribe] of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers.clear();
    this.processingMessages.clear();
    logger.main.info('[MobileSyncHandler] Stopped watching all sessions');
  }
}
