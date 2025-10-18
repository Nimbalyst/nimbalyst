import React, { useRef, useEffect, useCallback } from 'react';
import { AgenticPanel } from '../UnifiedAI';
import type { DocumentContext } from '../../services/aiApi';
import './AIChat.css';

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
}

/**
 * AIChat - Sidebar AI assistant panel
 *
 * This is now a thin wrapper around AgenticPanel in chat mode.
 * All AI session management, message handling, and streaming is handled by AgenticPanel.
 */
export function AIChat({
  isCollapsed,
  onToggleCollapse,
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
}: AIChatProps) {
  const isResizingRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

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

  // Collapsed state - show floating toggle button
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
          {/* Close button overlay (top-right corner) */}
          <button
            onClick={onToggleCollapse}
            style={{
              position: 'absolute',
              top: '0.5rem',
              right: '0.5rem',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '0.25rem',
              display: 'flex',
              alignItems: 'center',
              color: 'var(--text-secondary)',
              zIndex: 10
            }}
            title="Close AI Assistant (⌘⇧A)"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>

          <AgenticPanel
            mode="chat"
            workspacePath={workspacePath}
            documentContext={documentContext}
            onSessionChange={onSessionIdChange}
          />
        </div>
      )}
    </div>
  );
}
