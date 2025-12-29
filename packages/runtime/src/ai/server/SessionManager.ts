/**
 * Session manager with injectable storage backend
 */

import { v4 as uuidv4 } from 'uuid';
import { AISessionsRepository } from '../../storage/repositories/AISessionsRepository';
import { AgentMessagesRepository } from '../../storage/repositories/AgentMessagesRepository';
import {
  getSessionStore,
  hasSessionStore,
  setSessionStore,
  type SessionStore,
  type UpdateSessionMetadataPayload,
} from '../adapters/sessionStore';
import { SessionData, Message, DocumentContext, AIProviderType } from './types';
import type { SessionData as ChatSession } from './types';
import { parseContextUsageMessage } from './utils/contextUsage';

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
    attachments: msg.attachments,
  };
}

function sessionDataFromChatSession(session: ChatSession, fallbackWorkspace: string): SessionData {
  const metadata = (session.metadata ?? {}) as Record<string, unknown>;
  const documentContext = metadata.documentContext as DocumentContext | undefined;
  const workspaceId = (metadata.workspaceId as string | undefined) ?? fallbackWorkspace;
  const providerConfig = metadata.providerConfig as SessionData['providerConfig'];
  // CRITICAL: providerSessionId is stored at top-level, not in metadata
  const providerSessionId = session.providerSessionId ?? (metadata.providerSessionId as string | undefined);

  // Read tokenUsage from metadata if present
  const tokenUsage = metadata.tokenUsage as SessionData['tokenUsage'] | undefined;

  return {
    id: session.id,
    provider: session.provider as AIProviderType,
    model: session.model ?? undefined,
    sessionType: session.sessionType,
    mode: session.mode,
    createdAt: toTimestampMillis(session.createdAt),
    updatedAt: toTimestampMillis(session.updatedAt),
    messages: session.messages.map(chatMessageFromServerMessage),
    documentContext,
    workspacePath: workspaceId,
    title: session.title ?? 'New conversation',
    draftInput: session.draftInput ?? undefined,
    providerConfig,
    providerSessionId,
    lastReadMessageTimestamp: session.lastReadMessageTimestamp ?? undefined,
    tokenUsage,
    metadata: session.metadata ?? {},
    isArchived: session.isArchived ?? false,
  } satisfies SessionData;
}

/**
 * Transform raw agent messages from database into UI-friendly format
 * This processes the raw input/output logs and reconstructs the conversation
 * Implements three-pass processing for sub-agent support:
 * 1. Build parent-child map from parent_tool_use_id
 * 2. Create all tool messages with sub-agent metadata
 * 3. Build hierarchy and filter out child tools from top-level
 */
