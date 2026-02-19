import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSync } from '../contexts/CollabV3SyncContext';
import { getSessionJwt, getOrgId } from '../services/StytchAuthService';
import { analyticsService } from '../services/AnalyticsService';
import { AgentTranscriptPanel, transformAgentMessagesToUI, PromptsMenuButton } from '@nimbalyst/runtime';
import { setInteractiveWidgetHost } from '@nimbalyst/runtime/store';
import { AIInput } from '@nimbalyst/runtime/ui';
import type { SessionData, ChatAttachment, PromptMarker } from '@nimbalyst/runtime';
import { createMobileInteractiveWidgetHost } from '../services/MobileInteractiveWidgetHost';
import forge from 'node-forge';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Capacitor } from '@capacitor/core';
import {
  InteractiveVoiceService,
  VoiceServiceState,
  TranscriptEntry,
  PendingPrompt as VoicePendingPrompt,
} from '../services/InteractiveVoiceService';

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
  voiceModeActive?: boolean;
}

export function SessionDetailScreen({ hiddenBackButton, voiceModeActive }: SessionDetailScreenProps) {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId: string }>();
  const { config, sendIndexUpdate, allSessions, sendSessionControlMessage, syncedOpenAIApiKey, syncedVoiceModeSettings, projects } = useSync();

  const [messages, setMessages] = useState<SyncedMessage[]>([]);
  const [metadata, setMetadata] = useState<Partial<WireSessionMetadata>>({});
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Input state
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);

  // Note: isSubmittingPrompt was removed - widgets now handle their own submission state
  // via InteractiveWidgetHost which is set up after WebSocket connection

  // Voice mode state
  const [voiceState, setVoiceState] = useState<VoiceServiceState>('idle');
  const [voiceTranscript, setVoiceTranscript] = useState<TranscriptEntry[]>([]);
  const [voicePendingPrompt, setVoicePendingPrompt] = useState<VoicePendingPrompt | null>(null);
  const [voiceCountdown, setVoiceCountdown] = useState(5);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [isEditingVoicePrompt, setIsEditingVoicePrompt] = useState(false);
  const [editedVoicePrompt, setEditedVoicePrompt] = useState('');
  const voiceServiceRef = useRef<InteractiveVoiceService | null>(null);
  const voiceCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

    // Track session viewed (no session details for privacy)
    if (sessionId) {
      analyticsService.capture('mobile_session_viewed');
    }
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

      // Build WebSocket URL with optional org-scoped room ID
      const baseUrl = config.serverUrl.replace(/\/$/, '');
      const wsBase = baseUrl.replace(/^http/, 'ws');
      const orgId = await getOrgId();
      const roomId = orgId
        ? `org:${orgId}:user:${config.userId}:session:${sessionId}`
        : `user:${config.userId}:session:${sessionId}`;
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

  // Helper function to append a tool result message to the transcript
  // Used by MobileInteractiveWidgetHost to persist responses
  const appendToolResult = useCallback(async (toolUseId: string, result: string): Promise<void> => {
    if (!wsRef.current || !encryptionKeyRef.current) {
      console.error('[SessionDetail] Cannot append tool result: not connected');
      return;
    }

    const messageId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const timestamp = Date.now();

    const toolResult = {
      type: 'nimbalyst_tool_result',
      tool_use_id: toolUseId,
      result,
    };

    // Encrypt the response
    const responseContent = JSON.stringify({
      content: JSON.stringify(toolResult),
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

    // Optimistically add to local messages
    setMessages((prev) => [
      ...prev,
      {
        id: messageId,
        createdAt: timestamp,
        source: 'system',
        direction: 'input',
        content: JSON.stringify(toolResult),
        metadata: {},
        hidden: false,
      },
    ]);
  }, []);

  // Set up MobileInteractiveWidgetHost for CustomToolWidgets
  // This allows widgets to respond to prompts via the sync layer
  useEffect(() => {
    if (!sessionId || !connected) {
      return;
    }

    const host = createMobileInteractiveWidgetHost(
      sessionId,
      sendSessionControlMessage,
      appendToolResult
    );
    setInteractiveWidgetHost(sessionId, host);

    return () => {
      setInteractiveWidgetHost(sessionId, null);
    };
  }, [sessionId, connected, sendSessionControlMessage, appendToolResult]);

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
  // Use allSessions (unfiltered) to ensure we find the session regardless of selected project
  const indexEntry = allSessions.find((s) => s.id === sessionId);
  const title = indexEntry?.title || metadata.title || 'Untitled Session';

  // Detect if there are any pending interactive prompts
  // With the durable prompts architecture, widgets render inline in the transcript
  // and handle responses via InteractiveWidgetHost. This detection is only used
  // to disable the input field while waiting for a response.
  const INTERACTIVE_TOOL_NAMES = ['ToolPermission', 'AskUserQuestion', 'ExitPlanMode', 'developer_git_commit_proposal', 'mcp__nimbalyst-mcp__developer_git_commit_proposal'];

  const hasPendingPrompt = useMemo((): boolean => {
    // Scan messages looking for pending interactive prompts
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      try {
        const parsed = JSON.parse(msg.content);

        // Check for nimbalyst_tool_use messages (durable prompts format)
        if (parsed.type === 'nimbalyst_tool_use') {
          const toolId = parsed.id;
          const toolName = parsed.name;

          // Only check interactive tools
          if (!INTERACTIVE_TOOL_NAMES.includes(toolName)) {
            continue;
          }

          // Check for nimbalyst_tool_result with matching tool_use_id
          const hasResult = messages.some(m => {
            try {
              const r = JSON.parse(m.content);
              return r.type === 'nimbalyst_tool_result' && r.tool_use_id === toolId;
            } catch { return false; }
          });

          if (!hasResult) {
            return true;
          }
        }

        // Also check for SDK tool_use blocks (ExitPlanMode, GitCommit)
        if (parsed.type === 'tool_use' && INTERACTIVE_TOOL_NAMES.includes(parsed.name)) {
          const hasResult = messages.some(m => {
            try {
              const r = JSON.parse(m.content);
              return r.type === 'tool_result' && r.tool_use_id === parsed.id;
            } catch { return false; }
          });

          if (!hasResult) {
            return true;
          }
        }
      } catch {
        // Not JSON or not an interactive prompt
      }
    }
    return false;
  }, [messages]);

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

    // Track message sent from mobile (privacy: no message content)
    analyticsService.capture('mobile_ai_message_sent', {
      hasAttachments: attachments.length > 0,
    });

    // Clear input immediately (optimistic) before async work
    setInputValue('');
    setAttachments([]);

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

  // ============================================================================
  // Voice Mode Functions
  // ============================================================================

  // Cleanup voice on unmount or session change
  useEffect(() => {
    return () => {
      voiceServiceRef.current?.stop('user_stopped');
      if (voiceCountdownRef.current) {
        clearInterval(voiceCountdownRef.current);
      }
    };
  }, [sessionId]);

  // Handle voice pending prompt
  const handleVoicePendingPrompt = useCallback((prompt: VoicePendingPrompt) => {
    setVoicePendingPrompt(prompt);
    setEditedVoicePrompt(prompt.prompt);
    setVoiceCountdown(5);

    voiceCountdownRef.current = setInterval(() => {
      setVoiceCountdown((prev) => {
        if (prev <= 1) {
          if (voiceCountdownRef.current) {
            clearInterval(voiceCountdownRef.current);
            voiceCountdownRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    if (Capacitor.isNativePlatform()) {
      Haptics.notification({ type: NotificationType.Warning });
    }
  }, []);

  // Send voice pending prompt to desktop
  const sendVoicePendingPrompt = useCallback(async () => {
    if (!sessionId || !voicePendingPrompt) return;

    if (voiceCountdownRef.current) {
      clearInterval(voiceCountdownRef.current);
      voiceCountdownRef.current = null;
    }

    const finalPrompt = isEditingVoicePrompt ? editedVoicePrompt : voicePendingPrompt.prompt;
    if (!finalPrompt.trim()) return;

    try {
      const queuedPrompt = {
        id: crypto.randomUUID(),
        prompt: finalPrompt.trim(),
        timestamp: Date.now(),
        source: 'voice' as const,
      };

      await sendIndexUpdate(sessionId, { queuedPrompts: [queuedPrompt] });

      if (Capacitor.isNativePlatform()) {
        Haptics.notification({ type: NotificationType.Success });
      }

      setVoicePendingPrompt(null);
      setIsEditingVoicePrompt(false);
      setEditedVoicePrompt('');
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : 'Failed to send');
    }
  }, [sessionId, voicePendingPrompt, isEditingVoicePrompt, editedVoicePrompt, sendIndexUpdate]);

  // Auto-send when countdown reaches 0
  useEffect(() => {
    if (voiceCountdown === 0 && voicePendingPrompt && !isEditingVoicePrompt) {
      sendVoicePendingPrompt();
    }
  }, [voiceCountdown, voicePendingPrompt, isEditingVoicePrompt, sendVoicePendingPrompt]);

  // Cancel voice pending prompt
  const cancelVoicePendingPrompt = useCallback(() => {
    if (voiceCountdownRef.current) {
      clearInterval(voiceCountdownRef.current);
      voiceCountdownRef.current = null;
    }
    setVoicePendingPrompt(null);
    setIsEditingVoicePrompt(false);
    setEditedVoicePrompt('');

    if (Capacitor.isNativePlatform()) {
      Haptics.impact({ style: ImpactStyle.Light });
    }
  }, []);

  // Toggle voice mode
  const toggleVoiceMode = useCallback(async () => {
    // If active, stop
    if (voiceState !== 'idle' && voiceState !== 'error') {
      voiceServiceRef.current?.stop('user_stopped');
      if (Capacitor.isNativePlatform()) {
        Haptics.impact({ style: ImpactStyle.Light });
      }
      return;
    }

    // Start voice session
    setVoiceError(null);

    if (!syncedOpenAIApiKey) {
      setVoiceError('OpenAI API key not synced from desktop');
      setVoiceState('error');
      return;
    }

    // Build session context
    const indexEntry = allSessions.find((s) => s.id === sessionId);
    const project = projects.find((p) => p.id === indexEntry?.workspaceId);
    let sessionContext = 'Mobile voice session';
    if (indexEntry) {
      sessionContext = `Session "${indexEntry.title || 'Unnamed'}" in project "${project?.name || 'Unknown'}"`;
      if (indexEntry.messageCount > 0) {
        sessionContext += `. Session has ${indexEntry.messageCount} messages.`;
      }
    }

    voiceServiceRef.current = new InteractiveVoiceService(
      syncedOpenAIApiKey,
      {
        onTranscriptUpdate: setVoiceTranscript,
        onPendingPrompt: handleVoicePendingPrompt,
        onStateChange: setVoiceState,
        onError: (err) => {
          setVoiceError(err.message);
          if (Capacitor.isNativePlatform()) {
            Haptics.notification({ type: NotificationType.Error });
          }
        },
        onSessionEnd: (reason) => {
          if (reason === 'timeout') {
            setVoiceError('Voice timed out');
          }
        },
      },
      {
        sessionContext,
        // Use synced voice settings from desktop
        voice: syncedVoiceModeSettings?.voice,
      }
    );

    try {
      await voiceServiceRef.current.start();
      if (Capacitor.isNativePlatform()) {
        Haptics.impact({ style: ImpactStyle.Medium });
      }
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : 'Failed to start voice');
      setVoiceState('error');
    }
  }, [voiceState, syncedOpenAIApiKey, syncedVoiceModeSettings, sessionId, allSessions, projects, handleVoicePendingPrompt]);

  // Voice mode helpers
  const isVoiceActive = voiceState !== 'idle' && voiceState !== 'error';
  const latestVoiceEntry = voiceTranscript[voiceTranscript.length - 1];

  return (
    <div className="flex flex-col w-full bg-nim" style={{ height: hiddenBackButton || voiceModeActive ? '100%' : '100dvh' }}>
      {/* Header - Hidden in voice mode since VoiceControlScreen provides its own */}
      {!voiceModeActive && (
        <header className="flex-shrink-0 flex items-center px-3 py-2 border-b border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] safe-area-top">
          {!hiddenBackButton && (
            <button
              onClick={() => {
                // Navigate back to the session list for this project
                const projectId = metadata.project_id || indexEntry?.workspaceId || 'default';
                navigate(`/project/${encodeURIComponent(projectId)}/sessions`);
              }}
              className="mr-2 p-1 text-[var(--nim-text)] active:opacity-70"
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
            <h1 className="text-base font-semibold truncate text-[var(--nim-text)]">{title}</h1>
            <div className="flex items-center gap-1.5 text-xs text-[var(--nim-text-muted)]">
              {metadata.provider && <span>{metadata.provider}</span>}
              {metadata.model && <span>/ {metadata.model}</span>}
              <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
            </div>
          </div>
          {/* Voice Control Button */}
          <button
            onClick={toggleVoiceMode}
            disabled={voiceState === 'connecting'}
            className={`ml-2 p-1.5 rounded-lg transition-all ${
              voiceState === 'connecting'
                ? 'bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-faint)]'
                : isVoiceActive
                  ? 'bg-red-500 text-white'
                  : 'hover:bg-[var(--nim-bg-tertiary)] text-[var(--nim-primary)]'
            }`}
            title={isVoiceActive ? 'Stop Voice' : 'Start Voice'}
          >
            {voiceState === 'connecting' ? (
              // Spinner when connecting
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : isVoiceActive ? (
              // Stop icon when active
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              // Mic icon when idle
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
            )}
          </button>
        </header>
      )}

      {/* Voice Status Bar - Shows when voice is active */}
      {isVoiceActive && !voiceModeActive && (
        <div className="flex-shrink-0 px-3 py-1.5 bg-[var(--nim-bg-tertiary)] border-b border-[var(--nim-border)]">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs text-[var(--nim-text-muted)]">
              {voiceState === 'listening' ? 'Listening...' : voiceState === 'agent_speaking' ? 'Speaking...' : 'Voice active'}
            </span>
            {latestVoiceEntry && (
              <span className="flex-1 text-xs text-[var(--nim-text)] truncate">
                {latestVoiceEntry.role === 'user' ? 'You: ' : 'Agent: '}
                {latestVoiceEntry.text || '...'}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Voice Pending Prompt - Shows when agent queues a task */}
      {voicePendingPrompt && !voiceModeActive && (
        <div className="flex-shrink-0 px-3 py-2 bg-[var(--nim-bg-secondary)] border-b border-[var(--nim-border)]">
          <div className="p-2 rounded-lg bg-[var(--nim-bg-tertiary)] border border-[var(--nim-primary)]/50">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-[var(--nim-primary)] font-medium">Pending Task</span>
              {!isEditingVoicePrompt && (
                <span className="text-xs text-[var(--nim-text-faint)]">Auto-send in {voiceCountdown}s</span>
              )}
            </div>
            {isEditingVoicePrompt ? (
              <textarea
                value={editedVoicePrompt}
                onChange={(e) => setEditedVoicePrompt(e.target.value)}
                className="w-full p-2 rounded border border-[var(--nim-border)] bg-[var(--nim-bg)] text-[var(--nim-text)] text-sm resize-none"
                rows={2}
                autoFocus
              />
            ) : (
              <p className="text-sm text-[var(--nim-text)] line-clamp-2">{voicePendingPrompt.prompt}</p>
            )}
            <div className="flex items-center justify-between mt-2">
              <button
                onClick={() => {
                  if (isEditingVoicePrompt) {
                    setIsEditingVoicePrompt(false);
                    setVoiceCountdown(5);
                    voiceCountdownRef.current = setInterval(() => {
                      setVoiceCountdown((prev) => {
                        if (prev <= 1) {
                          if (voiceCountdownRef.current) {
                            clearInterval(voiceCountdownRef.current);
                            voiceCountdownRef.current = null;
                          }
                          return 0;
                        }
                        return prev - 1;
                      });
                    }, 1000);
                  } else {
                    if (voiceCountdownRef.current) {
                      clearInterval(voiceCountdownRef.current);
                      voiceCountdownRef.current = null;
                    }
                    setIsEditingVoicePrompt(true);
                  }
                }}
                className="text-xs text-[var(--nim-primary)] font-medium"
              >
                {isEditingVoicePrompt ? 'Done' : 'Edit'}
              </button>
              <div className="flex gap-2">
                <button
                  onClick={cancelVoicePendingPrompt}
                  className="px-2 py-1 text-xs rounded bg-[var(--nim-bg)] text-[var(--nim-text-muted)] border border-[var(--nim-border)]"
                >
                  Cancel
                </button>
                <button
                  onClick={sendVoicePendingPrompt}
                  className="px-2 py-1 text-xs rounded bg-[var(--nim-primary)] text-white font-medium"
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Voice Error */}
      {voiceError && voiceState === 'error' && !voiceModeActive && (
        <div className="flex-shrink-0 px-3 py-2 bg-red-500/10 border-b border-red-500/30">
          <div className="flex items-center justify-between">
            <span className="text-xs text-red-500">{voiceError}</span>
            <button
              onClick={() => { setVoiceError(null); setVoiceState('idle'); }}
              className="text-xs text-red-500 font-medium"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Transcript - Scrollable */}
      <main className="flex-1 overflow-auto min-h-0">
        {error && (
          <div className="m-4 p-3 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>
        )}

        {messages.length === 0 ? (
          <div className="text-center text-[var(--nim-text-faint)] py-8">
            {connected ? 'No messages yet' : 'Connecting...'}
          </div>
        ) : (
          <AgentTranscriptPanel
            key={sessionId}
            sessionId={sessionId || ''}
            sessionData={sessionData}
            hideSidebar={true}
            renderHeaderActions={({ prompts, onNavigateToPrompt }: { prompts: PromptMarker[]; onNavigateToPrompt: (marker: PromptMarker) => void }) => (
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

      {/* AI Input - Fixed at bottom with safe area for home indicator */}
      {/* Note: Interactive prompts now render inline via CustomToolWidgets in AgentTranscriptPanel */}
      <footer className="flex-shrink-0 bg-[var(--nim-bg)] border-t border-[var(--nim-border)] safe-area-bottom">
        <AIInput
          value={inputValue}
          onChange={handleInputChange}
          onSend={handleSendMessage}
          disabled={!connected || isSending || hasPendingPrompt}
          isLoading={isSending || metadata.isExecuting}
          onCancel={metadata.isExecuting ? handleCancel : undefined}
          placeholder={hasPendingPrompt ? 'Respond to prompt in transcript...' : (connected ? 'Type your message...' : 'Connecting...')}
          attachments={attachments}
          onAttachmentAdd={handleAttachmentAdd}
          onAttachmentRemove={handleAttachmentRemove}
          simpleMode={true}
        />
      </footer>
    </div>
  );
}
