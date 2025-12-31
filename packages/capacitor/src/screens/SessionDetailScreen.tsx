import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSync } from '../contexts/CollabV3SyncContext';
import { getSessionJwt } from '../services/StytchAuthService';
import { AgentTranscriptPanel, transformAgentMessagesToUI, PromptsMenuButton } from '@nimbalyst/runtime';
import { AIInput, InteractivePromptWidget } from '@nimbalyst/runtime/ui';
import type { SessionData, ChatAttachment, PromptMarker } from '@nimbalyst/runtime';
import type {
  PermissionRequestContent,
  PermissionResponseContent,
  AskUserQuestionRequestContent,
  AskUserQuestionResponseContent,
  InteractivePromptContent,
} from '@nimbalyst/runtime';
import forge from 'node-forge';

/**
 * CollabV3 Message Types
 */

interface EncryptedMessage {
  id: string;
  sequence: number;
  created_at: number;
  source: 'user' | 'assistant' | 'tool' | 'system';
  direction: 'input' | 'output';
  encrypted_content: string;
  iv: string;
  metadata: {
    tool_name?: string;
    has_attachments?: boolean;
    content_length?: number;
  };
}

// Wire protocol type for session metadata (snake_case to match server)
interface WireSessionMetadata {
  title: string;
  provider: string;
  model?: string;
  mode?: 'agent' | 'planning';
  project_id: string;
  created_at: number;
  updated_at: number;
  pendingExecution?: {
    messageId: string;
    sentAt: number;
    sentBy: 'mobile' | 'desktop';
  };
  isExecuting?: boolean;
  queuedPrompts?: Array<{
    id: string;
    prompt: string;
    timestamp: number;
  }>;
}

interface SyncedMessage {
  id: string;
  createdAt: number;
  source: string;
  direction: 'input' | 'output';
  content: string;
  metadata?: Record<string, unknown>;
  hidden?: boolean;
}

type ClientMessage =
  | { type: 'sync_request'; since_id?: string; since_seq?: number }
  | { type: 'append_message'; message: EncryptedMessage }
  | { type: 'update_metadata'; metadata: Partial<WireSessionMetadata> };

type ServerMessage =
  | {
      type: 'sync_response';
      messages: EncryptedMessage[];
      metadata: WireSessionMetadata | null;
      has_more: boolean;
      cursor: string | null;
    }
  | {
      type: 'message_broadcast';
      message: EncryptedMessage;
      from_connection_id?: string;
    }
  | {
      type: 'metadata_broadcast';
      metadata: Partial<WireSessionMetadata>;
      from_connection_id?: string;
    }
  | { type: 'error'; code: string; message: string };

// ============================================================================
// Base64 Utilities (handles large byte arrays)
// ============================================================================

/**
 * Convert Uint8Array to base64 string.
 * Uses chunked approach to avoid call stack size limits with large arrays.
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  // For small arrays, use simple approach
  if (bytes.length < 1024) {
    return btoa(String.fromCharCode(...bytes));
  }

  // For large arrays, chunk to avoid stack overflow
  const CHUNK_SIZE = 8192;
  let result = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
    result += String.fromCharCode(...chunk);
  }
  return btoa(result);
}

/**
 * Convert base64 string to Uint8Array.
 * Returns a Uint8Array backed by an ArrayBuffer (not SharedArrayBuffer).
 */
function base64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ============================================================================
// Encryption Utilities (using node-forge for mobile compatibility)
// ============================================================================

// Key type for forge-based encryption
type ForgeKey = string; // Raw key bytes as binary string

/**
 * Derive encryption key from passphrase using PBKDF2
 * Returns raw key bytes as a binary string (compatible with forge)
 */
async function deriveEncryptionKey(passphrase: string, salt: string): Promise<ForgeKey> {
  // Use forge's PBKDF2 - returns binary string
  const key = forge.pkcs5.pbkdf2(passphrase, salt, 100000, 32, 'sha256');
  return key;
}

/**
 * Encrypt content for sending using AES-GCM
 */
async function encrypt(
  content: string,
  key: ForgeKey
): Promise<{ encrypted: string; iv: string }> {
  // Generate random IV (12 bytes for GCM)
  const iv = forge.random.getBytesSync(12);

  // Create cipher
  const cipher = forge.cipher.createCipher('AES-GCM', key);
  cipher.start({ iv, tagLength: 128 });
  cipher.update(forge.util.createBuffer(content, 'utf8'));
  cipher.finish();

  // Get encrypted data and auth tag
  const encrypted = cipher.output.getBytes();
  const tag = cipher.mode.tag.getBytes();

  // Combine encrypted + tag (this is how Web Crypto API returns it)
  const combined = encrypted + tag;

  return {
    encrypted: forge.util.encode64(combined),
    iv: forge.util.encode64(iv),
  };
}

