import type { Message, SessionData } from '../../ai/server/types';
import {
  type CreateSessionPayload,
  type SessionListItem,
  type SessionStore,
  type UpdateSessionMetadataPayload,
  getSessionStore,
  hasSessionStore,
  setSessionStore,
} from '../../ai/adapters/sessionStore';

function requireStore(): SessionStore {
  if (!hasSessionStore()) {
    throw new Error('Session store adapter has not been provided to the runtime');
  }
  return getSessionStore();
}

export const AISessionsRepository = {
  setStore(store: SessionStore): void {
    setSessionStore(store);
  },

  registerStore(store: SessionStore): void {
    setSessionStore(store);
  },

  clearStore(): void {
    setSessionStore(null);
  },

  getStore(): SessionStore {
    return requireStore();
  },

  async ensureReady(): Promise<void> {
    await requireStore().ensureReady();
  },

  async create(payload: CreateSessionPayload): Promise<void> {
    await requireStore().create(payload);
  },

  async appendMessage(sessionId: string, message: Message): Promise<void> {
    await requireStore().appendMessage(sessionId, message);
  },

  async replaceMessages(sessionId: string, messages: Message[]): Promise<void> {
    await requireStore().replaceMessages(sessionId, messages);
  },

  async updateMetadata(sessionId: string, metadata: UpdateSessionMetadataPayload): Promise<void> {
    await requireStore().updateMetadata(sessionId, metadata);
  },

  async get(sessionId: string): Promise<SessionData | null> {
    return await requireStore().get(sessionId);
  },

  async list(workspaceId: string): Promise<SessionListItem[]> {
    return await requireStore().list(workspaceId);
  },

  async delete(sessionId: string): Promise<void> {
    await requireStore().delete(sessionId);
  },
};

export type {
  CreateSessionPayload,
  SessionListItem,
  UpdateSessionMetadataPayload,
};
