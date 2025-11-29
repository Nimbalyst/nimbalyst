import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { useSync } from '../contexts/SyncContext';
import { AgentTranscriptPanel, transformAgentMessagesToUI } from '@nimbalyst/runtime';
import { AIInput } from '@nimbalyst/runtime/ui';
import type { SessionData, Message, ChatAttachment } from '@nimbalyst/runtime';

interface SyncedMessage {
  id: string;
  createdAt: number;
  source: string;
  direction: 'input' | 'output';
  content: string;
  metadata?: Record<string, unknown>;
  hidden?: boolean;
}

interface SessionMetadata {
  title?: string;
  provider?: string;
  model?: string;
  mode?: string;
}

export function SessionDetailScreen() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId: string }>();
  const { config } = useSync();

  const [messages, setMessages] = useState<SyncedMessage[]>([]);
  const [metadata, setMetadata] = useState<SessionMetadata>({});
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Input state
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);

  const docRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);

  useEffect(() => {
    if (!config || !sessionId) {
      setError('Missing configuration or session ID');
      return;
    }

    // Create Y.Doc for this session
    const doc = new Y.Doc();
    docRef.current = doc;

    const wsUrl = `${config.serverUrl}/sync`;

    const provider = new WebsocketProvider(wsUrl, sessionId, doc, {
      params: {
        authorization: `Bearer ${config.userId}:${config.authToken}`,
      },
      connect: true,
    });
    providerRef.current = provider;

    // Status tracking
    provider.on('status', ({ status }: { status: string }) => {
      setConnected(status === 'connected');
      if (status === 'connected') {
        setError(null);
      }
    });

    provider.on('connection-error', () => {
      setError('Connection failed');
      setConnected(false);
    });

    // Get messages array and metadata map
    const messagesArray = doc.getArray<SyncedMessage>('messages');
    const metadataMap = doc.getMap<unknown>('metadata');

    // Update messages from Y.Doc
    const updateMessages = () => {
      const msgs = messagesArray.toArray().map((msg) => {
        // Convert Y.js types to plain objects if needed
        return (msg as any)?.toJSON ? (msg as any).toJSON() : msg;
      });
      console.log('[SessionDetail] Messages:', msgs);
      setMessages(msgs.filter((m) => !m.hidden));
    };

    // Update metadata from Y.Doc
    const updateMetadata = () => {
      const meta: SessionMetadata = {};
      metadataMap.forEach((value, key) => {
        (meta as Record<string, unknown>)[key] = value;
      });
      console.log('[SessionDetail] Metadata:', meta);
      setMetadata(meta);

      // Sync draft input from Y.Doc (if different from local state)
      const draft = metadataMap.get('draftInput');
      if (typeof draft === 'string' && draft !== inputValue) {
        setInputValue(draft);
      }
    };

    // Observe changes
    messagesArray.observe(updateMessages);
    metadataMap.observe(updateMetadata);

    // Initial update after sync
    provider.on('sync', (isSynced: boolean) => {
      if (isSynced) {
        updateMessages();
        updateMetadata();
      }
    });

    // Cleanup
    return () => {
      messagesArray.unobserve(updateMessages);
      metadataMap.unobserve(updateMetadata);

      if (providerRef.current) {
        providerRef.current.disconnect();
        providerRef.current.destroy();
        providerRef.current = null;
      }
      if (docRef.current) {
        docRef.current.destroy();
        docRef.current = null;
      }
    };
  }, [config, sessionId]);

  // Convert synced messages to SessionData format
  const sessionData = useMemo((): SessionData => {
    console.log('[SessionDetail] Raw messages:', messages);

    // Use the same transformation function that the desktop app uses!
    // This properly handles Claude Code format, tool calls, thinking, etc.
    const convertedMessages = transformAgentMessagesToUI(messages);

    return {
      id: sessionId || '',
      provider: metadata.provider || 'unknown',
      model: metadata.model,
      mode: metadata.mode as 'planning' | 'agent' | undefined,
      messages: convertedMessages,
      createdAt: messages[0]?.createdAt || Date.now(),
      updatedAt: messages[messages.length - 1]?.createdAt || Date.now(),
      title: metadata.title,
    };
  }, [sessionId, messages, metadata]);

  const title = metadata.title || 'Untitled Session';

  // Generate unique ID for messages
  const generateId = () => {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  };

  // Handle input change - sync draft to Y.Doc
  const handleInputChange = (value: string) => {
    setInputValue(value);

    // Sync draft input to Y.Doc
    if (docRef.current) {
      const metadataMap = docRef.current.getMap('metadata');
      metadataMap.set('draftInput', value);
    }
  };

  // Handle sending a message
  const handleSendMessage = async (message: string) => {
    if (!message.trim() || !sessionId || !docRef.current) {
      console.log('[SessionDetail] Cannot send: missing data', { message: !!message.trim(), sessionId, doc: !!docRef.current });
      return;
    }

    setIsSending(true);
    try {
      // Create user message
      const userMessage: SyncedMessage = {
        id: generateId(),
        createdAt: Date.now(),
        source: 'user',
        direction: 'input',
        content: message,
      };

      console.log('[SessionDetail] Sending message:', userMessage);

      // Push to Y.Doc messages array
      const messagesArray = docRef.current.getArray<SyncedMessage>('messages');
      messagesArray.push([userMessage]);

      // Update metadata with pending execution flag and clear draft
      const metadataMap = docRef.current.getMap('metadata');
      metadataMap.set('pendingExecution', {
        messageId: userMessage.id,
        sentAt: Date.now(),
        sentBy: 'mobile',
      });
      metadataMap.set('draftInput', ''); // Clear draft after sending

      // Clear input
      setInputValue('');
      setAttachments([]);

      console.log('[SessionDetail] Message sent successfully');
    } catch (err) {
      console.error('[SessionDetail] Failed to send message:', err);
      setError('Failed to send message');
    } finally {
      setIsSending(false);
    }
  };

  const handleAttachmentAdd = (attachment: ChatAttachment) => {
    setAttachments(prev => [...prev, attachment]);
  };

  const handleAttachmentRemove = (attachmentId: string) => {
    setAttachments(prev => prev.filter(a => a.id !== attachmentId));
  };

  return (
    <div className="flex flex-col h-screen">
      {/* Header - Fixed */}
      <header className="sticky top-0 z-10 flex items-center px-3 py-2 border-b border-[var(--border-primary)] bg-[var(--surface-secondary)]">
        <button
          onClick={() => navigate('/')}
          className="mr-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6"/>
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold truncate">{title}</h1>
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
            {metadata.provider && <span>{metadata.provider}</span>}
            {metadata.model && <span>/ {metadata.model}</span>}
            <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
          </div>
        </div>
      </header>

      {/* Transcript - Scrollable */}
      <main className="flex-1 overflow-auto">
        {error && (
          <div className="m-4 p-3 rounded-lg bg-red-50 text-red-600 text-sm">
            {error}
          </div>
        )}

        {messages.length === 0 ? (
          <div className="text-center text-[var(--text-tertiary)] py-8">
            {connected ? 'No messages yet' : 'Connecting...'}
          </div>
        ) : (
          <AgentTranscriptPanel
            sessionId={sessionId || ''}
            sessionData={sessionData}
            hideSidebar={true}
          />
        )}
      </main>

      {/* AI Input - Fixed at bottom */}
      <footer className="flex-shrink-0">
        <AIInput
          value={inputValue}
          onChange={handleInputChange}
          onSend={handleSendMessage}
          disabled={!connected || isSending}
          isLoading={isSending}
          placeholder={connected ? "Type your message..." : "Connecting..."}
          attachments={attachments}
          onAttachmentAdd={handleAttachmentAdd}
          onAttachmentRemove={handleAttachmentRemove}
          simpleMode={true}
        />
      </footer>
    </div>
  );
}
