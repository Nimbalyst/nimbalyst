/**
 * ChatSidebar - Lightweight chat panel for files mode sidebar.
 *
 * This is the replacement for AIChat/AgenticPanel when used in chat mode.
 * It renders a single session tied to the current document context.
 * Supports resizable width and collapse/expand functionality.
 */

import React, { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle, useMemo } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime';
import { SessionTranscript, SessionTranscriptRef } from '../UnifiedAI/SessionTranscript';
import { SessionDropdown } from '../AIChat/SessionDropdown';
import {
  sessionListChatAtom,
  refreshSessionListAtom,
  initSessionList,
} from '../../store';
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
  /** Getter function for document context - called on-demand to avoid re-renders */
  getDocumentContext?: () => {
    filePath?: string;
    content?: string;
    fileType?: string;
    getLatestContent?: () => string;
  };
  onFileOpen?: (filePath: string) => Promise<void>;
  /** Whether the sidebar is collapsed */
  isCollapsed?: boolean;
  /** Callback when collapse state should toggle */
  onToggleCollapse?: () => void;
  /** Current width of the sidebar */
  width?: number;
  /** Callback when width changes (during resize) */
  onWidthChange?: (width: number) => void;
  /** Callback to switch to agent mode (for "All Sessions") */
  onSwitchToAgentMode?: () => void;
}

