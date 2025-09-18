import type { ChatMessage, ChatSession } from '../types';

export interface SessionListItem {
  id: string;
  provider: string;
  model?: string;
  title?: string;
  workspaceId: string;
  updatedAt: number;
}

export interface CreateSessionPayload {
  id: string;
  provider: string;
  model?: string;
  title?: string;
  workspaceId: string;
  filePath?: string;
  providerConfig?: Record<string, unknown>;
  providerSessionId?: string;
  documentContext?: Record<string, unknown> | undefined;
}

export interface UpdateSessionMetadataPayload extends Partial<CreateSessionPayload> {
  draftInput?: string;
}

export interface SessionStore {
  ensureReady(): Promise<void>;
  create(payload: CreateSessionPayload): Promise<void>;
  appendMessage(sessionId: string, message: ChatMessage): Promise<void>;
  replaceMessages(sessionId: string, messages: ChatMessage[]): Promise<void>;
  updateMetadata(sessionId: string, metadata: UpdateSessionMetadataPayload): Promise<void>;
  get(sessionId: string): Promise<ChatSession | null>;
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