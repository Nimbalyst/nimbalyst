import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { Message, SessionData } from '../../../ai/server/types';
import type { TranscriptSettings } from '../types';
import { MessageSegment } from './MessageSegment';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ProviderIcon } from '../../icons/ProviderIcons';
import { parseTimestamp } from '../../../utils/dateUtils';
import { JSONViewer } from './JSONViewer';
import { formatToolArguments } from '../utils/pathResolver';
import { EditToolResultCard } from './EditToolResultCard';
import { TranscriptSearchBar } from './TranscriptSearchBar';
import { formatToolDisplayName } from '../utils/toolNameFormatter';
import { useVirtualizedMessages } from '../hooks/useVirtualizedMessages';
import { getCustomToolWidget } from './CustomToolWidgets';
import './RichTranscriptView.css';

/**
 * Wrapper component that measures its children and reports height changes
 */
interface VirtualizedMessageWrapperProps {
  index: number;
  onMeasured: (index: number, height: number) => void;
  children: React.ReactNode;
}

const VirtualizedMessageWrapper = React.memo(({ index, onMeasured, children }: VirtualizedMessageWrapperProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastHeightRef = useRef<number>(0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    // Create ResizeObserver to track height changes
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = entry.contentRect.height;
        // Only report if height changed significantly (>1px)
        if (Math.abs(height - lastHeightRef.current) > 1) {
          lastHeightRef.current = height;
          onMeasured(index, height);
        }
      }
    });

    // Initial measurement
    const initialHeight = element.offsetHeight;
    if (initialHeight > 0) {
      lastHeightRef.current = initialHeight;
      onMeasured(index, initialHeight);
    }

    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  }, [index, onMeasured]);

  return (
    <div ref={containerRef} className="virtualized-message-wrapper">
      {children}
    </div>
  );
});

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
>(({ sessionId, sessionStatus, isProcessing, messages, provider, settings: propsSettings, onSettingsChange, showSettings, documentContext, workspacePath }, ref) => {
  const [collapsedMessages, setCollapsedMessages] = useState<Set<number>>(new Set());
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
  const [showSearchBar, setShowSearchBar] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const wasAtBottomRef = useRef(true);

  const settings = propsSettings || defaultSettings;

  // Virtualization hook
  const {
    virtualizedRange,
    isVirtualized,
    handleScroll: handleVirtualScroll,
    onMessageMeasured,
    scrollToIndex,
    invalidateHeight,
    isAtBottom,
    setIsAtBottom,
    getBottomOffset,
  } = useVirtualizedMessages(messages, expandedTools, {
    compactMode: settings.compactMode,
    overscan: 10, // Render 10 extra items above/below viewport for smoother scrolling
    virtualizationThreshold: 50, // Enable virtualization at 50+ messages
  });

  // Expose scroll method via ref
  React.useImperativeHandle(ref, () => ({
    scrollToMessage: (index: number) => {
      const container = scrollContainerRef.current;
      if (!container) return;

      // TODO: Debug logging - uncomment if needed
      // console.log('[scrollToMessage] Starting scroll to index:', index, {
      //   isVirtualized,
      //   virtualizedRange: { start: virtualizedRange.startIndex, end: virtualizedRange.endIndex },
      //   messageCount: messages.length,
      // });

      // Helper to check if element is attached to DOM and in viewport
      const isElementAttached = (element: HTMLElement): boolean => {
        return document.body.contains(element);
      };

      // Helper to check if element is centered in viewport
      const isInViewport = (element: HTMLElement): boolean => {
        if (!isElementAttached(element)) return false;
        const rect = element.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const viewportTop = containerRect.top;
        const viewportBottom = containerRect.bottom;
        const viewportCenter = (viewportTop + viewportBottom) / 2;
        const elementCenter = rect.top + rect.height / 2;
        // Check if element center is within 150px of viewport center
        return Math.abs(elementCenter - viewportCenter) < 150;
      };

      // Retry loop to ensure we scroll to the right place
      let attempts = 0;
      const maxAttempts = 10;

      const attemptScroll = () => {
        attempts++;
        const messageDiv = messageRefs.current.get(index);
        const isAttached = messageDiv ? isElementAttached(messageDiv) : false;

        // TODO: Debug logging - uncomment if needed
        // console.log(`[scrollToMessage] Attempt ${attempts}/${maxAttempts}:`, {
        //   hasMessageDiv: !!messageDiv,
        //   isAttached,
        //   refsSize: messageRefs.current.size,
        //   scrollTop: container.scrollTop,
        //   clientHeight: container.clientHeight,
        // });

        // If element exists but is detached, remove it from refs and treat as not found
        if (messageDiv && !isAttached) {
          // TODO: Debug logging - uncomment if needed
          // console.log('[scrollToMessage] Element is detached, removing stale ref');
          messageRefs.current.delete(index);
        }

        if (messageDiv && isAttached) {
          const inViewport = isInViewport(messageDiv);
          // TODO: Debug logging - uncomment if needed
          // console.log(`[scrollToMessage] Element found and attached, inViewport: ${inViewport}`);

          // Element exists in DOM - check if it's in viewport
          if (!inViewport) {
            // Not in viewport, scroll to it
            messageDiv.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'center' });
            // Immediately update scroll state
            handleVirtualScroll(container.scrollTop, container.clientHeight);
          }

          // Check again after scroll
          if (isInViewport(messageDiv)) {
            // TODO: Debug logging - uncomment if needed
            // console.log('[scrollToMessage] Element now in viewport, finishing with highlight');
            // Add highlight effect
            messageDiv.classList.add('highlight-message');
            setTimeout(() => {
              messageDiv.classList.remove('highlight-message');
            }, 2000);
            return;
          }

          // If we've done enough attempts, finish anyway
          if (attempts >= maxAttempts) {
            // TODO: Debug logging - uncomment if needed
            // console.log('[scrollToMessage] Max attempts, finishing with highlight anyway');
            messageDiv.classList.add('highlight-message');
            setTimeout(() => {
              messageDiv.classList.remove('highlight-message');
            }, 2000);
            return;
          }

          // Schedule another attempt with delay for React to process
          setTimeout(attemptScroll, 50);
        } else {
          // Element not in DOM yet - use height cache to scroll to approximate position
          const scrollInfo = scrollToIndex(index);
          // TODO: Debug logging - uncomment if needed
          // console.log('[scrollToMessage] Element not in DOM, scrollInfo:', scrollInfo);

          if (scrollInfo) {
            const targetScrollTop = scrollInfo.offset - (container.clientHeight / 2) + (scrollInfo.height / 2);
            // TODO: Debug logging - uncomment if needed
            // console.log('[scrollToMessage] Scrolling to:', targetScrollTop, 'current:', container.scrollTop);
            container.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'instant' as ScrollBehavior });
            // TODO: Debug logging - uncomment if needed
            // console.log('[scrollToMessage] After scroll, scrollTop:', container.scrollTop);
            handleVirtualScroll(container.scrollTop, container.clientHeight);
          }

          // If we still have attempts left, try again after DOM updates
          // Use setTimeout to give React time to process the scroll state update and re-render
          if (attempts < maxAttempts) {
            setTimeout(attemptScroll, 100); // Longer delay when waiting for element to appear
          }
          // TODO: Debug logging - uncomment if needed
          // else {
          //   console.log('[scrollToMessage] Max attempts reached without finding element');
          // }
        }
      };

      // Start the scroll attempt loop
      attemptScroll();
    }
  }), [scrollToIndex, handleVirtualScroll, isVirtualized, virtualizedRange, messages.length]);

  // Initialize scroll to bottom when session loads
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || messages.length === 0) return;

    // Use double RAF to ensure DOM is fully rendered before scrolling
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Scroll to bottom
        if (messagesEndRef.current) {
          messagesEndRef.current.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
        }
        // Update virtualization with actual scroll position
        handleVirtualScroll(container.scrollTop, container.clientHeight);
      });
    });
  }, [sessionId]); // Re-run when session changes

  // Auto-scroll to bottom when messages change (if user was at bottom)
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
      setIsAtBottom(distanceFromBottom < 50);
      setShowScrollButton(distanceFromBottom > clientHeight);

      // Feed scroll position to virtualization hook
      handleVirtualScroll(scrollTop, clientHeight);
    };

    container.addEventListener('scroll', handleScroll);
    handleScroll();

    return () => container.removeEventListener('scroll', handleScroll);
  }, [messages, handleVirtualScroll, setIsAtBottom]);

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

    // Find the message index for this tool and invalidate its height
    const toolIndex = messages.findIndex(m => m.toolCall?.id === toolId);
    if (toolIndex >= 0) {
      invalidateHeight(toolIndex);
    }
  }, [messages, invalidateHeight]);

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
    // Check isProcessing prop first (most reliable for queued prompts from mobile)
    if (isProcessing) return true;
    if (sessionStatus === 'running') return true;
    if (sessionStatus === 'waiting' && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      return lastMessage.role === 'user';
    }
    return false;
  }, [messages, sessionStatus, isProcessing]);

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
  const isLoginRequiredError = (message: Message) => {
    const content = message.content || message.errorMessage || '';
    return (
      content.toLowerCase().includes('invalid api key') ||
      content.includes('/login') ||
      content.toLowerCase().includes('please run /login') ||
      content.toLowerCase().includes('unauthorized') ||
      content.toLowerCase().includes('authentication required')
    );
  };

  // Helper to check if we should show the login widget for a given message index
  // Show the widget if this is a login error AND the previous non-tool message wasn't also a login error
  const shouldShowLoginWidgetForIndex = (index: number): boolean => {
    const message = messages[index];
    if (!isLoginRequiredError(message) || message.role === 'user') {
      return false;
    }

    // Find the previous non-tool message
    let prevIndex = index - 1;
    while (prevIndex >= 0 && messages[prevIndex].role === 'tool') {
      prevIndex--;
    }

    // If no previous message, show the widget
    if (prevIndex < 0) {
      return true;
    }

    // Show the widget only if the previous message wasn't also a login error
    return !isLoginRequiredError(messages[prevIndex]);
  };

  // Helper to get provider display name
  const getProviderDisplayName = (provider?: string): string => {
    switch (provider) {
      case 'claude':
        return 'Claude';
      case 'claude-code':
        return 'Claude Code';
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
          className={`rich-transcript-tool-container ${depth > 0 ? 'nested' : ''}`}
          style={{ marginLeft: depth > 0 ? '1rem' : '0' }}
        >
          <CustomWidget
            message={toolMsg}
            isExpanded={isExpanded}
            onToggle={() => toggleToolExpand(toolId)}
            workspacePath={workspacePath}
          />
        </div>
      );
    }

    const editTool = isEditToolName(tool.name);
    const editEntries = editTool ? extractEditsFromToolMessage(toolMsg) : [];
    const toolDisplayName = formatToolDisplayName(tool.name || '') || tool.name || 'Tool';

    // DEBUG: Log tool detection results
    // if (tool.name && (tool.name.toLowerCase().includes('edit') || tool.name.toLowerCase().includes('write'))) {
    //   console.log('[RichTranscriptView] Tool detection:', {
    //     toolName: tool.name,
    //     isEditTool: editTool,
    //     editEntriesCount: editEntries.length,
    //     toolStructure: {
    //       hasArguments: !!tool.arguments,
    //       hasResult: !!tool.result,
    //       hasEdits: !!toolMsg.edits,
    //       argumentsKeys: tool.arguments ? Object.keys(tool.arguments) : [],
    //       resultKeys: tool.result ? Object.keys(tool.result) : []
    //     }
    //   });
    //   if (editEntries.length > 0) {
    //     console.log('[RichTranscriptView] Edit entries:', editEntries);
    //   }
    // }

    if (editTool && editEntries.length > 0) {
      return (
        <div
          key={`tool-${toolIndex}-${depth}`}
          className={`rich-transcript-tool-container ${depth > 0 ? 'nested' : ''}`}
          style={{ marginLeft: depth > 0 ? '1rem' : '0' }}
        >
          <EditToolResultCard
            toolMessage={toolMsg}
            edits={editEntries}
            workspacePath={workspacePath}
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
      ? 'rich-transcript-tool-card sub-agent'
      : depth > 0
        ? 'rich-transcript-tool-card child-tool'
        : 'rich-transcript-tool-card';

    return (
      <div key={`tool-${toolIndex}-${depth}`} className={`rich-transcript-tool-container ${depth > 0 ? 'nested' : ''}`} style={{ marginLeft: depth > 0 ? '1rem' : '0' }}>
        <div className={cardClass}>
          <button onClick={() => toggleToolExpand(toolId)} className="rich-transcript-tool-button">
            {isSubAgent ? (
              // Document/clipboard icon for sub-agents
              <svg className="rich-transcript-tool-icon sub-agent-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            ) : (
              // Wrench icon for regular tools
              <svg className="rich-transcript-tool-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            )}
            <span className="rich-transcript-tool-name" title={tool.name || undefined}>
              {isSubAgent ? 'Sub-Agent' : toolDisplayName}
              {isSubAgent && tool.subAgentType && (
                <span className="rich-transcript-tool-subagent-type"> [{tool.subAgentType}]</span>
              )}
            </span>
            {!isSubAgent && tool.arguments && (() => {
              const argStr = formatToolArguments(tool.name, tool.arguments, workspacePath);
              return argStr ? <span className="rich-transcript-tool-args">{argStr}</span> : null;
            })()}
            {tool.result && !(toolMsg as any).isError && (
              <svg className="rich-transcript-tool-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            {tool.result && (toolMsg as any).isError && (
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
              {/* Show description for sub-agents */}
              {isSubAgent && description && (
                <div className="rich-transcript-tool-section">
                  <div className="rich-transcript-tool-description">{description}</div>
                </div>
              )}

              {/* Show prompt for sub-agents (collapsable) */}
              {isSubAgent && prompt && (
                <details className="rich-transcript-tool-details">
                  <summary className="rich-transcript-tool-details-summary">View full prompt</summary>
                  <div className="rich-transcript-tool-details-content">
                    <MarkdownRenderer content={prompt} isUser={false} />
                  </div>
                </details>
              )}

              {/* Show regular tool arguments (not for sub-agents) */}
              {!isSubAgent && tool.arguments && Object.keys(tool.arguments).length > 0 && (
                <div className="rich-transcript-tool-section">
                  <div className="rich-transcript-tool-section-label">Arguments:</div>
                  <JSONViewer data={tool.arguments} maxHeight="16rem" />
                </div>
              )}

              {/* Recursively render child tools */}
              {hasChildren && (
                <div className="rich-transcript-tool-section">
                  <div className="rich-transcript-tool-section-label">
                    Sub-agent Actions ({tool.childToolCalls!.length}):
                  </div>
                  <div className="rich-transcript-subagent-children">
                    {tool.childToolCalls!.map((childMsg, childIdx) =>
                      renderToolCard(childMsg, childIdx, depth + 1)
                    )}
                  </div>
                </div>
              )}

              {/* Show result - extract text from JSON if possible */}
              {tool.result && (
                <details className="rich-transcript-tool-details" open={!isSubAgent}>
                  <summary className="rich-transcript-tool-details-summary">
                    {isSubAgent ? 'View result' : 'Result'}
                  </summary>
                  <div className="rich-transcript-tool-details-content">
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
    <div className="rich-transcript-view">
      {/* Search Bar */}
      <TranscriptSearchBar
        isVisible={showSearchBar}
        containerRef={scrollContainerRef}
        onClose={() => setShowSearchBar(false)}
      />

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
              <div className="rich-transcript-empty-content">
                <div className="rich-transcript-empty-title">
                  {getProviderDisplayName(provider)} is ready to assist with:
                </div>
                <ul className="rich-transcript-empty-capabilities">
                  <li>Web research</li>
                  <li>Code analysis</li>
                  <li>File editing</li>
                </ul>
                <div className="rich-transcript-empty-footer">
                  Enter a task below to get started
                </div>
              </div>
            </div>
          ) : (
            <div className="rich-transcript-messages">
              {/* Top spacer for virtualization */}
              {isVirtualized && virtualizedRange.topSpacerHeight > 0 && (
                <div
                  className="rich-transcript-spacer"
                  style={{ height: virtualizedRange.topSpacerHeight }}
                  aria-hidden="true"
                />
              )}

              {messages.map((message, index) => {
                // Skip messages outside the visible range when virtualized
                if (isVirtualized && (index < virtualizedRange.startIndex || index > virtualizedRange.endIndex)) {
                  return null;
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

                // Render tool calls (orphaned tools)
                if (isTool && message.toolCall) {
                  return (
                    <VirtualizedMessageWrapper
                      key={`${sessionId}-${index}`}
                      index={index}
                      onMeasured={onMessageMeasured}
                    >
                      <div className="rich-transcript-tool-container orphan">
                        {renderToolCard(message, index, 0)}
                      </div>
                    </VirtualizedMessageWrapper>
                  );
                }

                return (
                  <VirtualizedMessageWrapper
                    key={`${sessionId}-${index}`}
                    index={index}
                    onMeasured={onMessageMeasured}
                  >
                    <div
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
                            {(() => {
                              const date = parseTimestamp(message.timestamp);
                              if (!date) return '';

                              const today = new Date();
                              const isToday =
                                date.getDate() === today.getDate() &&
                                date.getMonth() === today.getMonth() &&
                                date.getFullYear() === today.getFullYear();

                              if (isToday) {
                                return date.toLocaleTimeString();
                              } else {
                                return date.toLocaleString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: 'numeric',
                                  minute: '2-digit'
                                });
                              }
                            })()}
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
                          {toolMessagesBefore.map(({ message: toolMsg, index: toolIndex }) =>
                            renderToolCard(toolMsg, toolIndex, 0)
                          )}
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
                          shouldShowLoginWidget={shouldShowLoginWidgetForIndex(index)}
                        />
                      </div>
                    </div>
                  </VirtualizedMessageWrapper>
                );
              })}

              {/* Bottom spacer for virtualization */}
              {isVirtualized && virtualizedRange.bottomSpacerHeight > 0 && (
                <div
                  className="rich-transcript-spacer"
                  style={{ height: virtualizedRange.bottomSpacerHeight }}
                  aria-hidden="true"
                />
              )}

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
