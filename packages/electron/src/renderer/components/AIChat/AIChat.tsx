import React, { useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import { AgenticPanel, type AgenticPanelRef } from '../UnifiedAI';
import type { DocumentContext } from '../../services/aiApi';
import './AIChat.css';

export interface AIChatRef {
  openSessionInTab: (sessionId: string) => Promise<void>;
}

interface AIChatProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  width: number;
  onWidthChange: (width: number) => void;
  planningModeEnabled?: boolean;
  onTogglePlanningMode?: (enabled: boolean) => void;
  documentContext?: DocumentContext & { getLatestContent?: () => string };
  onApplyEdit?: (edit: any, prompt?: string, aiResponse?: string) => void;
  workspacePath?: string;
  sessionToLoad?: { sessionId: string; workspacePath?: string } | null;
  onSessionLoaded?: () => void;
  onSessionIdChange?: (sessionId: string | null) => void;
  onShowApiKeyError?: () => void;
  onContentModeChange?: (mode: string) => void;
}

/**
 * AIChat - Sidebar AI assistant panel
 *
 * This is now a thin wrapper around AgenticPanel in chat mode.
 * All AI session management, message handling, and streaming is handled by AgenticPanel.
 */
export const AIChat = forwardRef<AIChatRef, AIChatProps>(function AIChat({
  isCollapsed,
  onToggleCollapse,
  onContentModeChange,
  width,
  onWidthChange,
  planningModeEnabled = true,
  onTogglePlanningMode,
  documentContext,
  onApplyEdit,
  workspacePath,
  sessionToLoad,
  onSessionLoaded,
  onSessionIdChange,
  onShowApiKeyError
}, ref) {
  const isResizingRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const agenticPanelRef = useRef<AgenticPanelRef>(null);

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    openSessionInTab: async (sessionId: string) => {
      // console.log('[AIChat] openSessionInTab called with sessionId:', sessionId);
      // console.log('[AIChat] agenticPanelRef.current:', agenticPanelRef.current);
      if (agenticPanelRef.current) {
        // console.log('[AIChat] Calling agenticPanelRef.current.openSessionInTab');
        await agenticPanelRef.current.openSessionInTab(sessionId);
        // console.log('[AIChat] openSessionInTab completed');
      } else {
        console.error('[AIChat] agenticPanelRef.current is null!');
      }
    }
  }), []);

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

  // Collapsed state - toggle button is now in the title bar, so don't render anything
  if (isCollapsed) {
    return null;
  }

  // Expanded state - show full panel with AgenticPanel
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

      {/* AgenticPanel in chat mode - includes its own header with session dropdown */}
      {workspacePath && (
        <div style={{
          flex: 1,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative'
        }}>
          <AgenticPanel
            ref={agenticPanelRef}
            mode="chat"
            workspacePath={workspacePath}
            documentContext={documentContext}
            onSessionChange={onSessionIdChange}
            onContentModeChange={onContentModeChange}
          />
        </div>
      )}
    </div>
  );
});
