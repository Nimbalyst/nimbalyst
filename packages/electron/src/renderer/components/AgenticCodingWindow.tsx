import React, { useState, useEffect, useRef } from 'react';
import { AgentTranscriptPanel, TodoItem, FileEditSummary } from '@stravu/runtime';
import type { SessionData, ChatAttachment } from '@stravu/runtime/ai/server/types';
import { SessionDropdown } from './AIChat/SessionDropdown';
import { FileGutter } from './AIChat/FileGutter';
import { WorkspaceHeader } from './WorkspaceHeader';
import { TabBar } from './TabManager/TabBar';
import type { Tab } from './TabManager/TabManager';
import { AgenticInput } from './AgenticCoding/AgenticInput';
import { SessionHistory } from './AgenticCoding/SessionHistory';
import { ResizablePanel } from './AgenticCoding/ResizablePanel';
import { useFileMention } from '../hooks/useFileMention';
import './TabManager/TabManager.css';

interface AgenticCodingWindowProps {
  sessionId?: string;
  workspacePath: string;
  planDocumentPath?: string;
}

interface SessionTab {
  id: string;
  name: string;
  sessionData: SessionData;
  isPinned?: boolean;
  draftInput?: string;
  draftAttachments?: ChatAttachment[];
}

type SessionListItem = Pick<SessionData, 'id' | 'createdAt' | 'name' | 'title' | 'provider' | 'model'> & {
  messageCount?: number;
};

