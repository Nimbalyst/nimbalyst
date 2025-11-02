import type { Message, SessionData } from '../server/types';

// Type aliases for compatibility
export type ChatMessage = Message;
export type ChatSession = SessionData;

export interface SessionListItem {
  id: string;
  provider: string;
  model?: string;
  title?: string;
  sessionType?: string;
  workspaceId: string;
  createdAt: number;
  updatedAt: number;
  messageCount?: number;
}

export interface CreateSessionPayload {
  id: string;
  provider: string;
  model?: string;
  sessionType?: 'chat' | 'planning' | 'coding';
  title?: string;
  workspaceId: string;
  filePath?: string;
  providerConfig?: Record<string, unknown>;
  providerSessionId?: string;
  documentContext?: Record<string, unknown> | undefined;
}

export interface UpdateSessionMetadataPayload extends Partial<CreateSessionPayload> {
  draftInput?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionStore {
  ensureReady(): Promise<void>;
  create(payload: CreateSessionPayload): Promise<void>;
  updateMetadata(sessionId: string, metadata: UpdateSessionMetadataPayload): Promise<void>;
  get(sessionId: string): Promise<SessionData | null>;
  list(workspaceId: string): Promise<SessionListItem[]>;
  delete(sessionId: string): Promise<void>;
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