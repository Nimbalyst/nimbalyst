import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChatHeader } from './ChatHeader';
import { ChatMessages } from './ChatMessages';
import { ChatInput } from './ChatInput';
import { SessionDropdown } from './SessionDropdown';
import { NewSessionButton } from './NewSessionButton';
import { EmptyState } from './EmptyState';
import { PerformanceMetrics } from './PerformanceMetrics';
import { aiApi, DocumentContext } from '../../services/aiApi';
import { logger } from '../../utils/logger';
import { DEFAULT_MODELS } from '../../../shared/modelConstants';
import './AIChat.css';

interface AIChatProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  width: number;
  onWidthChange: (width: number) => void;
  documentContext?: DocumentContext & { getLatestContent?: () => string };
  onApplyEdit?: (edit: any, prompt?: string, aiResponse?: string) => void;
  projectPath?: string;
  sessionToLoad?: { sessionId: string; projectPath?: string } | null;
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
  projectPath,
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
  const [currentModel, setCurrentModel] = useState<string | null>(() => {
    // Load last used model from localStorage, but don't default to anything
    return localStorage.getItem('ai-selected-model');
  });
  const [showPerformanceMetrics, setShowPerformanceMetrics] = useState<boolean>(() => {
    // Load performance metrics visibility from localStorage
    return localStorage.getItem('ai-show-performance-metrics') === 'true';
  });

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

  // Load sessions on mount
  const loadSessions = useCallback(async () => {
    try {
      const allSessions = await aiApi.getSessions(projectPath);
      setSessions(allSessions || []);
    } catch (error) {
      logger.session.info('Failed to load sessions:', error);
    }
  }, [projectPath]);

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
            logger.bridge.info('Auto-applying edit from Claude:', edit);

            // Apply the edit through the API (which handles both applying and error reporting)
            const result = await aiApi.applyEdit(edit);

            // If we have onApplyEdit callback, notify the parent AFTER the edit is applied
            // This is for UI updates, not for actually applying the edit
            if (onApplyEdit) {
              // Pass the result so the parent knows if it succeeded
              onApplyEdit(edit, currentUserMessage, data.content);
            }

            if (!result.success) {
              // Edit failed - send an automatic follow-up message to Claude
              const currentContent = documentContext?.getLatestContent ? documentContext.getLatestContent() : documentContext?.content || '';
              const errorMessage = `The previous edit command failed because: "${result.error}"\n\nThe current document contains:\n\`\`\`markdown\n${currentContent}\n\`\`\`\n\nPlease provide a corrected edit command using the EXACT text from the document above.`;

              // Add error notification to chat
              setMessages(prev => [...prev, {
                role: 'assistant',
                content: `⚠️ Edit failed: ${result.error}\n\nAutomatically asking Claude to correct...`
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
              // Skip applyDiff tool calls since they're already shown as edits on the assistant message
              if (toolCall.name === 'applyDiff') {
                continue;
              }

              // Create a unique signature for this tool call
              const signature = `${toolCall.name}-${JSON.stringify(toolCall.arguments)}`;

              // Only add if we haven't seen this exact tool call before
              if (!existingToolCalls.has(signature)) {
                newMessages.push({
                  role: 'tool',
                  content: '', // Tool messages don't have text content
                  toolCall: toolCall
                });
                existingToolCalls.add(signature);
              }
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

      // Set a timeout to detect stuck streaming (30 seconds)
      streamTimeoutRef.current = setTimeout(() => {
        if (isStreamingToEditorRef.current) {
          logger.streaming.info('⚠️ Streaming timeout - ending stuck session');
          handleStreamEditEnd({ error: 'Streaming timeout after 60 seconds' });
        }
      }, 60000);

      // Generate a unique ID for this streaming session
      const editId = `stream-${Date.now()}`;
      setStreamingEditId(editId);
      streamingEditIdRef.current = editId; // Set ref immediately
      logger.streaming.info('Generated stream ID:', editId);

      // Initialize the streaming edit in the editor
      const aiChatBridge = (window as any).aiChatBridge;
      logger.bridge.info('AI Chat Bridge available:', !!aiChatBridge);
      logger.bridge.info('Bridge methods:', {
        startStreamingEdit: !!aiChatBridge?.startStreamingEdit,
        streamContent: !!aiChatBridge?.streamContent,
        endStreamingEdit: !!aiChatBridge?.endStreamingEdit
      });

      if (aiChatBridge?.startStreamingEdit) {
        logger.bridge.info('Calling bridge.startStreamingEdit with:', {
          id: editId,
          ...config
        });
        aiChatBridge.startStreamingEdit({
          id: editId,
          ...config
        });
      } else {
        logger.bridge.info('❌ Bridge method startStreamingEdit not available!');
      }

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
      const aiChatBridge = (window as any).aiChatBridge;
      if (aiChatBridge?.streamContent) {
        logger.bridge.info('Calling bridge.streamContent');
        aiChatBridge.streamContent(currentStreamId, content);
      } else {
        logger.bridge.info('❌ Bridge method streamContent not available!');
      }
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
      const aiChatBridge = (window as any).aiChatBridge;
      if (aiChatBridge?.endStreamingEdit) {
        logger.bridge.info('Calling bridge.endStreamingEdit');
        aiChatBridge.endStreamingEdit(currentStreamId);
      } else {
        logger.bridge.info('❌ Bridge method endStreamingEdit not available!');
      }

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
          logger.api.info('AI provider now configured, resetting initialization');
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

  // Initialize Claude AFTER event handlers are set up
  useEffect(() => {
    // Prevent double initialization or initialization without API key
    if (isInitialized || hasApiKey === null || !hasApiKey) return;

    let mounted = true;
    const initClaude = async () => {
      try {
        await aiApi.initialize();

        // First check if there's an existing session for this project
        const existingSessions = await aiApi.getSessions(projectPath);
        let session;

        if (existingSessions && existingSessions.length > 0) {
          // Load the most recent session
          session = await aiApi.loadSession(existingSessions[0].id, projectPath);

          // ALWAYS restore the provider and model from the session
          // This ensures the UI shows what's actually being used
          if (session.provider) {
            let modelIdToSet: string;
            if (session.provider === 'claude-code') {
              modelIdToSet = 'claude-code';
            } else {
              // Use the session's actual model, or fall back to provider default
              modelIdToSet = session.model 
                ? `${session.provider}:${session.model}`
                : `${session.provider}:default`;
            }
            
            console.log(`[AIChat] Syncing UI model from session: ${modelIdToSet} (was: ${currentModel})`);
            setCurrentModel(modelIdToSet);
            localStorage.setItem('ai-selected-model', modelIdToSet);
          } else {
            // No provider in session - this shouldn't happen but handle it
            console.warn('[AIChat] Session has no provider, using default');
            setCurrentModel(DEFAULT_MODELS.claude);
            localStorage.setItem('ai-selected-model', DEFAULT_MODELS.claude);
          }
        } else {
          // Create new session only if none exists
          // Clean the document context for IPC (remove functions)
          const cleanDocumentContext = documentContext ? {
            filePath: documentContext.filePath,
            fileType: documentContext.fileType,
            content: documentContext.getLatestContent ? documentContext.getLatestContent() : documentContext.content,
            cursorPosition: documentContext.cursorPosition,
            selection: documentContext.selection
          } : undefined;
          const modelToUse = currentModel || DEFAULT_MODELS.claude;
          const { provider, model } = parseModelId(modelToUse);
          session = await aiApi.createSession(cleanDocumentContext, projectPath, provider, model);
        }

        if (mounted) {
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
              streamingData: msg.streamingData
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
          logger.api.info('Failed to initialize Claude:', error);
          setInitError(error.message || 'Failed to initialize Claude');
        }
      }
    };

    // Small delay to ensure event handlers are registered
    setTimeout(initClaude, 100);

    return () => {
      mounted = false;
    };
  }, [projectPath, documentContext, loadSessions, hasApiKey]);

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

    console.log('[AIChat] Sending document context:', {
      hasSelection: !!freshDocumentContext.selection,
      selectionLength: freshDocumentContext.selection?.length,
      hasCursorPosition: !!freshDocumentContext.cursorPosition,
      cursorPosition: freshDocumentContext.cursorPosition
    });

    // Check if we need a new session (no session or provider changed)
    const modelToUse = currentModel || DEFAULT_MODELS.claude;
    const { provider, model } = parseModelId(modelToUse);

    // Get current session to check provider
    let needNewSession = !currentSessionId;
    let actualProvider = provider;
    let actualModel = model;
    
    if (currentSessionId && sessions.length > 0) {
      const currentSession = sessions.find(s => s.id === currentSessionId);
      if (currentSession) {
        // Check if provider changed
        if (currentSession.provider !== provider) {
          console.log(`[AIChat] Provider changed from ${currentSession.provider} to ${provider}, creating new session`);
          needNewSession = true;
        } else {
          // Use the session's actual provider/model for consistency
          actualProvider = currentSession.provider;
          actualModel = currentSession.model || model;
          
          // Sync UI if needed
          const expectedModelId = currentSession.provider === 'claude-code' 
            ? 'claude-code' 
            : `${actualProvider}:${actualModel}`;
          
          if (currentModel !== expectedModelId) {
            console.log(`[AIChat] Syncing UI model to match session: ${expectedModelId}`);
            setCurrentModel(expectedModelId);
            localStorage.setItem('ai-selected-model', expectedModelId);
          }
        }
      }
    }

    if (needNewSession) {
      console.log(`[AIChat] Creating new session with provider: ${actualProvider}, model: ${actualModel}`);
      const session = await aiApi.createSession(freshDocumentContext, projectPath, actualProvider, actualModel);
      setCurrentSessionId(session.id);
      console.log(`[AIChat] Created session ${session.id} with provider: ${session.provider}`);
      
      // Update UI to match the new session
      const newModelId = session.provider === 'claude-code' 
        ? 'claude-code' 
        : `${session.provider}:${session.model || actualModel}`;
      setCurrentModel(newModelId);
      localStorage.setItem('ai-selected-model', newModelId);
      
      // Reload sessions to include the new one
      await loadSessions();
    } else {
      console.log(`[AIChat] Using existing session ${currentSessionId} with provider: ${actualProvider}`);
    }

    // Add user message
    setMessages(prev => [...prev, { role: 'user', content: message }]);
    setInputValue('');
    setHistoryIndex(-1); // Reset history navigation
    setTempInput(''); // Clear temp input
    setIsLoading(true);

    try {
      // Send message to Claude with fresh document context and session ID
      await aiApi.sendMessage(message, freshDocumentContext, currentSessionId!, projectPath);
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
  }, [isInitialized, documentContext, loadSessions, currentSessionId, projectPath]);

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
      // Apply the edit through the API - this should return a promise
      const result = await aiApi.applyEdit(edit);
      return result;
    } catch (error) {
      logger.bridge.info('Failed to apply edit:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to apply changes'
      };
    }
  }, []);

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
      // Use provided model or current model
      const selectedModel = modelId || currentModel;
      const { provider, model } = parseModelId(selectedModel);

      // Update current model
      setCurrentModel(selectedModel);
      localStorage.setItem('ai-selected-model', selectedModel);

      // Create a clean document context without functions for IPC
      const cleanDocumentContext = documentContext ? {
        filePath: documentContext.filePath,
        fileType: documentContext.fileType,
        content: documentContext.getLatestContent ? documentContext.getLatestContent() : documentContext.content,
        cursorPosition: documentContext.cursorPosition,
        selection: documentContext.selection
      } : undefined;

      const session = await aiApi.createSession(cleanDocumentContext, projectPath, provider as any, model);
      setCurrentSessionId(session.id);
      setMessages([]);
      setInputValue(''); // Clear input for new session
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
  }, [documentContext, projectPath, currentModel, loadSessions, onShowApiKeyError]);

  const handleOpenSessionManager = useCallback(async () => {
    try {
      await (window as any).electronAPI.openSessionManager(projectPath);
    } catch (error) {
      logger.session.info('Failed to open session manager:', error);
    }
  }, [projectPath]);

  // Sync messages to backend whenever they change
  useEffect(() => {
    if (!currentSessionId || messages.length === 0) return;

    const syncMessages = async () => {
      try {
        await aiApi.updateSessionMessages(currentSessionId, messages, projectPath);
        // Reload sessions to update message counts
        await loadSessions();
      } catch (error) {
        logger.session.info('Failed to sync messages:', error);
      }
    };

    // Debounce to avoid too many updates
    const timeoutId = setTimeout(syncMessages, 500);
    return () => clearTimeout(timeoutId);
  }, [messages, currentSessionId, projectPath, loadSessions]);

  // Save draft input whenever it changes
  useEffect(() => {
    if (!currentSessionId || !isInitialized) return;

    const saveDraft = async () => {
      try {
        await aiApi.saveDraftInput(currentSessionId, inputValue, projectPath);
      } catch (error) {
        logger.session.info('Failed to save draft input:', error);
      }
    };

    // Debounce to avoid too many saves
    const timeoutId = setTimeout(saveDraft, 1000);
    return () => clearTimeout(timeoutId);
  }, [inputValue, currentSessionId, projectPath, isInitialized]);

  const handleSessionSelect = useCallback(async (sessionId: string) => {
    try {
      const session = await aiApi.loadSession(sessionId, projectPath);
      
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
        localStorage.setItem('ai-selected-model', modelIdToSet);
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
        streamingData: msg.streamingData
      }));

      setMessages(chatMessages);

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
  }, [projectPath, onSessionIdChange]);

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    try {
      // Delete the session
      await aiApi.deleteSession(sessionId, projectPath);

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
  }, [currentSessionId, projectPath, loadSessions]);

  const handleRenameSession = useCallback(async (sessionId: string, newName: string) => {
    try {
      // TODO: Add rename session API call when available
      // await aiApi.renameSession(sessionId, newName);

      await loadSessions();
    } catch (error) {
      logger.session.info('Failed to rename session:', error);
    }
  }, [loadSessions]);

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
    >
      <div
        className="ai-chat-resize-handle"
        onMouseDown={handleMouseDown}
      />

      <ChatHeader
        onToggleCollapse={onToggleCollapse}
        provider={currentModel ? parseModelId(currentModel).provider : undefined}
        model={currentModel || undefined}
        showPerformanceMetrics={showPerformanceMetrics}
        onTogglePerformanceMetrics={() => {
          const newValue = !showPerformanceMetrics;
          setShowPerformanceMetrics(newValue);
          localStorage.setItem('ai-show-performance-metrics', String(newValue));
        }}
      >
        <SessionDropdown
          currentSessionId={currentSessionId}
          sessions={sessions.map(s => ({
            id: s.id,
            timestamp: s.timestamp,
            name: s.name,
            title: s.title,
            messageCount: s.messages?.length || 0,
            provider: s.provider,
            model: s.model
          }))}
          onSessionSelect={handleSessionSelect}
          onNewSession={() => handleNewSession()}
          onDeleteSession={handleDeleteSession}
          onRenameSession={handleRenameSession}
          onOpenSessionManager={handleOpenSessionManager}
        />
        <NewSessionButton
          currentModel={currentModel}
          onNewSession={handleNewSession}
          onOpenSettings={() => window.electronAPI.openAIModels()}
          disabled={isLoading}
          hasUnsavedInput={inputValue.trim().length > 0}
        />
      </ChatHeader>

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
            provider={currentModel ? parseModelId(currentModel).provider : undefined}
            modelName={currentModel ? getModelDisplayName(currentModel) : undefined}
            hasDocument={!!documentContext && !!(documentContext.filePath || documentContext.content)}
          />

          <ChatInput
            ref={chatInputRef}
            value={inputValue}
            onChange={setInputValue}
            onSend={handleSendMessage}
            onNavigateHistory={handleNavigateHistory}
            onCancel={handleCancelRequest}
            disabled={isLoading || !isInitialized}
            isLoading={isLoading}
            placeholder={!isInitialized ? "Initializing AI..." : "Ask anything..."}
          />
        </>
      )}
    </div>
  );
}
