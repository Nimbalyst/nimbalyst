import React, { useState, useEffect } from 'react';
import type { Message, ChatAttachment } from '../../../ai/server/types';
import { MarkdownRenderer } from './MarkdownRenderer';
import { JSONViewer } from './JSONViewer';
import { DiffViewer } from './DiffViewer';
import { LoginRequiredWidget } from './LoginRequiredWidget';
import { OpenAIAuthWidget } from './OpenAIAuthWidget';
import { ContextLimitWidget } from './ContextLimitWidget';
import { RateLimitWidget } from './RateLimitWidget';
import { FullscreenModal } from './FullscreenModal';
import { MaterialSymbol } from '../../icons/MaterialSymbol';
import { formatToolDisplayName } from '../utils/toolNameFormatter';

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
  sessionId?: string; // For context limit widget to trigger compact command
  isLastMessage?: boolean; // For context limit widget to show compact button only on last message
  /** Optional: Open a file in the editor (makes file paths clickable) */
  onOpenFile?: (filePath: string) => void;
  /** Optional: Callback to trigger /compact command */
  onCompact?: () => void;
  /** Optional: Provider name for provider-specific rendering (e.g., 'openai-codex') */
  provider?: string;
}

export const MessageSegment: React.FC<MessageSegmentProps> = ({
  message,
  isUser,
  isCollapsed = false,
  showToolCalls,
  expandedTools,
  onToggleToolExpand,
  documentContext,
  shouldShowLoginWidget = true,
  sessionId,
  isLastMessage = false,
  onOpenFile,
  onCompact,
  provider
}) => {
  const [isDiffExpanded, setDiffExpanded] = useState(false);
  const [enlargedImage, setEnlargedImage] = useState<ChatAttachment | null>(null);
  const [enlargedText, setEnlargedText] = useState<ChatAttachment | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [textLoadError, setTextLoadError] = useState<string | null>(null);


  // Load text content when a text attachment is selected
  useEffect(() => {
    if (!enlargedText) {
      setTextContent(null);
      setTextLoadError(null);
      return;
    }

    const loadTextContent = async () => {
      try {
        // Read the file content using Electron's file system API
        if (typeof window !== 'undefined' && (window as any).electronAPI) {
          const result = await (window as any).electronAPI.invoke('read-file-content', enlargedText.filepath);
          if (result?.success) {
            // Handle binary files (e.g., PDFs) - for now just show a message
            if (result.isBinary) {
              setTextContent('[Binary file - preview not available]');
            } else {
              setTextContent(result.content);
            }
            setTextLoadError(null);
          } else if (result === null) {
            setTextLoadError('File not found');
            setTextContent(null);
          } else {
            setTextLoadError('Failed to read file');
            setTextContent(null);
          }
        } else {
          setTextLoadError('File reading not available');
          setTextContent(null);
        }
      } catch (error) {
        setTextLoadError(error instanceof Error ? error.message : 'Failed to read file');
        setTextContent(null);
      }
    };

    loadTextContent();
  }, [enlargedText]);

  // Helper function to check if content indicates login is required
  // Uses SDK's first-class isAuthError flag when available (preferred)
  // Falls back to string matching for backwards compatibility with old messages
  const isLoginRequiredError = (text: string): boolean => {
    // First-class detection via SDK's isAuthError flag (most reliable)
    // This is set by ClaudeCodeProvider when it detects auth errors from the SDK
    if (message.isAuthError === true) {
      return true;
    }

    return false;
  };

  // Helper function to check if content indicates an OpenAI authentication error
  // Matches 401 Unauthorized responses from api.openai.com
  const isOpenAIAuthError = (text: string): boolean => {
    const lowerText = text.toLowerCase();
    return (
      lowerText.includes('api.openai.com') &&
      (lowerText.includes('401 unauthorized') || (lowerText.includes('401') && lowerText.includes('authentication')))
    );
  };

  // Helper function to check if content indicates context limit exceeded
  const isContextLimitError = (text: string): boolean => {
    const lowerText = text.toLowerCase();
    return (
      lowerText.includes('prompt is too long') ||
      lowerText.includes('prompt too long') ||
      lowerText.includes('context limit') ||
      lowerText.includes('context window') ||
      lowerText.includes('exceeds maximum context') ||
      lowerText.includes('maximum context length')
    );
  };

  // Helper function to check if content is a rate limit event
  const isRateLimitError = (text: string): boolean => {
    return text.includes('[RATE_LIMIT]');
  };

  // Helper function to strip all <NIMBALYST_SYSTEM_MESSAGE> blocks from content
  // Uses regex to handle multiline content and any whitespace before the tags
  const stripSystemMessage = (content: string): string => {
    // Remove all <NIMBALYST_SYSTEM_MESSAGE>...</NIMBALYST_SYSTEM_MESSAGE> blocks
    // Including any whitespace before the tag (e.g., newlines)
    // [\s\S]*? matches any character including newlines (non-greedy)
    return content.replace(/\s*<NIMBALYST_SYSTEM_MESSAGE>[\s\S]*?<\/NIMBALYST_SYSTEM_MESSAGE>/g, '').trim();
  };

  // Render text content
  const renderTextContent = () => {
    if (!message.content.trim()) return null;

    // Skip if this is an error message - renderError() will handle it
    // This prevents duplicate LoginRequiredWidget rendering
    if (message.isError) return null;

    // Check if this is an OpenAI auth error in the message content
    if (!isUser && isOpenAIAuthError(message.content)) {
      return shouldShowLoginWidget ? <OpenAIAuthWidget /> : null;
    }

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

    // Codex raw events are now rendered directly in RichTranscriptView (grouped together)
    // This component only handles non-Codex messages

    return (
      <div className={isCollapsed ? 'max-h-20 overflow-hidden relative' : ''}>
        <MarkdownRenderer
          content={displayContent}
          isUser={isUser}
          isSystemMessage={isSystemMessage}
        />
        {isCollapsed && (
          <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[var(--nim-bg-secondary)] to-transparent pointer-events-none" />
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
    const statusColor = didFail ? 'var(--nim-error)' : 'var(--nim-success)';
    const statusBackground = didFail ? 'rgba(239, 68, 68, 0.12)' : 'rgba(16, 185, 129, 0.12)';
    const hasResult = toolResult !== undefined && toolResult !== null && (typeof toolResult !== 'string' || toolResult.trim().length > 0);
    const toolDisplayName = formatToolDisplayName(tool.name || '') || tool.name || 'Tool Call';

    return (
      <div className="rounded-md bg-nim-tertiary overflow-hidden border border-nim my-2">
        <button
          onClick={() => onToggleToolExpand(tool.id || tool.name)}
          className="w-full py-2 px-3 bg-nim-secondary flex items-center gap-2 transition-colors text-left border-none cursor-pointer hover:bg-nim-hover"
        >
          <MaterialSymbol icon="build" size={14} className="tool-icon" />
          <span
            className="font-mono text-xs text-nim flex-1"
            title={tool.name}
          >
            {toolDisplayName}
          </span>
          <span
            className="text-[0.7rem] font-semibold py-0.5 px-2 rounded-full uppercase tracking-tight pointer-events-none"
            style={{
              color: statusColor,
              backgroundColor: statusBackground
            }}
          >
            {statusLabel}
          </span>
          <MaterialSymbol
            icon={isExpanded ? "expand_more" : "chevron_right"}
            size={12}
            className="chevron-icon"
          />
        </button>

        {isExpanded && (
          <div className="py-2 px-3 text-xs">
            {typeof tool.arguments === 'object' && tool.arguments !== null && Object.keys(tool.arguments).length > 0 && (
              <div className="mb-2">
                <div className="text-nim-faint mb-1">Parameters:</div>
                <JSONViewer data={tool.arguments} maxHeight="16rem" />
              </div>
            )}


            <div className="mt-2">
              <div className="text-nim-faint mb-1">Result:</div>
              {hasResult ? (
                typeof toolResult === 'string' ? (
                  <pre className="text-xs text-nim font-mono overflow-x-auto bg-nim-secondary p-2 rounded max-h-64 overflow-y-auto">
                    {toolResult}
                  </pre>
                ) : (
                  <JSONViewer data={toolResult} maxHeight="16rem" />
                )
              ) : (
                <div className="text-xs text-nim-faint italic">
                  Tool did not return a result.
                </div>
              )}
              {derivedErrorMessage && (
                <div className="mt-2 text-xs text-nim-error">
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

    // Check if this is an OpenAI authentication error
    if (isOpenAIAuthError(errorMessage) && shouldShowLoginWidget) {
      return <OpenAIAuthWidget />;
    }
    if (isOpenAIAuthError(errorMessage) && !shouldShowLoginWidget) {
      return null;
    }

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

    // Check if this is a context limit error
    if (isContextLimitError(errorMessage)) {
      return <ContextLimitWidget sessionId={sessionId} isLastMessage={isLastMessage} onCompact={onCompact} />;
    }

    // Check if this is a rate limit event
    if (isRateLimitError(errorMessage)) {
      return <RateLimitWidget errorMessage={errorMessage} />;
    }

    // Otherwise, render the generic error UI
    return (
      <div className="my-2 p-3 bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.3)] rounded-lg">
        <div className="text-nim-error font-semibold text-sm mb-2 whitespace-pre-wrap">
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

    const handleAttachmentClick = (attachment: ChatAttachment) => {
      if (attachment.type === 'image') {
        setEnlargedImage(attachment);
      } else {
        setEnlargedText(attachment);
      }
    };

    return (
      <div className="message-attachments flex flex-wrap gap-2 mb-2">
        {message.attachments.map((attachment) => (
          <div
            key={attachment.id}
            className="message-attachment-item flex items-center gap-2 px-2.5 py-1.5 border border-[var(--nim-border)] rounded-md bg-[var(--nim-bg-secondary)] cursor-pointer transition-colors duration-150 max-w-[200px] hover:bg-[var(--nim-bg-hover)]"
            onClick={() => handleAttachmentClick(attachment)}
            title="Click to preview"
          >
            {attachment.type === 'image' ? (
              <img
                src={attachment.thumbnail || `file://${attachment.filepath}`}
                alt={attachment.filename}
                className="message-attachment-thumbnail w-12 h-12 object-cover rounded shrink-0"
              />
            ) : (
              <div className="message-attachment-icon w-12 h-12 flex items-center justify-center bg-[var(--nim-bg-tertiary)] rounded shrink-0 text-[var(--nim-text-muted)]">
                <MaterialSymbol icon={getFileIcon(attachment.type)} size={24} />
              </div>
            )}
            <div className="message-attachment-info flex flex-col gap-0.5 min-w-0 flex-1">
              <span className="message-attachment-filename text-xs font-medium text-[var(--nim-text)] whitespace-nowrap overflow-hidden text-ellipsis">{attachment.filename}</span>
              <span className="message-attachment-size text-[10px] text-[var(--nim-text-faint)]">{formatFileSize(attachment.size)}</span>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Render image lightbox modal
  const renderImageModal = () => {
    // For enlarged view, use the full file path (not thumbnail)
    // Convert file path to file:// URL for Electron
    const getEnlargedSrc = () => {
      if (!enlargedImage) return '';
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
      <FullscreenModal
        isOpen={!!enlargedImage}
        onClose={() => setEnlargedImage(null)}
        ariaLabel="Image preview"
        contentClassName="max-w-[90vw] max-h-[90vh] flex flex-col items-center"
      >
        <button
          className="message-attachment-modal-close absolute -top-8 -right-8 w-7 h-7 p-0 border-none bg-[var(--nim-bg-secondary)] rounded-full cursor-pointer flex items-center justify-center text-[var(--nim-text)] transition-colors duration-150 hover:bg-[var(--nim-bg-hover)]"
          onClick={() => setEnlargedImage(null)}
          aria-label="Close"
        >
          <MaterialSymbol icon="close" size={20} />
        </button>
        {enlargedImage && (
          <>
            <img
              src={getEnlargedSrc()}
              alt={enlargedImage.filename}
              className="message-attachment-modal-image max-w-full max-h-[calc(90vh-60px)] object-contain rounded-lg shadow-[0_4px_24px_rgba(0,0,0,0.3)]"
            />
            <div className="message-attachment-modal-caption mt-3 text-[13px] text-[var(--nim-text-muted)] bg-[var(--nim-bg-secondary)] px-3 py-1.5 rounded max-w-full whitespace-nowrap overflow-hidden text-ellipsis">
              {enlargedImage.filename}
            </div>
          </>
        )}
      </FullscreenModal>
    );
  };

  // Render text preview modal
  const renderTextModal = () => {
    const handleClose = () => {
      setEnlargedText(null);
      setTextContent(null);
      setTextLoadError(null);
    };

    return (
      <FullscreenModal
        isOpen={!!enlargedText}
        onClose={handleClose}
        ariaLabel="Text file preview"
        contentClassName="w-[80vw] max-w-[900px] max-h-[80vh] flex flex-col bg-[var(--nim-bg)] rounded-lg shadow-[0_4px_24px_rgba(0,0,0,0.3)] overflow-hidden"
      >
        {enlargedText && (
          <>
            <div className="message-attachment-text-modal-header flex items-center gap-2 px-4 py-3 border-b border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] shrink-0 text-[var(--nim-text-muted)]">
              <MaterialSymbol
                icon={enlargedText.type === 'pdf' ? 'picture_as_pdf' : 'description'}
                size={18}
              />
              <span className="message-attachment-text-modal-title text-sm font-medium text-[var(--nim-text)] whitespace-nowrap overflow-hidden text-ellipsis flex-1">
                {enlargedText.filename}
              </span>
              <button
                className="message-attachment-modal-close static ml-auto w-6 h-6 p-0 border-none bg-[var(--nim-bg-secondary)] rounded-full cursor-pointer flex items-center justify-center text-[var(--nim-text)] transition-colors duration-150 hover:bg-[var(--nim-bg-hover)]"
                onClick={handleClose}
                aria-label="Close"
              >
                <MaterialSymbol icon="close" size={18} />
              </button>
            </div>
            <div className="message-attachment-text-modal-content flex-1 overflow-auto p-4 bg-[var(--nim-bg)]">
              {textLoadError ? (
                <div className="message-attachment-text-modal-error flex flex-col items-center justify-center gap-2 p-8 text-[var(--nim-error)] text-sm">
                  <MaterialSymbol icon="error" size={24} />
                  <span>{textLoadError}</span>
                </div>
              ) : textContent === null ? (
                <div className="message-attachment-text-modal-loading flex flex-col items-center justify-center gap-2 p-8 text-[var(--nim-text-faint)] text-sm">
                  <span>Loading...</span>
                </div>
              ) : (
                <pre className="message-attachment-text-modal-pre m-0 font-mono text-[13px] leading-normal text-[var(--nim-text)] whitespace-pre-wrap break-words tab-4">
                  {textContent}
                </pre>
              )}
            </div>
          </>
        )}
      </FullscreenModal>
    );
  };

  // Render edits as diffs
  const renderEdits = () => {
    if (!message.edits || message.edits.length === 0) return null;

    return (
      <div className="my-2">
        <button
          onClick={() => setDiffExpanded(!isDiffExpanded)}
          className="flex items-center gap-2 py-1.5 px-3 text-xs bg-nim-secondary rounded transition-colors w-full text-left border-none cursor-pointer hover:bg-nim-hover"
        >
          <span className="text-nim-faint">
            {isDiffExpanded ? '\u25BC' : '\u25B6'}
          </span>
          <span className="text-nim-muted font-medium">
            {message.edits.length} edit{message.edits.length !== 1 ? 's' : ''}
          </span>
        </button>

        {isDiffExpanded && (
          <div className="mt-2 flex flex-col gap-2">
            {message.edits.map((edit: any, idx: number) => {
              const absolutePath = edit.filePath || edit.file_path || edit.targetFilePath;
              return (
                <DiffViewer
                  key={idx}
                  edit={edit}
                  filePath={documentContext?.filePath}
                  maxHeight="20rem"
                  onOpenFile={onOpenFile}
                  absoluteFilePath={absolutePath}
                />
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      {renderAttachments()}
      {renderTextContent()}
      {renderToolCall()}
      {renderEdits()}
      {renderError()}
      {renderImageModal()}
      {renderTextModal()}
    </div>
  );
};
