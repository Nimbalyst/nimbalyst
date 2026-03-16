/**
 * Session State Manager
 *
 * Manages in-memory state for AI sessions and synchronizes with database.
 * Provides event-based notifications for state changes.
 */

import { EventEmitter } from 'events';
import {
  SessionStatus,
  SessionState,
  SessionStateEvent,
  SessionStateListener,
  StartSessionOptions,
  UpdateActivityOptions,
} from './types/SessionState';

const STALE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes (as specified in requirements)

// Database interface for direct SQL access
interface DatabaseWorker {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
}

export class SessionStateManager extends EventEmitter {
  private activeSessions: Map<string, SessionState> = new Map();
  private database: DatabaseWorker | null = null;
  private activityUpdateTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    super();
    // Increase max listeners to accommodate multiple windows
    // Each window subscribes with 7 event listeners, so 50 allows ~7 windows
    this.setMaxListeners(50);
  }

  /**
   * Set the database worker (called after initialization).
   * Also runs stale session recovery since the database is now available.
   */
  setDatabase(database: DatabaseWorker): void {
    this.database = database;
    // Recover stale sessions now that the database is available.
    // initialize() may have already run (and skipped recovery because database was null),
    // so we need to run recovery here.
    this.recoverStaleSessions().catch(error => {
      console.error('[SessionStateManager] Failed to recover stale sessions on setDatabase:', error);
    });
  }

  /**
   * Initialize the state manager
   * - Recovers stale sessions from database
   * - Marks sessions as interrupted if they were running
   */
  async initialize(): Promise<void> {
    if (!this.database) {
      console.warn('[SessionStateManager] No database configured, skipping initialization');
      return;
    }

    try {
      await this.recoverStaleSessions();
    } catch (error) {
      console.error('[SessionStateManager] Failed to recover stale sessions:', error);
    }
  }

  /**
   * Start tracking a session
   */
  async startSession(options: StartSessionOptions): Promise<void> {
    const { sessionId, workspacePath, initialStatus = 'running' } = options;

    const state: SessionState = {
      sessionId,
      workspacePath,
      status: initialStatus,
      lastActivity: new Date(),
      isStreaming: false,
    };

    this.activeSessions.set(sessionId, state);

    // Update database
    await this.updateDatabase(sessionId, initialStatus);

    // Emit event
    this.emitEvent({
      type: 'session:started',
      sessionId,
      workspacePath: state.workspacePath,
      timestamp: new Date(),
    });
  }

  /**
   * Update session activity
   */
  async updateActivity(options: UpdateActivityOptions): Promise<void> {
    const { sessionId, status, isStreaming } = options;

    const state = this.activeSessions.get(sessionId);
    if (!state) {
      console.warn(`[SessionStateManager] Cannot update activity for unknown session: ${sessionId}`);
      return;
    }

    // Update in-memory state
    state.lastActivity = new Date();
    if (status !== undefined) {
      state.status = status;
    }
    if (isStreaming !== undefined) {
      state.isStreaming = isStreaming;
    }

    // Update database
    if (status !== undefined) {
      await this.updateDatabase(sessionId, status);
    } else {
      // Just update last_activity without changing status
      await this.updateLastActivity(sessionId);
    }

    // Emit appropriate event
    if (status === 'running') {
      this.emitEvent({
        type: isStreaming ? 'session:streaming' : 'session:started',
        sessionId,
        workspacePath: state.workspacePath,
        timestamp: new Date(),
      });
    } else if (status === 'waiting_for_input') {
      this.emitEvent({
        type: 'session:waiting',
        sessionId,
        workspacePath: state.workspacePath,
        timestamp: new Date(),
      });
    } else if (status === 'error') {
      this.emitEvent({
        type: 'session:error',
        sessionId,
        workspacePath: state.workspacePath,
        error: 'Session encountered an error',
        timestamp: new Date(),
      });
    } else {
      this.emitEvent({
        type: 'session:activity',
        sessionId,
        workspacePath: state.workspacePath,
        timestamp: new Date(),
      });
    }
  }

  /**
   * End a session (mark as idle)
   */
  async endSession(sessionId: string): Promise<void> {
    const state = this.activeSessions.get(sessionId);
    if (!state) {
      // Session not in memory (e.g., app restarted while session was running).
      // Still update the database to ensure it's not left as 'running'.
      console.warn(`[SessionStateManager] endSession called for session not in activeSessions: ${sessionId}, updating DB directly`);
      await this.updateDatabase(sessionId, 'idle');
      return;
    }

    // Remove from active sessions
    this.activeSessions.delete(sessionId);

    // Clear any activity update timer
    const timer = this.activityUpdateTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.activityUpdateTimers.delete(sessionId);
    }

    // Update database
    await this.updateDatabase(sessionId, 'idle');

    // Emit event
    this.emitEvent({
      type: 'session:completed',
      sessionId,
      workspacePath: state.workspacePath,
      timestamp: new Date(),
    });
  }

  /**
   * Mark a session as interrupted (for crashes or force stops)
   */
  async interruptSession(sessionId: string): Promise<void> {
    const state = this.activeSessions.get(sessionId);
    if (state) {
      this.activeSessions.delete(sessionId);
    }

    // Update database -- interrupted is just idle (SDK process died)
    await this.updateDatabase(sessionId, 'idle');

    // Emit event (event type stays 'interrupted' for tray/UI to react to)
    this.emitEvent({
      type: 'session:interrupted',
      sessionId,
      workspacePath: state?.workspacePath,
      timestamp: new Date(),
    });
  }

  /**
   * Get all active session IDs
   */
  getActiveSessionIds(): string[] {
    return Array.from(this.activeSessions.keys());
  }

  /**
   * Get state for a specific session
   */
  getSessionState(sessionId: string): SessionState | null {
    return this.activeSessions.get(sessionId) ?? null;
  }

  /**
   * Check if a session is active
   */
  isSessionActive(sessionId: string): boolean {
    return this.activeSessions.has(sessionId);
  }

  /**
   * Subscribe to state change events
   */
  subscribe(listener: SessionStateListener): () => void {
    const handler = (event: SessionStateEvent) => listener(event);

    const onStarted = (data: Omit<Extract<SessionStateEvent, { type: 'session:started' }>, 'type'>) =>
      handler({ ...data, type: 'session:started' });
    const onStreaming = (data: Omit<Extract<SessionStateEvent, { type: 'session:streaming' }>, 'type'>) =>
      handler({ ...data, type: 'session:streaming' });
    const onWaiting = (data: Omit<Extract<SessionStateEvent, { type: 'session:waiting' }>, 'type'>) =>
      handler({ ...data, type: 'session:waiting' });
    const onCompleted = (data: Omit<Extract<SessionStateEvent, { type: 'session:completed' }>, 'type'>) =>
      handler({ ...data, type: 'session:completed' });
    const onError = (data: Omit<Extract<SessionStateEvent, { type: 'session:error' }>, 'type'>) =>
      handler({ ...data, type: 'session:error' });
    const onInterrupted = (data: Omit<Extract<SessionStateEvent, { type: 'session:interrupted' }>, 'type'>) =>
      handler({ ...data, type: 'session:interrupted' });
    const onActivity = (data: Omit<Extract<SessionStateEvent, { type: 'session:activity' }>, 'type'>) =>
      handler({ ...data, type: 'session:activity' });

    // Listen to all event types
    this.on('session:started', onStarted);
    this.on('session:streaming', onStreaming);
    this.on('session:waiting', onWaiting);
    this.on('session:completed', onCompleted);
    this.on('session:error', onError);
    this.on('session:interrupted', onInterrupted);
    this.on('session:activity', onActivity);

    // Return unsubscribe function
    return () => {
      this.removeListener('session:started', onStarted);
      this.removeListener('session:streaming', onStreaming);
      this.removeListener('session:waiting', onWaiting);
      this.removeListener('session:completed', onCompleted);
      this.removeListener('session:error', onError);
      this.removeListener('session:interrupted', onInterrupted);
      this.removeListener('session:activity', onActivity);
    };
  }

  /**
   * Cleanup all active sessions on shutdown
   */
  async shutdown(): Promise<void> {
    const sessionIds = Array.from(this.activeSessions.keys());

    // Mark all active sessions as interrupted
    for (const sessionId of sessionIds) {
      await this.interruptSession(sessionId);
    }

    // Clear all timers
    for (const timer of this.activityUpdateTimers.values()) {
      clearTimeout(timer);
    }
    this.activityUpdateTimers.clear();

    // Clear state
    this.activeSessions.clear();
  }

  /**
   * Private: Recover stale sessions from database
   */
  private async recoverStaleSessions(): Promise<void> {
    if (!this.database) return;

    try {
      // Recover sessions that were 'running' -- the SDK subprocess is dead after restart,
      // so these are just idle now.
      const runningResult = await this.database.query(
        `SELECT id, last_activity FROM ai_sessions WHERE status = 'running'`,
        []
      );

      for (const row of runningResult.rows) {
        const sessionId = row.id;

        // Skip sessions that are actively tracked in memory (currently running this app session)
        if (this.activeSessions.has(sessionId)) {
          continue;
        }

        await this.updateDatabase(sessionId, 'idle');
        console.log(`[SessionStateManager] Marked running session as idle after restart: ${sessionId}`);
      }

      // Sessions with status 'waiting_for_input' are intentionally LEFT ALONE.
      // The user may still need to answer the question (even days/weeks later).
      // The durable prompt widgets will be restored from ai_agent_messages on load,
      // and answering will auto-resume the session via the answer handler.
      const waitingResult = await this.database.query(
        `SELECT id FROM ai_sessions WHERE status = 'waiting_for_input'`,
        []
      );
      if (waitingResult.rows.length > 0) {
        const ids = waitingResult.rows.map((r: any) => r.id);
        console.log(`[SessionStateManager] Preserved ${ids.length} session(s) waiting for input: ${ids.join(', ')}`);
      }
    } catch (error) {
      console.error('[SessionStateManager] Failed to recover stale sessions:', error);
    }
  }

  /**
   * Private: Update database with new status
   * Note: Only updates last_activity, NOT updated_at. The updated_at timestamp
   * should only change when messages are added to the session, so that session
   * history sorting accurately reflects when the last message was sent/received.
   */
  private async updateDatabase(sessionId: string, status: SessionStatus): Promise<void> {
    if (!this.database) return;

    try {
      await this.database.query(
        `UPDATE ai_sessions SET status = $1, last_activity = CURRENT_TIMESTAMP WHERE id = $2`,
        [status, sessionId]
      );
    } catch (error) {
      console.error(`[SessionStateManager] Failed to update database for session ${sessionId}:`, error);
    }
  }

  /**
   * Private: Update last_activity timestamp in database
   */
  private async updateLastActivity(sessionId: string): Promise<void> {
    if (!this.database) return;

    try {
      await this.database.query(
        `UPDATE ai_sessions SET last_activity = CURRENT_TIMESTAMP WHERE id = $1`,
        [sessionId]
      );
    } catch (error) {
      console.error(`[SessionStateManager] Failed to update last_activity for session ${sessionId}:`, error);
    }
  }

  /**
   * Private: Emit an event
   */
  private emitEvent(event: SessionStateEvent): void {
    this.emit(event.type, event);
  }
}

// Singleton instance
let instance: SessionStateManager | null = null;

export function getSessionStateManager(): SessionStateManager {
  if (!instance) {
    instance = new SessionStateManager();
  }
  return instance;
}

export function setSessionStateManager(manager: SessionStateManager): void {
  instance = manager;
}
