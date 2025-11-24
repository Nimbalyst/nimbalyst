import React, { useState } from 'react';
import type { Message, ChatAttachment } from '../../../ai/server/types';
import { MarkdownRenderer } from './MarkdownRenderer';
import { JSONViewer } from './JSONViewer';
import { DiffViewer } from './DiffViewer';
import { LoginRequiredWidget } from './LoginRequiredWidget';
import { formatToolDisplayName } from '../utils/toolNameFormatter';
import './MessageSegment.css';

interface MessageSegmentProps {
  message: Message;
  isUser: boolean;
  isCollapsed?: boolean;
  showToolCalls: boolean;
  showThinking: boolean;
  expandedTools: Set<string>;
  onToggleToolExpand: (toolId: string) => void;
  documentContext?: { filePath?: string }; // For passing file path to edits
  shouldShowLoginWidget?: boolean; // Control whether to show login widget
}

export const MessageSegment: React.FC<MessageSegmentProps> = ({
  message,
  isUser,
  isCollapsed = false,
  showToolCalls,
  expandedTools,
  onToggleToolExpand,
  documentContext,
  shouldShowLoginWidget = true
}) => {
  const [isDiffExpanded, setDiffExpanded] = useState(false);
  const [enlargedImage, setEnlargedImage] = useState<ChatAttachment | null>(null);

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

  // Helper function to check if content indicates login is required
  const isLoginRequiredError = (text: string): boolean => {
    const lowerText = text.toLowerCase();
    return (
      lowerText.includes('invalid api key') ||
      lowerText.includes('/login') ||
      lowerText.includes('please run /login') ||
      lowerText.includes('unauthorized') ||
      lowerText.includes('authentication required') ||
      lowerText.includes('oauth token has expired') ||
      lowerText.includes('token has expired') ||
      lowerText.includes('expired token') ||
      lowerText.includes('please obtain a new token') ||
      lowerText.includes('refresh your existing token') ||
      lowerText.includes('authentication_error')
      // Note: Removed overly broad 'process exited with code' check
      // Only authentication-related errors should be treated as login-required
    );
  };

  // Helper function to strip the final <NIMBALYST_SYSTEM_MESSAGE> tag from content
  // This removes only the LAST occurrence, so if user types it in their message it won't break
  const stripSystemMessage = (content: string): string => {
    // Find the last occurrence of <NIMBALYST_SYSTEM_MESSAGE>
    const lastIndex = content.lastIndexOf('<NIMBALYST_SYSTEM_MESSAGE>');
    if (lastIndex === -1) return content;

    // Find the closing tag after this occurrence
    const closingTag = '</NIMBALYST_SYSTEM_MESSAGE>';
    const closingIndex = content.indexOf(closingTag, lastIndex);
    if (closingIndex === -1) return content;

    // Remove the system message block
    return content.substring(0, lastIndex) + content.substring(closingIndex + closingTag.length);
  };

  // Render text content
  const renderTextContent = () => {
    if (message.isThinking) return renderThinking();
    if (!message.content.trim()) return null;

    // Check if this is a login-required error in the message content
    const isLoginRequired = isLoginRequiredError(message.content);

    // If it's a login-required message, render the special widget (only if allowed)
    if (isLoginRequired && !isUser && shouldShowLoginWidget) {
      return <LoginRequiredWidget />;
    }

    // If it's a login-required message but we shouldn't show the widget, render nothing
    if (isLoginRequired && !isUser && !shouldShowLoginWidget) {
      return null;
    }

    // Slight visual variation for system messages
    const isSystemMessage = message.isSystem || message.role === 'system';

    // Strip out system message from user messages
    const displayContent = isUser ? stripSystemMessage(message.content) : message.content;

    return (
      <div style={isCollapsed ? { maxHeight: '5rem', overflow: 'hidden', position: 'relative' } : {}}>
        <MarkdownRenderer
          content={displayContent}
          isUser={isUser}
          isSystemMessage={isSystemMessage}
        />
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
    const toolResult = tool.result;
    const resultDetails = typeof toolResult === 'object' && toolResult !== null ? (toolResult as Record<string, any>) : null;
    const explicitSuccess = resultDetails && 'success' in resultDetails ? resultDetails.success !== false : undefined;
    const derivedErrorMessage = message.errorMessage || (resultDetails && typeof resultDetails.error === 'string' ? (resultDetails.error as string) : undefined);
    const didFail = message.isError || explicitSuccess === false || !!derivedErrorMessage;
    const statusLabel = didFail ? 'Failed' : 'Succeeded';
    const statusColor = didFail ? 'var(--error-color)' : 'var(--success-color)';
    const statusBackground = didFail ? 'rgba(239, 68, 68, 0.12)' : 'rgba(16, 185, 129, 0.12)';
    const hasResult = toolResult !== undefined && toolResult !== null && (typeof toolResult !== 'string' || toolResult.trim().length > 0);
    const toolDisplayName = formatToolDisplayName(tool.name || '') || tool.name || 'Tool Call';

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
          <span
            style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--text-primary)', flex: 1 }}
            title={tool.name}
          >
            {toolDisplayName}
          </span>
          <span
            style={{
              fontSize: '0.7rem',
              fontWeight: 600,
              color: statusColor,
              backgroundColor: statusBackground,
              padding: '0.125rem 0.5rem',
              borderRadius: '9999px',
              textTransform: 'uppercase',
              letterSpacing: '0.02em',
              pointerEvents: 'none'
            }}
          >
            {statusLabel}
          </span>
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
            {typeof tool.arguments === 'object' && tool.arguments !== null && Object.keys(tool.arguments).length > 0 && (
              <div style={{ marginBottom: '0.5rem' }}>
                <div style={{ color: 'var(--text-tertiary)', marginBottom: '0.25rem' }}>Parameters:</div>
                <JSONViewer data={tool.arguments} maxHeight="16rem" />
              </div>
            )}

            {typeof tool.arguments === 'string' && tool.arguments.trim().length > 0 && (
              <div style={{ marginBottom: '0.5rem' }}>
                <div style={{ color: 'var(--text-tertiary)', marginBottom: '0.25rem' }}>Parameters (raw):</div>
                <pre style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-secondary)',
                  fontFamily: 'monospace',
                  overflowX: 'auto',
                  backgroundColor: 'var(--surface-secondary)',
                  padding: '0.5rem',
                  borderRadius: '0.25rem'
                }}>
                  {tool.arguments}
                </pre>
              </div>
            )}

            <div style={{ marginTop: '0.5rem' }}>
              <div style={{ color: 'var(--text-tertiary)', marginBottom: '0.25rem' }}>Result:</div>
              {hasResult ? (
                typeof toolResult === 'string' ? (
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
                    {toolResult}
                  </pre>
                ) : (
                  <JSONViewer data={toolResult} maxHeight="16rem" />
                )
              ) : (
                <div style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-tertiary)',
                  fontStyle: 'italic'
                }}>
                  Tool did not return a result.
                </div>
              )}
              {derivedErrorMessage && (
                <div style={{
                  marginTop: '0.5rem',
                  fontSize: '0.75rem',
                  color: 'var(--error-color)'
                }}>
                  {derivedErrorMessage}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  // Render error
  const renderError = () => {
    if (!message.isError || message.role === 'tool') return null;

    const errorMessage = message.errorMessage || message.content || 'Error';

    // Check if this is a login-required error for Claude Code
    const isLoginRequired = isLoginRequiredError(errorMessage);

    // If it's a login-required error, render the special widget (only if allowed)
    if (isLoginRequired && shouldShowLoginWidget) {
      return <LoginRequiredWidget />;
    }

    // If it's a login-required error but we shouldn't show widget, render nothing
    if (isLoginRequired && !shouldShowLoginWidget) {
      return null;
    }

    // Otherwise, render the generic error UI
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
          {errorMessage}
        </div>
      </div>
    );
  };

  // Render attachments for user messages (thumbnails with click-to-enlarge)
  const renderAttachments = () => {
    if (!isUser || !message.attachments || message.attachments.length === 0) return null;

    const getFileIcon = (type: 'image' | 'pdf' | 'document'): string => {
      switch (type) {
        case 'image':
          return 'image';
        case 'pdf':
          return 'picture_as_pdf';
        case 'document':
          return 'description';
        default:
          return 'insert_drive_file';
      }
    };

    const formatFileSize = (bytes: number): string => {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    return (
      <div className="message-attachments">
        {message.attachments.map((attachment) => (
          <div
            key={attachment.id}
            className="message-attachment-item"
            onClick={() => attachment.type === 'image' && setEnlargedImage(attachment)}
            title={attachment.type === 'image' ? 'Click to enlarge' : attachment.filename}
          >
            {attachment.type === 'image' ? (
              <img
                src={attachment.thumbnail || `file://${attachment.filepath}`}
                alt={attachment.filename}
                className="message-attachment-thumbnail"
              />
            ) : (
              <div className="message-attachment-icon">
                <span className="material-icons">{getFileIcon(attachment.type)}</span>
              </div>
            )}
            <div className="message-attachment-info">
              <span className="message-attachment-filename">{attachment.filename}</span>
              <span className="message-attachment-size">{formatFileSize(attachment.size)}</span>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Render image lightbox modal
  const renderImageModal = () => {
    if (!enlargedImage) return null;

    // For enlarged view, use the full file path (not thumbnail)
    // Convert file path to file:// URL for Electron
    const getEnlargedSrc = () => {
      if (enlargedImage.filepath) {
        // If it's already a file:// URL or data URL, use as-is
        if (enlargedImage.filepath.startsWith('file://') || enlargedImage.filepath.startsWith('data:')) {
          return enlargedImage.filepath;
        }
        // Convert file path to file:// URL
        return `file://${enlargedImage.filepath}`;
      }
      // Fallback to thumbnail if no filepath
      return enlargedImage.thumbnail || '';
    };

    return (
      <div
        className="message-attachment-modal-overlay"
        onClick={() => setEnlargedImage(null)}
      >
        <div
          className="message-attachment-modal"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="message-attachment-modal-close"
            onClick={() => setEnlargedImage(null)}
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <img
            src={getEnlargedSrc()}
            alt={enlargedImage.filename}
            className="message-attachment-modal-image"
          />
          <div className="message-attachment-modal-caption">
            {enlargedImage.filename}
          </div>
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
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem'
          }}>
            {message.edits.map((edit: any, idx: number) => (
              <DiffViewer
                key={idx}
                edit={edit}
                filePath={documentContext?.filePath}
                maxHeight="20rem"
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {renderAttachments()}
      {renderTextContent()}
      {renderToolCall()}
      {renderEdits()}
      {renderError()}
      {renderImageModal()}
    </div>
  );
};
