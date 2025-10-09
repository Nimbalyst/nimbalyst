import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { Message, SessionData } from '../../../ai/server/types';
import type { TranscriptSettings } from '../types';
import { MessageSegment } from './MessageSegment';
import { ProviderIcon } from '../../icons/ProviderIcons';
import { parseTimestamp } from '../../../utils/dateUtils';

interface RichTranscriptViewProps {
  sessionId: string;
  sessionStatus?: string;
  messages: Message[];
  provider?: string;
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
>(({ sessionId, sessionStatus, messages, provider, settings: propsSettings, onSettingsChange, showSettings }, ref) => {
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
                // Debug logging
                if (index === 0 || message.toolCall) {
                  // console.log(`[RichTranscriptView] Message ${index}:`, {
                  //   role: message.role,
                  //   hasToolCall: !!message.toolCall,
                  //   toolCallName: message.toolCall?.name,
                  //   contentLength: message.content?.length || 0
                  // });
                }

                const isUser = message.role === 'user';
                const isTool = message.role === 'tool';
                const isCollapsed = collapsedMessages.has(index);

                // Check if this is the start of a new message group (different role from previous)
                const prevMessage = index > 0 ? messages[index - 1] : null;
                const isNewGroup = !prevMessage || prevMessage.role !== message.role;

                // Render tool calls in a compact format
                if (isTool && message.toolCall) {
                  const tool = message.toolCall;
                  const toolId = tool.id || tool.name || `tool-${index}`;
                  const isExpanded = expandedTools.has(toolId);

                  return (
                    <div
                      key={`${sessionId}-${index}`}
                      style={{
                        marginLeft: '1.75rem',
                        marginTop: '-0.75rem',
                        marginBottom: '0.25rem'
                      }}
                    >
                      <div style={{
                        borderRadius: '0.25rem',
                        backgroundColor: 'var(--surface-secondary)',
                        overflow: 'hidden',
                        border: '1px solid var(--border-primary)'
                      }}>
                        <button
                          onClick={() => toggleToolExpand(toolId)}
                          style={{
                            width: '100%',
                            padding: '0.375rem 0.625rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            textAlign: 'left',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '0.875rem',
                            backgroundColor: 'transparent'
                          }}
                        >
                          <svg style={{ width: '1rem', height: '1rem', color: 'var(--accent-primary)', flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          <span style={{ fontFamily: 'monospace', fontSize: '0.875rem', color: 'var(--text-primary)', fontWeight: 500 }}>
                            {tool.name}
                          </span>
                          {tool.arguments && (() => {
                            const args = tool.arguments;
                            const argStr = Object.keys(args).map(k => {
                              const val = args[k];
                              if (typeof val === 'string') return val.length > 30 ? val.substring(0, 30) + '...' : val;
                              return JSON.stringify(val);
                            }).join(', ');
                            return <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{argStr}</span>;
                          })()}
                          {tool.result && (
                            <svg style={{ width: '1rem', height: '1rem', color: 'var(--success-color)', flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          )}
                          <svg style={{ width: '0.75rem', height: '0.75rem', color: 'var(--text-tertiary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isExpanded ? "M19 9l-7 7-7-7" : "M9 5l7 7-7 7"} />
                          </svg>
                        </button>

                        {isExpanded && (
                          <div style={{ padding: '0.625rem', fontSize: '0.875rem', borderTop: '1px solid var(--border-primary)' }}>
                            {tool.arguments && Object.keys(tool.arguments).length > 0 && (
                              <div style={{ marginBottom: '0.5rem' }}>
                                <div style={{ color: 'var(--text-tertiary)', marginBottom: '0.25rem', fontSize: '0.75rem' }}>Arguments:</div>
                                <pre style={{
                                  fontSize: '0.75rem',
                                  color: 'var(--text-secondary)',
                                  fontFamily: 'monospace',
                                  overflowX: 'auto',
                                  backgroundColor: 'var(--surface-tertiary)',
                                  padding: '0.5rem',
                                  borderRadius: '0.25rem',
                                  margin: 0
                                }}>
                                  {JSON.stringify(tool.arguments, null, 2)}
                                </pre>
                              </div>
                            )}

                            {tool.result && (
                              <div>
                                <div style={{ color: 'var(--text-tertiary)', marginBottom: '0.25rem', fontSize: '0.75rem' }}>Result:</div>
                                <pre style={{
                                  fontSize: '0.75rem',
                                  color: 'var(--text-primary)',
                                  fontFamily: 'monospace',
                                  overflowX: 'auto',
                                  backgroundColor: 'var(--surface-tertiary)',
                                  padding: '0.5rem',
                                  borderRadius: '0.25rem',
                                  maxHeight: '12rem',
                                  overflowY: 'auto',
                                  margin: 0
                                }}>
                                  {typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }

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
                      padding: settings.compactMode ? '0.75rem' : '1rem',
                      marginTop: !isNewGroup ? '-0.5rem' : '0'
                    }}
                  >
                    {/* Message Header - only show for new message groups */}
                    {isNewGroup && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                      <div style={{
                        borderRadius: '9999px',
                        padding: '0.375rem',
                        flexShrink: 0,
                        backgroundColor: isUser ? 'rgba(16, 185, 129, 0.2)' : 'rgba(59, 130, 246, 0.2)',
                        color: isUser ? '#10b981' : '#3b82f6'
                      }}>
                        {isUser ? (
                          <svg className="w-4 h-4" style={{ width: '1rem', height: '1rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                        ) : (
                          <ProviderIcon provider={provider || 'claude-code'} size={16} />
                        )}
                      </div>
                      <div style={{ flex: 1, display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                        <span style={{ fontWeight: 500, color: 'var(--text-primary)', fontSize: '0.875rem' }}>
                          {isUser ? 'You' : 'Claude Code'}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                          {parseTimestamp(message.timestamp)?.toLocaleTimeString() || ''}
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
                    )}

                    {/* Message Content */}
                    <div style={{ marginLeft: isNewGroup ? '1.75rem' : '0' }}>
                      <MessageSegment
                        message={message}
                        isUser={isUser}
                        isCollapsed={isCollapsed}
                        showToolCalls={false}
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
                backgroundColor: 'var(--accent-primary)',
                color: 'white',
                borderRadius: '9999px',
                border: 'none',
                boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--accent-primary-hover)';
                e.currentTarget.style.transform = 'scale(1.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--accent-primary)';
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
