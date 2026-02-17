import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { Provider as JotaiProvider } from 'jotai';
import { store } from '@nimbalyst/runtime/store';
import { setInteractiveWidgetHost } from '@nimbalyst/runtime/store';
// Deep imports to avoid the barrel @nimbalyst/runtime index which re-exports
// Lexical plugins, MockupPlugin, TrackerPlugin, etc. and transitively pulls in
// Excalidraw (~18MB), Mermaid, and other heavy deps. The barrel's `export *`
// prevents tree-shaking, producing a ~25MB bundle that crashes WKWebView.
import { AgentTranscriptPanel } from '@nimbalyst/runtime/ui/AgentTranscript/components/AgentTranscriptPanel';
import { noopInteractiveWidgetHost } from '@nimbalyst/runtime/ui/AgentTranscript/components/CustomToolWidgets/InteractiveWidgetHost';
import { transformAgentMessagesToUI } from '@nimbalyst/runtime/ai/server/SessionManager';
import type { SessionData } from '@nimbalyst/runtime/ai/server/types';
import type { InteractiveWidgetHost } from '@nimbalyst/runtime/ui/AgentTranscript/components/CustomToolWidgets/InteractiveWidgetHost';
import './styles.css';

// ============================================================================
// Types for Swift <-> JS bridge
// ============================================================================

interface BridgeSessionData {
  sessionId: string;
  messages: BridgeMessage[];
  metadata: {
    title?: string;
    provider?: string;
    model?: string;
    mode?: string;
    isExecuting?: boolean;
  };
}

interface BridgeMessage {
  id: string;
  sessionId: string;
  sequence: number;
  source: string;
  direction: string;
  contentDecrypted: string | null;
  metadataJson: string | null;
  createdAt: number;
}

interface BridgeMetadataUpdate {
  title?: string;
  provider?: string;
  model?: string;
  mode?: string;
  isExecuting?: boolean;
}

// ============================================================================
// Convert bridge messages to the format transformAgentMessagesToUI expects
// ============================================================================

function bridgeMessageToRaw(msg: BridgeMessage): {
  id: string;
  createdAt: number;
  source: string;
  direction: 'input' | 'output';
  content: string;
  metadata?: Record<string, unknown>;
  hidden?: boolean;
} {
  const raw = msg.contentDecrypted || '';

  // The encrypted payload is an envelope: { content: "...", metadata: {...}, hidden: false }
  // We need to unwrap it to get the actual message content, which is what
  // transformAgentMessagesToUI expects (e.g., '{"type":"text","content":"..."}')
  try {
    const envelope = JSON.parse(raw);
    if (envelope && typeof envelope === 'object' && 'content' in envelope) {
      return {
        id: msg.id,
        createdAt: msg.createdAt,
        source: msg.source,
        direction: msg.direction as 'input' | 'output',
        content: typeof envelope.content === 'string' ? envelope.content : JSON.stringify(envelope.content),
        metadata: envelope.metadata || (msg.metadataJson ? tryParseJson(msg.metadataJson) : undefined),
        hidden: envelope.hidden,
      };
    }
  } catch {
    // Not JSON envelope - use as-is
  }

  return {
    id: msg.id,
    createdAt: msg.createdAt,
    source: msg.source,
    direction: msg.direction as 'input' | 'output',
    content: raw,
    metadata: msg.metadataJson ? tryParseJson(msg.metadataJson) : undefined,
  };
}

