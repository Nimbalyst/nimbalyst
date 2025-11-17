import { describe, it, expect, beforeEach } from 'vitest';
import { SessionManager } from '../SessionManager';
import type {
  SessionStore,
  CreateSessionPayload,
  SessionListItem,
  UpdateSessionMetadataPayload,
} from '../../adapters/sessionStore';
import type { Message, SessionData } from '../types';

class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, SessionData>();

  async ensureReady(): Promise<void> {}

  async create(payload: CreateSessionPayload): Promise<void> {
    const now = Date.now();
    this.sessions.set(payload.id, {
      id: payload.id,
      provider: payload.provider,
      model: payload.model,
      title: payload.title,
      draftInput: undefined,
      messages: [],
      createdAt: now,
      updatedAt: now,
      metadata: {
        workspaceId: payload.workspaceId,
        filePath: payload.filePath,
        documentContext: payload.documentContext,
        providerConfig: payload.providerConfig,
        providerSessionId: payload.providerSessionId,
      },
    });
  }

  async appendMessage(sessionId: string, message: Message): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');
    session.messages.push(message);
    session.updatedAt = Date.now();
  }

  async replaceMessages(sessionId: string, messages: Message[]): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');
    session.messages = [...messages];
    session.updatedAt = Date.now();
  }

  async updateMetadata(sessionId: string, metadata: UpdateSessionMetadataPayload): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');
    session.metadata = {
      ...(session.metadata ?? {}),
      ...metadata,
    } as SessionData['metadata'];
    if (metadata.draftInput !== undefined) {
      session.draftInput = metadata.draftInput;
    }
    session.updatedAt = Date.now();
  }

  async get(sessionId: string): Promise<SessionData | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async list(workspaceId: string): Promise<SessionListItem[]> {
    return [...this.sessions.values()]
      .filter(session => (session.metadata as any)?.workspaceId === workspaceId)
      .map(session => ({
        id: session.id,
        provider: session.provider,
        model: session.model,
        title: session.title,
        workspaceId: (session.metadata as any)?.workspaceId,
        createdAt: session.createdAt || 0,
        updatedAt: session.updatedAt || 0,
      }))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  async search(workspaceId: string, query: string): Promise<SessionListItem[]> {
    // Simple in-memory search for testing
    if (!query || query.trim().length === 0) {
      return this.list(workspaceId);
    }

    const lowerQuery = query.toLowerCase();
    return [...this.sessions.values()]
      .filter(session => {
        if ((session.metadata as any)?.workspaceId !== workspaceId) {
          return false;
        }
        // Search in title
        if (session.title?.toLowerCase().includes(lowerQuery)) {
          return true;
        }
        // Search in messages
        return session.messages.some(msg => {
          const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
          return content.toLowerCase().includes(lowerQuery);
        });
      })
      .map(session => ({
        id: session.id,
        provider: session.provider,
        model: session.model,
        title: session.title,
        workspaceId: (session.metadata as any)?.workspaceId,
        createdAt: session.createdAt || 0,
        updatedAt: session.updatedAt || 0,
      }))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}

describe('SessionManager (runtime server)', () => {
  let store: InMemorySessionStore;
  let manager: SessionManager;

  beforeEach(async () => {
    store = new InMemorySessionStore();
    manager = new SessionManager(store);
    await manager.initialize();
  });

  it('returns persisted tool messages when listing sessions', async () => {
    const session = await manager.createSession('claude-code', { content: 'text' }, 'ws');

    await manager.addMessage({ role: 'user', content: 'hello', timestamp: Date.now() }, session.id);
    await manager.addMessage({
      role: 'tool',
      content: '',
      timestamp: Date.now(),
      toolCall: {
        name: 'applyDiff',
        arguments: { replacements: [{ oldText: 'a', newText: 'b' }] },
        result: { success: true },
      },
    }, session.id);

    const sessions = await manager.getSessions('ws');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].messages.some(msg => msg.toolCall?.name === 'applyDiff')).toBe(true);
  });

  it('loads persisted sessions including tool messages after a new manager is created', async () => {
    const session = await manager.createSession('claude-code', { content: 'text' }, 'ws');
    await manager.addMessage({ role: 'user', content: 'hello', timestamp: Date.now() }, session.id);
    await manager.addMessage({
      role: 'tool',
      content: '',
      timestamp: Date.now(),
      toolCall: {
        name: 'applyDiff',
        arguments: { replacements: [] },
        result: { success: true },
      },
    }, session.id);

    const newManager = new SessionManager(store);
    await newManager.initialize();
    const loaded = await newManager.loadSession(session.id, 'ws');
    expect(loaded).not.toBeNull();
    expect(loaded?.messages.some(msg => msg.toolCall?.name === 'applyDiff')).toBe(true);
  });

});
