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
  createdAt: number;
  updatedAt: number;
  messageCount?: number;
  isArchived?: boolean;
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
  providerConfig?: Record<string, unknown>;
  providerSessionId?: string;
  documentContext?: Record<string, unknown> | undefined;
  createdAt?: number; // Optional override for imported sessions
  updatedAt?: number; // Optional override for imported sessions
}

export interface UpdateSessionMetadataPayload extends Partial<CreateSessionPayload> {
  draftInput?: string;
  metadata?: Record<string, unknown>;
  isArchived?: boolean;
}

export interface SessionListOptions {
  includeArchived?: boolean;
}

export interface SessionStore {
  ensureReady(): Promise<void>;
  create(payload: CreateSessionPayload): Promise<void>;
  updateMetadata(sessionId: string, metadata: UpdateSessionMetadataPayload): Promise<void>;
  get(sessionId: string): Promise<SessionData | null>;
  list(workspaceId: string, options?: SessionListOptions): Promise<SessionListItem[]>;
  search(workspaceId: string, query: string, options?: SessionListOptions): Promise<SessionListItem[]>;
  delete(sessionId: string): Promise<void>;
  /**
   * Atomically update session title if it has not been named yet.
   * Returns true if the update succeeded, false if the session was already named.
   */
  updateTitleIfNotNamed?(sessionId: string, title: string): Promise<boolean>;
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