function tryParseJson(json: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

// ============================================================================
// Mobile Interactive Widget Host
// Bridges interactive widget responses back to Swift via WKWebView
// ============================================================================

function createMobileBridgeHost(sessionId: string): InteractiveWidgetHost {
  const postToNative = (message: Record<string, unknown>) => {
    try {
      (window as any).webkit?.messageHandlers?.bridge?.postMessage(message);
    } catch (e) {
      console.warn('Failed to post to native:', e);
    }
  };

  return {
    ...noopInteractiveWidgetHost,
    sessionId,
    workspacePath: '',

    async askUserQuestionSubmit(questionId: string, answers: Record<string, string>) {
      postToNative({ type: 'interactive_response', action: 'askUserQuestionSubmit', questionId, answers });
    },

    async toolPermissionSubmit(requestId: string, response: any) {
      postToNative({ type: 'interactive_response', action: 'toolPermissionSubmit', requestId, response });
    },

    async exitPlanModeApprove(requestId: string) {
      postToNative({ type: 'interactive_response', action: 'exitPlanModeApprove', requestId });
    },

    async exitPlanModeDeny(requestId: string, feedback?: string) {
      postToNative({ type: 'interactive_response', action: 'exitPlanModeDeny', requestId, feedback });
    },

    async gitCommit(proposalId: string, files: string[], message: string) {
      postToNative({ type: 'interactive_response', action: 'gitCommit', proposalId, files, message });
      return { success: true, pending: true };
    },

    trackEvent() {
      // No-op on mobile
    },
  };
}

// ============================================================================
// Transcript App
// ============================================================================

function TranscriptApp() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [rawMessages, setRawMessages] = useState<BridgeMessage[]>([]);
  const [metadata, setMetadata] = useState<BridgeMetadataUpdate>({});
  const rawMessagesRef = useRef<BridgeMessage[]>([]);
  const transcriptRef = useRef<{ scrollToMessage: (index: number) => void; scrollToTop: () => void }>(null);

  // Track sessionId in a ref so clearSession can access it without re-running the effect
  const sessionIdRef = useRef<string | null>(null);

  // Set up the bridge on window.nimbalyst - runs once on mount, never re-runs
  useEffect(() => {
    const nimbalyst = {
      loadSession(data: BridgeSessionData) {
        // Clean up previous session's widget host
        if (sessionIdRef.current) {
          setInteractiveWidgetHost(sessionIdRef.current, null);
        }
        sessionIdRef.current = data.sessionId;

        setSessionId(data.sessionId);
        setRawMessages(data.messages);
        rawMessagesRef.current = data.messages;
        setMetadata(data.metadata);

        // Set up interactive widget host for this session
        const host = createMobileBridgeHost(data.sessionId);
        setInteractiveWidgetHost(data.sessionId, host);
      },

      appendMessage(message: BridgeMessage) {
        const updated = [...rawMessagesRef.current, message];
        rawMessagesRef.current = updated;
        setRawMessages(updated);
      },

      updateMetadata(update: BridgeMetadataUpdate) {
        setMetadata((prev) => ({ ...prev, ...update }));
      },

      clearSession() {
        if (sessionIdRef.current) {
          setInteractiveWidgetHost(sessionIdRef.current, null);
          sessionIdRef.current = null;
        }
        setSessionId(null);
        setRawMessages([]);
        rawMessagesRef.current = [];
        setMetadata({});
      },

      scrollToTop() {
        transcriptRef.current?.scrollToTop();
      },

      scrollToMessage(messageId: string) {
        // Messages are keyed by index, not ID, so we need to find the index
        const index = rawMessagesRef.current.findIndex(m => m.id === messageId);
        if (index !== -1) {
          transcriptRef.current?.scrollToMessage(index);
        }
      },

      getPromptList(): Array<{ id: string; text: string; createdAt: number }> {
        return rawMessagesRef.current
          .filter((m) => m.source === 'user' && m.direction === 'input')
          .map((m) => {
            let text = '';
            try {
              const raw = m.contentDecrypted || '';
              const envelope = JSON.parse(raw);
              const content = envelope?.content;
              if (typeof content === 'string') {
                const inner = JSON.parse(content);
                text = inner?.prompt || inner?.content || content;
              } else {
                text = JSON.stringify(content);
              }
            } catch {
              text = m.contentDecrypted || '';
            }
            return { id: m.id, text: text.substring(0, 80), createdAt: m.createdAt };
          });
      },
    };

    (window as any).nimbalyst = nimbalyst;

    // Signal to Swift that the bridge is ready
    try {
      (window as any).webkit?.messageHandlers?.bridge?.postMessage({ type: 'ready' });
    } catch {
      // Not in WKWebView (dev mode)
    }

    return () => {
      delete (window as any).nimbalyst;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Transform raw bridge messages to UI format
  const sessionData: SessionData | null = React.useMemo(() => {
    if (!sessionId) return null;

    const rawForTransform = rawMessages.map(bridgeMessageToRaw);
    const transformedMessages = transformAgentMessagesToUI(rawForTransform);

    let sessionStatus: string | undefined;
    if (metadata.isExecuting) {
      sessionStatus = 'running';
    }

    return {
      id: sessionId,
      provider: metadata.provider || 'unknown',
      model: metadata.model,
      mode: metadata.mode as 'planning' | 'agent' | undefined,
      messages: transformedMessages,
      title: metadata.title,
      createdAt: rawMessages[0]?.createdAt || Date.now(),
      updatedAt: rawMessages[rawMessages.length - 1]?.createdAt || Date.now(),
      metadata: sessionStatus ? { sessionStatus } : undefined,
    };
  }, [sessionId, rawMessages, metadata]);

  if (!sessionId || !sessionData) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        color: 'var(--nim-text-faint)',
        fontSize: '14px',
      }}>
        Waiting for session...
      </div>
    );
  }

  return (
    <AgentTranscriptPanel
      ref={transcriptRef}
      key={sessionId}
      sessionId={sessionId}
      sessionData={sessionData}
      hideSidebar={true}
    />
  );
}

// ============================================================================
// Mount
// ============================================================================

ReactDOM.createRoot(document.getElementById('transcript-root')!).render(
  <JotaiProvider store={store}>
    <TranscriptApp />
  </JotaiProvider>
);
