/**
 * Session manager with injectable storage backend
 */

import { v4 as uuidv4 } from 'uuid';
import { AISessionsRepository } from '../../storage/repositories/AISessionsRepository';
import { getSessionStore, hasSessionStore, setSessionStore, type SessionStore } from '../adapters/sessionStore';
import { SessionData, Message, DocumentContext, AIProviderType } from './types';
import type { SessionData as ChatSession } from './types';

function toTimestampMillis(value: unknown): number {
  if (!value) return Date.now();
  if (typeof value === 'number') return value;
  const dt = new Date(value as any);
  const time = dt.getTime();
  return Number.isNaN(time) ? Date.now() : time;
}

function chatMessageFromServerMessage(msg: any): Message {
  return {
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp,
    edits: msg.edits,
    toolCall: (msg as any).toolCall,
    isError: msg.isError,
    errorMessage: msg.errorMessage,
    isStreamingStatus: msg.isStreamingStatus,
    streamingData: msg.streamingData,
  };
}

function sessionDataFromChatSession(session: ChatSession, fallbackWorkspace: string): SessionData {
  const metadata = (session.metadata ?? {}) as Record<string, unknown>;
  const documentContext = metadata.documentContext as DocumentContext | undefined;
  const workspaceId = (metadata.workspaceId as string | undefined) ?? fallbackWorkspace;
  const providerConfig = metadata.providerConfig as SessionData['providerConfig'];
  // CRITICAL: providerSessionId is stored at top-level, not in metadata
  const providerSessionId = session.providerSessionId ?? (metadata.providerSessionId as string | undefined);

  return {
    id: session.id,
    provider: session.provider as AIProviderType,
    model: session.model ?? undefined,
    sessionType: session.sessionType,
    createdAt: toTimestampMillis(session.createdAt),
    updatedAt: toTimestampMillis(session.updatedAt),
    messages: session.messages.map(chatMessageFromServerMessage),
    documentContext,
    workspacePath: workspaceId,
    title: session.title ?? 'New conversation',
    draftInput: session.draftInput ?? undefined,
    providerConfig,
    providerSessionId,
  } satisfies SessionData;
}

async function fetchSessionsForWorkspace(workspace: string): Promise<SessionData[]> {
  const items = await AISessionsRepository.list(workspace);
  const sessions = await Promise.all(
    items.map(async item => {
      const session = await AISessionsRepository.get(item.id);
      if (!session) return null;
      return sessionDataFromChatSession(session, workspace);
    })
  );

  return sessions.filter((session): session is SessionData => session !== null);
}

export class SessionManager {
  private currentSession: SessionData | null = null;
  private currentWorkspacePath: string | null = null;
  private readonly providedStore: SessionStore | null;

  constructor(store?: SessionStore) {
    this.providedStore = store ?? null;
    if (store) {
      setSessionStore(store);
    }
  }

