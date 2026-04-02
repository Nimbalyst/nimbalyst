/**
 * TranscriptMigrationService -- higher-level service that orchestrates lazy
 * migration of old ai_agent_messages into canonical ai_transcript_events.
 *
 * This is the primary API for consumers: call getCanonicalEvents() and the
 * service transparently ensures the session is transformed first.
 */

import { TranscriptTransformer } from './TranscriptTransformer';
import { TranscriptProjector, type TranscriptViewMessage } from './TranscriptProjector';
import type { IRawMessageStore, ISessionMetadataStore } from './TranscriptTransformer';
import type { ITranscriptEventStore, TranscriptEvent, TranscriptEventType } from './types';

export class TranscriptMigrationService {
  private transformer: TranscriptTransformer;

  constructor(
    rawStore: IRawMessageStore,
    private transcriptStore: ITranscriptEventStore,
    private metadataStore: ISessionMetadataStore,
  ) {
    this.transformer = new TranscriptTransformer(rawStore, transcriptStore, metadataStore);
  }

  /**
   * Get canonical events for a session, transforming lazily if needed.
   * This is the primary API for consumers.
   */
  async getCanonicalEvents(
    sessionId: string,
    provider: string,
    options?: {
      eventTypes?: TranscriptEventType[];
      limit?: number;
      offset?: number;
    },
  ): Promise<TranscriptEvent[]> {
    await this.transformer.ensureTransformed(sessionId, provider);
    return this.transcriptStore.getSessionEvents(sessionId, options);
  }

  /**
   * Get projected view messages for UI rendering.
   * Chains getCanonicalEvents -> project, returning TranscriptViewMessage[] directly.
   */
  async getViewMessages(sessionId: string, provider: string): Promise<TranscriptViewMessage[]> {
    const events = await this.getCanonicalEvents(sessionId, provider);
    const viewModel = TranscriptProjector.project(events);
    return viewModel.messages;
  }

  /**
   * Ensure canonical events exist for a session (lazy migration).
   * Exposed for callers that need to ensure transformation then use
   * the transcript store directly (e.g. efficient tail queries).
   */
  async ensureTransformed(sessionId: string, provider: string): Promise<void> {
    await this.transformer.ensureTransformed(sessionId, provider);
  }

  /**
   * Get the last N canonical events for a session, excluding specified types.
   * More efficient than getCanonicalEvents for preview use cases.
   */
  async getTailEvents(
    sessionId: string,
    provider: string,
    count: number,
    options?: { excludeEventTypes?: TranscriptEventType[] },
  ): Promise<TranscriptEvent[]> {
    await this.transformer.ensureTransformed(sessionId, provider);
    return this.transcriptStore.getTailEvents(sessionId, count, options);
  }

  /**
   * Check if a session needs transformation without performing it.
   */
  async needsTransformation(sessionId: string): Promise<boolean> {
    const status = await this.metadataStore.getTransformStatus(sessionId);

    if (
      status.transformStatus === 'complete' &&
      status.transformVersion === TranscriptTransformer.CURRENT_VERSION
    ) {
      return false;
    }

    return true;
  }
}