export const AgenticCodingWindow: React.FC<AgenticCodingWindowProps> = ({
  sessionId: initialSessionId,
  workspacePath,
  planDocumentPath
}) => {
  // console.log('[AgenticCodingWindow] RENDER START', { initialSessionId, workspacePath, planDocumentPath });

  const [sessionTabs, setSessionTabs] = useState<SessionTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [availableSessions, setAvailableSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [closedSessions, setClosedSessions] = useState<SessionTab[]>([]);
  const [streamingContent, setStreamingContent] = useState<{
    sessionId: string;
    content: string;
  } | null>(null);
  const [testStreamingContent, setTestStreamingContent] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const initializedRef = useRef(false);
  const streamingTimeoutRef = useRef<NodeJS.Timeout>();

  // Session history layout state
  const [sessionHistoryWidth, setSessionHistoryWidth] = useState(240);
  const [sessionHistoryCollapsed, setSessionHistoryCollapsed] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);

  const MAX_CLOSED_SESSION_HISTORY = 10;

  // File mention support
  const {
    options: fileMentionOptions,
    handleSearch: handleFileMentionSearch,
    handleSelect: handleFileMentionSelect
  } = useFileMention({
    onInsertReference: () => {
      // File reference insertion is handled by AgenticInput
    }
  });

  // console.log('[AgenticCodingWindow] State initialized', { loading, error, activeTabId, tabCount: sessionTabs.length });

  // Set window title with workspace name
  useEffect(() => {
    const workspaceName = workspacePath.split('/').pop() || 'Unknown Workspace';
    if (window.electronAPI?.setTitle) {
      window.electronAPI.setTitle(`Agentic Coding - ${workspaceName}`);
    }
  }, [workspacePath]);

  // Load session history layout from workspace state
  useEffect(() => {
    const loadLayout = async () => {
      try {
        const result = await window.electronAPI.invoke('workspace:get-agentic-coding-state', workspacePath);
        if (result?.sessionHistoryLayout) {
          const layout = result.sessionHistoryLayout;
          setSessionHistoryWidth(layout.width ?? 240);
          setSessionHistoryCollapsed(layout.collapsed ?? false);
          setCollapsedGroups(layout.collapsedGroups ?? []);
        }
      } catch (err) {
        console.error('[AgenticCoding] Failed to load session history layout:', err);
      }
    };
    loadLayout();
  }, [workspacePath]);

  // Save session history layout to workspace state when it changes
  useEffect(() => {
    const saveLayout = async () => {
      try {
        await window.electronAPI.invoke('workspace:save-agentic-coding-state', workspacePath, {
          sessionHistoryLayout: {
            width: sessionHistoryWidth,
            collapsed: sessionHistoryCollapsed,
            collapsedGroups
          }
        });
      } catch (err) {
        console.error('[AgenticCoding] Failed to save session history layout:', err);
      }
    };

    // Debounce saves
    const timer = setTimeout(saveLayout, 500);
    return () => clearTimeout(timer);
  }, [workspacePath, sessionHistoryWidth, sessionHistoryCollapsed, collapsedGroups]);

  // Test mode: listen for test streaming events
  useEffect(() => {
    const handleTestStreaming = () => {
      const content = (window as any).__testStreamingContent;
      console.log('[AgenticCoding] Test streaming event fired, content:', content);
      setTestStreamingContent(content);
    };

    // Expose direct function for tests
    (window as any).__agenticSetTestStreaming = (content: string | null) => {
      console.log('[AgenticCoding] Direct test function called with:', content);
      setTestStreamingContent(content);
    };

    console.log('[AgenticCoding] Registering test streaming listener and direct function');
    window.addEventListener('test-streaming-updated', handleTestStreaming);
    return () => {
      console.log('[AgenticCoding] Removing test streaming listener');
      window.removeEventListener('test-streaming-updated', handleTestStreaming);
      delete (window as any).__agenticSetTestStreaming;
    };
  }, []);

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
      undefined, // no document context
      workspacePath,
      undefined, // no specific model - claude-code manages its own
      'coding' // Mark as coding session to enable all tools
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

    // Notify plan document about the new session
    if (planPath) {
      await window.electronAPI.invoke('plan-status:notify-session-created', {
        sessionId: sessionData.id,
        planDocumentPath: planPath
      });
    }

    return sessionData;
  };

  // Load or create initial session
  useEffect(() => {
    // console.log('[AgenticCodingWindow] useEffect STARTING', { initialSessionId, workspacePath, initialized: initializedRef.current });

    // Prevent double initialization in React StrictMode
    if (initializedRef.current) {
      // console.log('[AgenticCodingWindow] Already initialized, skipping');
      return;
    }
    initializedRef.current = true;

    const loadOrCreateSession = async () => {
      try {
        // console.log('[AgenticCodingWindow] loadOrCreateSession START');
        setLoading(true);
        setError(null);

        // Load all coding sessions for the dropdown
        await loadCodingSessions();

        // Try to restore from agentic tab state
        const tabStateResult = await window.electronAPI?.getWorkspaceTabState?.();
        const savedTabs = tabStateResult?.tabs || [];

        if (savedTabs.length > 0) {
          // console.log('[AgenticCoding] Restoring from agentic tabs:', savedTabs.length, 'tabs');

          // Load all session tabs
          const restoredTabs: SessionTab[] = [];
          for (const savedTab of savedTabs) {
            try {
              // Extract session ID from session:// or agentic:// URL (backward compat)
              const sessionId = savedTab.filePath.replace(/^(session|agentic):\/\//, '') || savedTab.id;
              const sessionData = await window.electronAPI.aiLoadSession(sessionId, workspacePath);
              if (sessionData) {
                restoredTabs.push({
                  id: sessionId,
                  name: savedTab.fileName,
                  sessionData,
                  isPinned: savedTab.isPinned
                });
              }
            } catch (err) {
              console.error('[AgenticCoding] Failed to load saved session:', savedTab.filePath, err);
            }
          }

          if (restoredTabs.length > 0) {
            setSessionTabs(restoredTabs);
            // Extract active tab ID (handle both old agentic:// and new session:// format)
            const activeId = tabStateResult.activeTabId?.replace(/^(session|agentic):\/\//, '') || tabStateResult.activeTabId || restoredTabs[0].id;
            setActiveTabId(activeId);

            // Restore closed sessions history if available
            if (tabStateResult.closedTabs && Array.isArray(tabStateResult.closedTabs)) {
              const restoredClosedSessions: SessionTab[] = [];
              for (const closedTab of tabStateResult.closedTabs) {
                try {
                  const sessionId = closedTab.filePath.replace(/^(session|agentic):\/\//, '') || closedTab.id;
                  const sessionData = await window.electronAPI.aiLoadSession(sessionId, workspacePath);
                  if (sessionData) {
                    restoredClosedSessions.push({
                      id: sessionId,
                      name: closedTab.fileName,
                      sessionData,
                      isPinned: closedTab.isPinned
                    });
                  }
                } catch (err) {
                  console.error('[AgenticCoding] Failed to load closed session:', closedTab.filePath, err);
                }
              }
              setClosedSessions(restoredClosedSessions);
            }

            setLoading(false);
            return;
          }
        }

        // No saved state - load initial session or create first-time session
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
          // First time opening - create a new session
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);  // Only run once on mount

  // Save to agentic tab state when tabs change
  useEffect(() => {
    if (sessionTabs.length === 0 && closedSessions.length === 0) return;

    const saveState = async () => {
      try {
        // Convert session tabs to tab format
        const tabs = sessionTabs.map(tab => ({
          id: tab.id,
          filePath: `session://${tab.id}`,
          fileName: tab.name,
          isDirty: false,
          isPinned: tab.isPinned || false,
          isVirtual: true
        }));

        // Convert closed sessions to simple format
        const closedSessionsData = closedSessions.map(tab => ({
          id: tab.id,
          filePath: `session://${tab.id}`,
          fileName: tab.name,
          isPinned: tab.isPinned || false
        }));

        await window.electronAPI?.saveWorkspaceTabState?.({
          tabs,
          activeTabId: activeTabId,
          tabOrder: tabs.map(t => t.id),
          closedTabs: closedSessionsData
        });
      } catch (err) {
        console.error('[AgenticCoding] Failed to save tabs state:', err);
      }
    };

    // Debounce saves
    const timer = setTimeout(saveState, 500);
    return () => clearTimeout(timer);
  }, [sessionTabs, activeTabId, closedSessions]);

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

  // Listen for requests to open a specific session (from plan status)
  useEffect(() => {
    const handleOpenSession = async (sessionId: string) => {
      // console.log('[AgenticCoding] Received request to open session:', sessionId);
      await openSessionInTab(sessionId);
    };

    window.electronAPI.on?.('agentic-coding:open-session', handleOpenSession);

    return () => {
      window.electronAPI.off?.('agentic-coding:open-session', handleOpenSession);
    };
  }, [openSessionInTab]);

  // Listen for AI streaming responses
  useEffect(() => {
    const handleStreamResponse = async (data: any) => {
      if (!activeTabId) return;

      // Handle streaming text content in real-time (debounced)
      if (data.partial && !data.isComplete) {
        // Clear any pending timeout
        if (streamingTimeoutRef.current) {
          clearTimeout(streamingTimeoutRef.current);
        }

        // Remove thinking placeholder when streaming starts (first chunk)
        if (!streamingContent) {
          setSessionTabs(prev => prev.map(tab => {
            if (tab.id === activeTabId) {
              return {
                ...tab,
                sessionData: {
                  ...tab.sessionData,
                  messages: tab.sessionData.messages.filter(m => !m.isThinking)
                }
              };
            }
            return tab;
          }));
        }

        // Debounce: update every 50ms to avoid excessive renders
        streamingTimeoutRef.current = setTimeout(() => {
          setStreamingContent({
            sessionId: activeTabId,
            content: data.partial
          });
        }, 50);
      }

      // Handle streaming tool calls in real-time
      // Note: We don't reload the session here anymore - tool calls will be loaded at completion
      // This prevents tool messages from appearing above the streaming content header
      if (data.toolCalls && Array.isArray(data.toolCalls) && data.toolCalls.length > 0) {
        // console.log('[AgenticCoding] Received tool calls during streaming:', data.toolCalls.length);
        // Tool calls are saved to the database but not displayed until streaming completes
      }

      // Handle tool errors in real-time
      // Note: We don't reload the session here anymore - errors will be loaded at completion
      if (data.toolError) {
        // console.log('[AgenticCoding] Received tool error during streaming');
        // Tool errors are saved to the database but not displayed until streaming completes
      }

      // Handle completion - reload final state
      if (data.isComplete) {
        // Clear streaming content
        setStreamingContent(null);
        if (streamingTimeoutRef.current) {
          clearTimeout(streamingTimeoutRef.current);
        }

        // console.log('[AgenticCoding] Stream complete, reloading session:', activeTabId);
        try {
          const sessionData = await window.electronAPI.aiLoadSession(activeTabId, workspacePath);
          if (sessionData) {
            setSessionTabs(prev => prev.map(tab => {
              if (tab.id === activeTabId) {
                return { ...tab, sessionData };
              }
              return tab;
            }));

            // Create history snapshots for edited files
            if (window.electronAPI?.history && sessionData.messages) {
              try {
                // Find the most recent user message for prompt summary
                const userMessages = sessionData.messages.filter((m: any) => m.role === 'user');
                const lastUserMessage = userMessages[userMessages.length - 1];
                const promptSummary = lastUserMessage?.content
                  ? (lastUserMessage.content.length > 100
                    ? lastUserMessage.content.substring(0, 97) + '...'
                    : lastUserMessage.content)
                  : 'AI Edit';

                // Find tool calls that indicate file edits (applyDiff, etc.)
                const editedFiles = new Set<string>();
                for (const message of sessionData.messages) {
                  if (message.role === 'tool' && message.toolCall) {
                    const toolName = message.toolCall.name;
                    // Check for file editing tools
                    if (toolName === 'applyDiff' || toolName?.endsWith('__applyDiff') ||
                        toolName === 'editFile' || toolName?.endsWith('__editFile')) {
                      const targetFile = message.toolCall.targetFilePath ||
                                        message.toolCall.arguments?.filePath ||
                                        message.toolCall.arguments?.file;
                      if (targetFile && message.toolCall.result?.success) {
                        editedFiles.add(targetFile);
                      }
                    }
                  }
                }

                // Create snapshots for each edited file
                for (const filePath of editedFiles) {
                  try {
                    // Read the current file content
                    const fileContent = await window.electronAPI.invoke('workspace:read-file', {
                      workspacePath,
                      filePath
                    });

                    if (fileContent) {
                      await window.electronAPI.history.createSnapshot(
                        filePath,
                        fileContent,
                        'ai-edit',
                        `AI Edit: ${promptSummary}`
                      );

                      console.log('[AgenticCoding] Created AI edit history snapshot for', filePath);
                    }
                  } catch (error) {
                    console.error('[AgenticCoding] Failed to create snapshot for', filePath, error);
                  }
                }
              } catch (error) {
                console.error('[AgenticCoding] Failed to create AI edit history snapshots:', error);
              }
            }
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
      // Clear streaming content
      setStreamingContent(null);
      if (streamingTimeoutRef.current) {
        clearTimeout(streamingTimeoutRef.current);
      }
      // Remove thinking message on error
      if (activeTabId) {
        setSessionTabs(prev => prev.map(tab => {
          if (tab.id === activeTabId) {
            return {
              ...tab,
              sessionData: {
                ...tab.sessionData,
                messages: tab.sessionData.messages.filter(m => !m.isThinking)
              }
            };
          }
          return tab;
        }));
      }
    };

    window.electronAPI.onAIStreamResponse(handleStreamResponse);
    window.electronAPI.onAIError(handleStreamError);

    return () => {
      // Cleanup streaming timeout on unmount
      if (streamingTimeoutRef.current) {
        clearTimeout(streamingTimeoutRef.current);
      }
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

  const handleCancelRequest = async () => {
    try {
      const result = await window.electronAPI.aiCancelRequest();
      if (result.success) {
        setIsSending(false);
        // Clear streaming content
        setStreamingContent(null);
        if (streamingTimeoutRef.current) {
          clearTimeout(streamingTimeoutRef.current);
        }
        // Remove thinking message
        if (activeTabId) {
          setSessionTabs(prev => prev.map(tab => {
            if (tab.id === activeTabId) {
              return {
                ...tab,
                sessionData: {
                  ...tab.sessionData,
                  messages: tab.sessionData.messages.filter(m => !m.isThinking)
                }
              };
            }
            return tab;
          }));
        }
      }
    } catch (err) {
      console.error('[AgenticCoding] Failed to cancel request:', err);
    }
  };

  const handleSendMessage = async () => {
    if (!activeTabInput.trim() || !activeTabId) return;

    const prompt = activeTabInput.trim();
    const attachments = activeTabAttachments;

    // Clear input and attachments for this tab
    setSessionTabs(prev => prev.map(tab =>
      tab.id === activeTabId
        ? { ...tab, draftInput: '', draftAttachments: [] }
        : tab
    ));
    setIsSending(true);

    // Immediately add user message to the transcript
    setSessionTabs(prev => prev.map(tab => {
      if (tab.id === activeTabId) {
        const userMessage = {
          role: 'user' as const,
          content: prompt,
          timestamp: Date.now(),
          attachments: attachments.length > 0 ? attachments : undefined
        };
        const thinkingMessage = {
          role: 'assistant' as const,
          content: '',
          timestamp: Date.now(),
          isThinking: true
        };
        return {
          ...tab,
          sessionData: {
            ...tab.sessionData,
            messages: [...tab.sessionData.messages, userMessage, thinkingMessage]
          }
        };
      }
      return tab;
    }));

    try {
      // Send message via existing AI service with coding session context
      await window.electronAPI.aiSendMessage(
        prompt,
        { sessionType: 'coding', attachments } as any, // Mark as coding session to enable all tools, include attachments
        activeTabId,
        workspacePath
      );
    } catch (err) {
      console.error('[AgenticCoding] Failed to send message:', err);
      setError(String(err));
      setIsSending(false);
      // Remove thinking message on error
      setSessionTabs(prev => prev.map(tab => {
        if (tab.id === activeTabId) {
          return {
            ...tab,
            sessionData: {
              ...tab.sessionData,
              messages: tab.sessionData.messages.filter(m => !m.isThinking)
            }
          };
        }
        return tab;
      }));
    }
    // Note: setIsSending(false) happens when we receive the completion event
  };

  const activeTab = sessionTabs.find(tab => tab.id === activeTabId);
  const activeTabInput = activeTab?.draftInput || '';
  const activeTabAttachments = activeTab?.draftAttachments || [];

  const handleInputChange = (value: string) => {
    if (!activeTabId) return;
    setSessionTabs(prev => prev.map(tab =>
      tab.id === activeTabId
        ? { ...tab, draftInput: value }
        : tab
    ));
  };

  const handleAttachmentAdd = (attachment: ChatAttachment) => {
    if (!activeTabId) return;
    setSessionTabs(prev => prev.map(tab =>
      tab.id === activeTabId
        ? { ...tab, draftAttachments: [...(tab.draftAttachments || []), attachment] }
        : tab
    ));
  };

  const handleAttachmentRemove = (attachmentId: string) => {
    if (!activeTabId) return;
    setSessionTabs(prev => prev.map(tab =>
      tab.id === activeTabId
        ? { ...tab, draftAttachments: (tab.draftAttachments || []).filter(a => a.id !== attachmentId) }
        : tab
    ));
  };

  const handleOpenSessionManager = () => {
    window.electronAPI.invoke('open-session-manager', workspacePath);
  };

  // Convert SessionTab to Tab format for TabBar component
  const convertToTabs = (sessionTabs: SessionTab[]): Tab[] => {
    return sessionTabs.map(tab => ({
      id: tab.id,
      filePath: `session://${tab.id}`,
      fileName: tab.name,
      content: '', // Virtual tabs don't have content
      isDirty: false,
      isPinned: tab.isPinned || false,
      isVirtual: true
    }));
  };

  // Handle tab operations from TabBar
  const handleTabSelect = (tabId: string) => {
    setActiveTabId(tabId);
  };

  const handleTabClose = (tabId: string) => {
    // Find the tab being closed and add to closed sessions history
    const closingTab = sessionTabs.find(t => t.id === tabId);
    if (closingTab) {
      setClosedSessions(prev => [closingTab, ...prev].slice(0, MAX_CLOSED_SESSION_HISTORY));
    }

    setSessionTabs(prev => {
      const filtered = prev.filter(t => t.id !== tabId);
      if (activeTabId === tabId && filtered.length > 0) {
        setActiveTabId(filtered[filtered.length - 1].id);
      } else if (filtered.length === 0) {
        setActiveTabId(null);
      }
      return filtered;
    });
  };

  // Reopen the last closed session
  const reopenLastClosedSession = async () => {
    if (closedSessions.length === 0) return;

    const [lastClosed, ...remainingClosed] = closedSessions;
    setClosedSessions(remainingClosed);

    // Reopen the session - load it fresh from the database
    await openSessionInTab(lastClosed.id);
  };

  const handleTabReorder = (fromIndex: number, toIndex: number) => {
    setSessionTabs(prev => {
      const newTabs = [...prev];
      const [movedTab] = newTabs.splice(fromIndex, 1);
      newTabs.splice(toIndex, 0, movedTab);
      return newTabs;
    });
  };

  const handleTogglePin = (tabId: string) => {
    setSessionTabs(prev => {
      const tab = prev.find(t => t.id === tabId);
      if (!tab) return prev;

      const newIsPinned = !tab.isPinned;
      const updatedTab = { ...tab, isPinned: newIsPinned };

      // Create new array with updated tab
      let newTabs = prev.map(t => t.id === tabId ? updatedTab : t);

      // Reorder: pinned tabs go to the front
      if (newIsPinned) {
        // Remove the tab from its current position
        newTabs = newTabs.filter(t => t.id !== tabId);
        // Find where to insert it (after the last pinned tab)
        const lastPinnedIndex = newTabs.findIndex(t => !t.isPinned);
        const insertIndex = lastPinnedIndex === -1 ? newTabs.length : lastPinnedIndex;
        newTabs.splice(insertIndex, 0, updatedTab);
      } else {
        // Unpinning: move to first unpinned position
        newTabs = newTabs.filter(t => t.id !== tabId);
        const firstUnpinnedIndex = newTabs.findIndex(t => !t.isPinned);
        const insertIndex = firstUnpinnedIndex === -1 ? newTabs.length : firstUnpinnedIndex;
        newTabs.splice(insertIndex, 0, updatedTab);
      }

      return newTabs;
    });
  };

  const handleNewTab = () => {
    createNewSession();
  };

  const handleTabRename = async (tabId: string, newName: string) => {
    // Update local state
    setSessionTabs(prev => prev.map(tab => {
      if (tab.id === tabId) {
        return { ...tab, name: newName };
      }
      return tab;
    }));

    // Persist to database via SessionManager
    try {
      await window.electronAPI.invoke('sessions:update-title', tabId, newName);
    } catch (err) {
      console.error('[AgenticCoding] Failed to update session title:', err);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + Shift + T to reopen last closed session
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        reopenLastClosedSession();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closedSessions]); // Re-bind when closedSessions changes

  // console.log('[AgenticCodingWindow] RENDER', { loading, error, activeTabId, tabCount: sessionTabs.length });

  if (loading) {
    // console.log('[AgenticCodingWindow] Rendering LOADING state');
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--surface-primary)' }}>
        <div style={{ color: 'var(--text-secondary)' }}>Loading session...</div>
      </div>
    );
  }

  if (error) {
    console.log('[AgenticCodingWindow] Rendering ERROR state', { error });
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--surface-primary)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: 'var(--status-error)', marginBottom: '0.5rem' }}>Failed to load session</div>
          <div style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>{error}</div>
        </div>
      </div>
    );
  }

  // Remove the early return for empty tabs - we want to show session history even with no tabs

  // console.log('[AgenticCodingWindow] Rendering MAIN content');
  // console.log('[AgenticCodingWindow] About to render AgentTranscriptPanel');
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--surface-primary)' }}>
      <WorkspaceHeader
        workspacePath={workspacePath}
        subtitle="Code"
        actions={
          <>
            <button
              onClick={() => createNewSession()}
              style={{
                padding: '0.375rem 0.75rem',
                borderRadius: '0.25rem',
                fontSize: '0.75rem',
                backgroundColor: 'var(--primary-color)',
                color: 'white',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 500
              }}
              title="New Session"
            >
              New Session
            </button>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
              {activeTab?.sessionData.provider || 'claude-code'}
            </span>
            <SessionDropdown
              currentSessionId={activeTabId}
              sessions={availableSessions}
              onSessionSelect={openSessionInTab}
              onNewSession={() => createNewSession()}
              onDeleteSession={deleteSession}
              onOpenSessionManager={handleOpenSessionManager}
            />
          </>
        }
      />

      {/* Main Content with Resizable Session History Panel */}
      <ResizablePanel
        leftWidth={sessionHistoryWidth}
        minWidth={180}
        maxWidth={400}
        onWidthChange={setSessionHistoryWidth}
        collapsed={sessionHistoryCollapsed}
        leftPanel={
          <SessionHistory
            workspacePath={workspacePath}
            activeSessionId={activeTabId}
            onSessionSelect={openSessionInTab}
            onSessionDelete={deleteSession}
            collapsedGroups={collapsedGroups}
            onCollapsedGroupsChange={setCollapsedGroups}
          />
        }
        rightPanel={
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* Tabs */}
            {sessionTabs.length > 0 && (
              <TabBar
                tabs={convertToTabs(sessionTabs)}
                activeTabId={activeTabId}
                onTabSelect={handleTabSelect}
                onTabClose={handleTabClose}
                onNewTab={handleNewTab}
                onTogglePin={handleTogglePin}
                onTabReorder={handleTabReorder}
                onReopenLastClosed={reopenLastClosedSession}
                hasClosedTabs={closedSessions.length > 0}
                onTabRename={handleTabRename}
                allowRename={true}
              />
            )}

            {/* Active Session Content */}
            {activeTab ? (
              <>
                {/* Referenced files gutter at top */}
                <FileGutter
                  sessionId={activeTab.id}
                  workspacePath={workspacePath}
                  type="referenced"
                  onFileClick={handleFileClick}
                />

                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <AgentTranscriptPanel
                    sessionId={activeTab.sessionData.id}
                    sessionData={activeTab.sessionData}
                    streamingContent={
                      testStreamingContent ||
                      (streamingContent?.sessionId === activeTab.id
                        ? streamingContent.content
                        : undefined)
                    }
                    onFileClick={handleFileClick}
                    onTodoClick={handleTodoClick}
                    initialSettings={{
                      showToolCalls: true,
                      compactMode: false,
                      collapseTools: false,
                      showThinking: true,
                      showSessionInit: false
                    }}
                  />
                </div>

                {/* Chat Input */}
                <AgenticInput
                  value={activeTabInput}
                  onChange={handleInputChange}
                  onSend={handleSendMessage}
                  onCancel={handleCancelRequest}
                  isLoading={isSending}
                  workspacePath={workspacePath}
                  sessionId={activeTabId || undefined}
                  fileMentionOptions={fileMentionOptions}
                  onFileMentionSearch={handleFileMentionSearch}
                  onFileMentionSelect={handleFileMentionSelect}
                  attachments={activeTabAttachments}
                  onAttachmentAdd={handleAttachmentAdd}
                  onAttachmentRemove={handleAttachmentRemove}
                />
              </>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ textAlign: 'center', maxWidth: '400px', padding: '2rem' }}>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>
                    No session selected
                  </div>
                  <div style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>
                    Select a session from the history or create a new one
                  </div>
                </div>
              </div>
            )}
          </div>
        }
      />
    </div>
  );
};