/**
 * Decrypt content from server using AES-GCM
 */
async function decrypt(encrypted: string, iv: string, key: ForgeKey): Promise<string> {
  const encryptedBytes = forge.util.decode64(encrypted);
  const ivBytes = forge.util.decode64(iv);

  // Split encrypted data and tag (tag is last 16 bytes)
  const tagLength = 16;
  const ciphertext = encryptedBytes.slice(0, -tagLength);
  const tag = encryptedBytes.slice(-tagLength);

  // Create decipher
  const decipher = forge.cipher.createDecipher('AES-GCM', key);
  decipher.start({
    iv: ivBytes,
    tagLength: 128,
    tag: forge.util.createBuffer(tag),
  });
  decipher.update(forge.util.createBuffer(ciphertext));

  const success = decipher.finish();
  if (!success) {
    throw new Error('Decryption failed - authentication tag mismatch');
  }

  // Cast to any because forge types don't expose the encoding parameter
  return (decipher.output as { toString(encoding: string): string }).toString('utf8');
}

interface SessionDetailScreenProps {
  hiddenBackButton?: boolean;
}

export function SessionDetailScreen({ hiddenBackButton }: SessionDetailScreenProps) {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId: string }>();
  const { config, sendIndexUpdate, sessions, sendSessionControlMessage } = useSync();

  const [messages, setMessages] = useState<SyncedMessage[]>([]);
  const [metadata, setMetadata] = useState<Partial<WireSessionMetadata>>({});
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Input state
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);

  // Interactive prompt state
  const [isSubmittingPrompt, setIsSubmittingPrompt] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const encryptionKeyRef = useRef<ForgeKey | null>(null);
  const lastSequenceRef = useRef<number>(0);

  // Track if initial sync is complete to avoid re-renders during sync
  const isSyncingRef = useRef(false);
  // Buffer for batching paginated sync responses
  const pendingMessagesRef = useRef<SyncedMessage[]>([]);
  // Ref to hold latest handleServerMessage so WebSocket handler doesn't need it as dep
  const handleServerMessageRef = useRef<((data: string) => Promise<void>) | null>(null);

  // Reset state when sessionId changes
  useEffect(() => {
    setMessages([]);
    setMetadata({});
    setError(null);
    lastSequenceRef.current = 0;
    pendingMessagesRef.current = [];
    isSyncingRef.current = false;
  }, [sessionId]);

  // Decrypt a message
  const decryptMessage = useCallback(
    async (encrypted: EncryptedMessage): Promise<SyncedMessage | null> => {
      if (!encryptionKeyRef.current) {
        console.error('[SessionDetail] No encryption key');
        return null;
      }

      try {
        const decrypted = await decrypt(
          encrypted.encrypted_content,
          encrypted.iv,
          encryptionKeyRef.current
        );
        const parsed = JSON.parse(decrypted);

        return {
          id: encrypted.id,
          createdAt: encrypted.created_at,
          source: encrypted.source,
          direction: encrypted.direction,
          content: parsed.content,
          metadata: parsed.metadata,
          hidden: parsed.hidden ?? false,
        };
      } catch (err) {
        console.error('[SessionDetail] Failed to decrypt message:', err);
        return null;
      }
    },
    []
  );

  // Handle incoming server messages
  const handleServerMessage = useCallback(
    async (data: string) => {
      try {
        const message: ServerMessage = JSON.parse(data);

        switch (message.type) {
          case 'sync_response': {
            // Decrypt all messages
            const decrypted: SyncedMessage[] = [];
            for (const encrypted of message.messages) {
              const msg = await decryptMessage(encrypted);
              if (msg) {
                decrypted.push(msg);
                lastSequenceRef.current = Math.max(lastSequenceRef.current, encrypted.sequence);
              }
            }

            // Buffer messages during paginated sync
            if (message.has_more) {
              // More pages coming - buffer these messages
              isSyncingRef.current = true;
              pendingMessagesRef.current = [...pendingMessagesRef.current, ...decrypted];

              // Store metadata for later
              if (message.metadata) {
                setMetadata(message.metadata);
              }

              // Request next page
              if (message.cursor && wsRef.current) {
                const nextRequest: ClientMessage = {
                  type: 'sync_request',
                  since_seq: parseInt(message.cursor, 10),
                };
                wsRef.current.send(JSON.stringify(nextRequest));
              }
            } else {
              // Final page - commit all buffered messages at once
              isSyncingRef.current = false;
              const allDecrypted = [...pendingMessagesRef.current, ...decrypted];
              pendingMessagesRef.current = [];

              setMessages((prev) => {
                // Merge with existing (avoid duplicates)
                const existing = new Set(prev.map((m) => m.id));
                const newMsgs = allDecrypted.filter((m) => !existing.has(m.id));
                return [...prev, ...newMsgs].sort((a, b) => a.createdAt - b.createdAt);
              });

              if (message.metadata) {
                setMetadata(message.metadata);
              }
            }
            break;
          }

          case 'message_broadcast': {
            const msg = await decryptMessage(message.message);
            if (msg) {
              lastSequenceRef.current = Math.max(
                lastSequenceRef.current,
                message.message.sequence
              );
              setMessages((prev) => {
                // Avoid duplicates
                if (prev.some((m) => m.id === msg.id)) {
                  return prev;
                }
                return [...prev, msg].sort((a, b) => a.createdAt - b.createdAt);
              });
            }
            break;
          }

          case 'metadata_broadcast': {
            setMetadata((prev) => ({ ...prev, ...message.metadata }));
            break;
          }

          case 'error': {
            console.error('[SessionDetail] Server error:', message.code, message.message);
            setError(message.message);
            break;
          }
        }
      } catch (err) {
        console.error('[SessionDetail] Failed to handle message:', err);
      }
    },
    [decryptMessage]
  );

  // Keep ref updated with latest handler (avoids reconnecting when handler changes)
  useEffect(() => {
    handleServerMessageRef.current = handleServerMessage;
  }, [handleServerMessage]);

  // Connect to SessionRoom
  useEffect(() => {
    if (!config || !sessionId) {
      setError('Missing configuration or session ID');
      return;
    }

    let ws: WebSocket | null = null;
    let cancelled = false;

    const connect = async () => {
      // Derive encryption key
      const passphrase = config.encryptionPassphrase || config.userId;
      encryptionKeyRef.current = await deriveEncryptionKey(
        passphrase,
        `nimbalyst:${config.userId}`
      );

      if (cancelled) return;

      // Get a fresh JWT (auto-refreshes if stale) instead of using potentially expired config.authToken
      const freshToken = await getSessionJwt(config.serverUrl);
      if (!freshToken) {
        setError('Failed to get authentication token');
        return;
      }

      if (cancelled) return;

      // Build WebSocket URL
      const baseUrl = config.serverUrl.replace(/\/$/, '');
      const wsBase = baseUrl.replace(/^http/, 'ws');
      const roomId = `user:${config.userId}:session:${sessionId}`;
      const wsUrl = `${wsBase}/sync/${roomId}?user_id=${config.userId}&token=${freshToken}`;

      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        setConnected(true);
        setError(null);

        // Request initial sync
        const syncRequest: ClientMessage = { type: 'sync_request' };
        ws?.send(JSON.stringify(syncRequest));
      };

      ws.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        wsRef.current = null;
      };

      ws.onerror = () => {
        if (cancelled) return;
        setError('Connection error');
        setConnected(false);
      };

      ws.onmessage = (event) => {
        // Use ref to get latest handler without causing reconnects
        handleServerMessageRef.current?.(event.data);
      };
    };

    connect().catch(err => {
      if (!cancelled) {
        setError(`Connection failed: ${err.message || err}`);
      }
    });

    return () => {
      cancelled = true;
      if (ws) {
        ws.close();
      }
      wsRef.current = null;
    };
  }, [config, sessionId]);

  // Convert synced messages to SessionData format
  const sessionData = useMemo((): SessionData => {
    // Use the same transformation function that the desktop app uses
    const convertedMessages = transformAgentMessagesToUI(messages);

    // Determine session status for "Thinking..." indicator
    // isExecuting means the desktop is currently processing
    // queuedPrompts means we have prompts waiting for desktop to process
    let sessionStatus: string | undefined;
    if (metadata.isExecuting) {
      sessionStatus = 'running';
    } else if (metadata.queuedPrompts && metadata.queuedPrompts.length > 0) {
      sessionStatus = 'waiting';
    }

    return {
      id: sessionId || '',
      provider: metadata.provider || 'unknown',
      model: metadata.model,
      mode: metadata.mode as 'planning' | 'agent' | undefined,
      messages: convertedMessages,
      createdAt: messages[0]?.createdAt || Date.now(),
      updatedAt: messages[messages.length - 1]?.createdAt || Date.now(),
      title: metadata.title,
      metadata: sessionStatus ? { sessionStatus } : undefined,
    };
  }, [sessionId, messages, metadata]);

  // Get title from index entry (syncs correctly) or fall back to metadata
  const indexEntry = sessions.find((s) => s.id === sessionId);
  const title = indexEntry?.title || metadata.title || 'Untitled Session';

  // Detect pending interactive prompts from messages
  const pendingPrompt = useMemo((): {
    type: 'permission_request' | 'ask_user_question_request';
    content: PermissionRequestContent | AskUserQuestionRequestContent;
  } | null => {
    // Scan messages from newest to oldest looking for pending prompts
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      try {
        const parsed = JSON.parse(msg.content);
        if (parsed.type === 'permission_request' && parsed.status === 'pending') {
          // Check if there's a response for this request
          const hasResponse = messages.some(m => {
            try {
              const r = JSON.parse(m.content);
              return r.type === 'permission_response' && r.requestId === parsed.requestId;
            } catch { return false; }
          });
          if (!hasResponse) {
            return { type: 'permission_request', content: parsed as PermissionRequestContent };
          }
        }
        if (parsed.type === 'ask_user_question_request' && parsed.status === 'pending') {
          // Check if there's a response for this question
          const hasResponse = messages.some(m => {
            try {
              const r = JSON.parse(m.content);
              return r.type === 'ask_user_question_response' && r.questionId === parsed.questionId;
            } catch { return false; }
          });
          if (!hasResponse) {
            return { type: 'ask_user_question_request', content: parsed as AskUserQuestionRequestContent };
          }
        }
      } catch {
        // Not JSON or not an interactive prompt
      }
    }
    return null;
  }, [messages]);

  // Handle submitting a response to an interactive prompt
  const handlePromptResponse = useCallback(async (
    response: PermissionResponseContent | AskUserQuestionResponseContent
  ) => {
    if (!wsRef.current || !encryptionKeyRef.current) {
      console.error('[SessionDetail] Cannot submit prompt response: not connected');
      return;
    }

    setIsSubmittingPrompt(true);
    try {
      const messageId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const timestamp = Date.now();

      // Encrypt the response
      const responseContent = JSON.stringify({
        content: JSON.stringify(response),
        metadata: {},
      });
      const { encrypted, iv } = await encrypt(responseContent, encryptionKeyRef.current);

      // Send as a new message
      const msg: ClientMessage = {
        type: 'append_message',
        message: {
          id: messageId,
          sequence: 0, // Server will assign proper sequence
          created_at: timestamp,
          source: 'system',
          direction: 'input',
          encrypted_content: encrypted,
          iv,
          metadata: {},
        },
      };
      wsRef.current.send(JSON.stringify(msg));

      // Optimistically add to local messages so pendingPrompt clears immediately
      setMessages((prev) => [
        ...prev,
        {
          id: messageId,
          createdAt: timestamp,
          source: 'system',
          direction: 'input',
          content: JSON.stringify(response),
          metadata: {},
          hidden: false,
        },
      ]);

      // For AskUserQuestion responses, also send via IndexRoom so desktop receives it immediately
      if (response.type === 'ask_user_question_response' && sessionId) {
        const questionResponse = response as AskUserQuestionResponseContent;
        const isCancelled = questionResponse.cancelled;
        console.log('[SessionDetail]', isCancelled ? 'Cancelled' : 'Submitted', 'question response via IndexRoom:', questionResponse.questionId);

        if (isCancelled) {
          // For cancellation, send the cancel control message
          sendSessionControlMessage(sessionId, 'cancel');
        } else {
          // For normal responses, send the question response control message
          sendSessionControlMessage(sessionId, 'question_response', {
            questionId: questionResponse.questionId,
            answers: questionResponse.answers,
            cancelled: false,
          });
        }
      } else {
        console.log('[SessionDetail] Submitted prompt response:', response.type);
      }
    } catch (err) {
      console.error('[SessionDetail] Failed to submit prompt response:', err);
      setError('Failed to submit response');
    } finally {
      setIsSubmittingPrompt(false);
    }
  }, [sessionId, sendSessionControlMessage]);

  // Generate unique ID for messages
  const generateId = () => {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  };

  // Handle input change
  const handleInputChange = (value: string) => {
    setInputValue(value);
    // Note: Draft sync via metadata is not yet implemented in CollabV3
  };

  // Handle cancel - abort the running session on desktop
  const handleCancel = useCallback(() => {
    if (sessionId) {
      console.log('[SessionDetail] Cancelling session:', sessionId);
      sendSessionControlMessage(sessionId, 'cancel');
    }
  }, [sessionId, sendSessionControlMessage]);

  // Handle sending a message by adding it to the queue
  // Desktop will process the queue and create both user message and AI response
  const handleSendMessage = async (message: string) => {
    if (!message.trim() || !sessionId || !wsRef.current) {
      return;
    }

    setIsSending(true);
    try {
      // Create a queued prompt entry
      const queuedPrompt = {
        id: generateId(),
        prompt: message,
        timestamp: Date.now(),
      };

      // Get current queue and add the new prompt
      const currentQueue = metadata.queuedPrompts || [];
      const newQueue = [...currentQueue, queuedPrompt];

      // Send metadata update to add to queue (session room)
      const queueMsg: ClientMessage = {
        type: 'update_metadata',
        metadata: { queuedPrompts: newQueue },
      };
      wsRef.current.send(JSON.stringify(queueMsg));

      // Also send index update so desktop (listening to index) can get the full queue
      console.log('[SessionDetail] DEBUG Calling sendIndexUpdate with queuedPrompts:', newQueue.length, 'prompts');
      await sendIndexUpdate(sessionId, { queuedPrompts: newQueue });

      // Update local metadata state
      setMetadata((prev) => ({ ...prev, queuedPrompts: newQueue }));

      // Clear input
      setInputValue('');
      setAttachments([]);
    } catch (err) {
      console.error('[SessionDetail] Failed to queue message:', err);
      setError('Failed to queue message');
    } finally {
      setIsSending(false);
    }
  };

  const handleAttachmentAdd = (attachment: ChatAttachment) => {
    setAttachments((prev) => [...prev, attachment]);
  };

  const handleAttachmentRemove = (attachmentId: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
  };

  return (
    <div className="flex flex-col w-full bg-[var(--surface-primary)]" style={{ height: hiddenBackButton ? '100%' : '100dvh' }}>
      {/* Header - Fixed with safe area for notch */}
      <header className="flex-shrink-0 flex items-center px-3 py-2 border-b border-[var(--border-primary)] bg-[var(--surface-secondary)] safe-area-top">
        {!hiddenBackButton && (
          <button
            onClick={() => navigate('/')}
            className="mr-2 p-1 text-[var(--text-primary)] active:opacity-70"
            aria-label="Go back"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold truncate text-[var(--text-primary)]">{title}</h1>
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
            {metadata.provider && <span>{metadata.provider}</span>}
            {metadata.model && <span>/ {metadata.model}</span>}
            <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
          </div>
        </div>
      </header>

      {/* Transcript - Scrollable */}
      <main className="flex-1 overflow-auto min-h-0">
        {error && (
          <div className="m-4 p-3 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>
        )}

        {messages.length === 0 ? (
          <div className="text-center text-[var(--text-tertiary)] py-8">
            {connected ? 'No messages yet' : 'Connecting...'}
          </div>
        ) : (
          <AgentTranscriptPanel
            key={sessionId}
            sessionId={sessionId || ''}
            sessionData={sessionData}
            hideSidebar={true}
            renderHeaderActions={({ prompts, onNavigateToPrompt }) => (
              <div className="mobile-prompts-menu-container">
                <PromptsMenuButton
                  prompts={prompts}
                  onNavigateToPrompt={onNavigateToPrompt}
                  buttonClassName="mobile-prompts-button"
                  dropdownClassName="mobile-prompts-dropdown"
                  usePortal={true}
                />
              </div>
            )}
          />
        )}
      </main>

      {/* Interactive Prompt (when pending) */}
      {pendingPrompt && (
        <div className="flex-shrink-0 px-3 py-2 border-t border-[var(--border-primary)] bg-[var(--surface-secondary)]">
          <InteractivePromptWidget
            promptType={pendingPrompt.type}
            content={pendingPrompt.content}
            onSubmitResponse={handlePromptResponse}
            isMobile={true}
            isSubmitting={isSubmittingPrompt}
          />
        </div>
      )}

      {/* AI Input - Fixed at bottom */}
      <footer className="flex-shrink-0 bg-[var(--surface-primary)] border-t border-[var(--border-primary)]">
        <AIInput
          value={inputValue}
          onChange={handleInputChange}
          onSend={handleSendMessage}
          disabled={!connected || isSending || !!pendingPrompt}
          isLoading={isSending || metadata.isExecuting}
          onCancel={metadata.isExecuting ? handleCancel : undefined}
          placeholder={pendingPrompt ? 'Respond to prompt above...' : (connected ? 'Type your message...' : 'Connecting...')}
          attachments={attachments}
          onAttachmentAdd={handleAttachmentAdd}
          onAttachmentRemove={handleAttachmentRemove}
          simpleMode={true}
        />
      </footer>
    </div>
  );
}
