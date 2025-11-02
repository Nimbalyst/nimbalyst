import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { Message, SessionData } from '../../../ai/server/types';
import type { TranscriptSettings } from '../types';
import { MessageSegment } from './MessageSegment';
import { ProviderIcon } from '../../icons/ProviderIcons';
import { parseTimestamp } from '../../../utils/dateUtils';
import { JSONViewer } from './JSONViewer';
import './RichTranscriptView.css';

interface RichTranscriptViewProps {
  sessionId: string;
  sessionStatus?: string;
  messages: Message[];
  provider?: string;
  settings?: TranscriptSettings;
  onSettingsChange?: (settings: TranscriptSettings) => void;
  showSettings?: boolean;
  documentContext?: { filePath?: string };
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
>(({ sessionId, sessionStatus, messages, provider, settings: propsSettings, onSettingsChange, showSettings, documentContext }, ref) => {
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
    <div className="rich-transcript-view">
      {/* Settings Panel */}
      {showSettings && onSettingsChange && (
        <div className="rich-transcript-settings">
          <div className="rich-transcript-settings-controls">
            <label className="rich-transcript-settings-label">
              <input
                type="checkbox"
                checked={settings.showToolCalls}
                onChange={(e) => onSettingsChange({ ...settings, showToolCalls: e.target.checked })}
                className="rich-transcript-settings-checkbox"
              />
              <span>Show Tool Calls</span>
            </label>
            <label className="rich-transcript-settings-label">
              <input
                type="checkbox"
                checked={settings.compactMode}
                onChange={(e) => onSettingsChange({ ...settings, compactMode: e.target.checked })}
                className="rich-transcript-settings-checkbox"
              />
              <span>Compact Mode</span>
            </label>
            <label className="rich-transcript-settings-label">
              <input
                type="checkbox"
                checked={settings.showThinking}
                onChange={(e) => onSettingsChange({ ...settings, showThinking: e.target.checked })}
                className="rich-transcript-settings-checkbox"
              />
              <span>Show Thinking</span>
            </label>
          </div>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollContainerRef} className="rich-transcript-scroll-container">
        <div className={`rich-transcript-content ${settings.compactMode ? 'compact' : 'normal'}`}>
          {messages.length === 0 && !isWaitingForResponse ? (
            <div className="rich-transcript-empty">
              No messages to display
            </div>
          ) : (
            <div className="rich-transcript-messages">
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

                // Find tool messages that should be grouped with this message
                // Tool messages come BEFORE their associated assistant message in the array
                // So we need to look backward for tool messages when rendering an assistant message
                const toolMessagesBefore: { message: Message, index: number }[] = [];
                if (message.role === 'assistant') {
                  // Look backward for consecutive tool messages
                  let checkIndex = index - 1;
                  while (checkIndex >= 0 && messages[checkIndex].role === 'tool') {
                    toolMessagesBefore.unshift({ message: messages[checkIndex], index: checkIndex });
                    checkIndex--;
                  }
                }

                // Skip rendering tool messages here - they'll be rendered with their assistant message
                if (isTool) {
                  // Check if the next non-tool message is an assistant message
                  let nextIndex = index + 1;
                  while (nextIndex < messages.length && messages[nextIndex].role === 'tool') {
                    nextIndex++;
                  }
                  if (nextIndex < messages.length && messages[nextIndex].role === 'assistant') {
                    // This tool message will be rendered with the assistant message
                    return null;
                  }
                  // Otherwise render it normally (orphaned tool message)
                }

                // Check if this is the start of a new message group
                const prevMessage = index > 0 ? messages[index - 1] : null;
                // Skip over tool messages when checking for new group
                let effectivePrevMessage = prevMessage;
                let checkIndex = index - 1;
                while (checkIndex >= 0 && messages[checkIndex].role === 'tool') {
                  checkIndex--;
                }
                if (checkIndex >= 0) {
                  effectivePrevMessage = messages[checkIndex];
                }
                const isNewGroup = !effectivePrevMessage || effectivePrevMessage.role !== message.role;

                // Render tool calls in a compact format (only for orphaned tools now)
                if (isTool && message.toolCall) {
                  const tool = message.toolCall;
                  const toolId = tool.id || tool.name || `tool-${index}`;
                  const isExpanded = expandedTools.has(toolId);

                  return (
                    <div key={`${sessionId}-${index}`} className="rich-transcript-tool-container orphan">
                      <div className="rich-transcript-tool-card">
                        <button onClick={() => toggleToolExpand(toolId)} className="rich-transcript-tool-button">
                          <svg className="rich-transcript-tool-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          <span className="rich-transcript-tool-name">
                            {tool.name}
                          </span>
                          {tool.arguments && (() => {
                            const args = tool.arguments;
                            const argStr = Object.keys(args).map(k => {
                              const val = args[k];
                              if (typeof val === 'string') return val.length > 30 ? val.substring(0, 30) + '...' : val;
                              return JSON.stringify(val);
                            }).join(', ');
                            return <span className="rich-transcript-tool-args">{argStr}</span>;
                          })()}
                          {tool.result && !(tool as any).isError && (
                            <svg className="rich-transcript-tool-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          )}
                          {tool.result && (tool as any).isError && (
                            <svg className="rich-transcript-tool-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          )}
                          <svg className="rich-transcript-tool-chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isExpanded ? "M19 9l-7 7-7-7" : "M9 5l7 7-7 7"} />
                          </svg>
                        </button>

                        {isExpanded && (
                          <div className="rich-transcript-tool-expanded">
                            {tool.arguments && Object.keys(tool.arguments).length > 0 && (
                              <div className="rich-transcript-tool-section">
                                <div className="rich-transcript-tool-section-label">Arguments:</div>
                                <JSONViewer data={tool.arguments} maxHeight="16rem" />
                              </div>
                            )}

                            {tool.result && (
                              <div className="rich-transcript-tool-section result">
                                <div className="rich-transcript-tool-section-label">Result:</div>
                                {typeof tool.result === 'string' ? (
                                  <pre>{tool.result}</pre>
                                ) : (
                                  <JSONViewer data={tool.result} maxHeight="16rem" />
                                )}
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
                    className={`rich-transcript-message ${isUser ? 'user' : 'assistant'} ${settings.compactMode ? 'compact' : 'normal'} ${!isNewGroup ? 'continuation' : ''}`}
                  >
                    {/* Message Header - only show for new message groups */}
                    {isNewGroup && (
                      <div className="rich-transcript-message-header">
                      <div className={`rich-transcript-message-avatar ${isUser ? 'user' : 'assistant'}`}>
                        {isUser && (
                          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                        )}
                      </div>
                      <div className="rich-transcript-message-meta">
                        <span className="rich-transcript-message-sender">
                          {isUser ? 'You' : ''}
                        </span>
                        <span className="rich-transcript-message-time">
                          {parseTimestamp(message.timestamp)?.toLocaleTimeString() || ''}
                        </span>
                      </div>
                      {/* Action buttons */}
                      <div className="rich-transcript-message-actions">
                        {!isUser && (
                          <button
                            onClick={() => copyMessageContent(message, index)}
                            className={`rich-transcript-action-button ${copiedMessageIndex === index ? 'copied' : ''}`}
                            title="Copy message content"
                          >
                            {copiedMessageIndex === index ? (
                              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            ) : (
                              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            )}
                          </button>
                        )}
                        {message.content.length > 200 && (
                          <button
                            onClick={() => toggleMessageCollapse(index)}
                            className="rich-transcript-collapse-button"
                            title={isCollapsed ? "Show full message" : "Collapse message"}
                          >
                            {isCollapsed ? (
                              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                            ) : (
                              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                              </svg>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                    )}

                    {/* Tool messages that came before this assistant message */}
                    {toolMessagesBefore.length > 0 && (
                      <div className={`rich-transcript-tool-messages ${isNewGroup ? 'indented' : ''}`}>
                        {toolMessagesBefore.map(({ message: toolMsg, index: toolIndex }) => {
                          if (!toolMsg.toolCall) return null;
                          const tool = toolMsg.toolCall;
                          const toolId = tool.id || tool.name || `tool-${toolIndex}`;
                          const isExpanded = expandedTools.has(toolId);

                          return (
                            <div key={`tool-${toolIndex}`} className="rich-transcript-tool-container">
                              <div className="rich-transcript-tool-card">
                                <button onClick={() => toggleToolExpand(toolId)} className="rich-transcript-tool-button">
                                  <svg className="rich-transcript-tool-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                  </svg>
                                  <span className="rich-transcript-tool-name">
                                    {tool.name}
                                  </span>
                                  {tool.arguments && (() => {
                                    const args = tool.arguments;
                                    const argStr = Object.keys(args).map(k => {
                                      const val = args[k];
                                      if (typeof val === 'string') return val.length > 30 ? val.substring(0, 30) + '...' : val;
                                      return JSON.stringify(val);
                                    }).join(', ');
                                    return <span className="rich-transcript-tool-args">{argStr}</span>;
                                  })()}
                                  {tool.result && !(tool as any).isError && (
                                    <svg className="rich-transcript-tool-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                  )}
                                  {tool.result && (tool as any).isError && (
                                    <svg className="rich-transcript-tool-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                  )}
                                  <svg className="rich-transcript-tool-chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isExpanded ? "M19 9l-7 7-7-7" : "M9 5l7 7-7 7"} />
                                  </svg>
                                </button>

                                {isExpanded && (
                                  <div className="rich-transcript-tool-expanded">
                                    {tool.arguments && Object.keys(tool.arguments).length > 0 && (
                                      <div className="rich-transcript-tool-section">
                                        <div className="rich-transcript-tool-section-label">Arguments:</div>
                                        <JSONViewer data={tool.arguments} maxHeight="16rem" />
                                      </div>
                                    )}

                                    {tool.result && (
                                      <div className="rich-transcript-tool-section result">
                                        <div className="rich-transcript-tool-section-label">Result:</div>
                                        {typeof tool.result === 'string' ? (
                                          <pre>{tool.result}</pre>
                                        ) : (
                                          <JSONViewer data={tool.result} maxHeight="16rem" />
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Message Content */}
                    <div className={`rich-transcript-message-content ${isNewGroup ? '' : 'no-indent'}`}>
                      <MessageSegment
                        message={message}
                        isUser={isUser}
                        isCollapsed={isCollapsed}
                        showToolCalls={false}
                        showThinking={settings.showThinking}
                        expandedTools={expandedTools}
                        onToggleToolExpand={toggleToolExpand}
                        documentContext={documentContext}
                      />
                    </div>
                  </div>
                );
              })}

              {isWaitingForResponse && (
                <div className="rich-transcript-waiting">
                  <div className="rich-transcript-waiting-text">Thinking...</div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Scroll to bottom button */}
        {showScrollButton && (
          <div className="rich-transcript-scroll-button-container">
            <button
              onClick={scrollToBottom}
              className="rich-transcript-scroll-button"
              title="Scroll to bottom"
            >
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
