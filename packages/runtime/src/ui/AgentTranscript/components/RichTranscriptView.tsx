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
import { formatToolArguments } from '../utils/pathResolver';
import { EditToolResultCard } from './EditToolResultCard';
import { TranscriptSearchBar } from './TranscriptSearchBar';
import { formatToolDisplayName } from '../utils/toolNameFormatter';
import { getCustomToolWidget } from './CustomToolWidgets';
import './RichTranscriptView.css';

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
>(({ sessionId, sessionStatus, isProcessing, messages, provider, settings: propsSettings, onSettingsChange, showSettings, documentContext, workspacePath, renderEmptyExtra, readFile }, ref) => {
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
    if (!wasAtBottomRef.current) return;

    requestAnimationFrame(() => {
      if (vlistRef.current) {
        // Account for the "Thinking..." indicator which is an extra item after messages
        const lastIndex = isWaitingForResponse ? messages.length : messages.length - 1;
        vlistRef.current.scrollToIndex(lastIndex, { align: 'end' });
      }
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
          className={`rich-transcript-tool-container ${depth > 0 ? 'nested' : ''}`}
          style={{ marginLeft: depth > 0 ? '1rem' : '0' }}
        >
          <CustomWidget
            message={toolMsg}
            isExpanded={isExpanded}
            onToggle={() => toggleToolExpand(toolId)}
            workspacePath={workspacePath}
            readFile={readFile}
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
              <MaterialSymbol icon="description" size={16} className="rich-transcript-tool-icon sub-agent-icon" />
            ) : (
              // Wrench icon for regular tools
              <MaterialSymbol icon="build" size={16} className="rich-transcript-tool-icon" />
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
              <MaterialSymbol icon="check_circle" size={16} className="rich-transcript-tool-success" />
            )}
            {tool.result && (toolMsg as any).isError && (
              <MaterialSymbol icon="cancel" size={16} className="rich-transcript-tool-error" />
            )}
            <MaterialSymbol icon={isExpanded ? "expand_more" : "chevron_right"} size={16} className="rich-transcript-tool-chevron" />
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
              {renderEmptyExtra?.()}
            </div>
          ) : (
            <div className="rich-transcript-messages">
              <VList
                  ref={vlistRef}
                  className="rich-transcript-vlist"
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
                        <div key={`${sessionId}-${index}`} className="rich-transcript-tool-container orphan">
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
                        className={`rich-transcript-message ${isUser ? 'user' : 'assistant'} ${settings.compactMode ? 'compact' : 'normal'} ${!isNewGroup ? 'continuation' : ''}`}
                      >
                        {isNewGroup && (
                          <div className="rich-transcript-message-header">
                            <div className={`rich-transcript-message-avatar ${isUser ? 'user' : 'assistant'}`}>
                              {isUser && (
                                <MaterialSymbol icon="person" size={18} />
                              )}
                            </div>
                            <div className="rich-transcript-message-meta">
                              <span className="rich-transcript-message-sender">
                                {isUser ? 'You' : ''}
                              </span>
                              <span className="rich-transcript-message-time">
                                {formatMessageTime(message.timestamp)}
                              </span>
                            </div>
                            <div className="rich-transcript-message-actions">
                              {message.content.length > 200 && (
                                <button
                                  onClick={() => toggleMessageCollapse(index)}
                                  className="rich-transcript-collapse-button"
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
                          <div className={`rich-transcript-tool-messages ${isNewGroup ? 'indented' : ''}`}>
                            {toolMessagesBefore.map(({ message: toolMsg, index: toolIndex }) =>
                              renderToolCard(toolMsg, toolIndex, 0)
                            )}
                          </div>
                        )}

                        <div className={`rich-transcript-message-content ${isNewGroup ? '' : 'no-indent'}`}>
                          {/* Copy button for assistant messages - shows on hover */}
                          {!isUser && (
                            <div className="rich-transcript-message-copy-action">
                              <button
                                onClick={() => copyMessageContent(message, index)}
                                className={`rich-transcript-copy-button ${copiedMessageIndex === index ? 'copied' : ''}`}
                                title="Copy as Markdown"
                              >
                                {copiedMessageIndex === index ? (
                                  <MaterialSymbol icon="check" size={16} />
                                ) : (
                                  <MaterialSymbol icon="content_copy" size={16} />
                                )}
                              </button>
                            </div>
                          )}
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
                    );
                  })}
                  {isWaitingForResponse && (
                    <div key="waiting" className="rich-transcript-waiting">
                      <div className="rich-transcript-waiting-dots">
                        <div className="rich-transcript-waiting-dot" />
                        <div className="rich-transcript-waiting-dot" />
                        <div className="rich-transcript-waiting-dot" />
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
          <div className="rich-transcript-scroll-button-container">
            <button
              onClick={scrollToBottom}
              className="rich-transcript-scroll-button"
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
