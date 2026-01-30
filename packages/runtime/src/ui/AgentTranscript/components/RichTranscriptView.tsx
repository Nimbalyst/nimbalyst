import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { VList, type VListHandle } from 'virtua';
import type { Message, SessionData } from '../../../ai/server/types';
import type { TranscriptSettings } from '../types';
import { MessageSegment } from './MessageSegment';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ProviderIcon } from '../../icons/ProviderIcons';
import { MaterialSymbol } from '../../icons/MaterialSymbol';
import { formatMessageTime } from '../../../utils/dateUtils';
import { JSONViewer } from './JSONViewer';
import { formatToolArguments, extractFilePathFromArgs } from '../utils/pathResolver';
import { EditToolResultCard } from './EditToolResultCard';
import { TranscriptSearchBar } from './TranscriptSearchBar';
import { formatToolDisplayName } from '../utils/toolNameFormatter';
import { getCustomToolWidget } from './CustomToolWidgets';

// Inject RichTranscriptView styles once (for animations, scrollbar, and complex selectors)
const injectRichTranscriptStyles = () => {
  const styleId = 'rich-transcript-view-styles';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    /* Avatar color-mix backgrounds */
    .rich-transcript-message-avatar.user {
      background-color: color-mix(in srgb, var(--nim-success) 20%, transparent);
      color: var(--nim-success);
    }
    .rich-transcript-message-avatar.assistant {
      background-color: color-mix(in srgb, var(--nim-primary) 20%, transparent);
      color: var(--nim-primary);
    }

    /* Edit card icon background */
    .rich-transcript-edit-card__icon {
      background-color: color-mix(in srgb, var(--nim-primary) 12%, transparent);
    }

    /* Edit card status backgrounds */
    .rich-transcript-edit-card__status--success {
      background-color: color-mix(in srgb, var(--nim-success) 15%, transparent);
    }
    .rich-transcript-edit-card__status--error {
      background-color: color-mix(in srgb, var(--nim-error) 15%, transparent);
    }

    /* Streaming avatar background */
    .rich-transcript-streaming-avatar {
      background-color: color-mix(in srgb, var(--nim-primary) 20%, transparent);
      color: var(--nim-primary);
    }

    /* Sub-agent styling */
    .rich-transcript-tool-card.sub-agent {
      background-color: color-mix(in srgb, var(--nim-primary) 5%, var(--nim-bg-secondary));
      border-color: color-mix(in srgb, var(--nim-primary) 20%, var(--nim-border));
    }

    /* VList scrollbar styling */
    .rich-transcript-vlist {
      scrollbar-width: thin;
      scrollbar-color: var(--nim-scrollbar-thumb) transparent;
    }
    .rich-transcript-vlist::-webkit-scrollbar {
      width: 8px;
    }
    .rich-transcript-vlist::-webkit-scrollbar-track {
      background: transparent;
    }
    .rich-transcript-vlist::-webkit-scrollbar-thumb {
      background-color: var(--nim-scrollbar-thumb);
      border-radius: 4px;
    }
    .rich-transcript-vlist::-webkit-scrollbar-thumb:hover {
      background-color: var(--nim-scrollbar-thumb-hover);
    }

    /* VList inner container styling */
    .rich-transcript-vlist > div {
      display: flex;
      flex-direction: column;
      max-width: 64rem;
      margin: 0 auto;
      padding: 0 0.75rem;
    }
    .rich-transcript-content.compact .rich-transcript-vlist > div {
      max-width: 72rem;
    }

    /* Copy button hover visibility */
    .rich-transcript-message-copy-action {
      opacity: 0;
      transition: opacity 0.15s ease-in-out;
    }
    .rich-transcript-message-content:hover .rich-transcript-message-copy-action {
      opacity: 1;
    }
    .rich-transcript-message-copy-action:has(.copied) {
      opacity: 1;
    }

    /* Animations */
    @keyframes thinking-pulse {
      0%, 100% {
        opacity: 0.4;
        transform: scale(0.9);
      }
      50% {
        opacity: 1;
        transform: scale(1.1);
      }
    }
    .rich-transcript-waiting-dot {
      animation: thinking-pulse 1.4s ease-in-out infinite;
    }
    .rich-transcript-waiting-dot:nth-child(1) { animation-delay: 0s; }
    .rich-transcript-waiting-dot:nth-child(2) { animation-delay: 0.2s; }
    .rich-transcript-waiting-dot:nth-child(3) { animation-delay: 0.4s; }

    @keyframes highlight {
      0%, 100% { background-color: inherit; }
      50% { background-color: var(--nim-bg-hover); }
    }
    .rich-transcript-message.highlight-message {
      animation: highlight 2s ease-in-out;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .rich-transcript-cursor {
      animation: pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    }
  `;
  document.head.appendChild(style);
};

// Initialize styles on module load
if (typeof document !== 'undefined') {
  injectRichTranscriptStyles();
}

/**
 * Inline component for displaying prompt additions (system prompt and user message additions)
 * Shows as collapsible sections after user messages when the developer option is enabled
 */
const PromptAdditionsInline: React.FC<{
  systemPromptAddition: string | null;
  userMessageAddition: string | null;
  timestamp: number;
}> = ({ systemPromptAddition, userMessageAddition, timestamp }) => {
  const [isSystemExpanded, setIsSystemExpanded] = useState(false);
  const [isUserExpanded, setIsUserExpanded] = useState(false);

  const hasSystemPrompt = systemPromptAddition && systemPromptAddition.trim().length > 0;
  const hasUserMessage = userMessageAddition && userMessageAddition.trim().length > 0;

  if (!hasSystemPrompt && !hasUserMessage) {
    return null;
  }

  const formatTimestamp = (ts: number) => {
    return new Date(ts).toLocaleTimeString();
  };

  return (
    <div
      className="ml-6 mt-2 rounded-md border border-[var(--nim-border)] bg-[var(--nim-bg-tertiary)] text-xs"
      style={{ maxHeight: '300px', overflowY: 'auto' }}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--nim-border)]">
        <span
          className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase"
          style={{
            backgroundColor: 'var(--nim-warning)',
            color: 'var(--nim-bg)',
          }}
        >
          Dev
        </span>
        <span className="text-[var(--nim-text-muted)]">Prompt Additions</span>
        <span className="ml-auto text-[11px] text-[var(--nim-text-faint)]">
          {formatTimestamp(timestamp)}
        </span>
      </div>

      <div className="p-2">
        {hasSystemPrompt && (
          <div className={hasUserMessage ? 'mb-2' : ''}>
            <button
              onClick={() => setIsSystemExpanded(!isSystemExpanded)}
              className="flex items-center gap-1 bg-transparent border-none text-[var(--nim-text)] cursor-pointer p-1 text-xs font-medium hover:bg-[var(--nim-bg-hover)] rounded w-full text-left"
            >
              <span
                style={{
                  transform: isSystemExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                  transition: 'transform 0.15s ease',
                  display: 'inline-block',
                  fontSize: '10px',
                }}
              >
                {'\u25B6'}
              </span>
              System Prompt Addition
              <span className="text-[11px] text-[var(--nim-text-muted)] font-normal ml-1">
                ({systemPromptAddition!.length} chars)
              </span>
            </button>
            {isSystemExpanded && (
              <pre
                className="m-0 mt-1 ml-3 p-2 bg-[var(--nim-bg)] rounded border border-[var(--nim-border)] text-[11px] leading-relaxed text-[var(--nim-text-muted)] overflow-auto"
                style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '150px' }}
              >
                {systemPromptAddition}
              </pre>
            )}
          </div>
        )}

        {hasUserMessage && (
          <div>
            <button
              onClick={() => setIsUserExpanded(!isUserExpanded)}
              className="flex items-center gap-1 bg-transparent border-none text-[var(--nim-text)] cursor-pointer p-1 text-xs font-medium hover:bg-[var(--nim-bg-hover)] rounded w-full text-left"
            >
              <span
                style={{
                  transform: isUserExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                  transition: 'transform 0.15s ease',
                  display: 'inline-block',
                  fontSize: '10px',
                }}
              >
                {'\u25B6'}
              </span>
              User Message Addition
              <span className="text-[11px] text-[var(--nim-text-muted)] font-normal ml-1">
                ({userMessageAddition!.length} chars)
              </span>
            </button>
            {isUserExpanded && (
              <pre
                className="m-0 mt-1 ml-3 p-2 bg-[var(--nim-bg)] rounded border border-[var(--nim-border)] text-[11px] leading-relaxed text-[var(--nim-text-muted)] overflow-auto"
                style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '150px' }}
              >
                {userMessageAddition}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

interface RichTranscriptViewProps {
  sessionId: string;
  sessionStatus?: string;
  isProcessing?: boolean; // Whether the session is currently processing a request
  messages: Message[];
  provider?: string;
  settings?: TranscriptSettings;
  onSettingsChange?: (settings: TranscriptSettings) => void;
  showSettings?: boolean;
  documentContext?: { filePath?: string };
  workspacePath?: string;
  /** Optional: render additional content in the empty state (e.g., command suggestions) */
  renderEmptyExtra?: () => React.ReactNode;
  /** Optional: Read a file from the filesystem (for custom widgets that need to load persisted files) */
  readFile?: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>;
  /** Optional: Open a file in the editor */
  onOpenFile?: (filePath: string) => void;
  /** Optional: Callback to trigger /compact command */
  onCompact?: () => void;
  /** Optional: Prompt additions for debugging (system prompt and user message additions) */
  promptAdditions?: {
    systemPromptAddition: string | null;
    userMessageAddition: string | null;
    timestamp: number;
  } | null;
}

const defaultSettings: TranscriptSettings = {
  showToolCalls: true,
  compactMode: false,
  collapseTools: false,
  showThinking: true,
  showSessionInit: false,
};

const EDIT_TOOL_NAMES = new Set(['edit', 'write', 'multi-edit', 'multiedit', 'multi_edit']);

const isEditToolName = (name?: string): boolean => {
  if (!name) return false;
  const normalized = name.toLowerCase();
  if (EDIT_TOOL_NAMES.has(normalized)) return true;
  if (normalized.endsWith('__edit')) return true;
  if (normalized.endsWith(':edit')) return true;
  return false;
};

const safeParseJson = (value: string): any | null => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const looksLikeJson = (value: string) => {
  const trimmed = value.trim();
  return (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'));
};

const extractEditsFromToolMessage = (message: Message): any[] => {
  const tool = message.toolCall;
  if (!tool) return [];

  const fallbackPath =
    tool.targetFilePath ||
    tool.arguments?.file_path ||
    tool.arguments?.filePath ||
    tool.arguments?.path;

  const edits: any[] = [];
  const visited = new WeakSet<object>();

  // DEBUG: Log the incoming tool message structure
  // if (tool.name && (tool.name.toLowerCase().includes('edit') || tool.name.toLowerCase().includes('write'))) {
  //   console.log('[extractEditsFromToolMessage] Processing tool:', tool.name);
  //   console.log('  fallbackPath:', fallbackPath);
  //   console.log('  messageHasEdits:', !!message.edits);
  //   console.log('  toolArguments:', JSON.stringify(tool.arguments, null, 2));
  //   console.log('  toolResult:', JSON.stringify(tool.result, null, 2));
  // }

  const pushEdit = (raw: any, fallback?: string) => {
    if (!raw || typeof raw !== 'object') return;
    const normalized: any = { ...raw };

    if (Array.isArray(normalized.content)) {
      const flattened = normalized.content
        .map((block: any) => {
          if (typeof block === 'string') return block;
          if (block && typeof block.text === 'string') return block.text;
          return '';
        })
        .filter(Boolean)
        .join('\n')
        .trim();
      if (flattened) {
        normalized.content = flattened;
      }
    }

    if (
      !normalized.filePath &&
      !normalized.file_path &&
      !normalized.targetFilePath &&
      fallback
    ) {
      normalized.filePath = fallback;
    }

    edits.push(normalized);
  };

  const visit = (value: any, localFallback?: string) => {
    if (value === null || value === undefined) return;
    const fallback = localFallback || fallbackPath;

    if (Array.isArray(value)) {
      value.forEach(item => visit(item, fallback));
      return;
    }

    if (typeof value === 'string') {
      if (looksLikeJson(value)) {
        const parsed = safeParseJson(value);
        if (parsed) {
          visit(parsed, fallback);
        }
      }
      return;
    }

    if (typeof value !== 'object') {
      return;
    }

    if (visited.has(value as object)) {
      return;
    }
    visited.add(value as object);

    const candidate = value as Record<string, any>;
    const candidateFilePath =
      candidate.file_path ||
      candidate.filePath ||
      candidate.targetFilePath ||
      candidate.file ||
      fallback;

    const hasReplacementArray = Array.isArray(candidate.replacements) && candidate.replacements.length > 0;
    const hasTextContent = typeof candidate.content === 'string' && candidate.content.trim().length > 0;
    const hasContentBlocks =
      Array.isArray(candidate.content) &&
      candidate.content.some((block: any) => typeof block === 'string' || typeof block?.text === 'string');
    const hasDiffLike =
      typeof candidate.diff === 'string' ||
      typeof candidate.newText === 'string' ||
      typeof candidate.oldText === 'string' ||
      typeof candidate.new_string === 'string' ||
      typeof candidate.old_string === 'string';

    if (hasReplacementArray || hasTextContent || hasContentBlocks || hasDiffLike) {
      pushEdit(candidate, candidateFilePath);
    }

    if (candidate.edit) {
      const editPath = candidate.edit?.file_path || candidate.edit?.filePath || candidateFilePath;
      visit(candidate.edit, editPath);
    }

    if (Array.isArray(candidate.edits)) {
      candidate.edits.forEach((entry: any) => {
        const entryPath = entry?.file_path || entry?.filePath || candidateFilePath;
        visit(entry, entryPath);
      });
    }

    Object.entries(candidate).forEach(([key, child]) => {
      if (key === 'edit' || key === 'edits') {
        return;
      }

      if (typeof child === 'string' && looksLikeJson(child)) {
        const parsed = safeParseJson(child);
        if (parsed) {
          visit(parsed, candidateFilePath);
        }
        return;
      }

      if (child && typeof child === 'object') {
        visit(child, candidateFilePath);
      }
    });
  };

  if (Array.isArray(message.edits) && message.edits.length > 0) {
    message.edits.forEach(edit => pushEdit(edit, fallbackPath));
  }

  if (tool.arguments) {
    visit(tool.arguments);
  }

  if (tool.result) {
    visit(tool.result);
  }

  // DEBUG: Log extraction results
  // if (tool.name && (tool.name.toLowerCase().includes('edit') || tool.name.toLowerCase().includes('write'))) {
  //   console.log('[extractEditsFromToolMessage] Extraction complete:', {
  //     toolName: tool.name,
  //     editsFound: edits.length,
  //     edits: edits.length > 0 ? edits : 'No edits found'
  //   });
  // }

  return edits;
};

export const RichTranscriptView = React.forwardRef<
  { scrollToMessage: (index: number) => void },
  RichTranscriptViewProps
>(({ sessionId, sessionStatus, isProcessing, messages, provider, settings: propsSettings, onSettingsChange, showSettings, documentContext, workspacePath, renderEmptyExtra, readFile, onOpenFile, onCompact, promptAdditions }, ref) => {
  const [collapsedMessages, setCollapsedMessages] = useState<Set<number>>(new Set());
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
  const [showSearchBar, setShowSearchBar] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const vlistRef = useRef<VListHandle>(null);
  const messageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const wasAtBottomRef = useRef(true);

  const settings = propsSettings || defaultSettings;

  // Determine if we're waiting for a response (used for scroll behavior and UI)
  const isWaitingForResponse = useMemo(() => {
    // Check isProcessing prop first (most reliable for queued prompts from mobile)
    if (isProcessing) return true;
    if (sessionStatus === 'running') return true;
    if (sessionStatus === 'waiting' && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      return lastMessage.role === 'user';
    }
    return false;
  }, [messages, sessionStatus, isProcessing]);

  // Find the index of the last user message (for prompt additions display)
  const lastUserMessageIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        return i;
      }
    }
    return -1;
  }, [messages]);

  // Expose scroll method via ref
  React.useImperativeHandle(ref, () => ({
    scrollToMessage: (index: number) => {
      if (vlistRef.current) {
        vlistRef.current.scrollToIndex(index, { align: 'center' });
        // Add highlight after scroll
        setTimeout(() => {
          const messageDiv = messageRefs.current.get(index);
          if (messageDiv) {
            messageDiv.classList.add('highlight-message');
            setTimeout(() => {
              messageDiv.classList.remove('highlight-message');
            }, 2000);
          }
        }, 100);
      }
    }
  }), []);

  // Initialize scroll to bottom when session loads
  useEffect(() => {
    if (messages.length === 0) return;

    // Use double RAF to ensure DOM is fully rendered before scrolling
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (vlistRef.current) {
          vlistRef.current.scrollToIndex(messages.length - 1, { align: 'end' });
        }
      });
    });
  }, [sessionId]); // Re-run when session changes

  // Auto-scroll to bottom when messages change (if user was at bottom)
  useEffect(() => {
    // Use double RAF to ensure DOM is fully rendered before scrolling
    // This matches the session load effect and prevents wasAtBottomRef from being
    // incorrectly set to false during content height changes
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (vlistRef.current) {
          // Re-check if we're at bottom after layout settles
          // This handles cases where wasAtBottomRef was incorrectly set during content updates
          const scrollSize = vlistRef.current.scrollSize;
          const viewportSize = vlistRef.current.viewportSize;
          const scrollOffset = vlistRef.current.scrollOffset;
          const distanceFromBottom = scrollSize - scrollOffset - viewportSize;
          const isAtBottom = distanceFromBottom < 100; // Slightly more lenient threshold

          if (isAtBottom || wasAtBottomRef.current) {
            // Account for the "Thinking..." indicator which is an extra item after messages
            const lastIndex = isWaitingForResponse ? messages.length : messages.length - 1;
            vlistRef.current.scrollToIndex(lastIndex, { align: 'end' });
            wasAtBottomRef.current = true; // Reset the ref since we scrolled to bottom
          }
        }
      });
    });
  }, [messages, isWaitingForResponse]);


  // Listen for routed search events from the menu system
  // Only respond if this session is the active one
  useEffect(() => {
    const handleFind = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.sessionId === sessionId) {
        setShowSearchBar(true);
      }
    };

    const handleFindNext = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.sessionId === sessionId && showSearchBar) {
        window.dispatchEvent(new CustomEvent('transcript-search-next'));
      }
    };

    const handleFindPrevious = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.sessionId === sessionId && showSearchBar) {
        window.dispatchEvent(new CustomEvent('transcript-search-prev'));
      }
    };

    window.addEventListener('menu:find', handleFind);
    window.addEventListener('menu:find-next', handleFindNext);
    window.addEventListener('menu:find-previous', handleFindPrevious);

    return () => {
      window.removeEventListener('menu:find', handleFind);
      window.removeEventListener('menu:find-next', handleFindNext);
      window.removeEventListener('menu:find-previous', handleFindPrevious);
    };
  }, [sessionId, showSearchBar]);

  const scrollToBottom = useCallback(() => {
    if (vlistRef.current) {
      // Account for the "Thinking..." indicator which is an extra item after messages
      const lastIndex = isWaitingForResponse ? messages.length : messages.length - 1;
      vlistRef.current.scrollToIndex(lastIndex, { align: 'end' });
    }
  }, [messages.length, isWaitingForResponse]);

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

  const toggleToolExpand = useCallback((toolId: string) => {
    setExpandedTools(prev => {
      const next = new Set(prev);
      if (next.has(toolId)) {
        next.delete(toolId);
      } else {
        next.add(toolId);
      }
      return next;
    });
  }, []);

  const copyMessageContent = async (message: Message, index: number) => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageIndex(index);
      setTimeout(() => setCopiedMessageIndex(null), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  // Auto-expand sub-agent (Task) tools
  useEffect(() => {
    const subAgentIds = new Set<string>();
    messages.forEach(msg => {
      if (msg.role === 'tool' && msg.toolCall?.isSubAgent && msg.toolCall.id) {
        subAgentIds.add(msg.toolCall.id);
      }
    });

    if (subAgentIds.size > 0) {
      setExpandedTools(prev => {
        const next = new Set(prev);
        subAgentIds.forEach(id => next.add(id));
        return next;
      });
    }
  }, [messages]);

  // Helper to check if message is a login-required error
  // Uses SDK's first-class isAuthError flag when available (preferred)
  // Falls back to string matching for backwards compatibility with old messages
  const isLoginRequiredError = (message: Message) => {
    // First-class detection via SDK's isAuthError flag (most reliable)
    if (message.isAuthError === true) {
      return true;
    }

    // Fallback to string matching for backwards compatibility
    // IMPORTANT: Only match specific authentication error patterns, NOT generic words
    const content = message.content || message.errorMessage || '';
    const lowerContent = content.toLowerCase();
    return (
      lowerContent.includes('invalid api key') ||
      lowerContent.includes('please run /login') ||
      // Match "401 unauthorized" or "unauthorized error" but not just "unauthorized" alone
      lowerContent.includes('401 unauthorized') ||
      lowerContent.includes('unauthorized error') ||
      lowerContent.includes('authentication required') ||
      lowerContent.includes('oauth token has expired') ||
      lowerContent.includes('token has expired') ||
      lowerContent.includes('expired token') ||
      lowerContent.includes('please obtain a new token') ||
      lowerContent.includes('refresh your existing token') ||
      lowerContent.includes('authentication_error') ||
      // Match "/login" only at word boundary (not in URLs)
      /\b\/login\b/.test(lowerContent)
    );
  };

  // Helper to check if we should show the login widget for a given message index
  // Only show the widget if this is a login error AND it's the last message in the session
  // This prevents redundant widgets from being shown when scrolling through history
  const shouldShowLoginWidgetForIndex = (index: number): boolean => {
    const message = messages[index];
    if (!isLoginRequiredError(message) || message.role === 'user') {
      return false;
    }

    // Only show the login widget if this is the last message in the session
    // This prevents re-rendering/re-checking login status when scrolling through old messages
    return index === messages.length - 1;
  };

  // Helper to get provider display name
  const getProviderDisplayName = (provider?: string): string => {
    switch (provider) {
      case 'claude':
        return 'Claude';
      case 'claude-code':
        return 'Claude Agent';
      case 'openai':
      case 'openai-codex':
        return 'OpenAI';
      case 'lmstudio':
        return 'LM Studio';
      default:
        return 'Agent';
    }
  };

  // Helper to extract text content from tool result
  const extractResultText = (result: any): string | null => {
    if (typeof result === 'string') {
      return result;
    }

    // Handle array of content blocks (Anthropic format)
    if (Array.isArray(result)) {
      const textParts: string[] = [];
      for (const block of result) {
        if (block.type === 'text' && block.text) {
          textParts.push(block.text);
        }
      }
      return textParts.length > 0 ? textParts.join('\n') : null;
    }

    return null;
  };

  // Recursive tool rendering helper
  const renderToolCard = (toolMsg: Message, toolIndex: number, depth: number = 0): JSX.Element | null => {
    if (!toolMsg.toolCall) return null;

    const tool = toolMsg.toolCall;
    const toolId = tool.id || tool.name || `tool-${toolIndex}`;
    const isExpanded = expandedTools.has(toolId);
    const isSubAgent = tool.isSubAgent && tool.name === 'Task';
    const hasChildren = tool.childToolCalls && tool.childToolCalls.length > 0;

    // Check for custom widget first
    const CustomWidget = tool.name ? getCustomToolWidget(tool.name) : undefined;
    if (CustomWidget) {
      return (
        <div
          key={`tool-${toolIndex}-${depth}`}
          className={`rich-transcript-tool-container mb-2 ${depth > 0 ? 'nested ml-0' : ''}`}
          style={{ marginLeft: depth > 0 ? '1rem' : '0' }}
        >
          <CustomWidget
            message={toolMsg}
            isExpanded={isExpanded}
            onToggle={() => toggleToolExpand(toolId)}
            workspacePath={workspacePath}
            sessionId={sessionId}
            readFile={readFile}
          />
        </div>
      );
    }

    const editTool = isEditToolName(tool.name);
    const editEntries = editTool ? extractEditsFromToolMessage(toolMsg) : [];
    const toolDisplayName = formatToolDisplayName(tool.name || '') || tool.name || 'Tool';

    if (editTool && editEntries.length > 0) {
      return (
        <div
          key={`tool-${toolIndex}-${depth}`}
          className={`rich-transcript-tool-container mb-2 ${depth > 0 ? 'nested ml-0' : ''}`}
          style={{ marginLeft: depth > 0 ? '1rem' : '0' }}
        >
          <EditToolResultCard
            toolMessage={toolMsg}
            edits={editEntries}
            workspacePath={workspacePath}
            onOpenFile={onOpenFile}
          />
        </div>
      );
    }

    // Extract description from arguments for sub-agents
    const description = isSubAgent && tool.arguments?.description ? tool.arguments.description : null;
    const prompt = isSubAgent && tool.arguments?.prompt ? tool.arguments.prompt : null;

    // Extract result text
    const resultText = tool.result ? extractResultText(tool.result) : null;

    // Special styling for sub-agents
    const cardClass = isSubAgent
      ? 'rich-transcript-tool-card sub-agent rounded border border-[var(--nim-border)] overflow-hidden'
      : depth > 0
        ? 'rich-transcript-tool-card child-tool rounded border border-[var(--nim-border)] overflow-hidden bg-[var(--nim-bg-tertiary)]'
        : 'rich-transcript-tool-card rounded border border-[var(--nim-border)] overflow-hidden bg-[var(--nim-bg-secondary)]';

    return (
      <div key={`tool-${toolIndex}-${depth}`} className={`rich-transcript-tool-container mb-2 ${depth > 0 ? 'nested ml-0' : ''}`} style={{ marginLeft: depth > 0 ? '1rem' : '0' }}>
        <div className={cardClass}>
          <button onClick={() => toggleToolExpand(toolId)} className="rich-transcript-tool-button w-full py-1 px-2 flex items-center gap-1.5 text-left border-none cursor-pointer text-sm bg-transparent">
            {isSubAgent ? (
              // Document/clipboard icon for sub-agents
              <MaterialSymbol icon="description" size={16} className="rich-transcript-tool-icon sub-agent-icon w-4 h-4 text-[var(--nim-primary)] shrink-0" />
            ) : (
              // Wrench icon for regular tools
              <MaterialSymbol icon="build" size={16} className="rich-transcript-tool-icon w-4 h-4 text-[var(--nim-primary)] shrink-0" />
            )}
            <span className="rich-transcript-tool-name font-mono text-sm text-[var(--nim-text)] font-medium" title={tool.name || undefined}>
              {isSubAgent ? 'Sub-Agent' : toolDisplayName}
              {isSubAgent && tool.subAgentType && (
                <span className="rich-transcript-tool-subagent-type text-[var(--nim-primary)] font-semibold"> [{tool.subAgentType}]</span>
              )}
            </span>
            {!isSubAgent && tool.arguments && (() => {
              const argStr = formatToolArguments(tool.name, tool.arguments, workspacePath);
              if (!argStr) return null;

              // Check if there's a clickable file path (only for tools that reference actual files)
              const filePath = extractFilePathFromArgs(tool.name, tool.arguments);
              const isClickable = onOpenFile && filePath;

              if (isClickable) {
                return (
                  <span
                    role="link"
                    tabIndex={0}
                    className="rich-transcript-tool-args rich-transcript-tool-args-link text-[var(--nim-text-muted)] flex-1 overflow-hidden text-ellipsis whitespace-nowrap bg-transparent border-none p-0 m-0 font-inherit text-[var(--nim-link)] cursor-pointer no-underline text-left hover:underline"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenFile(filePath);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.stopPropagation();
                        e.preventDefault();
                        onOpenFile(filePath);
                      }
                    }}
                    title={`Open ${filePath}`}
                  >
                    {argStr}
                  </span>
                );
              }
              return <span className="rich-transcript-tool-args text-[var(--nim-text-muted)] flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{argStr}</span>;
            })()}
            {tool.result && !(toolMsg as any).isError && (
              <MaterialSymbol icon="check_circle" size={16} className="rich-transcript-tool-success w-4 h-4 text-[var(--nim-success)] shrink-0" />
            )}
            {tool.result && (toolMsg as any).isError && (
              <MaterialSymbol icon="cancel" size={16} className="rich-transcript-tool-error w-4 h-4 text-[var(--nim-error)] shrink-0" />
            )}
            <MaterialSymbol icon={isExpanded ? "expand_more" : "chevron_right"} size={16} className="rich-transcript-tool-chevron w-3 h-3 text-[var(--nim-text-faint)]" />
          </button>

          {isExpanded && (
            <div className="rich-transcript-tool-expanded p-2 text-sm border-t border-[var(--nim-border)]">
              {/* Show description for sub-agents */}
              {isSubAgent && description && (
                <div className="rich-transcript-tool-section mb-1.5">
                  <div className="rich-transcript-tool-description text-sm text-[var(--nim-text)] leading-relaxed mb-2">{description}</div>
                </div>
              )}

              {/* Show prompt for sub-agents (collapsable) */}
              {isSubAgent && prompt && (
                <details className="rich-transcript-tool-details my-2">
                  <summary className="rich-transcript-tool-details-summary text-xs text-[var(--nim-text-faint)] cursor-pointer py-1 select-none hover:text-[var(--nim-text-muted)]">View full prompt</summary>
                  <div className="rich-transcript-tool-details-content mt-1 text-sm">
                    <MarkdownRenderer content={prompt} isUser={false} />
                  </div>
                </details>
              )}

              {/* Show regular tool arguments (not for sub-agents) */}
              {!isSubAgent && tool.arguments && Object.keys(tool.arguments).length > 0 && (
                <div className="rich-transcript-tool-section mb-1.5">
                  <div className="rich-transcript-tool-section-label text-[var(--nim-text-faint)] mb-0.5 text-xs">Arguments:</div>
                  <JSONViewer data={tool.arguments} maxHeight="16rem" />
                </div>
              )}

              {/* Recursively render child tools */}
              {hasChildren && (
                <div className="rich-transcript-tool-section mb-1.5">
                  <div className="rich-transcript-tool-section-label text-[var(--nim-text-faint)] mb-0.5 text-xs">
                    Sub-agent Actions ({tool.childToolCalls!.length}):
                  </div>
                  <div className="rich-transcript-subagent-children flex flex-col gap-1 mt-2">
                    {tool.childToolCalls!.map((childMsg, childIdx) =>
                      renderToolCard(childMsg, childIdx, depth + 1)
                    )}
                  </div>
                </div>
              )}

              {/* Show result - extract text from JSON if possible */}
              {tool.result && (
                <details className="rich-transcript-tool-details my-2" open={!isSubAgent}>
                  <summary className="rich-transcript-tool-details-summary text-xs text-[var(--nim-text-faint)] cursor-pointer py-1 select-none hover:text-[var(--nim-text-muted)]">
                    {isSubAgent ? 'View result' : 'Result'}
                  </summary>
                  <div className="rich-transcript-tool-details-content mt-1 text-sm">
                    {resultText ? (
                      <MarkdownRenderer content={resultText} isUser={false} />
                    ) : typeof tool.result === 'string' ? (
                      <MarkdownRenderer content={tool.result} isUser={false} />
                    ) : (
                      <JSONViewer data={tool.result} maxHeight="16rem" />
                    )}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="rich-transcript-view h-full flex flex-col bg-[var(--nim-bg)] relative overflow-x-hidden">
      {/* Search Bar */}
      <TranscriptSearchBar
        isVisible={showSearchBar}
        containerRef={scrollContainerRef}
        onClose={() => setShowSearchBar(false)}
      />

      {/* Settings Panel */}
      {showSettings && onSettingsChange && (
        <div className="rich-transcript-settings py-2 px-3 border-b border-[var(--nim-border)] bg-[var(--nim-bg-secondary)]">
          <div className="rich-transcript-settings-controls flex flex-wrap gap-3 text-xs">
            <label className="rich-transcript-settings-label flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.showToolCalls}
                onChange={(e) => onSettingsChange({ ...settings, showToolCalls: e.target.checked })}
                className="rich-transcript-settings-checkbox rounded border border-[var(--nim-border)]"
              />
              <span>Show Tool Calls</span>
            </label>
            <label className="rich-transcript-settings-label flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.compactMode}
                onChange={(e) => onSettingsChange({ ...settings, compactMode: e.target.checked })}
                className="rich-transcript-settings-checkbox rounded border border-[var(--nim-border)]"
              />
              <span>Compact Mode</span>
            </label>
            <label className="rich-transcript-settings-label flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.showThinking}
                onChange={(e) => onSettingsChange({ ...settings, showThinking: e.target.checked })}
                className="rich-transcript-settings-checkbox rounded border border-[var(--nim-border)]"
              />
              <span>Show Thinking</span>
            </label>
          </div>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollContainerRef} className="rich-transcript-scroll-container flex-1 overflow-hidden relative">
        <div className={`rich-transcript-content mx-auto py-1 h-full ${settings.compactMode ? 'compact' : 'normal'}`}>
          {messages.length === 0 && !isWaitingForResponse ? (
            <div className="rich-transcript-empty flex flex-col items-center p-8 px-4 h-full max-w-4xl mx-auto">
              <div className="rich-transcript-empty-content flex-1 flex flex-col justify-center max-w-[400px] text-left">
                <div className="rich-transcript-empty-title text-[var(--nim-text-faint)] text-sm mb-2 leading-relaxed">
                  {getProviderDisplayName(provider)} is ready to assist with:
                </div>
                <ul className="rich-transcript-empty-capabilities list-none p-0 m-0 ml-6">
                  <li className="text-[var(--nim-text-faint)] text-sm py-1 pl-3 relative leading-relaxed before:content-['•'] before:absolute before:left-0 before:text-[var(--nim-text-faint)]">Web research</li>
                  <li className="text-[var(--nim-text-faint)] text-sm py-1 pl-3 relative leading-relaxed before:content-['•'] before:absolute before:left-0 before:text-[var(--nim-text-faint)]">Code analysis</li>
                  <li className="text-[var(--nim-text-faint)] text-sm py-1 pl-3 relative leading-relaxed before:content-['•'] before:absolute before:left-0 before:text-[var(--nim-text-faint)]">File editing</li>
                </ul>
                <div className="rich-transcript-empty-footer text-[var(--nim-text-faint)] text-sm mt-3 leading-relaxed">
                  Enter a task below to get started
                </div>
              </div>
              {renderEmptyExtra?.()}
            </div>
          ) : (
            <div className="rich-transcript-messages flex flex-col max-w-full overflow-x-hidden h-full">
              <VList
                  ref={vlistRef}
                  className="rich-transcript-vlist !h-full !w-full"
                  style={{ height: '100%' }}
                  onScroll={(offset) => {
                    // Track if we're at the bottom for auto-scroll
                    if (vlistRef.current) {
                      const scrollSize = vlistRef.current.scrollSize;
                      const viewportSize = vlistRef.current.viewportSize;
                      const distanceFromBottom = scrollSize - offset - viewportSize;
                      wasAtBottomRef.current = distanceFromBottom < 50;
                      setShowScrollButton(distanceFromBottom > viewportSize);
                    }
                  }}
                >
                  {messages.map((message, index) => {
                    const isUser = message.role === 'user';
                    const isTool = message.role === 'tool';
                    const isCollapsed = collapsedMessages.has(index);

                    // Find tool messages that should be grouped with this message
                    const toolMessagesBefore: { message: Message, index: number }[] = [];
                    if (message.role === 'assistant') {
                      let checkIdx = index - 1;
                      while (checkIdx >= 0 && messages[checkIdx].role === 'tool') {
                        toolMessagesBefore.unshift({ message: messages[checkIdx], index: checkIdx });
                        checkIdx--;
                      }
                    }

                    // Skip rendering tool messages - they'll be rendered with their assistant message
                    if (isTool) {
                      let nextIndex = index + 1;
                      while (nextIndex < messages.length && messages[nextIndex].role === 'tool') {
                        nextIndex++;
                      }
                      if (nextIndex < messages.length && messages[nextIndex].role === 'assistant') {
                        // Return empty div for virtualization (can't return null)
                        return <div key={`${sessionId}-${index}`} style={{ display: 'none' }} />;
                      }
                    }

                    // Check if this is the start of a new message group
                    let effectivePrevMessage = null;
                    let checkIdx = index - 1;
                    while (checkIdx >= 0 && messages[checkIdx].role === 'tool') {
                      checkIdx--;
                    }
                    if (checkIdx >= 0) {
                      effectivePrevMessage = messages[checkIdx];
                    }
                    const isNewGroup = !effectivePrevMessage || effectivePrevMessage.role !== message.role;

                    // Render orphaned tool calls
                    if (isTool && message.toolCall) {
                      return (
                        <div key={`${sessionId}-${index}`} className="rich-transcript-tool-container orphan ml-6 mb-2">
                          {renderToolCard(message, index, 0)}
                        </div>
                      );
                    }

                    return (
                      <div
                        key={`${sessionId}-${index}`}
                        ref={(el) => {
                          if (el) messageRefs.current.set(index, el);
                        }}
                        className={`rich-transcript-message rounded-md relative max-w-full overflow-x-hidden break-words mb-2 ${isUser ? 'user bg-[var(--nim-bg-secondary)]' : 'assistant bg-[var(--nim-bg)]'} ${settings.compactMode ? 'compact p-2' : 'normal p-3'} ${!isNewGroup ? 'continuation -mt-1' : ''}`}
                      >
                        {isNewGroup && (
                          <div className="rich-transcript-message-header flex items-center gap-2 mb-1.5">
                            <div className={`rich-transcript-message-avatar rounded-full p-1 shrink-0 ${isUser ? 'user' : 'assistant'}`}>
                              {isUser && (
                                <MaterialSymbol icon="person" size={18} />
                              )}
                            </div>
                            <div className="rich-transcript-message-meta flex-1 flex items-baseline gap-2">
                              <span className="rich-transcript-message-sender font-medium text-[var(--nim-text)] text-sm">
                                {isUser ? 'You' : ''}
                              </span>
                              {isUser && message.mode === 'planning' && (
                                <span
                                  className="text-[10px] rounded-full font-medium"
                                  style={{ backgroundColor: '#3b82f6', color: 'white', padding: '2px 6px' }}
                                >
                                  Plan
                                </span>
                              )}
                              <span className="rich-transcript-message-time text-xs text-[var(--nim-text-faint)]">
                                {formatMessageTime(message.timestamp)}
                              </span>
                            </div>
                            <div className="rich-transcript-message-actions flex items-center gap-1">
                              {message.content.length > 200 && (
                                <button
                                  onClick={() => toggleMessageCollapse(index)}
                                  className="rich-transcript-collapse-button p-1 rounded-md bg-transparent border-none text-[var(--nim-text-faint)] cursor-pointer transition-colors hover:bg-[var(--nim-bg-secondary)] hover:text-[var(--nim-text-muted)]"
                                  title={isCollapsed ? "Show full message" : "Collapse message"}
                                >
                                  {isCollapsed ? (
                                    <MaterialSymbol icon="visibility" size={16} />
                                  ) : (
                                    <MaterialSymbol icon="visibility_off" size={16} />
                                  )}
                                </button>
                              )}
                            </div>
                          </div>
                        )}

                        {toolMessagesBefore.length > 0 && (
                          <div className={`rich-transcript-tool-messages flex flex-col gap-2 mb-1.5 ${isNewGroup ? 'indented ml-6' : ''}`}>
                            {toolMessagesBefore.map(({ message: toolMsg, index: toolIndex }) =>
                              renderToolCard(toolMsg, toolIndex, 0)
                            )}
                          </div>
                        )}

                        <div className={`rich-transcript-message-content relative ${isNewGroup ? 'ml-6' : 'no-indent ml-0'}`}>
                          {/* Copy button - shows on hover */}
                          <div className="rich-transcript-message-copy-action absolute -top-1 right-0 z-[1]">
                            <button
                              onClick={() => copyMessageContent(message, index)}
                              className={`rich-transcript-copy-button p-1.5 rounded-md bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] cursor-pointer transition-all flex items-center justify-center hover:bg-[var(--nim-bg-hover)] ${copiedMessageIndex === index ? 'copied' : ''}`}
                              title="Copy as Markdown"
                            >
                              {copiedMessageIndex === index ? (
                                <MaterialSymbol icon="check" size={16} className="text-[var(--nim-success)]" />
                              ) : (
                                <MaterialSymbol icon="content_copy" size={16} className="text-[var(--nim-text-faint)]" />
                              )}
                            </button>
                          </div>
                          <MessageSegment
                            message={message}
                            isUser={isUser}
                            isCollapsed={isCollapsed}
                            showToolCalls={false}
                            showThinking={settings.showThinking}
                            expandedTools={expandedTools}
                            onToggleToolExpand={toggleToolExpand}
                            documentContext={documentContext}
                            shouldShowLoginWidget={shouldShowLoginWidgetForIndex(index)}
                            sessionId={sessionId}
                            isLastMessage={index === messages.length - 1}
                            onOpenFile={onOpenFile}
                            onCompact={onCompact}
                          />
                        </div>
                        {/* Prompt additions debug display - show after the last user message when available */}
                        {isUser && promptAdditions && index === lastUserMessageIndex && (
                          <PromptAdditionsInline
                            systemPromptAddition={promptAdditions.systemPromptAddition}
                            userMessageAddition={promptAdditions.userMessageAddition}
                            timestamp={promptAdditions.timestamp}
                          />
                        )}
                      </div>
                    );
                  })}
                  {isWaitingForResponse && (
                    <div key="waiting" className="rich-transcript-waiting flex items-center gap-2 text-[var(--nim-text-muted)] italic py-2 px-4 mb-2">
                      <div className="rich-transcript-waiting-dots flex gap-1">
                        <div className="rich-transcript-waiting-dot w-2 h-2 rounded-full bg-[var(--nim-primary)]" />
                        <div className="rich-transcript-waiting-dot w-2 h-2 rounded-full bg-[var(--nim-primary)]" />
                        <div className="rich-transcript-waiting-dot w-2 h-2 rounded-full bg-[var(--nim-primary)]" />
                      </div>
                      <span className="rich-transcript-waiting-text">Thinking...</span>
                    </div>
                  )}
              </VList>
            </div>
          )}
        </div>

        {/* Scroll to bottom button */}
        {showScrollButton && (
          <div className="rich-transcript-scroll-button-container sticky bottom-3 flex justify-center pointer-events-none">
            <button
              onClick={scrollToBottom}
              className="rich-transcript-scroll-button pointer-events-auto p-2 bg-[var(--nim-primary)] text-white rounded-full border-none shadow-lg cursor-pointer transition-all hover:bg-[var(--nim-primary-hover)] hover:scale-110"
              title="Scroll to bottom"
            >
              <MaterialSymbol icon="arrow_downward" size={20} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

RichTranscriptView.displayName = 'RichTranscriptView';