  private resolveStore(): SessionStore | null {
    if (this.providedStore) return this.providedStore;
    if (hasSessionStore()) {
      try {
        return getSessionStore();
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.warn('[runtime][SessionManager] Failed to access configured session store', error);
        }
      }
    }
    return null;
  }

  cleanupAllSessions(): number {
    // PGlite stores canonical state; no cleanup required beyond removing empty messages on load
    // Return 0 to preserve existing behaviour
    return 0;
  }

  async initialize(): Promise<void> {
    const store = this.resolveStore();
    if (!store) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[runtime][SessionManager] initialize() called without a configured session store');
      }
      return;
    }
    try {
      await store.ensureReady();
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[runtime][SessionManager] Failed to ensure session store readiness', error);
      }
    }
  }

  async createSession(
    provider: AIProviderType,
    documentContext?: DocumentContext,
    workspacePath?: string,
    providerConfig?: any,
    model?: string,
    sessionType?: 'chat' | 'planning' | 'coding'
  ): Promise<SessionData> {
    const sessionId = uuidv4();
    const workspace = workspacePath || documentContext?.filePath?.split('/').slice(0, -1).join('/') || 'default';

    await AISessionsRepository.create({
      id: sessionId,
      provider,
      model,
      sessionType,
      workspaceId: workspace,
      filePath: documentContext?.filePath,
      title: 'New conversation',
      providerConfig,
      documentContext: documentContext ? { ...documentContext } : undefined,
    });

    const now = Date.now();
    const session: SessionData = {
      id: sessionId,
      provider,
      model,
      sessionType,
      createdAt: now,
      updatedAt: now,
      messages: [],
      documentContext,
      workspacePath: workspace,
      title: 'New conversation',
      providerConfig,
    };

    this.currentSession = session;
    this.currentWorkspacePath = workspace;
    return session;
  }

  async loadSession(sessionId: string, workspacePath?: string): Promise<SessionData | null> {
    const workspace = workspacePath || this.currentWorkspacePath || 'default';
    const session = await AISessionsRepository.get(sessionId);
    if (!session) {
      return null;
    }

    const cleanedMessages = session.messages.filter(msg => {
      if (!msg) return false;
      if ((msg as any).toolCall) return true;
      if ((msg as any).isStreamingStatus) return true;
      return Boolean(msg.content && msg.content.trim() !== '');
    });

    if (cleanedMessages.length !== session.messages.length) {
      await AISessionsRepository.replaceMessages(sessionId, cleanedMessages);
    }

    const normalized: ChatSession = {
      ...session,
      messages: cleanedMessages,
    };

    const sessionData = sessionDataFromChatSession(normalized, workspace);

    this.currentSession = sessionData;
    this.currentWorkspacePath = sessionData.workspacePath ?? workspace;
    return sessionData;
  }

  async getSessions(workspacePath?: string): Promise<SessionData[]> {
    const workspace = workspacePath || this.currentWorkspacePath || 'default';
    return fetchSessionsForWorkspace(workspace);
  }

  getCurrentSession(): SessionData | null {
    return this.currentSession;
  }

  clearCurrentSession(): void {
    this.currentSession = null;
  }

  async addMessage(message: Message, sessionId?: string): Promise<void> {
    const targetId = sessionId || this.currentSession?.id;
    if (!targetId) {
      throw new Error('No session ID provided and no current session loaded');
    }
    await AISessionsRepository.appendMessage(targetId, message);
    if (this.currentSession?.id === targetId) {
      this.currentSession = {
        ...this.currentSession,
        messages: [...(this.currentSession.messages || []), chatMessageFromServerMessage(message)],
        updatedAt: Date.now(),
      };
    }
  }

  async updateSessionMessages(sessionId: string, messages: Message[], workspacePath?: string): Promise<boolean> {
    await AISessionsRepository.replaceMessages(sessionId, messages);
    if (this.currentSession?.id === sessionId) {
      this.currentSession = {
        ...this.currentSession,
        messages: messages.map(chatMessageFromServerMessage),
        updatedAt: Date.now(),
      };
    }
    return true;
  }

  async saveDraftInput(sessionId: string, draftInput: string, workspacePath?: string): Promise<boolean> {
    await AISessionsRepository.updateMetadata(sessionId, { draftInput });
    if (this.currentSession?.id === sessionId) {
      this.currentSession = { ...this.currentSession, draftInput };
    }
    return true;
  }

  async deleteSession(sessionId: string, workspacePath?: string): Promise<boolean> {
    await AISessionsRepository.delete(sessionId);
    if (this.currentSession?.id === sessionId) {
      this.currentSession = null;
    }
    return true;
  }

  async updateProviderSessionData(sessionId: string, providerSessionId?: string): Promise<void> {
    await AISessionsRepository.updateMetadata(sessionId, { providerSessionId });
    if (this.currentSession?.id === sessionId) {
      this.currentSession = { ...this.currentSession, providerSessionId };
    }
  }

  async updateSessionTitle(sessionId: string, title: string): Promise<void> {
    await AISessionsRepository.updateMetadata(sessionId, { title });
    if (this.currentSession?.id === sessionId) {
      this.currentSession = { ...this.currentSession, title };
    }
  }

  async updateSessionModel(sessionId: string, model: string): Promise<void> {
    console.log(`[SessionManager] updateSessionModel called: sessionId=${sessionId}, model=${model}`);
    await AISessionsRepository.updateMetadata(sessionId, { model });
    console.log(`[SessionManager] Database updated with new model`);
    if (this.currentSession?.id === sessionId) {
      console.log(`[SessionManager] Updating current session model from ${this.currentSession.model} to ${model}`);
      this.currentSession = { ...this.currentSession, model };
    }
  }

  async updateSessionProviderAndModel(sessionId: string, provider: string, model: string): Promise<void> {
    console.log(`[SessionManager] updateSessionProviderAndModel called: sessionId=${sessionId}, provider=${provider}, model=${model}`);
    await AISessionsRepository.updateMetadata(sessionId, {
      provider,
      model
    });
    console.log(`[SessionManager] Database updated with new provider and model`);
    if (this.currentSession?.id === sessionId) {
      console.log(`[SessionManager] Updating current session: provider ${this.currentSession.provider} -> ${provider}, model ${this.currentSession.model} -> ${model}`);
      this.currentSession = {
        ...this.currentSession,
        provider: provider as AIProviderType,
        model
      };
    }
  }
}
