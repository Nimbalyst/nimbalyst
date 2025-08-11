import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChatHeader } from './ChatHeader';
import { ChatMessages } from './ChatMessages';
import { ChatInput } from './ChatInput';
import { SessionDropdown } from './SessionDropdown';
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
  onSessionLoaded
}: AIChatProps) {
  const [messages, setMessages] = useState<Array<{ 
    role: 'user' | 'assistant'; 
    content: string; 
    edits?: any[];
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
  const [currentStreamContent, setCurrentStreamContent] = useState('');
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
  const isResizingRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const streamingEditIdRef = useRef<string | null>(null);
  const isStreamingToEditorRef = useRef(false);
  const streamTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load sessions on mount
  const loadSessions = useCallback(async () => {
    try {
      const allSessions = await claudeApi.getSessions(projectPath);
      setSessions(allSessions || []);
    } catch (error) {
      logger.log('session', 'Failed to load sessions:', error);
    }
  }, [projectPath]);

  // Set up all event listeners FIRST (before initialization)
  useEffect(() => {
    logger.log('ui', 'Setting up event listeners...');
    // Set up streaming response listener
    const handleStreamResponse = (data: any) => {
      if (data.isComplete) {
        // Final response with edits
        setMessages(prev => {
          const newMessages = [...prev];
          if (newMessages.length > 0 && newMessages[newMessages.length - 1].role === 'assistant') {
            newMessages[newMessages.length - 1].content = data.content;
            newMessages[newMessages.length - 1].edits = data.edits;
          } else {
            newMessages.push({ 
              role: 'assistant', 
              content: data.content,
              edits: data.edits 
            });
          }
          return newMessages;
        });
        setCurrentStreamContent('');
        setIsLoading(false);
        
        // Auto-apply edits when they arrive
        if (data.edits && data.edits.length > 0) {
          data.edits.forEach(async (edit: any) => {
            logger.log('bridge', 'Auto-applying edit from Claude:', edit);
            
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
      } else if (data.partial) {
        // Streaming partial response
        setCurrentStreamContent(prev => prev + data.partial);
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
      logger.log('streaming', '🎯 Stream Edit Start Event Received:', config);
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
          logger.log('streaming', '⚠️ Streaming timeout - ending stuck session');
          handleStreamEditEnd({ error: 'Streaming timeout after 30 seconds' });
        }
      }, 30000);
      
      // Generate a unique ID for this streaming session
      const editId = `stream-${Date.now()}`;
      setStreamingEditId(editId);
      streamingEditIdRef.current = editId; // Set ref immediately
      logger.log('streaming', 'Generated stream ID:', editId);
      
      // Initialize the streaming edit in the editor
      const aiChatBridge = (window as any).aiChatBridge;
      logger.log('bridge', 'AI Chat Bridge available:', !!aiChatBridge);
      logger.log('bridge', 'Bridge methods:', {
        startStreamingEdit: !!aiChatBridge?.startStreamingEdit,
        streamContent: !!aiChatBridge?.streamContent,
        endStreamingEdit: !!aiChatBridge?.endStreamingEdit
      });
      
      if (aiChatBridge?.startStreamingEdit) {
        logger.log('bridge', 'Calling bridge.startStreamingEdit with:', {
          id: editId,
          ...config
        });
        aiChatBridge.startStreamingEdit({
          id: editId,
          ...config
        });
      } else {
        logger.log('bridge', '❌ Bridge method startStreamingEdit not available!');
      }
      
      // Determine position text for display
      let positionText = 'document';
      if (config.insertAtEnd) {
        positionText = 'end of document';
      } else if (config.insertAfter) {
        positionText = `after "${config.insertAfter.substring(0, 30)}..."`;
      }
      
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
      logger.log('streaming', 'Stream content received:', {
        hasStreamingEditId: !!currentStreamId,
        isStreamingToEditor: isStreaming,
        contentLength: content?.length,
        preview: content?.substring(0, 50)
      });
      
      if (!isStreaming || !currentStreamId) {
        logger.log('streaming', 'Ignoring stream content - not in streaming mode');
        return;
      }
      
      // Accumulate streaming content for display
      setStreamingContent(prev => prev + content);
      
      // Update the streaming status message with accumulated content
      setMessages(prev => {
        const newMessages = [...prev];
        const lastMsg = newMessages[newMessages.length - 1];
        if (lastMsg && lastMsg.isStreamingStatus && lastMsg.streamingData) {
          lastMsg.streamingData.content = streamingContent + content;
        }
        return newMessages;
      });
      
      // Stream the content to the editor
      const aiChatBridge = (window as any).aiChatBridge;
      if (aiChatBridge?.streamContent) {
        logger.log('bridge', 'Calling bridge.streamContent');
        aiChatBridge.streamContent(currentStreamId, content);
      } else {
        logger.log('bridge', '❌ Bridge method streamContent not available!');
      }
    };

    const handleStreamEditEnd = async (data?: { error?: string }) => {
      const currentStreamId = streamingEditIdRef.current || streamingEditId;
      const isStreaming = isStreamingToEditorRef.current || isStreamingToEditor;
      logger.log('streaming', '🏁 Stream Edit End Event Received:', {
        streamingEditId: currentStreamId,
        isStreamingToEditor: isStreaming,
        streamingContentLength: streamingContent.length,
        error: data?.error
      });
      
      if (!currentStreamId) {
        logger.log('streaming', 'No streaming edit ID to end');
        return;
      }
      
      // Finalize the streaming edit in the editor
      const aiChatBridge = (window as any).aiChatBridge;
      if (aiChatBridge?.endStreamingEdit) {
        logger.log('bridge', 'Calling bridge.endStreamingEdit');
        aiChatBridge.endStreamingEdit(currentStreamId);
      } else {
        logger.log('bridge', '❌ Bridge method endStreamingEdit not available!');
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
    logger.log('ui', 'Registering event handlers...');
    claudeApi.on('streamEditStart', handleStreamEditStart);
    claudeApi.on('streamEditContent', handleStreamEditContent);
    claudeApi.on('streamEditEnd', handleStreamEditEnd);
    
    // Test that handlers are registered
    logger.log('ui', 'Event handlers registered:', {
      streamResponse: true,
      editRequest: true,
      streamEditStart: true,
      streamEditContent: true,
      streamEditEnd: true
    });

    return () => {
      logger.log('ui', 'Cleaning up event handlers...');
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
          session = await claudeApi.createSession(cleanDocumentContext, projectPath);
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
          logger.log('api', 'Failed to initialize Claude:', error);
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
    
    // If no current session, create one first
    if (!currentSessionId) {
      const session = await claudeApi.createSession(freshDocumentContext, projectPath);
      setCurrentSessionId(session.id);
    }
    
    // Add user message
    setMessages(prev => [...prev, { role: 'user', content: message }]);
    setInputValue('');
    setHistoryIndex(-1); // Reset history navigation
    setTempInput(''); // Clear temp input
    setIsLoading(true);
    setCurrentStreamContent('');
    
    try {
      // Send message to Claude with fresh document context
      await claudeApi.sendMessage(message, freshDocumentContext);
      // Reload sessions to update message counts
      await loadSessions();
    } catch (error) {
      logger.log('api', 'Failed to send message:', error);
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
      logger.log('bridge', 'Failed to apply edit:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to apply changes' 
      };
    }
  }, []);

  // Session management handlers
  const handleNewSession = useCallback(async () => {
    try {
      // Create a clean document context without functions for IPC
      const cleanDocumentContext = documentContext ? {
        filePath: documentContext.filePath,
        fileType: documentContext.fileType,
        content: documentContext.getLatestContent ? documentContext.getLatestContent() : documentContext.content,
        cursorPosition: documentContext.cursorPosition,
        selection: documentContext.selection
      } : undefined;
      
      const session = await claudeApi.createSession(cleanDocumentContext, projectPath);
      setCurrentSessionId(session.id);
      setMessages([]);
      setInputValue(''); // Clear input for new session
      await loadSessions();
    } catch (error) {
      logger.log('session', 'Failed to create new session:', error);
    }
  }, [documentContext, projectPath, loadSessions]);

  const handleOpenSessionManager = useCallback(async () => {
    try {
      await (window as any).electronAPI.openSessionManager(projectPath);
    } catch (error) {
      logger.log('session', 'Failed to open session manager:', error);
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
        logger.log('session', 'Failed to sync messages:', error);
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
        logger.log('session', 'Failed to save draft input:', error);
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
      
      // Convert session messages to chat format, preserving streaming status
      const chatMessages = session.messages.map((msg: any) => ({
        role: msg.role,
        content: msg.content,
        edits: msg.edits,
        isStreamingStatus: msg.isStreamingStatus,
        streamingData: msg.streamingData
      }));
      
      setMessages(chatMessages);
      
      // Restore draft input for this session
      setInputValue(session.draftInput || '');
    } catch (error) {
      logger.log('session', 'Failed to load session:', error);
    }
  }, []);

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
      logger.log('session', 'Failed to delete session:', error);
    }
  }, [currentSessionId, projectPath, loadSessions]);

  const handleRenameSession = useCallback(async (sessionId: string, newName: string) => {
    try {
      // TODO: Add rename session API call when available
      // await claudeApi.renameSession(sessionId, newName);
      
      await loadSessions();
    } catch (error) {
      logger.log('session', 'Failed to rename session:', error);
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
        logger.log('session', 'Failed to load requested session:', error);
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
        onNewSession={handleNewSession}
        onOpenSessionManager={handleOpenSessionManager}
      >
        <SessionDropdown
          currentSessionId={currentSessionId}
          sessions={sessions.map(s => ({
            id: s.id,
            timestamp: s.timestamp,
            name: s.name,
            title: s.title,
            messageCount: s.messages?.length || 0
          }))}
          onSessionSelect={handleSessionSelect}
          onNewSession={handleNewSession}
          onDeleteSession={handleDeleteSession}
          onRenameSession={handleRenameSession}
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
            currentStreamContent={currentStreamContent}
            onApplyEdit={handleApplyEdit}
          />
          
          <ChatInput 
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