export function transformAgentMessagesToUI(agentMessages: any[]): Message[] {
  const uiMessages: Message[] = [];
  const allToolMessages = new Map<string, Message>(); // Map tool ID -> Message
  const parentToolMap = new Map<string, string>(); // Map child tool ID -> parent tool ID

  // PASS 1: Build parent-child relationship map
  for (const agentMsg of agentMessages) {
    try {
      if (agentMsg.direction === 'output') {
        try {
          const parsed = JSON.parse(agentMsg.content);

          // Check for parent_tool_use_id which indicates this message contains sub-agent tools
          if (parsed.parent_tool_use_id && parsed.message?.content) {
            const parentToolId = parsed.parent_tool_use_id;
            const content = parsed.message.content;

            // Map all tool_use blocks in this message to the parent
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'tool_use' && block.id) {
                  parentToolMap.set(block.id, parentToolId);
                }
              }
            }
          }
        } catch (parseError) {
          // Not JSON or doesn't have the structure we're looking for
        }
      }
    } catch (error) {
      // Continue processing other messages
    }
  }

  // PASS 2: Process messages in order and create tool messages
  for (const agentMsg of agentMessages) {
    // Skip hidden messages - they shouldn't appear in UI
    if (agentMsg.hidden) {
      continue;
    }

    const timestamp = agentMsg.createdAt ? new Date(agentMsg.createdAt).getTime() : Date.now();

    try {
      // Handle different message types based on direction and content
      if (agentMsg.direction === 'input') {
        // Try to parse as JSON first (Claude Code format)
        try {
          const parsed = JSON.parse(agentMsg.content);
          if (parsed.prompt) {
            // Claude Code format: { prompt: "...", options: {...} }
            // Extract attachments from metadata if present
            const attachments = agentMsg.metadata?.attachments;
            uiMessages.push({
              role: 'user',
              content: parsed.prompt,
              timestamp,
              attachments: attachments && attachments.length > 0 ? attachments : undefined
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

              // Extract attachments from metadata if present
              const attachments = agentMsg.metadata?.attachments;
              uiMessages.push({
                role: msg.role || 'user',
                content: content,
                timestamp,
                attachments: attachments && attachments.length > 0 ? attachments : undefined
              });
            }
          }
        } catch (parseError) {
          // Not JSON - treat as raw text (regular Claude SDK format)
          // Extract attachments from metadata if present
          const attachments = agentMsg.metadata?.attachments;
          uiMessages.push({
            role: 'user',
            content: agentMsg.content,
            attachments: attachments && attachments.length > 0 ? attachments : undefined,
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
                  // Tool call - create tool message with sub-agent metadata
                  // Skip if we already have a tool with this ID (deduplication)
                  if (block.id && allToolMessages.has(block.id)) {
                    continue;
                  }

                  const isTaskAgent = block.name === 'Task';
                  const parentToolId = parentToolMap.get(block.id);

                  const toolMessage: Message = {
                    role: 'tool',
                    content: '',
                    timestamp,
                    toolCall: {
                      id: block.id,
                      name: block.name,
                      arguments: block.input || block.arguments,
                      isSubAgent: isTaskAgent,
                      subAgentType: isTaskAgent ? String(block.input?.subagent_type || block.arguments?.subagent_type || '') : undefined,
                      parentToolId: parentToolId,
                      childToolCalls: []
                    }
                  };

                  // Store in allToolMessages map for hierarchy building
                  if (block.id) {
                    allToolMessages.set(block.id, toolMessage);
                  }

                  // Add child tools to their parent's childToolCalls array immediately (streaming)
                  if (parentToolId) {
                    const parentMessage = allToolMessages.get(parentToolId);
                    if (parentMessage && parentMessage.toolCall?.childToolCalls) {
                      parentMessage.toolCall.childToolCalls.push(toolMessage);
                    }
                  } else {
                    // Only add to uiMessages if it's a top-level tool (no parent)
                    uiMessages.push(toolMessage);
                  }
                } else if (block.type === 'tool_result') {
                  // Tool result - find the corresponding tool_use message and add result
                  const toolUseId = block.tool_use_id || block.id;

                  // Look up the tool message in our map
                  const toolMsg = allToolMessages.get(toolUseId);
                  if (toolMsg && toolMsg.toolCall) {
                    toolMsg.toolCall.result = block.content;
                    if (block.is_error) {
                      toolMsg.isError = true;
                    }
                  } else {
                    // Fallback: search backwards in uiMessages (for backward compatibility)
                    for (let i = uiMessages.length - 1; i >= 0; i--) {
                      const msg = uiMessages[i];
                      if (msg.role === 'tool' && msg.toolCall && msg.toolCall.id === toolUseId) {
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
            }
          } else if (parsed.type === 'error' && parsed.error) {
            // Error message from SDK or API
            const errorContent = typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error);
            // Check for isAuthError from both parsed content and metadata
            const isAuthError = parsed.is_auth_error === true || agentMsg.metadata?.isAuthError === true;
            uiMessages.push({
              role: 'assistant',
              content: errorContent,
              timestamp,
              isError: true,
              isAuthError,
              errorMessage: errorContent
            });
          } else if (parsed.type === 'user' && parsed.message) {
            // Skip messages that have parent_tool_use_id - these are sub-agent metadata, not conversation messages
            if (parsed.parent_tool_use_id) {
              // This message is metadata for organizing sub-agent tools, skip it
              continue;
            }

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

  // PASS 3: Build parent-child hierarchy (safety fallback)
  // NOTE: Hierarchy is now built incrementally during streaming (PASS 2), so this
  // should only catch edge cases where a child was created before its parent.
  // We keep this for robustness.
  for (const toolMessage of allToolMessages.values()) {
    if (toolMessage.toolCall?.parentToolId) {
      const parentMessage = allToolMessages.get(toolMessage.toolCall.parentToolId);
      if (parentMessage && parentMessage.toolCall?.childToolCalls) {
        // Check if not already added during streaming
        const alreadyAdded = parentMessage.toolCall.childToolCalls.some(
          child => child.toolCall?.id === toolMessage.toolCall?.id
        );
        if (!alreadyAdded) {
          parentMessage.toolCall.childToolCalls.push(toolMessage);
        }
      }
    }
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

interface UpdateSessionTitleOptions {
  /**
   * Force-update the session title regardless of hasBeenNamed flag.
   * When true, the update skips the atomic guard used by the session naming tool.
   */
  force?: boolean;
  /**
   * Explicitly set the hasBeenNamed flag when force-updating a title.
   * Useful for provisional titles (false) or manual renames (true).
   */
  markAsNamed?: boolean;
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
    sessionType?: 'chat' | 'planning' | 'coding',
    mode?: 'planning' | 'agent'
  ): Promise<SessionData> {
    const sessionId = uuidv4();
    const workspace = workspacePath || documentContext?.filePath?.split('/').slice(0, -1).join('/') || 'default';

    await AISessionsRepository.create({
      id: sessionId,
      provider,
      model,
      sessionType,
      mode,
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
      mode,
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

    // Validate workspace ownership to prevent cross-workspace session loading
    // This prevents bugs where a session ID from one workspace could be loaded
    // in another workspace (e.g., if the tab state got corrupted)
    if (session.workspacePath && session.workspacePath !== workspace) {
      console.warn(
        `[SessionManager] Rejecting session ${sessionId}: belongs to ${session.workspacePath}, not ${workspace}`
      );
      return null;
    }

    // Fetch raw agent messages from the database (already filtered to exclude hidden messages)
    const agentMessages = await AgentMessagesRepository.list(sessionId);

    // Transform raw messages into UI format
    // Hidden messages are already filtered out in transformAgentMessagesToUI
    const uiMessages = transformAgentMessagesToUI(agentMessages);

    // Create session data with transformed messages
    // tokenUsage is read from metadata in sessionDataFromChatSession
    const normalized: ChatSession = {
      ...session,
      messages: uiMessages,
    };

    const sessionData = sessionDataFromChatSession(normalized, workspace);

    // Fallback: If no tokenUsage in metadata, try parsing from /context responses
    // This provides backwards compatibility for sessions created before tokenUsage was stored in metadata
    if (!sessionData.tokenUsage) {
      const allMessages = await AgentMessagesRepository.list(sessionId, { includeHidden: true });
      for (let i = allMessages.length - 1; i >= 0; i--) {
        const msg = allMessages[i];
        if (msg.direction === 'output' && msg.content?.includes('## Context Usage')) {
          const parsedUsage = parseContextUsageMessage(msg.content);
          if (parsedUsage) {
            sessionData.tokenUsage = {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: parsedUsage.totalTokens,
              contextWindow: parsedUsage.contextWindow,
              categories: parsedUsage.categories
            };
            break;
          }
        }
      }
    }

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

  async updateSessionTitle(sessionId: string, title: string, options?: UpdateSessionTitleOptions): Promise<void> {
    if (options?.force) {
      const metadata: UpdateSessionMetadataPayload = { title };
      if (options.markAsNamed !== undefined) {
        (metadata as any).hasBeenNamed = options.markAsNamed;
      }
      await AISessionsRepository.updateMetadata(sessionId, metadata);
    } else {
      const updated = await AISessionsRepository.updateTitleIfNotNamed(sessionId, title);
      if (!updated) {
        throw new Error('Session has already been named');
      }
    }
    if (this.currentSession?.id === sessionId) {
      const updatedSession: SessionData = { ...this.currentSession, title };
      if (options?.markAsNamed !== undefined) {
        updatedSession.hasBeenNamed = options.markAsNamed;
      } else if (!options?.force) {
        updatedSession.hasBeenNamed = true;
      }
      this.currentSession = updatedSession;
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

  /**
   * Update session token usage in metadata
   * This persists cumulative token usage for the session
   */
  async updateSessionTokenUsage(sessionId: string, tokenUsage: SessionData['tokenUsage']): Promise<void> {
    // Get current metadata and merge token usage into it
    const session = await AISessionsRepository.get(sessionId);
    const currentMetadata = (session?.metadata ?? {}) as Record<string, unknown>;

    await AISessionsRepository.updateMetadata(sessionId, {
      metadata: {
        ...currentMetadata,
        tokenUsage
      }
    });

    if (this.currentSession?.id === sessionId) {
      this.currentSession = {
        ...this.currentSession,
        tokenUsage,
        metadata: {
          ...(this.currentSession.metadata ?? {}),
          tokenUsage
        }
      };
    }
  }
}
