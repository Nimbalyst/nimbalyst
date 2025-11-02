/**
 * Session manager with injectable storage backend
 */

import { v4 as uuidv4 } from 'uuid';
import { AISessionsRepository } from '../../storage/repositories/AISessionsRepository';
import { AgentMessagesRepository } from '../../storage/repositories/AgentMessagesRepository';
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

/**
 * Transform raw agent messages from database into UI-friendly format
 * This processes the raw input/output logs and reconstructs the conversation
 */
function transformAgentMessagesToUI(agentMessages: any[]): Message[] {
  const uiMessages: Message[] = [];

  // Process messages in order
  for (const agentMsg of agentMessages) {
    const timestamp = agentMsg.createdAt ? new Date(agentMsg.createdAt).getTime() : Date.now();

    try {
      // Handle different message types based on direction and content
      if (agentMsg.direction === 'input') {
        // Try to parse as JSON first (Claude Code format)
        try {
          const parsed = JSON.parse(agentMsg.content);
          if (parsed.prompt) {
            // Claude Code format: { prompt: "...", options: {...} }
            uiMessages.push({
              role: 'user',
              content: parsed.prompt,
              timestamp
            });
          } else if (parsed.type === 'user' && parsed.message) {
            // Slash command format: { type: "user", message: { role: "user", content: "..." } }
            const msg = parsed.message;

            // Check if this is a tool result message (content is array with tool_result blocks)
            if (Array.isArray(msg.content) && msg.content.some((block: any) => block.type === 'tool_result')) {
              // This is a tool result - find the corresponding tool_use and add the result
              for (const block of msg.content) {
                if (block.type === 'tool_result') {
                  const toolUseId = block.tool_use_id;
                  let resultText = '';

                  if (Array.isArray(block.content)) {
                    for (const innerBlock of block.content) {
                      if (innerBlock.type === 'text' && innerBlock.text) {
                        resultText += innerBlock.text;
                      }
                    }
                  }

                  // Search backwards for the tool message with this ID
                  for (let i = uiMessages.length - 1; i >= 0; i--) {
                    const uiMsg = uiMessages[i];
                    if (uiMsg.role === 'tool' && uiMsg.toolCall && uiMsg.toolCall.id === toolUseId) {
                      // Add the result to this tool call
                      uiMsg.toolCall.result = resultText;
                      break;
                    }
                  }
                }
              }
            } else {
              // Regular user message with string content
              let content = typeof msg.content === 'string' ? msg.content : '';

              uiMessages.push({
                role: msg.role || 'user',
                content: content,
                timestamp
              });
            }
          }
        } catch (parseError) {
          // Not JSON - treat as raw text (regular Claude SDK format)
          uiMessages.push({
            role: 'user',
            content: agentMsg.content,
            timestamp
          });
        }
      } else if (agentMsg.direction === 'output') {
        // Try to parse as JSON
        try {
          const parsed = JSON.parse(agentMsg.content);

          if (parsed.type === 'text' && parsed.content !== undefined) {
            // Claude Code text chunk: { type: 'text', content: '...' }
            const lastMsg = uiMessages[uiMessages.length - 1];
            if (lastMsg && lastMsg.role === 'assistant' && !(lastMsg as any).isComplete) {
              lastMsg.content += parsed.content;
            } else {
              uiMessages.push({
                role: 'assistant',
                content: parsed.content,
                timestamp
              });
            }
          } else if (parsed.type === 'assistant' && parsed.message) {
            // Full assistant message with structured content
            if (Array.isArray(parsed.message.content)) {
              for (const block of parsed.message.content) {
                if (block.type === 'text') {
                  const lastMsg = uiMessages[uiMessages.length - 1];
                  if (lastMsg && lastMsg.role === 'assistant' && !(lastMsg as any).isComplete) {
                    lastMsg.content += block.text || '';
                  } else {
                    uiMessages.push({
                      role: 'assistant',
                      content: block.text || '',
                      timestamp
                    });
                  }
                } else if (block.type === 'tool_use') {
                  // Tool call - add as a tool message
                  uiMessages.push({
                    role: 'tool',
                    content: '',
                    timestamp,
                    toolCall: {
                      id: block.id,
                      name: block.name,
                      arguments: block.input || block.arguments
                    }
                  });
                } else if (block.type === 'tool_result') {
                  // Tool result - find the corresponding tool_use message and add result
                  const toolUseId = block.tool_use_id || block.id;

                  // Search backwards for the tool message with this ID
                  for (let i = uiMessages.length - 1; i >= 0; i--) {
                    const msg = uiMessages[i];
                    if (msg.role === 'tool' && msg.toolCall && msg.toolCall.id === toolUseId) {
                      // Add the result to this tool call
                      msg.toolCall.result = block.content;
                      if (block.is_error) {
                        msg.isError = true;
                      }
                      break;
                    }
                  }
                }
              }
            }
          } else if (parsed.type === 'error' && parsed.error) {
            // Error message from SDK or API
            uiMessages.push({
              role: 'assistant',
              content: typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error),
              timestamp,
              isError: true,
              errorMessage: typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error)
            });
          } else if (parsed.type === 'user' && parsed.message) {
            // Slash command format (output): { type: "user", message: { role: "user", content: "..." } }
            // Note: Sometimes slash command outputs are marked as "user" messages (e.g., local command stdout)
            const msg = parsed.message;

            // Check if this is a tool result message (content is array with tool_result blocks)
            if (Array.isArray(msg.content) && msg.content.some((block: any) => block.type === 'tool_result')) {
              // This is a tool result - find the corresponding tool_use and add the result
              for (const block of msg.content) {
                if (block.type === 'tool_result') {
                  const toolUseId = block.tool_use_id;
                  let resultText = '';

                  if (Array.isArray(block.content)) {
                    for (const innerBlock of block.content) {
                      if (innerBlock.type === 'text' && innerBlock.text) {
                        resultText += innerBlock.text;
                      }
                    }
                  }

                  // Search backwards for the tool message with this ID
                  for (let i = uiMessages.length - 1; i >= 0; i--) {
                    const uiMsg = uiMessages[i];
                    if (uiMsg.role === 'tool' && uiMsg.toolCall && uiMsg.toolCall.id === toolUseId) {
                      // Add the result to this tool call
                      uiMsg.toolCall.result = resultText;
                      break;
                    }
                  }
                }
              }
            } else {
              // Regular user/system message with string content
              let content = typeof msg.content === 'string' ? msg.content : '';

              // Extract content from <local-command-stdout> tags if present
              const stdoutMatch = content.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
              if (stdoutMatch && stdoutMatch[1]) {
                // Format as code block for command output with system response label
                content = '**System Response:**\n\n```\n' + stdoutMatch[1].trim() + '\n```';
              }

              uiMessages.push({
                role: msg.role || 'user',
                content: content,
                timestamp
              });
            }
          } else if (parsed.usage) {
            // This is metadata (usage stats), mark last message as complete
            const lastMsg = uiMessages[uiMessages.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              (lastMsg as any).isComplete = true;
            }
          }
        } catch (parseError) {
          // Not valid JSON - treat as raw text output (regular Claude SDK)
          // This is the final output from ClaudeProvider.logAgentMessage()
          const content = agentMsg.content;
          if (content && content.trim()) {
            const lastMsg = uiMessages[uiMessages.length - 1];
            if (lastMsg && lastMsg.role === 'assistant' && !(lastMsg as any).isComplete) {
              // Shouldn't happen with Claude SDK (logs complete messages), but handle it
              lastMsg.content += content;
              (lastMsg as any).isComplete = true;
            } else {
              // Create new complete assistant message
              uiMessages.push({
                role: 'assistant',
                content: content,
                timestamp
              });
              (uiMessages[uiMessages.length - 1] as any).isComplete = true;
            }
          }
        }
      }
    } catch (error) {
      console.warn('[SessionManager] Failed to process agent message:', error);
    }
  }

  // Mark the last message as complete if it's an assistant message and not already marked
  if (uiMessages.length > 0 && uiMessages[uiMessages.length - 1].role === 'assistant') {
    (uiMessages[uiMessages.length - 1] as any).isComplete = true;
  }

  return uiMessages;
}

