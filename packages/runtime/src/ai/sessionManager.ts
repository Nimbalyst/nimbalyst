import { ChatMessage, ChatSession } from './types';

export interface SessionStorageAdapter {
  loadSessions(): Promise<Record<string, ChatSession>>;
  saveSessions(data: Record<string, ChatSession>): Promise<void>;
}

class MemoryStorageAdapter implements SessionStorageAdapter {
  private cache: Record<string, ChatSession> = {};
  async loadSessions(): Promise<Record<string, ChatSession>> {
    return { ...this.cache };
  }
  async saveSessions(data: Record<string, ChatSession>): Promise<void> {
    this.cache = { ...data };
  }
}

class LocalStorageAdapter implements SessionStorageAdapter {
  private key = 'stravu-runtime-ai-sessions-v1';
  async loadSessions(): Promise<Record<string, ChatSession>> {
    if (typeof window === 'undefined' || !window.localStorage) {
      return {};
    }
    try {
      const raw = window.localStorage.getItem(this.key);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, ChatSession>;
      }
    } catch (error) {
      console.warn('[runtime][SessionManager] Failed to load sessions from localStorage', error);
    }
    return {};
  }
  async saveSessions(data: Record<string, ChatSession>): Promise<void> {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    try {
      window.localStorage.setItem(this.key, JSON.stringify(data));
    } catch (error) {
      console.warn('[runtime][SessionManager] Failed to save sessions to localStorage', error);
    }
  }
}

function createDefaultAdapter(): SessionStorageAdapter {
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    return new LocalStorageAdapter();
  }
  return new MemoryStorageAdapter();
}

export interface CreateSessionOptions {
  id?: string;
  provider: string;
  model?: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

export class SessionManager {
  private sessions: Record<string, ChatSession> = {};
  private adapter: SessionStorageAdapter;
  private initialized = false;

  constructor(adapter: SessionStorageAdapter = createDefaultAdapter()) {
    this.adapter = adapter;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.sessions = await this.adapter.loadSessions();
    this.initialized = true;
  }

  list(): ChatSession[] {
    return Object.values(this.sessions).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(sessionId: string | null | undefined): ChatSession | null {
    if (!sessionId) return null;
    return this.sessions[sessionId] || null;
  }

  async create(options: CreateSessionOptions): Promise<ChatSession> {
    const now = Date.now();
    const session: ChatSession = {
      id: options.id || `session-${now}-${Math.random().toString(36).slice(2, 8)}`,
      provider: options.provider,
      model: options.model,
      title: options.title || 'New conversation',
      messages: [],
      createdAt: now,
      updatedAt: now,
      metadata: options.metadata,
    };
    this.sessions[session.id] = session;
    await this.persist();
    return session;
  }

  async delete(sessionId: string): Promise<void> {
    if (this.sessions[sessionId]) {
      delete this.sessions[sessionId];
      await this.persist();
    }
  }

  async updateDraft(sessionId: string, draft: string): Promise<void> {
    const session = this.sessions[sessionId];
    if (!session) return;
    session.draftInput = draft;
    session.updatedAt = Date.now();
    await this.persist();
  }

  async rename(sessionId: string, title: string): Promise<void> {
    const session = this.sessions[sessionId];
    if (!session) return;
    session.title = title;
    session.updatedAt = Date.now();
    await this.persist();
  }

  async addMessage(sessionId: string, message: ChatMessage): Promise<void> {
    const session = this.sessions[sessionId];
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    session.messages.push(message);
    session.updatedAt = Date.now();
    await this.persist();
  }

  async replaceMessages(sessionId: string, messages: ChatMessage[]): Promise<void> {
    const session = this.sessions[sessionId];
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    session.messages = messages;
    session.updatedAt = Date.now();
    await this.persist();
  }

  private async persist(): Promise<void> {
    await this.adapter.saveSessions(this.sessions);
  }
}

export const DefaultSessionManager = new SessionManager();
