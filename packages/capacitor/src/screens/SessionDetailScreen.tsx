import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { useSync } from '../contexts/SyncContext';
import { AgentTranscriptPanel, transformAgentMessagesToUI } from '@nimbalyst/runtime';
import type { SessionData, Message } from '@nimbalyst/runtime';

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
        return typeof msg.toJSON === 'function' ? msg.toJSON() : msg;
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

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <header className="flex items-center px-4 py-3 border-b border-[var(--border-primary)] bg-[var(--surface-secondary)]">
        <button
          onClick={() => navigate('/')}
          className="mr-3 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6"/>
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold truncate">{title}</h1>
          <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
            {metadata.provider && <span>{metadata.provider}</span>}
            {metadata.model && <span>/ {metadata.model}</span>}
            <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
          </div>
        </div>
      </header>

      {/* Transcript */}
      <main className="flex-1 overflow-hidden">
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
    </div>
  );
}