export const ChatSidebar = forwardRef<ChatSidebarRef, ChatSidebarProps>(({
  workspacePath,
  documentContext,
  getDocumentContext,
  onFileOpen,
  isCollapsed = false,
  onToggleCollapse,
  width = 350,
  onWidthChange,
  onSwitchToAgentMode,
}, ref) => {
  const transcriptRef = useRef<SessionTranscriptRef>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const isResizingRef = useRef(false);
  const isInitializingRef = useRef(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Session list from Jotai - filtered for chat mode (no worktrees, no workstream parents)
  const sessionList = useAtomValue(sessionListChatAtom);
  const refreshSessions = useSetAtom(refreshSessionListAtom);

  // Convert to format expected by SessionDropdown
  const availableSessions = useMemo(() => {
    return sessionList.map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      name: s.title,
      title: s.title,
      messageCount: s.messageCount || 0,
      provider: s.provider,
      model: s.model,
    }));
  }, [sessionList]);

  // Expose focusInput through ref
  useImperativeHandle(ref, () => ({
    focusInput: () => {
      transcriptRef.current?.focusInput();
    },
  }), []);

  // Initialize session list on mount
  useEffect(() => {
    initSessionList(workspacePath);
  }, [workspacePath]);

  // Initialize session - select most recent or create new if none exist
  // CRITICAL: Only runs once on mount to avoid creating duplicate sessions
  useEffect(() => {
    const initSession = async () => {
      // Prevent concurrent initialization
      if (isInitializingRef.current) {
        return;
      }
      isInitializingRef.current = true;

      try {
        setIsLoading(true);

        // Wait for session list to load (it's initialized in parallel above)
        // We need to give the session list time to populate
        await new Promise(resolve => setTimeout(resolve, 100));

        // Re-read session list after waiting
        const sessions = await window.electronAPI.invoke('sessions:list', workspacePath, {
          includeArchived: false,
        });

        if (sessions.success && Array.isArray(sessions.sessions)) {
          // Filter for chat sessions (no worktrees, no workstream parents)
          const chatSessions = sessions.sessions.filter((s: any) => {
            if (s.worktreeId) return false;
            if (s.childCount && s.childCount > 0) return false;
            return true;
          });

          // If we have existing chat sessions, use the most recent one
          if (chatSessions.length > 0) {
            setSessionId(chatSessions[0].id);
            setIsLoading(false);
            return;
          }
        }

        // No chat sessions exist - create a new one
        const newSessionId = crypto.randomUUID();
        const result = await window.electronAPI.invoke(
          'sessions:create',
          {
            session: {
              id: newSessionId,
              provider: 'claude',
              title: 'Chat',
            },
            workspaceId: workspacePath,
          }
        );
        if (result?.success) {
          setSessionId(newSessionId);
          // Refresh the session list to include the new session
          refreshSessions();
        }
      } catch (err) {
        console.error('[ChatSidebar] Failed to init session:', err);
      } finally {
        setIsLoading(false);
        isInitializingRef.current = false;
      }
    };

    initSession();
    // CRITICAL: Only run once on mount - workspacePath changes trigger full remount anyway
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath]);

  const handleFileClick = useCallback(async (filePath: string) => {
    if (onFileOpen) {
      await onFileOpen(filePath);
    }
  }, [onFileOpen]);

  const handleSessionSelect = useCallback((selectedSessionId: string) => {
    setSessionId(selectedSessionId);
  }, []);

  const handleNewSession = useCallback(async () => {
    const newSessionId = crypto.randomUUID();
    const result = await window.electronAPI.invoke(
      'sessions:create',
      {
        session: {
          id: newSessionId,
          provider: 'claude',
          title: 'Chat',
        },
        workspaceId: workspacePath,
      }
    );
    if (result?.success) {
      setSessionId(newSessionId);
      refreshSessions();
    }
  }, [workspacePath, refreshSessions]);

  const handleDeleteSession = useCallback(async (sessionIdToDelete: string) => {
    await window.electronAPI.invoke('session:delete', sessionIdToDelete);
    refreshSessions();
    // If we deleted the current session, switch to another or create new
    if (sessionIdToDelete === sessionId) {
      const remaining = sessionList.filter(s => s.id !== sessionIdToDelete);
      if (remaining.length > 0) {
        setSessionId(remaining[0].id);
      } else {
        handleNewSession();
      }
    }
  }, [workspacePath, sessionId, sessionList, refreshSessions, handleNewSession]);

  const handleRenameSession = useCallback(async (sessionIdToRename: string, newName: string) => {
    await window.electronAPI.invoke('sessions:update-title', sessionIdToRename, newName);
    refreshSessions();
  }, [workspacePath, refreshSessions]);

  // Handle resize drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!onWidthChange) return;
    e.preventDefault();
    isResizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [onWidthChange]);

  useEffect(() => {
    if (!onWidthChange) return;

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

  // When collapsed, render nothing (toggle button is in the title bar)
  if (isCollapsed) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="chat-sidebar chat-sidebar-loading" style={{ width: onWidthChange ? width : undefined }}>
        <div className="chat-sidebar-spinner" />
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div className="chat-sidebar chat-sidebar-error" style={{ width: onWidthChange ? width : undefined }}>
        <p>Failed to load chat session</p>
      </div>
    );
  }

  // Compute effective document context - prefer getter for on-demand access
  const effectiveDocumentContext = getDocumentContext ? getDocumentContext() : documentContext;

  return (
    <div
      ref={panelRef}
      className="chat-sidebar"
      style={{ width: onWidthChange ? width : undefined }}
      data-testid="chat-sidebar-panel"
    >
      {onWidthChange && (
        <div
          className="chat-sidebar-resize-handle"
          onMouseDown={handleMouseDown}
        />
      )}

      {/* Header with session dropdown */}
      <div className="chat-sidebar-header">
        <SessionDropdown
          currentSessionId={sessionId}
          sessions={availableSessions}
          onSessionSelect={handleSessionSelect}
          onNewSession={handleNewSession}
          onDeleteSession={handleDeleteSession}
          onRenameSession={handleRenameSession}
          onOpenSessionManager={onSwitchToAgentMode}
        />
        <button
          className="chat-sidebar-new-button"
          onClick={handleNewSession}
          title="Start new conversation"
        >
          <MaterialSymbol icon="add" size={16} />
          New
        </button>
      </div>

      <SessionTranscript
        ref={transcriptRef}
        sessionId={sessionId}
        workspacePath={workspacePath}
        mode="chat"
        hideSidebar={true}
        onFileClick={handleFileClick}
        documentContext={effectiveDocumentContext}
      />
    </div>
  );
});

ChatSidebar.displayName = 'ChatSidebar';
