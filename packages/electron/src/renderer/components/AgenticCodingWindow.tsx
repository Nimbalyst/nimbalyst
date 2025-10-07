import React, { useState, useEffect, useRef } from 'react';
import { AgentTranscriptPanel, TodoItem, FileEditSummary } from '@stravu/runtime';
import type { SessionData } from '@stravu/runtime/ai/server/types';
import { SessionDropdown } from './AIChat/SessionDropdown';

interface AgenticCodingWindowProps {
  sessionId?: string;
  workspacePath: string;
  planDocumentPath?: string;
}

interface SessionTab {
  id: string;
  name: string;
  sessionData: SessionData;
}

type SessionListItem = Pick<SessionData, 'id' | 'createdAt' | 'name' | 'title' | 'provider' | 'model'> & {
  messageCount?: number;
};

export const AgenticCodingWindow: React.FC<AgenticCodingWindowProps> = ({
  sessionId: initialSessionId,
  workspacePath,
  planDocumentPath
}) => {
  console.log('[AgenticCodingWindow] RENDER START', { initialSessionId, workspacePath, planDocumentPath });

  const [sessionTabs, setSessionTabs] = useState<SessionTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [availableSessions, setAvailableSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [promptInput, setPromptInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  console.log('[AgenticCodingWindow] State initialized', { loading, error, activeTabId, tabCount: sessionTabs.length });

  // Set window title with workspace name
  useEffect(() => {
    const workspaceName = workspacePath.split('/').pop() || 'Unknown Workspace';
    if (window.electronAPI?.setTitle) {
      window.electronAPI.setTitle(`Agentic Coding - ${workspaceName}`);
    }
  }, [workspacePath]);

  // Load all coding sessions for the dropdown
  const loadCodingSessions = async () => {
    try {
      const result = await window.electronAPI.invoke('sessions:list', workspacePath);
      if (result.success && Array.isArray(result.sessions)) {
        // Filter to only coding sessions and add message counts
        const codingSessions = result.sessions
          .filter((s: any) => s.sessionType === 'coding')
          .map((s: any) => ({
            id: s.id,
            createdAt: s.createdAt,
            name: s.name,
            title: s.title,
            provider: s.provider,
            model: s.model,
            messageCount: 0 // TODO: Get actual count
          }));
        setAvailableSessions(codingSessions);
      }
    } catch (err) {
      console.error('[AgenticCoding] Failed to load sessions:', err);
    }
  };

  // Open a session in a new tab
  const openSessionInTab = async (sessionId: string) => {
    // Check if already open in a tab
    const existingTab = sessionTabs.find(tab => tab.id === sessionId);
    if (existingTab) {
      setActiveTabId(sessionId);
      return;
    }

    try {
      const sessionData = await window.electronAPI.aiLoadSession(sessionId, workspacePath);
      if (sessionData) {
        const planPath = sessionData.metadata?.planDocumentPath as string | undefined;
        const tabName = planPath
          ? `Plan: ${planPath.split('/').pop()}`
          : sessionData.title || `Session ${sessionTabs.length + 1}`;

        const newTab: SessionTab = {
          id: sessionData.id,
          name: tabName,
          sessionData
        };

        setSessionTabs(prev => [...prev, newTab]);
        setActiveTabId(sessionData.id);
      }
    } catch (err) {
      console.error('[AgenticCoding] Failed to load session:', err);
    }
  };

  // Delete a session
  const deleteSession = async (sessionId: string) => {
    try {
      await window.electronAPI.invoke('sessions:delete', sessionId);

      // Remove from tabs if open
      setSessionTabs(prev => {
        const filtered = prev.filter(tab => tab.id !== sessionId);
        // If we deleted the active tab, switch to another
        if (activeTabId === sessionId && filtered.length > 0) {
          setActiveTabId(filtered[0].id);
        }
        return filtered;
      });

      // Reload sessions list
      await loadCodingSessions();
    } catch (err) {
      console.error('[AgenticCoding] Failed to delete session:', err);
    }
  };

  // Create a new session
  const createNewSession = async (planPath?: string) => {
    // Create session through AI service which handles database persistence
    const session = await window.electronAPI.aiCreateSession(
      'claude-code',
      undefined, // no documentContext for workspace-level work
      workspacePath,
      undefined // no specific model - claude-code manages its own
    );

    // Mark as coding session and add plan reference in metadata
    await window.electronAPI.invoke('agentic-coding:update-session-metadata', session.id, {
      sessionType: 'coding',
      planDocumentPath: planPath,
      fileEdits: [],
      todos: []
    });

    const tabName = planPath
      ? `Plan: ${planPath.split('/').pop()}`
      : `Session ${sessionTabs.length + 1}`;

    // Reload the session to get updated metadata
    const sessionData = await window.electronAPI.aiLoadSession(session.id, workspacePath);
    if (!sessionData) {
      throw new Error('Failed to load newly created session');
    }

    const newTab: SessionTab = {
      id: sessionData.id,
      name: tabName,
      sessionData
    };

    setSessionTabs(prev => [...prev, newTab]);
    setActiveTabId(sessionData.id);

    // Reload sessions list
    await loadCodingSessions();

    return sessionData;
  };

  // Load or create initial session
  useEffect(() => {
    console.log('[AgenticCodingWindow] useEffect STARTING', { initialSessionId, workspacePath });
    const loadOrCreateSession = async () => {
      try {
        console.log('[AgenticCodingWindow] loadOrCreateSession START');
        setLoading(true);
        setError(null);

        // Load all coding sessions for the dropdown
        await loadCodingSessions();

        if (initialSessionId) {
          // Load existing session
          const sessionData = await window.electronAPI.aiLoadSession(initialSessionId, workspacePath);
          if (sessionData) {
            const planPath = sessionData.metadata?.planDocumentPath as string | undefined;
            const tabName = planPath
              ? `Plan: ${planPath.split('/').pop()}`
              : 'Session 1';

            const tab: SessionTab = {
              id: sessionData.id,
              name: tabName,
              sessionData
            };

            setSessionTabs([tab]);
            setActiveTabId(sessionData.id);
          } else {
            setError('Failed to load session');
          }
        } else {
          // Create new session
          await createNewSession(planDocumentPath);
        }
      } catch (err) {
        console.error('[AgenticCoding] Failed to load/create session:', err);
        setError(String(err));
      } finally {
        setLoading(false);
      }
    };

    loadOrCreateSession();
  }, [initialSessionId, workspacePath, planDocumentPath]);

  // Listen for session updates (metadata changes from tools)
  useEffect(() => {
    const handleSessionUpdate = (_event: any, updatedSessionId: string, metadata: any) => {
      setSessionTabs(prev => prev.map(tab => {
        if (tab.id === updatedSessionId) {
          return {
            ...tab,
            sessionData: {
              ...tab.sessionData,
              metadata: { ...tab.sessionData.metadata, ...metadata }
            }
          };
        }
        return tab;
      }));
    };

    window.electronAPI.on?.('agentic-coding:session-updated', handleSessionUpdate);

    return () => {
      window.electronAPI.off?.('agentic-coding:session-updated', handleSessionUpdate);
    };
  }, []);

  // Listen for AI streaming responses
  useEffect(() => {
    const handleStreamResponse = async (data: any) => {
      // Reload the active session to get updated messages
      if (data.isComplete && activeTabId) {
        console.log('[AgenticCoding] Stream complete, reloading session:', activeTabId);
        try {
          const sessionData = await window.electronAPI.aiLoadSession(activeTabId, workspacePath);
          if (sessionData) {
            setSessionTabs(prev => prev.map(tab => {
              if (tab.id === activeTabId) {
                return { ...tab, sessionData };
              }
              return tab;
            }));
          }
        } catch (err) {
          console.error('[AgenticCoding] Failed to reload session after completion:', err);
        } finally {
          setIsSending(false);
        }
      }
    };

    const handleStreamError = (error: any) => {
      console.error('[AgenticCoding] AI error:', error);
      setError(error.message || 'An error occurred');
      setIsSending(false);
    };

    window.electronAPI.onAIStreamResponse(handleStreamResponse);
    window.electronAPI.onAIError(handleStreamError);

    return () => {
      // Note: onAIStreamResponse and onAIError return cleanup functions
      // but we're using them in a way that doesn't require explicit cleanup
    };
  }, [activeTabId, workspacePath]);

  const handleFileClick = async (filePath: string) => {
    // Open file in editor
    try {
      await window.electronAPI.invoke('workspace:open-file', {
        workspacePath,
        filePath
      });
    } catch (err) {
      console.error('[AgenticCoding] Failed to open file:', err);
    }
  };

  const handleTodoClick = (todo: TodoItem) => {
    // Could navigate to related message or highlight in transcript
    console.log('[AgenticCoding] Todo clicked:', todo);
  };

  const handleSendMessage = async () => {
    if (!promptInput.trim() || !activeTabId || isSending) return;

    const prompt = promptInput.trim();
    setPromptInput('');
    setIsSending(true);

    try {
      // Send message via existing AI service (no document context for workspace-level work)
      await window.electronAPI.aiSendMessage(
        prompt,
        undefined, // no documentContext - claude-code works on whole workspace via MCP
        activeTabId,
        workspacePath
      );
    } catch (err) {
      console.error('[AgenticCoding] Failed to send message:', err);
      setError(String(err));
      setIsSending(false);
    }
    // Note: setIsSending(false) happens when we receive the completion event
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const activeTab = sessionTabs.find(tab => tab.id === activeTabId);

  console.log('[AgenticCodingWindow] RENDER', { loading, error, activeTabId, tabCount: sessionTabs.length });

  if (loading) {
    console.log('[AgenticCodingWindow] Rendering LOADING state');
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--surface-primary)' }}>
        <div style={{ color: 'var(--text-secondary)' }}>Loading session...</div>
      </div>
    );
  }

  if (error || sessionTabs.length === 0) {
    console.log('[AgenticCodingWindow] Rendering ERROR state', { error });
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--surface-primary)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: 'var(--status-error)', marginBottom: '0.5rem' }}>Failed to load session</div>
          {error && <div style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>{error}</div>}
        </div>
      </div>
    );
  }

  console.log('[AgenticCodingWindow] Rendering MAIN content');
  console.log('[AgenticCodingWindow] About to render AgentTranscriptPanel');
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--surface-primary)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-primary)', backgroundColor: 'var(--surface-secondary)', WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div>
            <h1 style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.875rem' }}>
              Agentic Coding Session
              <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}> • {workspacePath.split('/').pop()}</span>
            </h1>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <SessionDropdown
            currentSessionId={activeTabId}
            sessions={availableSessions}
            onSessionSelect={openSessionInTab}
            onNewSession={() => createNewSession()}
            onDeleteSession={deleteSession}
          />
          <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
            {activeTab?.sessionData.provider || 'claude-code'}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.25rem 0.5rem', borderBottom: '1px solid var(--border-primary)', backgroundColor: 'var(--surface-primary)', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {sessionTabs.map(tab => (
          <div
            key={tab.id}
            style={{
              padding: '0.25rem 0.5rem 0.25rem 0.75rem',
              borderRadius: '0.25rem',
              fontSize: '0.75rem',
              backgroundColor: tab.id === activeTabId ? 'var(--surface-secondary)' : 'transparent',
              color: tab.id === activeTabId ? 'var(--text-primary)' : 'var(--text-secondary)',
              border: '1px solid',
              borderColor: tab.id === activeTabId ? 'var(--border-primary)' : 'transparent',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}
          >
            <span
              onClick={() => setActiveTabId(tab.id)}
              style={{ cursor: 'pointer' }}
            >
              {tab.name}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSessionTabs(prev => {
                  const filtered = prev.filter(t => t.id !== tab.id);
                  if (activeTabId === tab.id && filtered.length > 0) {
                    setActiveTabId(filtered[filtered.length - 1].id);
                  }
                  return filtered;
                });
              }}
              style={{
                padding: '0.125rem',
                backgroundColor: 'transparent',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                color: 'var(--text-tertiary)',
                fontSize: '0.875rem',
                lineHeight: 1
              }}
              title="Close tab"
            >
              ×
            </button>
          </div>
        ))}
        <button
          onClick={() => createNewSession()}
          style={{
            padding: '0.25rem 0.5rem',
            borderRadius: '0.25rem',
            fontSize: '0.75rem',
            backgroundColor: 'transparent',
            color: 'var(--text-tertiary)',
            border: '1px solid var(--border-primary)',
            cursor: 'pointer',
            marginLeft: '0.5rem'
          }}
          title="New Session"
        >
          +
        </button>
      </div>

      {/* Active Session Content */}
      {activeTab && (
        <>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <AgentTranscriptPanel
              sessionId={activeTab.sessionData.id}
              sessionData={activeTab.sessionData}
              onFileClick={handleFileClick}
              onTodoClick={handleTodoClick}
            />
          </div>

          {/* Chat Input */}
          <div style={{
            borderTop: '1px solid var(--border-primary)',
            backgroundColor: 'var(--surface-secondary)',
            padding: '0.75rem',
            display: 'flex',
            gap: '0.5rem',
            alignItems: 'flex-end'
          }}>
            <textarea
              ref={textareaRef}
              value={promptInput}
              onChange={(e) => setPromptInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your message... (Enter to send, Shift+Enter for new line)"
              disabled={isSending}
              style={{
                flex: 1,
                minHeight: '2.5rem',
                maxHeight: '10rem',
                padding: '0.5rem',
                backgroundColor: 'var(--surface-primary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-primary)',
                borderRadius: '0.375rem',
                resize: 'vertical',
                fontFamily: 'inherit',
                fontSize: '0.875rem',
                outline: 'none'
              }}
            />
            <button
              onClick={handleSendMessage}
              disabled={isSending || !promptInput.trim()}
              style={{
                padding: '0.5rem 1rem',
                backgroundColor: isSending || !promptInput.trim() ? 'var(--surface-tertiary)' : 'var(--color-interactive)',
                color: isSending || !promptInput.trim() ? 'var(--text-tertiary)' : 'white',
                border: 'none',
                borderRadius: '0.375rem',
                cursor: isSending || !promptInput.trim() ? 'not-allowed' : 'pointer',
                fontSize: '0.875rem',
                fontWeight: 500,
                whiteSpace: 'nowrap'
              }}
            >
              {isSending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </>
      )}
    </div>
  );
};