async function fetchSessionsForWorkspace(workspace: string): Promise<SessionData[]> {
  const items = await AISessionsRepository.list(workspace);
  const sessions = await Promise.all(
    items.map(async item => {
      const session = await AISessionsRepository.get(item.id);
      if (!session) return null;

      // Fetch raw agent messages from the database
      const agentMessages = await AgentMessagesRepository.list(item.id);

      // Transform raw messages into UI format
      const uiMessages = transformAgentMessagesToUI(agentMessages);

      // Create session with transformed messages
      const normalized: ChatSession = {
        ...session,
        messages: uiMessages,
      };

      return sessionDataFromChatSession(normalized, workspace);
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

    // Fetch raw agent messages from the database
    const agentMessages = await AgentMessagesRepository.list(sessionId);

    // Transform raw messages into UI format
    const uiMessages = transformAgentMessagesToUI(agentMessages);

    // Create session data with transformed messages
    const normalized: ChatSession = {
      ...session,
      messages: uiMessages,
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

    // Messages are now stored in ai_agent_messages table via provider logAgentMessage()
    // Only update in-memory session state for backward compatibility
    if (this.currentSession?.id === targetId) {
      this.currentSession = {
        ...this.currentSession,
        messages: [...(this.currentSession.messages || []), chatMessageFromServerMessage(message)],
        updatedAt: Date.now(),
      };
    }
  }

  async updateSessionMessages(sessionId: string, messages: Message[], workspacePath?: string): Promise<boolean> {
    // Messages are now stored in ai_agent_messages table via provider logAgentMessage()
    // Only update in-memory session state for backward compatibility
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

  async updateSessionDraftInput(sessionId: string, draftInput: string): Promise<void> {
    await AISessionsRepository.updateMetadata(sessionId, { draftInput });
    if (this.currentSession?.id === sessionId) {
      this.currentSession = { ...this.currentSession, draftInput };
    }
  }
}
