import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChatHeader } from './ChatHeader';
import { ChatMessages } from './ChatMessages';
import { ChatInput } from './ChatInput';
import { EmptyState } from './EmptyState';
import { PerformanceMetrics } from './PerformanceMetrics';
import { aiApi, DocumentContext } from '../../services/aiApi';
import { logger } from '../../utils/logger';
import { errorNotificationService } from '../../services/ErrorNotificationService';
import { DEFAULT_MODELS } from '@stravu/runtime/ai/modelConstants';
import { editorRegistry } from '@stravu/runtime/ai/EditorRegistry';
import './AIChat.css';

interface AIChatProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  width: number;
  onWidthChange: (width: number) => void;
  documentContext?: DocumentContext & { getLatestContent?: () => string };
  onApplyEdit?: (edit: any, prompt?: string, aiResponse?: string) => void;
  workspacePath?: string;
  sessionToLoad?: { sessionId: string; workspacePath?: string } | null;
  onSessionLoaded?: () => void;
  onSessionIdChange?: (sessionId: string | null) => void;
}

export function AIChat({
  isCollapsed,
  onToggleCollapse,
  width,
  onWidthChange,
  documentContext,
  onApplyEdit,
  workspacePath,
  sessionToLoad,
  onSessionLoaded,
  onSessionIdChange,
  onShowApiKeyError
}: AIChatProps & { onShowApiKeyError?: () => void }) {
  const [messages, setMessages] = useState<Array<{
    role: 'user' | 'assistant' | 'tool';
    content: string;
    edits?: any[];
    toolCall?: {  // For tool role messages, this contains the tool call data
      name: string;
      arguments?: any;
      result?: any;
    };
    isStreamingStatus?: boolean;
    streamingData?: {
      position: string;
      mode: string;
      content: string;
      isActive: boolean;
    };
    isError?: boolean;
    errorMessage?: string;
  }>>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null); // null = checking, true/false = result
  const [isStreamingToEditor, setIsStreamingToEditor] = useState(false);
  const [streamingEditId, setStreamingEditId] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState<string>('');
  const [sessions, setSessions] = useState<Array<any>>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [tempInput, setTempInput] = useState('');
  const [currentUserMessage, setCurrentUserMessage] = useState<string>(''); // Track current user message for error reporting
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const [showPerformanceMetrics, setShowPerformanceMetrics] = useState<boolean>(() => {
    // Load performance metrics visibility from localStorage
    return localStorage.getItem('ai-show-performance-metrics') === 'true';
  });

  // Get the current session for easy access
  const getCurrentSession = () => {
    if (!currentSessionId) return null;
    return sessions.find(s => s.id === currentSessionId) || null;
  };

  // Get the effective model ID from the current session
  const getEffectiveModelId = () => {
    const session = getCurrentSession();
    if (session) {
      return session.provider === 'claude-code'
        ? 'claude-code'
        : `${session.provider}:${session.model}`;
    }
    return currentModel;
  };

  // Parse provider and model from the combined ID
  const parseModelId = (modelId: string): { provider: string; model: string | undefined } => {
    // Special case for claude-code which doesn't have a model suffix
    if (modelId === 'claude-code') {
      return { provider: 'claude-code', model: undefined };
    }

    const [provider, ...modelParts] = modelId.split(':');
    const model = modelParts.join(':'); // Handle model IDs that might contain ':'

    return { provider, model };
  };

  const getModelDisplayName = (modelId: string): string => {
    if (!modelId) return '';

    // Special cases
    if (modelId === 'claude-code') return 'Claude Code';

    const { provider, model } = parseModelId(modelId);

    // Provider-specific display names
    switch (provider) {
      case 'claude':
        return 'Claude';
      case 'openai':
        if (model?.includes('gpt-4')) return 'GPT-4';
        if (model?.includes('gpt-3.5')) return 'GPT-3.5';
        return 'OpenAI';
      case 'lmstudio':
        // Extract model name from path if possible
        if (model) {
          const parts = model.split('/');
          if (parts.length > 0) {
            const modelName = parts[parts.length - 1];
            // Clean up common suffixes
            return modelName.replace(/[-_]GGUF$/i, '').replace(/\.gguf$/i, '');
          }
        }
        return 'LM Studio';
      default:
        return provider.charAt(0).toUpperCase() + provider.slice(1);
    }
  };
  const isResizingRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const streamingEditIdRef = useRef<string | null>(null);
  const isStreamingToEditorRef = useRef(false);
  const streamTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  // CRITICAL: Store the document context snapshot at the time each message is sent
  // This ensures edits are applied to the correct document even if the user switches tabs during AI processing
  const messageDocumentContextRef = useRef<{filePath: string; content: string} | null>(null);

  // Load sessions on mount
  const loadSessions = useCallback(async () => {
    try {
      const allSessions = await aiApi.getSessions(workspacePath);
      setSessions(allSessions || []);

      // Sync currentModel with actual session if we have one
      if (currentSessionId && allSessions) {
        const currentSession = allSessions.find(s => s.id === currentSessionId);
        if (currentSession) {
          const expectedModelId = currentSession.provider === 'claude-code'
            ? 'claude-code'
            : `${currentSession.provider}:${currentSession.model}`;

          if (currentModel !== expectedModelId) {
            console.log(`[AIChat] loadSessions - Syncing model: ${currentModel} -> ${expectedModelId}`);
            setCurrentModel(expectedModelId);
            // Don't store in localStorage - it's global across windows!
          }
        }
      }
    } catch (error) {
      logger.session.info('Failed to load sessions:', error);
    }
  }, [workspacePath, currentSessionId, currentModel]);

  // Set up all event listeners FIRST (before initialization)
  useEffect(() => {
    logger.ui.info('Setting up event listeners...');
    // Set up streaming response listener
    const handleStreamResponse = (data: any) => {
      if (data.isComplete) {
        // Final response with edits
        setMessages(prev => {
          const newMessages = [...prev];

          // Check if we have an existing assistant message (might have been created during streaming)
          const lastMessage = newMessages.length > 0 ? newMessages[newMessages.length - 1] : null;
          const hasAssistantMessage = lastMessage && lastMessage.role === 'assistant';

          if (hasAssistantMessage) {
            // Keep existing content if no new content provided (preserves streaming text like "Adding haiku")
            if (!lastMessage.content && data.content) {
              lastMessage.content = data.content;
            }
            // Only add edits if they don't already exist
            if (data.edits && !lastMessage.edits) {
              lastMessage.edits = data.edits;
            }
          } else {
            // Create new assistant message
            newMessages.push({
              role: 'assistant',
              content: data.content || '',
              edits: data.edits
            });
          }
          return newMessages;
        });
        setIsLoading(false);

        // Auto-apply edits when they arrive
        if (data.edits && data.edits.length > 0) {
          data.edits.forEach(async (edit: any) => {
            // CRITICAL: Use the LOCKED document context from when the message was sent
            // This prevents edits from going to the wrong document if the user switched tabs
            const targetContext = messageDocumentContextRef.current;

            if (!targetContext || !targetContext.filePath) {
              const errorMsg = 'Cannot auto-apply edit: No locked document context';
              logger.bridge.error(errorMsg);
              errorNotificationService.showError(
                'AI Edit Failed',
                'Cannot apply edit - no target document context available. This may indicate the message was sent without an active document.',
                { details: 'The AI attempted to apply an edit, but no document context was captured when the message was sent.' }
              );
              setMessages(prev => [...prev, {
                role: 'assistant',
                content: `🚨 Cannot apply edit: No target document context available.`,
                isError: true
              }]);
              return;
            }

            // Verify the target document is still the active one, or switch to it
            const currentActive = documentContext?.filePath;
            if (currentActive !== targetContext.filePath) {
              logger.bridge.warn(`[AUTO-APPLY] Target document ${targetContext.filePath} is not active (current: ${currentActive})`);
              logger.bridge.warn(`[AUTO-APPLY] User switched tabs during AI processing - attempting to switch back`);

              // Try to open the target file
              if (window.electronAPI && workspacePath) {
                try {
                  await window.electronAPI.invoke('workspace-open-file', workspacePath, targetContext.filePath);
                  // Wait a bit for the file to become active
                  await new Promise(resolve => setTimeout(resolve, 500));
                } catch (err) {
                  const errorMsg = `Failed to switch to target document: ${targetContext.filePath}`;
                  logger.bridge.error(`[AUTO-APPLY] ${errorMsg}`, err);
                  errorNotificationService.showError(
                    'AI Edit Failed',
                    `Cannot apply edit - failed to switch to target document "${targetContext.filePath}".`,
                    {
                      details: `The AI tried to apply an edit to ${targetContext.filePath}, but the system could not open that file.`,
                      stack: err instanceof Error ? err.stack : undefined,
                      context: { targetFilePath: targetContext.filePath, currentFilePath: currentActive }
                    }
                  );
                  setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: `🚨 Cannot apply edit: Failed to switch to target document ${targetContext.filePath}`,
                    isError: true
                  }]);
                  return;
                }
              }
            }

            logger.bridge.info(`Auto-applying edit to LOCKED target: ${targetContext.filePath}:`, edit);
            console.error('[AUTO-APPLY] Calling aiApi.applyEdit with targetFilePath:', targetContext.filePath);

            // CRITICAL: Apply the edit through the API WITH the target file path
            const result = await aiApi.applyEdit(edit, targetContext.filePath);
            console.error('[AUTO-APPLY] Result:', result);

            // If we have onApplyEdit callback, notify the parent AFTER the edit is applied
            // This is for UI updates, not for actually applying the edit
            if (onApplyEdit) {
              // Pass the result so the parent knows if it succeeded
              onApplyEdit(edit, currentUserMessage, data.content);
            }

            if (!result.success) {
              // Edit failed - send an automatic follow-up message to Claude
              const currentContent = documentContext?.getLatestContent ? documentContext.getLatestContent() : documentContext?.content || '';
              const errorMessage = `The previous edit command failed because: "${result.error}"\n\nThe current document (${documentContext.filePath}) contains:\n\`\`\`markdown\n${currentContent}\n\`\`\`\n\nPlease provide a corrected edit command using the EXACT text from the document above.`;

              // Add error notification to chat
              setMessages(prev => [...prev, {
                role: 'assistant',
                content: `⚠️ Edit failed for ${documentContext.filePath}: ${result.error}\n\nAutomatically asking Claude to correct...`
              }]);

              // Send the error back to Claude so it can correct itself
              setTimeout(() => {
                handleSendMessage(errorMessage);
              }, 500);
            }
          });
        }
      } else if (data.partial || data.edits || data.toolCalls) {
        // Streaming partial response
        if (data.partial) {
          // Track accumulated content separately to avoid duplication
          setMessages(prev => {
            const newMessages = [...prev];
            const lastMessage = newMessages[newMessages.length - 1];

            if (lastMessage && lastMessage.role === 'assistant' && !lastMessage.isStreamingStatus) {
              // Update existing assistant message - replace content, don't append
              // The partial already contains the full accumulated text
              lastMessage.content = data.partial;
            } else if (!lastMessage || lastMessage.role !== 'assistant' || lastMessage.isStreamingStatus) {
              // Create new assistant message only if there isn't one yet
              newMessages.push({
                role: 'assistant',
                content: data.partial
              });
            }
            return newMessages;
          });
        }

        // Handle edits that come during streaming (before isComplete)
        if (data.edits && data.edits.length > 0) {
          // Update the assistant message with edits
          setMessages(prev => {
            const newMessages = [...prev];
            const lastMessage = newMessages[newMessages.length - 1];

            if (lastMessage && lastMessage.role === 'assistant') {
              // Only add edits if they haven't been added yet
              if (!lastMessage.edits) {
                lastMessage.edits = data.edits;
              } else {
                // Check if these are new edits (simple comparison by length for now)
                const existingCount = lastMessage.edits.length;
                const newCount = data.edits.length;
                if (newCount > existingCount) {
                  // Add only the new edits
                  lastMessage.edits = [...lastMessage.edits, ...data.edits.slice(existingCount)];
                }
              }
            } else {
              // Create new assistant message with edits
              newMessages.push({
                role: 'assistant',
                content: '',
                edits: data.edits
              });
            }
            return newMessages;
          });
        }

        // Handle tool calls that come during streaming
        if (data.toolCalls && data.toolCalls.length > 0) {
          // Track tool calls to avoid duplicates
          setMessages(prev => {
            const newMessages = [...prev];

            // Create a set of existing tool call signatures for deduplication
            const existingToolCalls = new Set(
              newMessages
                .filter(m => m.role === 'tool' && m.toolCall)
                .map(m => `${m.toolCall?.name}-${JSON.stringify(m.toolCall?.arguments)}`)
            );

            for (const toolCall of data.toolCalls) {
              // Skip applyDiff tool calls since they're already shown as edits in the assistant message
              // This avoids duplicate UI elements for the same action
              if (toolCall.name === 'applyDiff' || toolCall.name?.endsWith('__applyDiff')) {
                continue;
              }

              // Create a unique signature for this tool call
              const signature = `${toolCall.name}-${JSON.stringify(toolCall.arguments)}`;

              // Only add if we haven't seen this exact tool call before
              if (!existingToolCalls.has(signature)) {
                newMessages.push({
                  role: 'tool',
                  content: '', // Tool messages don't have text content
                  toolCall: {
                    ...toolCall,
                    targetFilePath: messageDocumentContextRef.current?.filePath || documentContext?.filePath  // Use locked context
                  },
                  isError: toolCall.result?.success === false,
                  errorMessage: toolCall.result?.error
                });
                existingToolCalls.add(signature);
              }
            }
            return newMessages;
          });
        }

        if (data.toolError) {
          setMessages(prev => {
            const newMessages = [...prev];
            const signature = `${data.toolError.name}-${JSON.stringify(data.toolError.arguments)}`;
            const existingIndex = newMessages.findIndex(m =>
              m.role === 'tool' && m.toolCall && `${m.toolCall.name}-${JSON.stringify(m.toolCall.arguments)}` === signature
            );

            const errorInfo = {
              role: 'tool' as const,
              content: '',
              toolCall: {
                name: data.toolError.name,
                arguments: data.toolError.arguments,
                result: data.toolError.result,
                targetFilePath: messageDocumentContextRef.current?.filePath || documentContext?.filePath  // Use locked context
              },
              isError: true,
              errorMessage: data.toolError.error
            };

            if (existingIndex >= 0) {
              newMessages[existingIndex] = {
                ...newMessages[existingIndex],
                ...errorInfo
              };
            } else {
              newMessages.push(errorInfo);
            }
            return newMessages;
          });
        }
      }
    };

    aiApi.on('streamResponse', handleStreamResponse);

    // Set up error listener
    const handleError = (error: any) => {
      logger.api.info('Received error from API:', error);
      setIsLoading(false);

      // Add error message to chat
      const errorMessage = error.message || 'An error occurred while processing your request';
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ Error: ${errorMessage}`,
        isError: true
      }]);
    };

    aiApi.on('error', handleError);

    // Set up edit request listener
    const handleEditRequest = (edit: any) => {
      if (onApplyEdit) {
        // Pass current context for error reporting
        onApplyEdit(edit, currentUserMessage, '');
      }
    };

    aiApi.on('editRequest', handleEditRequest);

    // Set up streaming edit listeners
    const handleStreamEditStart = (config: any) => {
      logger.streaming.info('🎯 Stream Edit Start Event Received:', config);
      console.log('[AIChat] Full streaming config:', JSON.stringify(config, null, 2));
      setIsStreamingToEditor(true);
      isStreamingToEditorRef.current = true; // Set ref immediately
      setStreamingContent(''); // Reset streaming content

      // Clear any existing timeout
      if (streamTimeoutRef.current) {
        clearTimeout(streamTimeoutRef.current);
      }

      // Set a timeout to detect stuck streaming (90 seconds)
      streamTimeoutRef.current = setTimeout(() => {
        if (isStreamingToEditorRef.current) {
          logger.streaming.info('⚠️ Streaming timeout - ending stuck session');
          handleStreamEditEnd({ error: 'Streaming timeout after 90 seconds' });
        }
      }, 90000);

      // Generate a unique ID for this streaming session
      const editId = `stream-${Date.now()}`;
      setStreamingEditId(editId);
      streamingEditIdRef.current = editId; // Set ref immediately
      logger.streaming.info('Generated stream ID:', editId);

      // Initialize the streaming edit in the editor using editorRegistry
      // CRITICAL: Pass the locked target file path
      const targetContext = messageDocumentContextRef.current;
      const targetFilePath = targetContext?.filePath;

      if (!targetFilePath) {
        logger.bridge.error('❌ No target file path available for streaming');
        return;
      }

      const streamConfig = {
        id: editId,
        ...config,
        targetFilePath  // Lock stream to original document
      };

      logger.bridge.info('Calling editorRegistry.startStreaming with:', streamConfig);
      editorRegistry.startStreaming(targetFilePath, streamConfig);

      // Determine position text for display
      let positionText = 'at cursor position';
      if (config.insertAtEnd || config.position === 'end') {
        positionText = 'end of document';
      } else if (config.insertAfter) {
        const snippet = config.insertAfter.substring(0, 50);
        positionText = `after "${snippet}${config.insertAfter.length > 50 ? '...' : ''}"`;
      } else if (config.position === 'after-selection') {
        positionText = 'after selected text';
      } else if (config.position === 'cursor') {
        positionText = 'at cursor position';
      }

      logger.streaming.info(`📍 Streaming to: ${positionText}`);

      // Add a streaming status message
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '',
        isStreamingStatus: true,
        streamingData: {
          position: positionText,
          mode: config.mode || 'after',
          content: '',
          isActive: true
        }
      }]);
    };

    const handleStreamEditContent = (content: string) => {
      const currentStreamId = streamingEditIdRef.current || streamingEditId;
      const isStreaming = isStreamingToEditorRef.current || isStreamingToEditor;
      logger.streaming.info('Stream content received:', {
        hasStreamingEditId: !!currentStreamId,
        isStreamingToEditor: isStreaming,
        contentLength: content?.length,
        preview: content?.substring(0, 50)
      });

      if (!isStreaming || !currentStreamId) {
        logger.streaming.info('Ignoring stream content - not in streaming mode');
        return;
      }

      // Accumulate streaming content for display
      setStreamingContent(prev => {
        const newContent = prev + content;

        // Update the streaming status message with accumulated content
        setMessages(messages => {
          const newMessages = [...messages];
          const lastMsg = newMessages[newMessages.length - 1];
          if (lastMsg && lastMsg.isStreamingStatus && lastMsg.streamingData) {
            lastMsg.streamingData.content = newContent;
          }
          return newMessages;
        });

        return newContent;
      });

      // Stream the content to the editor
      // Stream content to the target file using editorRegistry
      const targetContext = messageDocumentContextRef.current;
      const targetFilePath = targetContext?.filePath;

      if (!targetFilePath) {
        logger.bridge.error('❌ No target file path available for streaming content');
        return;
      }

      logger.bridge.info('Calling editorRegistry.streamContent');
      editorRegistry.streamContent(targetFilePath, currentStreamId, content);
    };

    const handleStreamEditEnd = async (data?: { error?: string }) => {
      const currentStreamId = streamingEditIdRef.current || streamingEditId;
      const isStreaming = isStreamingToEditorRef.current || isStreamingToEditor;
      logger.streaming.info('🏁 Stream Edit End Event Received:', {
        streamingEditId: currentStreamId,
        isStreamingToEditor: isStreaming,
        streamingContentLength: streamingContent.length,
        error: data?.error
      });

      if (!currentStreamId) {
        logger.streaming.info('No streaming edit ID to end');
        return;
      }

      // Finalize the streaming edit in the editor
      // End streaming using editorRegistry
      const targetContext = messageDocumentContextRef.current;
      const targetFilePath = targetContext?.filePath;

      if (!targetFilePath) {
        logger.bridge.error('❌ No target file path available for ending stream');
        return;
      }

      logger.bridge.info('Calling editorRegistry.endStreaming');
      editorRegistry.endStreaming(targetFilePath, currentStreamId);

      // Update the streaming status to complete or error
      setMessages(prev => {
        const newMessages = [...prev];
        const lastMsg = newMessages[newMessages.length - 1];
        if (lastMsg && lastMsg.isStreamingStatus && lastMsg.streamingData) {
          lastMsg.streamingData.isActive = false;
          lastMsg.streamingData.content = streamingContent || (data?.error ? `Error: ${data.error}` : '');
        }
        return newMessages;
      });

      // Save the streaming status message to the session
      // This ensures it persists when sessions are reloaded
      await loadSessions();

      // Clear timeout
      if (streamTimeoutRef.current) {
        clearTimeout(streamTimeoutRef.current);
        streamTimeoutRef.current = null;
      }

      setIsStreamingToEditor(false);
      isStreamingToEditorRef.current = false; // Clear ref
      setStreamingEditId(null);
      streamingEditIdRef.current = null; // Clear ref
      setStreamingContent('');
      setIsLoading(false);
    };

    // Register all event handlers
    logger.ui.info('Registering event handlers...');
    aiApi.on('streamEditStart', handleStreamEditStart);
    aiApi.on('streamEditContent', handleStreamEditContent);
    aiApi.on('streamEditEnd', handleStreamEditEnd);

    // Test that handlers are registered
    logger.ui.info('Event handlers registered:', {
      streamResponse: true,
      editRequest: true,
      streamEditStart: true,
      streamEditContent: true,
      streamEditEnd: true
    });

    return () => {
      logger.ui.info('Cleaning up event handlers...');
      aiApi.off('streamResponse', handleStreamResponse);
      aiApi.off('error', handleError);
      aiApi.off('editRequest', handleEditRequest);
      aiApi.off('streamEditStart', handleStreamEditStart);
      aiApi.off('streamEditContent', handleStreamEditContent);
      aiApi.off('streamEditEnd', handleStreamEditEnd);
    };
  }, [documentContext, onApplyEdit, loadSessions, streamingContent]); // Add missing dependencies

  // Check for API key/provider configuration on mount and when window gains focus
  useEffect(() => {
    const checkApiKey = async () => {
      try {
        const hasKey = await window.electronAPI.aiHasApiKey();
        const previousHasKey = hasApiKey;
        setHasApiKey(hasKey);

        // If we now have a provider configured and didn't before, reset initialization
        if (hasKey && !previousHasKey) {
          // logger.api.info('AI provider now configured, resetting initialization');
          setIsInitialized(false); // This will trigger re-initialization
          setInitError(null); // Clear any previous errors
        }
      } catch (error) {
        logger.api.info('Failed to check API key:', error);
        setHasApiKey(false);
      }
    };

    checkApiKey();

    // Recheck when window gains focus (user might have configured provider in another window)
    const handleFocus = () => {
      checkApiKey();
    };

    // Only check on focus, not periodically
    // Checking every 2 seconds was causing unnecessary CPU usage
    // const interval = setInterval(checkApiKey, 2000);

    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('focus', handleFocus);
      // clearInterval(interval);
    };
  }, [hasApiKey]);

  // Keep UI in sync with current session's provider/model
  useEffect(() => {
    if (!currentSessionId || sessions.length === 0) return;

    const currentSession = sessions.find(s => s.id === currentSessionId);
    if (currentSession && currentSession.provider) {
      let expectedModelId: string;
      if (currentSession.provider === 'claude-code') {
        expectedModelId = 'claude-code';
      } else {
        expectedModelId = currentSession.model
          ? `${currentSession.provider}:${currentSession.model}`
          : `${currentSession.provider}:default`;
      }

      // If UI is out of sync, update it
      if (currentModel !== expectedModelId) {
        console.log(`[AIChat] UI sync: Updating model from ${currentModel} to ${expectedModelId} to match session ${currentSessionId}`);
        setCurrentModel(expectedModelId);
        // Don't store in localStorage - it's global across windows!
      }
    }
  }, [currentSessionId, sessions, currentModel]); // Re-run when session or model changes

  // Initialize Claude AFTER event handlers are set up
  useEffect(() => {
    // Prevent double initialization or initialization without API key
    if (isInitialized || hasApiKey === null || !hasApiKey) return;

    let mounted = true;
    const initClaude = async () => {
      try {
        await aiApi.initialize();

        // First check if there's an existing session for this workspace
        const existingSessions = await aiApi.getSessions(workspacePath);
        let session;

        if (existingSessions && existingSessions.length > 0) {
          // Load the most recent session
          session = await aiApi.loadSession(existingSessions[0].id, workspacePath);

          // ALWAYS restore the provider and model from the session
          // This ensures the UI shows what's actually being used
          if (session && session.provider) {
            let modelIdToSet: string;
            if (session.provider === 'claude-code') {
              modelIdToSet = 'claude-code';
            } else {
              // Use the session's actual model, or fall back to provider default
              modelIdToSet = session.model
                ? `${session.provider}:${session.model}`
                : `${session.provider}:default`;
            }

            console.log(`[AIChat] Initialization: Restoring session ${session.id} with provider: ${session.provider}, model: ${session.model}, UI will show: ${modelIdToSet}`);
            setCurrentModel(modelIdToSet);
            // Don't store in localStorage - it's global across windows!

            // Force update to ensure UI is in sync
            setTimeout(() => {
              setCurrentModel(modelIdToSet);
            }, 100);
          } else if (session) {
            // Session exists but no provider - shouldn't happen but handle it
            console.warn('[AIChat] Session has no provider, will recreate session');
            session = null; // Force new session creation below
          }
        }

        // Don't create a session automatically - user needs to pick a model
        if (!session) {
          console.log('[AIChat] No session and no model selected - waiting for user to choose');
          // Just mark as initialized without a session
          if (mounted) {
            setIsInitialized(true);
          }
          return;
        }

        if (mounted && session) {
          setCurrentSessionId(session.id);
          setIsInitialized(true);

          // Load existing messages if any
          if (session.messages && session.messages.length > 0) {
            const chatMessages = session.messages.map((msg: any) => ({
              role: msg.role,
              content: msg.content,
              edits: msg.edits,
              toolCall: msg.toolCall,
              isStreamingStatus: msg.isStreamingStatus,
              streamingData: msg.streamingData,
              isError: msg.isError,
              errorMessage: msg.errorMessage
            }));
            setMessages(chatMessages);
          }

          // Restore draft input if it exists
          if (session.draftInput) {
            setInputValue(session.draftInput);
          }

          await loadSessions();
        }
      } catch (error: any) {
        if (mounted) {
          logger.api.info('Failed to initialize AI:', error);
          setInitError(error.message || 'Failed to initialize AI');
          // Don't leave in a bad state - reset initialization
          setIsInitialized(false);
        }
      }
    };

    // Small delay to ensure event handlers are registered
    setTimeout(initClaude, 100);

    return () => {
      mounted = false;
    };
  }, [workspacePath, documentContext, loadSessions, hasApiKey]);

  // Update document context when it changes
  useEffect(() => {
    if (isInitialized && documentContext) {
      // Update context for future messages
      // This could be enhanced to send context updates to Claude
    }
  }, [documentContext, isInitialized]);

  // Handle resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;

      // Calculate new width from right edge
      const newWidth = window.innerWidth - e.clientX;
      // Allow up to 50% of window width, with minimum of 280px
      const maxWidth = Math.floor(window.innerWidth * 0.5);
      const clampedWidth = Math.min(Math.max(280, newWidth), maxWidth);
      onWidthChange(clampedWidth);
    };

    const handleMouseUp = () => {
      if (!isResizingRef.current) return;

      isResizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [onWidthChange]);

  const handleSendMessage = useCallback(async (message: string) => {
    if (!message.trim() || !isInitialized) return;

    // Store the current message for error reporting
    setCurrentUserMessage(message);

    // Check if we have a document open
    const hasDocument = documentContext && (documentContext.filePath || documentContext.content);

    // Get fresh document context with latest content
    const freshDocumentContext = hasDocument ? {
      filePath: documentContext?.filePath || '',
      fileType: documentContext?.fileType || 'markdown',
      content: documentContext?.getLatestContent ? documentContext.getLatestContent() : documentContext?.content || '',
      cursorPosition: documentContext?.cursorPosition,
      selection: documentContext?.selection
      // Note: Don't include getLatestContent function as it can't be serialized for IPC
    } : undefined;

    // CRITICAL: Snapshot the document context at send time
    // This locks edits to the document that was active when the message was sent
    if (freshDocumentContext?.filePath) {
      messageDocumentContextRef.current = {
        filePath: freshDocumentContext.filePath,
        content: freshDocumentContext.content
      };
      logger.bridge.info(`[AIChat] Locked message to document: ${freshDocumentContext.filePath}`);
    }

    console.log('[AIChat] Sending message with document context:', {
      filePath: freshDocumentContext?.filePath,
      hasSelection: !!freshDocumentContext?.selection,
      selectionLength: freshDocumentContext?.selection?.length,
      hasCursorPosition: !!freshDocumentContext?.cursorPosition,
      cursorPosition: freshDocumentContext?.cursorPosition,
      hasContent: !!freshDocumentContext?.content,
      contentLength: freshDocumentContext?.content?.length,
      contentPreview: freshDocumentContext?.content?.substring(0, 100)
    });

    // CRITICAL: Warn if sending without a valid file path
    if (!freshDocumentContext?.filePath) {
      logger.bridge.warn('Sending AI message without a valid document context - edits may fail!');
    }

    // If we don't have a session, we can't send a message
    if (!currentSessionId) {
      console.error('[AIChat] No session - cannot send message');
      setIsLoading(false);
      return;
    }

    // Get the session to find out what provider to use
    let sessionForSend = sessions.find(s => s.id === currentSessionId);
    if (!sessionForSend) {
      console.error('[AIChat] Session not found in sessions list, attempting to reload');
      const reloaded = await aiApi.loadSession(currentSessionId, workspacePath);
      if (!reloaded) {
        setIsLoading(false);
        return;
      }
      sessionForSend = reloaded;
      setSessions(prev => {
        const filtered = prev.filter(s => s.id !== reloaded.id);
        return [{ ...reloaded }, ...filtered];
      });
      const expectedModelId = reloaded.provider === 'claude-code'
        ? 'claude-code'
        : `${reloaded.provider}:${reloaded.model}`;
      if (currentModel !== expectedModelId) {
        setCurrentModel(expectedModelId);
      }
    }

    if (!sessionForSend) {
      setIsLoading(false);
      return;
    }

    // Use the session's provider - it's the source of truth
    const actualProvider = sessionForSend.provider;
    const actualModel = sessionForSend.model;
    console.log(`[AIChat] Using session provider: ${actualProvider}, model: ${actualModel}`);

    // Sync UI model to match session
    const expectedModelId = sessionForSend.provider === 'claude-code'
      ? 'claude-code'
      : `${sessionForSend.provider}:${sessionForSend.model}`;

    if (currentModel !== expectedModelId) {
      console.log(`[AIChat] Syncing UI model to match session: ${currentModel} -> ${expectedModelId}`);
      setCurrentModel(expectedModelId);
    }

    // Add user message
    setMessages(prev => [...prev, { role: 'user', content: message }]);
    setInputValue('');
    setHistoryIndex(-1); // Reset history navigation
    setTempInput(''); // Clear temp input
    setIsLoading(true);

    try {
      // Send message to Claude with fresh document context and session ID
      await aiApi.sendMessage(message, freshDocumentContext, currentSessionId!, workspacePath);
      // Reload sessions to update message counts
      await loadSessions();
    } catch (error: any) {
      logger.api.info('Failed to send message:', error);

      // Provide specific error messages
      let errorMessage = 'Sorry, I encountered an error processing your request.';
      if (error?.message?.includes('LMStudio')) {
        errorMessage = error.message;
      } else if (error?.message?.includes('API key')) {
        errorMessage = 'API key error. Please check your API key in settings.';
      } else if (error?.message) {
        errorMessage = `Error: ${error.message}`;
      }

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: errorMessage,
        isError: true
      }]);
      setIsLoading(false);
    }
  }, [isInitialized, documentContext, loadSessions, currentSessionId, workspacePath]);

  const handleNavigateHistory = useCallback((direction: 'up' | 'down') => {
    const userMessages = messages.filter(m => m.role === 'user');
    if (userMessages.length === 0) return;

    let newIndex = historyIndex;

    if (direction === 'up') {
      // Going back in history
      if (historyIndex === -1) {
        // First time pressing up, save current input
        setTempInput(inputValue);
        newIndex = userMessages.length - 1;
      } else if (historyIndex > 0) {
        newIndex = historyIndex - 1;
      }
      // else: already at oldest message, do nothing
    } else {
      // Going forward in history
      if (historyIndex === -1) {
        // Already at current input, do nothing
        return;
      } else if (historyIndex < userMessages.length - 1) {
        newIndex = historyIndex + 1;
      } else if (historyIndex === userMessages.length - 1) {
        // Return to current input
        newIndex = -1;
        setInputValue(tempInput);
        setHistoryIndex(-1);
        return;
      }
    }

    if (newIndex >= 0 && newIndex < userMessages.length) {
      setHistoryIndex(newIndex);
      setInputValue(userMessages[newIndex].content);
    }
  }, [messages, historyIndex, inputValue, tempInput]);

  const handleApplyEdit = useCallback(async (edit: any): Promise<{ success: boolean; error?: string }> => {
    try {
      // CRITICAL: Validate that we have a document open before applying edits
      if (!documentContext || !documentContext.filePath) {
        const errorMsg = 'Cannot apply edit: No active document';
        logger.bridge.error(errorMsg);
        errorNotificationService.showError(
          'AI Edit Failed',
          'No active document is open. Please open a file before requesting AI edits.',
          { details: 'An edit was requested but no document is currently active in the editor.' }
        );
        return {
          success: false,
          error: 'No active document. Please open a file before applying edits.'
        };
      }

      // Additional validation: ensure we have the latest content getter
      if (!documentContext.getLatestContent) {
        const errorMsg = 'Cannot apply edit: No content getter available';
        logger.bridge.error(errorMsg);
        errorNotificationService.showError(
          'AI Edit Failed',
          'Editor not ready. Please wait for the document to fully load before requesting AI edits.',
          {
            details: 'The editor is still initializing. Try again in a moment.',
            context: { filePath: documentContext.filePath }
          }
        );
        return {
          success: false,
          error: 'Editor not ready. Please wait for the document to fully load.'
        };
      }

      logger.bridge.info(`Applying edit to active document: ${documentContext.filePath}`);

      // Apply the edit through the API - this should return a promise
      const result = await aiApi.applyEdit(edit);

      if (result.success) {
        logger.bridge.info(`Edit successfully applied to ${documentContext.filePath}`);
      } else {
        logger.bridge.warn(`Edit failed for ${documentContext.filePath}:`, result.error);
      }

      return result;
    } catch (error) {
      logger.bridge.info('Failed to apply edit:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to apply changes'
      };
    }
  }, [documentContext]);

  const handleCancelRequest = useCallback(async () => {
    try {
      const result = await aiApi.cancelRequest();
      if (result.success) {
        setIsLoading(false);
        setIsStreamingToEditor(false);
        isStreamingToEditorRef.current = false;

        // Clear any streaming timeouts
        if (streamTimeoutRef.current) {
          clearTimeout(streamTimeoutRef.current);
          streamTimeoutRef.current = null;
        }

        // Add a cancelled message to the chat
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: 'Request cancelled by user.'
        }]);
      }
    } catch (error) {
      logger.api.info('Failed to cancel request:', error);
    }
  }, []);


  // Session management handlers
  const handleNewSession = useCallback(async (modelId?: string) => {
    try {
      // Must have a model to create a session
      const selectedModel = modelId || currentModel;
      if (!selectedModel) {
        console.error('[AIChat] No model selected - cannot create session');
        // Open the AI models window so user can configure
        window.electronAPI.openAIModels();
        return;
      }

      const { provider, model } = parseModelId(selectedModel);

      // Update current model
      setCurrentModel(selectedModel);
      // Don't store in localStorage - it's global across windows!

      // Create a clean document context without functions for IPC
      const cleanDocumentContext = documentContext ? {
        filePath: documentContext.filePath,
        fileType: documentContext.fileType,
        content: documentContext.getLatestContent ? documentContext.getLatestContent() : documentContext.content,
        cursorPosition: documentContext.cursorPosition,
        selection: documentContext.selection
      } : undefined;

      const session = await aiApi.createSession(cleanDocumentContext, workspacePath, provider as any, model);
      setCurrentSessionId(session.id);
      setMessages([]);
      setInputValue(''); // Clear input for new session

      // Add the new session to the list immediately so it's available
      setSessions(prev => [...prev, session]);

      // Then reload to get any other updates
      await loadSessions();

      // Focus the input field after creating new session
      setTimeout(() => {
        chatInputRef.current?.focus();
      }, 100);
    } catch (error: any) {
      logger.session.info('Failed to create new session:', error);

      // Check if it's an API key error
      if (error?.message?.includes('API key not configured') ||
          error?.message?.includes('Anthropic API key not configured')) {
        // Show API key error dialog
        if (onShowApiKeyError) {
          onShowApiKeyError();
        }
      } else if (error?.message?.includes('LMStudio')) {
        // Show LMStudio connection error in chat
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: error.message,
          isError: true
        }]);
      } else {
        // Show other errors in chat
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Error: ${error.message || 'Failed to create session'}`,
          isError: true
        }]);
      }
    }
  }, [documentContext, workspacePath, currentModel, loadSessions, onShowApiKeyError]);

  const handleOpenSessionManager = useCallback(async () => {
    try {
      await (window as any).electronAPI.openSessionManager(workspacePath);
    } catch (error) {
      logger.session.info('Failed to open session manager:', error);
    }
  }, [workspacePath]);

  // Sync messages to backend whenever they change
  useEffect(() => {
    if (!currentSessionId || messages.length === 0) return;

    const syncMessages = async () => {
      try {
        await aiApi.updateSessionMessages(currentSessionId, messages, workspacePath);
        // Reload sessions to update message counts
        await loadSessions();
      } catch (error) {
        logger.session.info('Failed to sync messages:', error);
      }
    };

    // Debounce to avoid too many updates
    const timeoutId = setTimeout(syncMessages, 500);
    return () => clearTimeout(timeoutId);
  }, [messages, currentSessionId, workspacePath, loadSessions]);

  // Save draft input whenever it changes
  useEffect(() => {
    if (!currentSessionId || !isInitialized) return;

    const saveDraft = async () => {
      try {
        await aiApi.saveDraftInput(currentSessionId, inputValue, workspacePath);
      } catch (error) {
        logger.session.info('Failed to save draft input:', error);
      }
    };

    // Debounce to avoid too many saves
    const timeoutId = setTimeout(saveDraft, 1000);
    return () => clearTimeout(timeoutId);
  }, [inputValue, currentSessionId, workspacePath, isInitialized]);

  const handleSessionSelect = useCallback(async (sessionId: string) => {
    try {
      const session = await aiApi.loadSession(sessionId, workspacePath);

      // Handle case where session doesn't exist (was deleted)
      if (!session) {
        logger.session.info('Session not found, clearing saved session ID');
        // Clear the saved session ID so we don't try to load it again
        if (onSessionIdChange) {
          onSessionIdChange(null);
        }
        return;
      }

      setCurrentSessionId(session.id);

      // ALWAYS update model based on session (provider:model format)
      // This ensures UI always shows what's actually being used
      if (session.provider) {
        let modelIdToSet: string;
        if (session.provider === 'claude-code') {
          modelIdToSet = 'claude-code';
        } else {
          // Use the session's actual model, or fall back to a sensible default
          modelIdToSet = session.model
            ? `${session.provider}:${session.model}`
            : `${session.provider}:default`;
        }

        console.log(`[AIChat] handleSessionSelect - Syncing UI model: ${modelIdToSet}`);
        setCurrentModel(modelIdToSet);
        // Don't store in localStorage - it's global across windows!
      } else {
        console.warn('[AIChat] handleSessionSelect - Session has no provider');
      }

      // Convert session messages to chat format, preserving streaming status
      const chatMessages = session.messages.map((msg: any) => ({
        role: msg.role,
        content: msg.content,
        edits: msg.edits,
        toolCall: msg.toolCall,
        isStreamingStatus: msg.isStreamingStatus,
        streamingData: msg.streamingData,
        isError: msg.isError,
        errorMessage: msg.errorMessage
      }));

      setMessages(chatMessages);

      // Ensure this session is reflected in the cached list immediately
      setSessions(prev => {
        const filtered = prev.filter(s => s.id !== session.id);
        return [{ ...session }, ...filtered];
      });

      // Restore draft input for this session
      setInputValue(session.draftInput || '');

      // Focus the input field after loading session
      setTimeout(() => {
        chatInputRef.current?.focus();
      }, 100);
    } catch (error) {
      logger.session.info('Failed to load session:', error);
      // Clear the saved session ID on error
      if (onSessionIdChange) {
        onSessionIdChange(null);
      }
    }
  }, [workspacePath, onSessionIdChange]);

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    try {
      // Delete the session
      await aiApi.deleteSession(sessionId, workspacePath);

      // If we deleted the current session, clear the UI but don't create a new one yet
      if (sessionId === currentSessionId) {
        setCurrentSessionId(null);
        setMessages([]);
      }

      // Reload sessions list
      await loadSessions();
    } catch (error) {
      logger.session.info('Failed to delete session:', error);
    }
  }, [currentSessionId, workspacePath, loadSessions]);

  const handleRenameSession = useCallback(async (sessionId: string, newName: string) => {
    try {
      // TODO: Add rename session API call when available
      // await aiApi.renameSession(sessionId, newName);

      await loadSessions();
    } catch (error) {
      logger.session.info('Failed to rename session:', error);
    }
  }, [loadSessions]);

  const handleCopyChat = useCallback(() => {
    // Format messages for copying
    const chatText = messages.map(msg => {
      let text = `[${msg.role.toUpperCase()}]: `;

      if (msg.role === 'tool' && msg.toolCall) {
        text += `Tool: ${msg.toolCall.name}\n`;
        if (msg.toolCall.arguments) {
          text += `Arguments: ${JSON.stringify(msg.toolCall.arguments, null, 2)}\n`;
        }
        if (msg.toolCall.result) {
          text += `Result: ${typeof msg.toolCall.result === 'string' ? msg.toolCall.result : JSON.stringify(msg.toolCall.result, null, 2)}`;
        }
      } else if (msg.isStreamingStatus && msg.streamingData) {
        text += `[Streaming Edit]\n`;
        text += `File: ${msg.streamingData.file}\n`;
        text += `Content:\n${msg.streamingData.content}`;
      } else {
        text += msg.content;

        // Add edits if present
        if (msg.edits && msg.edits.length > 0) {
          text += '\n\n[EDITS]:';
          msg.edits.forEach((edit, i) => {
            text += `\nEdit ${i + 1}:`;
            if (edit.file) text += `\n  File: ${edit.file}`;
            if (edit.operation) text += `\n  Operation: ${edit.operation}`;
            if (edit.content) text += `\n  Content: ${edit.content}`;
          });
        }
      }

      return text;
    }).join('\n\n---\n\n');

    // Add metadata
    const metadata = [
      `Chat Session Export`,
      `Date: ${new Date().toISOString()}`,
      `Session ID: ${currentSessionId || 'None'}`,
      `Workspace: ${workspacePath || 'None'}`,
      `Provider: ${sessions.find(s => s.id === currentSessionId)?.provider || 'None'}`,
      `Model: ${sessions.find(s => s.id === currentSessionId)?.model || 'None'}`,
      `Messages: ${messages.length}`,
      '',
      '=== CHAT HISTORY ===',
      '',
      chatText
    ].join('\n');

    // Copy to clipboard
    navigator.clipboard.writeText(metadata).then(() => {
      logger.ui.info('Chat copied to clipboard');
    }).catch(err => {
      logger.ui.info('Failed to copy chat:', err);
    });
  }, [messages, currentSessionId, workspacePath, sessions]);

  // Handle loading a specific session from Session Manager
  useEffect(() => {
    if (!sessionToLoad || !isInitialized) return;

    const loadRequestedSession = async () => {
      try {
        await handleSessionSelect(sessionToLoad.sessionId);
        if (onSessionLoaded) {
          onSessionLoaded();
        }
      } catch (error) {
        logger.session.info('Failed to load requested session:', error);
      }
    };

    loadRequestedSession();
  }, [sessionToLoad, isInitialized, handleSessionSelect, onSessionLoaded]);

  // Notify parent component when session ID changes
  useEffect(() => {
    if (onSessionIdChange) {
      onSessionIdChange(currentSessionId);
    }
  }, [currentSessionId, onSessionIdChange]);

  if (isCollapsed) {
    return (
      <button
        className="ai-chat-floating-toggle"
        onClick={onToggleCollapse}
        title="Open AI Assistant (⌘⇧A)"
        aria-label="Open AI Assistant"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M10 2L11.5 7.5L17 9L11.5 10.5L10 16L8.5 10.5L3 9L8.5 7.5L10 2Z" fill="currentColor"/>
          <path d="M4 3L4.5 4.5L6 5L4.5 5.5L4 7L3.5 5.5L2 5L3.5 4.5L4 3Z" fill="currentColor" opacity="0.6"/>
          <path d="M16 13L16.5 14.5L18 15L16.5 15.5L16 17L15.5 15.5L14 15L15.5 14.5L16 13Z" fill="currentColor" opacity="0.6"/>
        </svg>
      </button>
    );
  }

  return (
    <div
      ref={panelRef}
      className="ai-chat"
      style={{ width }}
      data-testid="ai-chat-panel"
    >
      <div
        className="ai-chat-resize-handle"
        onMouseDown={handleMouseDown}
      />

      <ChatHeader
        onToggleCollapse={onToggleCollapse}
        showPerformanceMetrics={showPerformanceMetrics}
        onTogglePerformanceMetrics={() => {
          const newValue = !showPerformanceMetrics;
          setShowPerformanceMetrics(newValue);
          localStorage.setItem('ai-show-performance-metrics', String(newValue));
        }}
        onCopyChat={handleCopyChat}
        currentSessionId={currentSessionId}
        sessions={sessions}
        currentModel={currentModel}
        isLoading={isLoading}
        hasUnsavedInput={inputValue.trim().length > 0}
        onSessionSelect={handleSessionSelect}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
        onRenameSession={handleRenameSession}
        onOpenSessionManager={handleOpenSessionManager}
        onOpenSettings={() => window.electronAPI.openAIModels()}
        documentContext={documentContext}
      />

      {hasApiKey === false ? (
        <EmptyState
          onOpenSettings={() => {
            // Open AI Models window
            window.electronAPI.openAIModels();
          }}
        />
      ) : initError ? (
        <div className="ai-chat-error">
          <p>Failed to initialize Claude AI:</p>
          <p>{initError}</p>
          <p>Please check your API key in settings.</p>
        </div>
      ) : (
        <>
          <PerformanceMetrics show={showPerformanceMetrics} />

          <ChatMessages
            messages={messages}
            isLoading={isLoading}
            onApplyEdit={handleApplyEdit}
            provider={getCurrentSession()?.provider || (currentModel ? parseModelId(currentModel).provider : undefined)}
            modelName={(() => {
              const effectiveModel = getEffectiveModelId();
              return effectiveModel ? getModelDisplayName(effectiveModel) : undefined;
            })()}
            hasDocument={!!documentContext && !!(documentContext.filePath || documentContext.content)}
            currentFilePath={documentContext?.filePath}
            onOpenFile={(filePath: string) => {
              // Request to open a file - this should be handled by the parent App component
              if (window.electronAPI && workspacePath) {
                // Use IPC to open the file in the workspace
                window.electronAPI.invoke('workspace-open-file', workspacePath, filePath).catch((err: Error) => {
                  logger.ui.error('Failed to open file from tool call:', err);
                });
              }
            }}
          />

          <ChatInput
            ref={chatInputRef}
            value={inputValue}
            onChange={setInputValue}
            onSend={handleSendMessage}
            onNavigateHistory={handleNavigateHistory}
            onCancel={handleCancelRequest}
            disabled={isLoading || !isInitialized || !currentSessionId}
            isLoading={isLoading}
            placeholder={!isInitialized ? "Initializing AI..." : !currentSessionId ? "No session - click + to start" : "Ask anything..."}
          />
        </>
      )}
    </div>
  );
}
