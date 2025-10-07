import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { Message, SessionData } from '../../../ai/server/types';
import type { TranscriptSettings } from '../types';
import { MessageSegment } from './MessageSegment';

interface RichTranscriptViewProps {
  sessionId: string;
  sessionStatus?: string;
  messages: Message[];
  settings?: TranscriptSettings;
  onSettingsChange?: (settings: TranscriptSettings) => void;
  showSettings?: boolean;
}

const defaultSettings: TranscriptSettings = {
  showToolCalls: true,
  compactMode: false,
  collapseTools: false,
  showThinking: true,
  showSessionInit: false,
};

export const RichTranscriptView = React.forwardRef<
  { scrollToMessage: (index: number) => void },
  RichTranscriptViewProps
>(({ sessionId, sessionStatus, messages, settings: propsSettings, onSettingsChange, showSettings }, ref) => {
  const [collapsedMessages, setCollapsedMessages] = useState<Set<number>>(new Set());
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const wasAtBottomRef = useRef(true);

  const settings = propsSettings || defaultSettings;

  // Expose scroll method via ref
  React.useImperativeHandle(ref, () => ({
    scrollToMessage: (index: number) => {
      const messageDiv = messageRefs.current.get(index);
      if (messageDiv && scrollContainerRef.current) {
        messageDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Add highlight effect
        messageDiv.classList.add('highlight-message');
        setTimeout(() => {
          messageDiv.classList.remove('highlight-message');
        }, 2000);
      }
    }
  }), []);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current && wasAtBottomRef.current) {
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
      });
    }
  }, [messages]);

  // Handle scroll events
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      wasAtBottomRef.current = distanceFromBottom < 50;
      setShowScrollButton(distanceFromBottom > clientHeight);
    };

    container.addEventListener('scroll', handleScroll);
    handleScroll();

    return () => container.removeEventListener('scroll', handleScroll);
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const toggleMessageCollapse = (index: number) => {
    setCollapsedMessages(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const toggleToolExpand = (toolId: string) => {
    setExpandedTools(prev => {
      const next = new Set(prev);
      if (next.has(toolId)) {
        next.delete(toolId);
      } else {
        next.add(toolId);
      }
      return next;
    });
  };

  const copyMessageContent = async (message: Message, index: number) => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageIndex(index);
      setTimeout(() => setCopiedMessageIndex(null), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  const isWaitingForResponse = useMemo(() => {
    if (sessionStatus === 'running') return true;
    if (sessionStatus === 'waiting' && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      return lastMessage.role === 'user';
    }
    return false;
  }, [messages, sessionStatus]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-primary)', position: 'relative' }}>
      {/* Settings Panel */}
      {showSettings && onSettingsChange && (
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-primary)', backgroundColor: 'var(--surface-secondary)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', fontSize: '0.75rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                type="checkbox"
                checked={settings.showToolCalls}
                onChange={(e) => onSettingsChange({ ...settings, showToolCalls: e.target.checked })}
                style={{ borderRadius: '0.25rem', border: '1px solid var(--border-primary)' }}
              />
              <span>Show Tool Calls</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                type="checkbox"
                checked={settings.compactMode}
                onChange={(e) => onSettingsChange({ ...settings, compactMode: e.target.checked })}
                style={{ borderRadius: '0.25rem', border: '1px solid var(--border-primary)' }}
              />
              <span>Compact Mode</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                type="checkbox"
                checked={settings.showThinking}
                onChange={(e) => onSettingsChange({ ...settings, showThinking: e.target.checked })}
                style={{ borderRadius: '0.25rem', border: '1px solid var(--border-primary)' }}
              />
              <span>Show Thinking</span>
            </label>
          </div>
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          position: 'relative',
          scrollbarWidth: 'thin',
          scrollbarColor: 'var(--color-border-secondary) transparent'
        }}
      >
        <div style={{ margin: '0 auto', maxWidth: settings.compactMode ? '72rem' : '64rem', padding: '1rem 0' }}>
          {messages.length === 0 && !isWaitingForResponse ? (
            <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: '2rem 0' }}>
              No messages to display
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '0 1rem' }}>
              {messages.map((message, index) => {
                const isUser = message.role === 'user';
                const isCollapsed = collapsedMessages.has(index);

                return (
                  <div
                    key={`${sessionId}-${index}`}
                    ref={(el) => {
                      if (el) messageRefs.current.set(index, el);
                    }}
                    style={{
                      borderRadius: '0.5rem',
                      transition: 'all 0.2s',
                      position: 'relative',
                      backgroundColor: isUser ? 'var(--surface-secondary)' : 'var(--surface-primary)',
                      padding: settings.compactMode ? '0.75rem' : '1rem'
                    }}
                  >
                    {/* Message Header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                      <div style={{
                        borderRadius: '9999px',
                        padding: '0.375rem',
                        flexShrink: 0,
                        backgroundColor: isUser ? 'rgba(var(--status-success-rgb, 34, 197, 94), 0.2)' : 'rgba(var(--color-interactive-rgb, 59, 130, 246), 0.2)',
                        color: isUser ? 'var(--status-success)' : 'var(--color-interactive)'
                      }}>
                        {isUser ? (
                          <svg className="w-4 h-4" style={{ width: '1rem', height: '1rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" style={{ width: '1rem', height: '1rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                        )}
                      </div>
                      <div style={{ flex: 1, display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                        <span style={{ fontWeight: 500, color: 'var(--text-primary)', fontSize: '0.875rem' }}>
                          {isUser ? 'You' : 'Assistant'}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                          {new Date(message.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      {/* Action buttons */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        {!isUser && (
                          <button
                            onClick={() => copyMessageContent(message, index)}
                            style={{
                              padding: '0.375rem',
                              borderRadius: '0.5rem',
                              backgroundColor: 'var(--surface-secondary)',
                              border: '1px solid var(--border-primary)',
                              cursor: 'pointer',
                              transition: 'all 0.2s'
                            }}
                            title="Copy message content"
                          >
                            {copiedMessageIndex === index ? (
                              <svg style={{ width: '0.875rem', height: '0.875rem', color: 'var(--status-success)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            ) : (
                              <svg style={{ width: '0.875rem', height: '0.875rem', color: 'var(--text-tertiary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            )}
                          </button>
                        )}
                        {message.content.length > 200 && (
                          <button
                            onClick={() => toggleMessageCollapse(index)}
                            style={{
                              padding: '0.375rem',
                              borderRadius: '0.5rem',
                              backgroundColor: 'transparent',
                              border: 'none',
                              color: 'var(--text-tertiary)',
                              cursor: 'pointer',
                              transition: 'colors 0.2s'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = 'var(--surface-secondary)';
                              e.currentTarget.style.color = 'var(--text-secondary)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = 'transparent';
                              e.currentTarget.style.color = 'var(--text-tertiary)';
                            }}
                            title={isCollapsed ? "Show full message" : "Collapse message"}
                          >
                            {isCollapsed ? (
                              <svg style={{ width: '1rem', height: '1rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                            ) : (
                              <svg style={{ width: '1rem', height: '1rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                              </svg>
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Message Content */}
                    <div style={{ marginLeft: '1.75rem' }}>
                      <MessageSegment
                        message={message}
                        isUser={isUser}
                        isCollapsed={isCollapsed}
                        showToolCalls={settings.showToolCalls}
                        showThinking={settings.showThinking}
                        expandedTools={expandedTools}
                        onToggleToolExpand={toggleToolExpand}
                      />
                    </div>
                  </div>
                );
              })}
              {isWaitingForResponse && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-tertiary)' }}>
                  <div style={{ animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' }}>Thinking...</div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Scroll to bottom button */}
        {showScrollButton && (
          <div style={{ position: 'sticky', bottom: '1rem', display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
            <button
              onClick={scrollToBottom}
              style={{
                pointerEvents: 'auto',
                padding: '0.75rem',
                backgroundColor: 'var(--color-interactive)',
                color: 'white',
                borderRadius: '9999px',
                border: 'none',
                boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--color-interactive-hover)';
                e.currentTarget.style.transform = 'scale(1.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--color-interactive)';
                e.currentTarget.style.transform = 'scale(1)';
              }}
              title="Scroll to bottom"
            >
              <svg style={{ width: '1.25rem', height: '1.25rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

RichTranscriptView.displayName = 'RichTranscriptView';
