/**
 * ChatSidebar - Lightweight chat panel for files mode sidebar.
 *
 * This is a simplified replacement for AgenticPanel when used in chat mode.
 * It renders a single session tied to the current document context.
 */

import React, { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { SessionTranscript, SessionTranscriptRef } from '../UnifiedAI/SessionTranscript';
import './ChatSidebar.css';

export interface ChatSidebarRef {
  focusInput: () => void;
}

export interface ChatSidebarProps {
  workspacePath: string;
  documentContext?: {
    filePath?: string;
    content?: string;
    fileType?: string;
  };
  onFileOpen?: (filePath: string) => Promise<void>;
}

export const ChatSidebar = forwardRef<ChatSidebarRef, ChatSidebarProps>(({
  workspacePath,
  documentContext,
  onFileOpen,
}, ref) => {
  const transcriptRef = useRef<SessionTranscriptRef>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Expose focusInput through ref
  useImperativeHandle(ref, () => ({
    focusInput: () => {
      transcriptRef.current?.focusInput();
    },
  }), []);

  // Create or load the chat sidebar session on mount
  useEffect(() => {
    const initSession = async () => {
      try {
        setIsLoading(true);

        // Try to get existing chat sidebar session for this workspace
        const existingSession = await window.electronAPI.invoke(
          'sessions:get-chat-sidebar-session',
          workspacePath
        );

        if (existingSession?.id) {
          setSessionId(existingSession.id);
        } else {
          // Create a new session for the chat sidebar
          const newSession = await window.electronAPI.invoke(
            'sessions:create',
            workspacePath,
            'claude', // Default to claude provider for chat
            { isChatSidebar: true }
          );
          if (newSession?.id) {
            setSessionId(newSession.id);
          }
        }
      } catch (err) {
        console.error('[ChatSidebar] Failed to init session:', err);
      } finally {
        setIsLoading(false);
      }
    };

    initSession();
  }, [workspacePath]);

  const handleFileClick = useCallback(async (filePath: string) => {
    if (onFileOpen) {
      await onFileOpen(filePath);
    }
  }, [onFileOpen]);

  if (isLoading) {
    return (
      <div className="chat-sidebar chat-sidebar-loading">
        <div className="chat-sidebar-spinner" />
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div className="chat-sidebar chat-sidebar-error">
        <p>Failed to load chat session</p>
      </div>
    );
  }

  return (
    <div className="chat-sidebar">
      <SessionTranscript
        ref={transcriptRef}
        sessionId={sessionId}
        workspacePath={workspacePath}
        mode="chat"
        hideSidebar={true}
        onFileClick={handleFileClick}
        documentContext={documentContext}
      />
    </div>
  );
});

ChatSidebar.displayName = 'ChatSidebar';
