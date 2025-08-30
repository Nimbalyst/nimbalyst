import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChatHeader } from './ChatHeader';
import { ChatMessages } from './ChatMessages';
import { ChatInput } from './ChatInput';
import { SessionDropdown } from './SessionDropdown';
import { NewSessionButton } from './NewSessionButton';
import { claudeApi, DocumentContext } from '../../services/claudeApi';
import { logger } from '../../utils/logger';
import './AIChat.css';

interface AIChatProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  width: number;
  onWidthChange: (width: number) => void;
  documentContext?: DocumentContext & { getLatestContent?: () => string };
  onApplyEdit?: (edit: any, prompt?: string, claudeResponse?: string) => void;
  projectPath?: string;
  sessionToLoad?: { sessionId: string; projectPath?: string } | null;
  onSessionLoaded?: () => void;
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
  const [isStreamingToEditor, setIsStreamingToEditor] = useState(false);
  const [streamingEditId, setStreamingEditId] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState<string>('');
  const [sessions, setSessions] = useState<Array<any>>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [tempInput, setTempInput] = useState('');
  const [currentUserMessage, setCurrentUserMessage] = useState<string>(''); // Track current user message for error reporting
  const [currentProvider, setCurrentProvider] = useState<string>(() => {
    // Load last used provider from localStorage
    const saved = localStorage.getItem('ai-last-provider');
    return saved || 'claude-code';
  });
  const [currentModel, setCurrentModel] = useState<string | undefined>(() => {
    // Load last used model from localStorage
    return localStorage.getItem('ai-last-model') || undefined;
  });
  const isResizingRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const streamingEditIdRef = useRef<string | null>(null);
  const isStreamingToEditorRef = useRef(false);
  const streamTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  // Load sessions on mount
  const loadSessions = useCallback(async () => {
    try {
      const allSessions = await claudeApi.getSessions(projectPath);
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
            const result = await claudeApi.applyEdit(edit);
            
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

    claudeApi.on('streamResponse', handleStreamResponse);

    // Set up edit request listener
    const handleEditRequest = (edit: any) => {
      if (onApplyEdit) {
        // Pass current context for error reporting
        onApplyEdit(edit, currentUserMessage, '');
      }
    };

    claudeApi.on('editRequest', handleEditRequest);

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
          handleStreamEditEnd({ error: 'Streaming timeout after 30 seconds' });
        }
      }, 30000);
      
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
    claudeApi.on('streamEditStart', handleStreamEditStart);
    claudeApi.on('streamEditContent', handleStreamEditContent);
    claudeApi.on('streamEditEnd', handleStreamEditEnd);
    
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
      claudeApi.off('streamResponse', handleStreamResponse);
      claudeApi.off('editRequest', handleEditRequest);
      claudeApi.off('streamEditStart', handleStreamEditStart);
      claudeApi.off('streamEditContent', handleStreamEditContent);
      claudeApi.off('streamEditEnd', handleStreamEditEnd);
    };
  }, [documentContext, onApplyEdit, loadSessions, streamingContent]); // Add missing dependencies

  // Initialize Claude AFTER event handlers are set up
  useEffect(() => {
    // Prevent double initialization
    if (isInitialized) return;
    
    let mounted = true;
    const initClaude = async () => {
      try {
        await claudeApi.initialize();
        
        // First check if there's an existing session for this project
        const existingSessions = await claudeApi.getSessions(projectPath);
        let session;
        
        if (existingSessions && existingSessions.length > 0) {
          // Load the most recent session
          session = await claudeApi.loadSession(existingSessions[0].id, projectPath);
          
          // Update provider and model based on loaded session
          if (session.provider) {
            setCurrentProvider(session.provider);
            localStorage.setItem('ai-last-provider', session.provider);
          }
          
          if (session.model) {
            setCurrentModel(session.model);
            localStorage.setItem('ai-last-model', session.model);
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
          session = await claudeApi.createSession(cleanDocumentContext, projectPath, currentProvider, currentModel);
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
  }, [projectPath, documentContext, loadSessions]);

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
    
    // Get fresh document context with latest content
    const freshDocumentContext = {
      filePath: documentContext?.filePath || '',
      fileType: documentContext?.fileType || 'markdown',
      content: documentContext?.getLatestContent ? documentContext.getLatestContent() : documentContext?.content || '',
      cursorPosition: documentContext?.cursorPosition,
      selection: documentContext?.selection
      // Note: Don't include getLatestContent function as it can't be serialized for IPC
    };
    
    console.log('[AIChat] Sending document context:', {
      hasSelection: !!freshDocumentContext.selection,
      selectionLength: freshDocumentContext.selection?.length,
      hasCursorPosition: !!freshDocumentContext.cursorPosition,
      cursorPosition: freshDocumentContext.cursorPosition
    });
    
    // If no current session, create one first
    if (!currentSessionId) {
      const session = await claudeApi.createSession(freshDocumentContext, projectPath, currentProvider, currentModel);
      setCurrentSessionId(session.id);
    }
    
    // Add user message
    setMessages(prev => [...prev, { role: 'user', content: message }]);
    setInputValue('');
    setHistoryIndex(-1); // Reset history navigation
    setTempInput(''); // Clear temp input
    setIsLoading(true);
    
    try {
      // Send message to Claude with fresh document context and session ID
      await claudeApi.sendMessage(message, freshDocumentContext, currentSessionId!, projectPath);
      // Reload sessions to update message counts
      await loadSessions();
    } catch (error) {
      logger.api.info('Failed to send message:', error);
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: 'Sorry, I encountered an error processing your request. Please try again.' 
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
      const result = await claudeApi.applyEdit(edit);
      return result;
    } catch (error) {
      logger.bridge.info('Failed to apply edit:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to apply changes' 
      };
    }
  }, []);

  // Session management handlers
  const handleNewSession = useCallback(async (provider?: string, modelId?: string) => {
    try {
      // Use provided provider or current provider
      const sessionProvider = provider || currentProvider;
      const sessionModel = modelId || currentModel;
      
      // Update current provider and model
      setCurrentProvider(sessionProvider);
      setCurrentModel(sessionModel);
      
      // Save to localStorage
      localStorage.setItem('ai-last-provider', sessionProvider);
      if (sessionModel) {
        localStorage.setItem('ai-last-model', sessionModel);
      }
      
      // Create a clean document context without functions for IPC
      const cleanDocumentContext = documentContext ? {
        filePath: documentContext.filePath,
        fileType: documentContext.fileType,
        content: documentContext.getLatestContent ? documentContext.getLatestContent() : documentContext.content,
        cursorPosition: documentContext.cursorPosition,
        selection: documentContext.selection
      } : undefined;
      
      const session = await claudeApi.createSession(cleanDocumentContext, projectPath, sessionProvider as any, sessionModel);
      setCurrentSessionId(session.id);
      setMessages([]);
      setInputValue(''); // Clear input for new session
      await loadSessions();
      
      // Store the last used provider preference
      localStorage.setItem('ai-last-provider', sessionProvider);
      
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
      }
    }
  }, [documentContext, projectPath, currentProvider, loadSessions, onShowApiKeyError]);

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
        await claudeApi.updateSessionMessages(currentSessionId, messages, projectPath);
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
        await claudeApi.saveDraftInput(currentSessionId, inputValue, projectPath);
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
      const session = await claudeApi.loadSession(sessionId, projectPath);
      setCurrentSessionId(session.id);
      
      // Update provider and model based on session
      if (session.provider) {
        setCurrentProvider(session.provider);
        localStorage.setItem('ai-last-provider', session.provider);
      }
      
      if (session.model) {
        setCurrentModel(session.model);
        localStorage.setItem('ai-last-model', session.model);
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
    }
  }, [projectPath]);

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    try {
      // Delete the session
      await claudeApi.deleteSession(sessionId, projectPath);
      
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
      // await claudeApi.renameSession(sessionId, newName);
      
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
        onOpenSessionManager={handleOpenSessionManager}
        provider={currentProvider}
        model={currentModel}
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
        />
        <NewSessionButton
          currentProvider={currentProvider}
          currentModel={currentModel}
          onNewSession={handleNewSession}
          disabled={isLoading}
        />
      </ChatHeader>
      
      {initError ? (
        <div className="ai-chat-error">
          <p>Failed to initialize Claude AI:</p>
          <p>{initError}</p>
          <p>Please check your API key in settings.</p>
        </div>
      ) : (
        <>
          <ChatMessages 
            messages={messages}
            isLoading={isLoading}
            onApplyEdit={handleApplyEdit}
          />
          
          <ChatInput 
            ref={chatInputRef}
            value={inputValue}
            onChange={setInputValue}
            onSend={handleSendMessage}
            onNavigateHistory={handleNavigateHistory}
            disabled={isLoading || !isInitialized}
            placeholder={!isInitialized ? "Initializing Claude..." : "Ask Claude anything..."}
          />
        </>
      )}
    </div>
  );
}