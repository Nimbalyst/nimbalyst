import type { Message, SessionData, SessionMode } from '../server/types';

// Type aliases for compatibility
export type ChatMessage = Message;
export type ChatSession = SessionData;

export interface SessionListItem {
  id: string;
  provider: string;
  model?: string;
  title?: string;
  sessionType?: string;
  mode?: SessionMode;
  workspaceId: string;
  worktreeId?: string;  // ID of the associated worktree if this is a worktree session
  parentSessionId?: string | null;  // Parent session ID for hierarchical workstreams
  childCount?: number;  // Number of child sessions (0 for leaf sessions)
  createdAt: number;
  updatedAt: number;
  messageCount?: number;
  isArchived?: boolean;
  isPinned?: boolean;  // Whether this session is pinned to the top of the list
  hasUnread?: boolean;  // Whether this session has unread messages (from metadata, for cross-device sync)
  // Branch tracking - SEPARATE from hierarchical parentSessionId
  branchedFromSessionId?: string;  // ID of the session this was forked from
  branchPointMessageId?: number;  // Message ID where this branch diverged
  branchedAt?: number;  // Timestamp when the branch was created
}

export interface CreateSessionPayload {
  id: string;
  provider: string;
  model?: string;
  sessionType?: 'chat' | 'planning' | 'coding' | 'terminal';
  mode?: SessionMode;
  title?: string;
  workspaceId: string;
  filePath?: string;
  worktreeId?: string;  // ID of the associated worktree
  worktreePath?: string;  // Path to the worktree directory
  worktreeProjectPath?: string;  // Path to the parent project (for permission lookups)
  parentSessionId?: string | null;  // Parent session ID for hierarchical workstreams
  providerConfig?: Record<string, unknown>;
  providerSessionId?: string;
  documentContext?: Record<string, unknown> | undefined;
  createdAt?: number; // Optional override for imported sessions
  updatedAt?: number; // Optional override for imported sessions
  // Branch tracking - SEPARATE from hierarchical parentSessionId
  branchedFromSessionId?: string;  // ID of the session this was forked from
  branchPointMessageId?: number;  // Message ID where this branch diverged
  branchedAt?: number;  // Timestamp when the branch was created
}

export interface UpdateSessionMetadataPayload extends Partial<CreateSessionPayload> {
  draftInput?: string;
  metadata?: Record<string, unknown>;
  isArchived?: boolean;
}

export interface SessionListOptions {
  includeArchived?: boolean;
}

export interface SessionSearchOptions extends SessionListOptions {
  timeRange?: '7d' | '30d' | '90d' | 'all';
  direction?: 'all' | 'input' | 'output';
}

export interface SessionStore {
  ensureReady(): Promise<void>;
  create(payload: CreateSessionPayload): Promise<void>;
  updateMetadata(sessionId: string, metadata: UpdateSessionMetadataPayload): Promise<void>;
  get(sessionId: string): Promise<SessionData | null>;
  /**
   * Batch fetch multiple sessions by IDs.
   * More efficient than calling get() multiple times.
   * Returns sessions in arbitrary order (not necessarily matching input order).
   */
  getMany?(sessionIds: string[]): Promise<SessionData[]>;
  list(workspaceId: string, options?: SessionListOptions): Promise<SessionListItem[]>;
  search(workspaceId: string, query: string, options?: SessionSearchOptions): Promise<SessionListItem[]>;
  delete(sessionId: string): Promise<void>;
  /**
   * Atomically update session title if it has not been named yet.
   * Returns true if the update succeeded, false if the session was already named.
   */
  updateTitleIfNotNamed?(sessionId: string, title: string): Promise<boolean>;
  /**
   * Get all branches for a given session.
   * Returns sessions that have this session as their parent.
   */
  getBranches?(sessionId: string): Promise<SessionListItem[]>;
}

let activeSessionStore: SessionStore | null = null;

export function setSessionStore(store: SessionStore | null): void {
  activeSessionStore = store;
}

export function hasSessionStore(): boolean {
  return activeSessionStore !== null;
}

export function getSessionStore(): SessionStore {
  if (!activeSessionStore) {
    throw new Error('Session store adapter has not been configured');
  }
  return activeSessionStore;
}