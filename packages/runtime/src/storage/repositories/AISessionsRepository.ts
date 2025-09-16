import { DefaultSessionManager, SessionManager } from '../../ai/sessionManager';
import type { ChatMessage, ChatSession } from '../../ai/types';

function ensureInitialized(manager: SessionManager): Promise<void> {
  return manager.initialize().catch(() => Promise.resolve());
}

export const AISessionsRepository = {
  async create(id: string, provider: string, model: string): Promise<void> {
    await ensureInitialized(DefaultSessionManager);
    const existing = DefaultSessionManager.get(id);
    if (existing) return;
    await DefaultSessionManager.create({ id, provider, model });
  },
  async appendMessage(id: string, msg: ChatMessage): Promise<void> {
    await ensureInitialized(DefaultSessionManager);
    await DefaultSessionManager.addMessage(id, msg);
  },
  async get(id: string): Promise<ChatSession | null> {
    await ensureInitialized(DefaultSessionManager);
    return DefaultSessionManager.get(id);
  },
  async list(): Promise<{ id: string; provider: string; model?: string; updatedAt: number }[]> {
    await ensureInitialized(DefaultSessionManager);
    return DefaultSessionManager.list().map(session => ({
      id: session.id,
      provider: session.provider,
      model: session.model,
      updatedAt: session.updatedAt
    }));
  },
  async delete(id: string): Promise<void> {
    await ensureInitialized(DefaultSessionManager);
    await DefaultSessionManager.delete(id);
  }
};
