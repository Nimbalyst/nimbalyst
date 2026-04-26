import * as path from 'path';
import { createHash } from 'crypto';
import { BrowserWindow } from 'electron';
import { SessionFilesRepository } from '@nimbalyst/runtime';
import { historyManager } from '../HistoryManager';
import { getSubscriberIds } from '../file/WorkspaceEventBus';
import { logger } from '../utils/logger';
import { toolCallMatcher } from './ToolCallMatcher';

export interface WorkspaceFileEditEvent {
  workspacePath: string;
  filePath: string;
  timestamp: number;
  beforeContent?: string | null;
}

interface WorkspaceQueueState {
  queue: WorkspaceFileEditEvent[];
  processing: boolean;
  recentByFile: Map<string, { ingestedAt: number; eventTimestamp: number }>;
  processedEventKeys: Map<string, number>;
}

const EVENT_DEDUPE_WINDOW_MS = 250;
const EVENT_TTL_MS = 30_000;
const MAX_QUEUE_SIZE = 500;

/** Per-workspace attribution counters for observability. */
interface AttributionCounters {
  eventsReceived: number;
  eventsDeduped: number;
  attributedEdits: number;
  unattributedEdits: number;
  tagsCreated: number;
}

/** Interval (ms) between periodic counter summary logs. */
const COUNTER_LOG_INTERVAL_MS = 60_000;

class WorkspaceFileEditAttributionServiceImpl {
  private readonly stateByWorkspace = new Map<string, WorkspaceQueueState>();
  private readonly counters = new Map<string, AttributionCounters>();
  private counterLogTimer: ReturnType<typeof setInterval> | null = null;

  private getCounters(workspacePath: string): AttributionCounters {
    const existing = this.counters.get(workspacePath);
    if (existing) return existing;
    const c: AttributionCounters = { eventsReceived: 0, eventsDeduped: 0, attributedEdits: 0, unattributedEdits: 0, tagsCreated: 0 };
    this.counters.set(workspacePath, c);

    // Start periodic counter logging on first workspace
    if (!this.counterLogTimer) {
      this.counterLogTimer = setInterval(() => this.logCounterSummary(), COUNTER_LOG_INTERVAL_MS);
      // Unref so it doesn't prevent process exit
      if (this.counterLogTimer && typeof this.counterLogTimer === 'object' && 'unref' in this.counterLogTimer) {
        this.counterLogTimer.unref();
      }
    }

    return c;
  }

  private logCounterSummary(): void {
    for (const [workspacePath, c] of this.counters.entries()) {
      if (c.eventsReceived === 0) continue;
      // logger.main.handleSetContentMode
    }
  }

  ingestWatcherEvent(rawEvent: WorkspaceFileEditEvent): void {
    const workspacePath = path.resolve(rawEvent.workspacePath);
    const filePath = path.resolve(rawEvent.filePath);
    const event: WorkspaceFileEditEvent = {
      ...rawEvent,
      workspacePath,
      filePath,
    };
    const now = Date.now();
    const counters = this.getCounters(workspacePath);
    counters.eventsReceived++;
    const state = this.getOrCreateState(workspacePath);
    this.cleanupState(state, now);

    const recent = state.recentByFile.get(filePath);
    if (recent) {
      const ingestDiff = now - recent.ingestedAt;
      const eventDiff = Math.abs(event.timestamp - recent.eventTimestamp);
      if (ingestDiff <= EVENT_DEDUPE_WINDOW_MS && eventDiff <= EVENT_DEDUPE_WINDOW_MS) {
        counters.eventsDeduped++;
        logger.main.debug('[WorkspaceFileEditAttributionService] Deduped watcher event:', {
          workspacePath,
          filePath,
          eventTimestamp: event.timestamp,
          previousTimestamp: recent.eventTimestamp,
          ingestDiff,
        });
        return;
      }
    }

    if (state.queue.length >= MAX_QUEUE_SIZE) {
      state.queue.shift();
      logger.main.warn('[WorkspaceFileEditAttributionService] Queue full, dropping oldest event:', {
        workspacePath,
        filePath,
      });
    }

    state.recentByFile.set(filePath, {
      ingestedAt: now,
      eventTimestamp: event.timestamp,
    });
    state.queue.push(event);

    logger.main.debug('[WorkspaceFileEditAttributionService] Ingested watcher event:', {
      workspacePath,
      filePath,
      timestamp: event.timestamp,
      queueLength: state.queue.length,
    });

    void this.processQueue(workspacePath);
  }

  private getOrCreateState(workspacePath: string): WorkspaceQueueState {
    const existing = this.stateByWorkspace.get(workspacePath);
    if (existing) return existing;

    const state: WorkspaceQueueState = {
      queue: [],
      processing: false,
      recentByFile: new Map(),
      processedEventKeys: new Map(),
    };
    this.stateByWorkspace.set(workspacePath, state);
    return state;
  }

