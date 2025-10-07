import React, { useState } from 'react';
import type { Message } from '../../../ai/server/types';

interface MessageSegmentProps {
  message: Message;
  isUser: boolean;
  isCollapsed?: boolean;
  showToolCalls: boolean;
  showThinking: boolean;
  expandedTools: Set<string>;
  onToggleToolExpand: (toolId: string) => void;
}

export const MessageSegment: React.FC<MessageSegmentProps> = ({
  message,
  isUser,
  isCollapsed = false,
  showToolCalls,
  expandedTools,
  onToggleToolExpand
}) => {
  const [isDiffExpanded, setDiffExpanded] = useState(false);

  // Debug logging for tool calls
  if (message.toolCall) {
    console.log('[MessageSegment] Rendering message with toolCall:', {
      role: message.role,
      toolName: message.toolCall.name,
      hasArguments: !!message.toolCall.arguments,
      hasResult: !!message.toolCall.result,
      showToolCalls
    });
  }

  // Render thinking indicator
  const renderThinking = () => {
    if (!message.isThinking) return null;

    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        color: 'var(--text-secondary)',
        fontStyle: 'italic'
      }}>
        <div style={{
          display: 'flex',
          gap: '0.25rem'
        }}>
          <div style={{
            width: '0.5rem',
            height: '0.5rem',
            borderRadius: '50%',
            backgroundColor: 'var(--accent-primary)',
            animation: 'pulse 1.4s ease-in-out infinite',
            animationDelay: '0s'
          }} />
          <div style={{
            width: '0.5rem',
            height: '0.5rem',
            borderRadius: '50%',
            backgroundColor: 'var(--accent-primary)',
            animation: 'pulse 1.4s ease-in-out infinite',
            animationDelay: '0.2s'
          }} />
          <div style={{
            width: '0.5rem',
            height: '0.5rem',
            borderRadius: '50%',
            backgroundColor: 'var(--accent-primary)',
            animation: 'pulse 1.4s ease-in-out infinite',
            animationDelay: '0.4s'
          }} />
        </div>
        <span>Thinking...</span>
        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 0.4; transform: scale(0.9); }
            50% { opacity: 1; transform: scale(1.1); }
          }
        `}</style>
      </div>
    );
  };

  // Render text content
  const renderTextContent = () => {
    if (message.isThinking) return renderThinking();
    if (!message.content.trim()) return null;

    return (
      <div style={isCollapsed ? { maxHeight: '5rem', overflow: 'hidden', position: 'relative' } : {}}>
        <div style={{
          whiteSpace: 'pre-wrap',
          fontWeight: isUser ? 500 : 400,
          color: 'var(--text-primary)'
        }}>
          {message.content}
        </div>
        {isCollapsed && (
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '3rem',
            background: 'linear-gradient(to top, var(--surface-secondary), transparent)',
            pointerEvents: 'none'
          }} />
        )}
      </div>
    );
  };

  // Render tool call
  const renderToolCall = () => {
    if (!showToolCalls || !message.toolCall) return null;

    const tool = message.toolCall;
    const isExpanded = expandedTools.has(tool.id || tool.name);

    return (
      <div style={{
        borderRadius: '0.375rem',
        backgroundColor: 'var(--surface-tertiary)',
        overflow: 'hidden',
        border: '1px solid var(--border-primary)',
        margin: '0.5rem 0'
      }}>
        <button
          onClick={() => onToggleToolExpand(tool.id || tool.name)}
          style={{
            width: '100%',
            padding: '0.5rem 0.75rem',
            backgroundColor: 'var(--surface-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            transition: 'colors 0.2s',
            textAlign: 'left',
            border: 'none',
            cursor: 'pointer'
          }}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--surface-hover)'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--surface-secondary)'}
        >
          <svg style={{ width: '0.875rem', height: '0.875rem', color: 'var(--accent-primary)', flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--text-primary)', flex: 1 }}>
            {tool.name}
          </span>
          {tool.result && (
            <svg style={{ width: '0.875rem', height: '0.875rem', color: 'var(--success-color)', flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
          {isExpanded ? (
            <svg style={{ width: '0.75rem', height: '0.75rem', color: 'var(--text-tertiary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          ) : (
            <svg style={{ width: '0.75rem', height: '0.75rem', color: 'var(--text-tertiary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          )}
        </button>

        {isExpanded && (
          <div style={{ padding: '0.5rem 0.75rem', fontSize: '0.75rem' }}>
            {tool.arguments && Object.keys(tool.arguments).length > 0 && (
              <div style={{ marginBottom: '0.5rem' }}>
                <div style={{ color: 'var(--text-tertiary)', marginBottom: '0.25rem' }}>Parameters:</div>
                <pre style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-secondary)',
                  fontFamily: 'monospace',
                  overflowX: 'auto',
                  backgroundColor: 'var(--surface-secondary)',
                  padding: '0.5rem',
                  borderRadius: '0.25rem'
                }}>
                  {JSON.stringify(tool.arguments, null, 2)}
                </pre>
              </div>
            )}

            {tool.result && (
              <div style={{ marginTop: '0.5rem' }}>
                <div style={{ color: 'var(--text-tertiary)', marginBottom: '0.25rem' }}>Result:</div>
                <pre style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-primary)',
                  fontFamily: 'monospace',
                  overflowX: 'auto',
                  backgroundColor: 'var(--surface-secondary)',
                  padding: '0.5rem',
                  borderRadius: '0.25rem',
                  maxHeight: '16rem',
                  overflowY: 'auto'
                }}>
                  {typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // Render error
  const renderError = () => {
    if (!message.isError) return null;

    return (
      <div style={{
        margin: '0.5rem 0',
        padding: '0.75rem',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        border: '1px solid rgba(239, 68, 68, 0.3)',
        borderRadius: '0.5rem'
      }}>
        <div style={{
          color: 'var(--error-color)',
          fontWeight: 600,
          fontSize: '0.875rem',
          marginBottom: '0.5rem'
        }}>
          {message.errorMessage || 'Error'}
        </div>
      </div>
    );
  };

  // Render edits as diffs
  const renderEdits = () => {
    if (!message.edits || message.edits.length === 0) return null;

    return (
      <div style={{ margin: '0.5rem 0' }}>
        <button
          onClick={() => setDiffExpanded(!isDiffExpanded)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.375rem 0.75rem',
            fontSize: '0.75rem',
            backgroundColor: 'var(--surface-secondary)',
            borderRadius: '0.25rem',
            transition: 'colors 0.2s',
            width: '100%',
            textAlign: 'left',
            border: 'none',
            cursor: 'pointer'
          }}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--surface-hover)'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--surface-secondary)'}
        >
          <span style={{ color: 'var(--text-tertiary)' }}>
            {isDiffExpanded ? '▼' : '▶'}
          </span>
          <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
            {message.edits.length} edit{message.edits.length !== 1 ? 's' : ''}
          </span>
        </button>

        {isDiffExpanded && (
          <div style={{
            marginTop: '0.5rem',
            backgroundColor: 'var(--surface-tertiary)',
            borderRadius: '0.5rem',
            padding: '0.75rem',
            overflow: 'hidden'
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {message.edits.map((edit: any, idx: number) => (
                <div key={idx} style={{ fontSize: '0.75rem' }}>
                  <div style={{
                    color: 'var(--text-secondary)',
                    fontFamily: 'monospace',
                    marginBottom: '0.25rem'
                  }}>
                    {edit.filePath || edit.file_path || 'Unknown file'}
                  </div>
                  <pre style={{
                    color: 'var(--text-primary)',
                    fontFamily: 'monospace',
                    overflowX: 'auto',
                    backgroundColor: 'var(--surface-secondary)',
                    padding: '0.5rem',
                    borderRadius: '0.25rem'
                  }}>
                    {edit.content || JSON.stringify(edit, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {renderTextContent()}
      {renderToolCall()}
      {renderEdits()}
      {renderError()}
    </div>
  );
};