  private cleanupState(state: WorkspaceQueueState, now: number): void {
    for (const [filePath, recent] of state.recentByFile.entries()) {
      if (now - recent.ingestedAt > EVENT_TTL_MS) {
        state.recentByFile.delete(filePath);
      }
    }

    for (const [eventKey, seenAt] of state.processedEventKeys.entries()) {
      if (now - seenAt > EVENT_TTL_MS) {
        state.processedEventKeys.delete(eventKey);
      }
    }
  }

  private makeEventKey(event: WorkspaceFileEditEvent, sessionId: string): string {
    const timestampBucket = Math.floor(event.timestamp / EVENT_DEDUPE_WINDOW_MS);
    const hash = createHash('sha1')
      .update(`${event.filePath}|${timestampBucket}`)
      .digest('hex')
      .slice(0, 16);
    return `${sessionId}:${hash}`;
  }

  private makeWatcherToolUseId(event: WorkspaceFileEditEvent): string {
    const hash = createHash('sha1')
      .update(`${event.filePath}|${event.timestamp}`)
      .digest('hex')
      .slice(0, 12);
    return `watcher-${hash}`;
  }

  private async processQueue(workspacePath: string): Promise<void> {
    const state = this.stateByWorkspace.get(workspacePath);
    if (!state || state.processing) return;
    state.processing = true;

    try {
      while (state.queue.length > 0) {
        const event = state.queue.shift();
        if (!event) continue;
        await this.processEvent(event, state);
      }
    } finally {
      state.processing = false;
    }
  }

  private async processEvent(event: WorkspaceFileEditEvent, state: WorkspaceQueueState): Promise<void> {
    try {
      const candidateSessionIds = getSubscriberIds(event.workspacePath);
      if (candidateSessionIds.length === 0) {
        logger.main.debug('[WorkspaceFileEditAttributionService] No active sessions for event:', {
          workspacePath: event.workspacePath,
          filePath: event.filePath,
          timestamp: event.timestamp,
        });
        return;
      }

      const matchResult = await toolCallMatcher.matchWorkspaceFileEdit({
        workspacePath: event.workspacePath,
        filePath: event.filePath,
        fileTimestamp: event.timestamp,
        candidateSessionIds,
      });

      const counters = this.getCounters(event.workspacePath);

      if (!matchResult.winner) {
        counters.unattributedEdits++;
        logger.main.debug('[WorkspaceFileEditAttributionService] No attribution winner for event:', {
          workspacePath: event.workspacePath,
          filePath: event.filePath,
          timestamp: event.timestamp,
          candidateCount: matchResult.candidates.length,
          reason: matchResult.reason,
        });
        return;
      }

      const winner = matchResult.winner;
      const eventKey = this.makeEventKey(event, winner.sessionId);
      if (state.processedEventKeys.has(eventKey)) {
        logger.main.debug('[WorkspaceFileEditAttributionService] Skipping already-processed event key:', {
          eventKey,
          sessionId: winner.sessionId,
          filePath: event.filePath,
        });
        return;
      }
      state.processedEventKeys.set(eventKey, Date.now());

      const toolUseId = winner.toolUseId || this.makeWatcherToolUseId(event);

      await SessionFilesRepository.addFileLink({
        sessionId: winner.sessionId,
        workspaceId: event.workspacePath,
        filePath: event.filePath,
        linkType: 'edited',
        timestamp: event.timestamp,
        metadata: {
          toolName: winner.toolName,
          operation: winner.toolName === 'Bash' ? 'bash' : 'edit',
          toolUseId,
          watcherAttribution: {
            score: winner.score,
            reasons: winner.reasons,
            messageId: winner.messageId,
            toolCallItemId: winner.toolCallItemId,
            fileTimestamp: event.timestamp,
          },
        },
      });

      counters.attributedEdits++;

      if (event.beforeContent == null) {
        // Don't create a tag with empty baseline - the proactive file_change handler
        // or trackBashFileEditsFromCommand will create one with correct content shortly.
        logger.main.info('[WorkspaceFileEditAttributionService] Skipping tag creation - no baseline available (cache miss):', {
          filePath: event.filePath,
          sessionId: winner.sessionId,
          toolUseId,
        });
      } else {
        const tagId = `ai-edit-pending-${winner.sessionId}-${toolUseId}`;
        await historyManager.createTag(
          event.workspacePath,
          event.filePath,
          tagId,
          event.beforeContent,
          winner.sessionId,
          toolUseId,
        );
        counters.tagsCreated++;
      }

      // logger.main.info('[WorkspaceFileEditAttributionService] Attributed file edit:', {
      //   workspacePath: event.workspacePath,
      //   filePath: event.filePath,
      //   sessionId: winner.sessionId,
      //   score: winner.score,
      //   reasons: winner.reasons,
      //   messageId: winner.messageId,
      // });

      const windows = BrowserWindow.getAllWindows();
      for (const window of windows) {
        if (!window.isDestroyed()) {
          window.webContents.send('session-files:updated', winner.sessionId);
        }
      }
    } catch (error) {
      logger.main.error('[WorkspaceFileEditAttributionService] Failed to process event:', {
        filePath: event.filePath,
        workspacePath: event.workspacePath,
        error,
      });
    }
  }
}

export const workspaceFileEditAttributionService = new WorkspaceFileEditAttributionServiceImpl();
