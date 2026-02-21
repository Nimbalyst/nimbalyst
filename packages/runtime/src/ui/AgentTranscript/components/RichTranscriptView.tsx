import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { VList, type VListHandle, type CacheSnapshot } from 'virtua';
import type { Message, SessionData } from '../../../ai/server/types';
import type { TranscriptSettings } from '../types';
import { MessageSegment } from './MessageSegment';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ProviderIcon } from '../../icons/ProviderIcons';
import { MaterialSymbol } from '../../icons/MaterialSymbol';
import { formatMessageTime, formatDuration } from '../../../utils/dateUtils';
import { JSONViewer } from './JSONViewer';
import { formatToolArguments, extractFilePathFromArgs } from '../utils/pathResolver';
import { EditToolResultCard } from './EditToolResultCard';
import { TranscriptSearchBar } from './TranscriptSearchBar';
import { formatToolDisplayName } from '../utils/toolNameFormatter';
import { getCustomToolWidget, type ToolCallDiffResult } from './CustomToolWidgets';
import { ToolCallChanges } from './ToolCallChanges';
import { setSessionIsAtBottom, getSessionIsAtBottom } from '../../../store/atoms/transcriptScroll';
import { CodexOutputRenderer } from './CodexOutputRenderer';

// Per-session VList cache - survives component remounts so returning to a session
// doesn't re-measure all items from scratch
const vlistCacheMap = new Map<string, CacheSnapshot>();

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

    /* Agent team teammate styling */
    .rich-transcript-tool-card.teammate {
      background-color: color-mix(in srgb, var(--nim-primary) 8%, var(--nim-bg-secondary));
      border-color: color-mix(in srgb, var(--nim-primary) 30%, var(--nim-border));
      border-left: 3px solid var(--nim-primary);
    }

    /* Teammate message notification styling */
    .rich-transcript-teammate-notification {
      background-color: transparent;
      border-left: 2px solid color-mix(in srgb, var(--nim-primary) 25%, transparent);
      padding: 0.25rem 0.5rem;
    }
    .rich-transcript-teammate-notification details > summary {
      cursor: pointer;
      user-select: none;
    }
    .rich-transcript-teammate-notification details > summary::-webkit-details-marker,
    .rich-transcript-teammate-notification details > summary::marker {
      display: none;
      content: '';
    }
    .rich-transcript-teammate-notification .teammate-content {
      font-size: 0.8125rem;
      line-height: 1.5;
      color: var(--nim-text-muted);
    }
    .rich-transcript-teammate-notification .teammate-content p:first-child {
      margin-top: 0;
    }
    .rich-transcript-teammate-notification .teammate-content p:last-child {
      margin-bottom: 0;
    }
    .rich-transcript-teammate-notification details[open] > summary .teammate-chevron {
      transform: rotate(90deg);
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

    /* Scroll-ready fade-in transition to prevent flash when switching sessions */
    .rich-transcript-vlist-wrapper {
      opacity: 0;
      transition: opacity 0.15s ease-out;
    }
    .rich-transcript-vlist-wrapper.scroll-ready {
      opacity: 1;
    }
  `;
  document.head.appendChild(style);
};

// Initialize styles on module load
if (typeof document !== 'undefined') {
  injectRichTranscriptStyles();
}

/**
 * Inline component for displaying prompt additions (system prompt, user message, and attachments)
 * Shows as collapsible sections after user messages when the developer option is enabled
 * Persists across messages so users can reference additions from previous prompts
 */
const PromptAdditionsInline: React.FC<{
  systemPromptAddition: string | null;
  userMessageAddition: string | null;
  attachments?: Array<{ type: string; filename: string; mimeType?: string; filepath?: string }>;
  timestamp: number;
}> = ({ systemPromptAddition, userMessageAddition, attachments, timestamp }) => {
  const [isSystemExpanded, setIsSystemExpanded] = useState(false);
  const [isUserExpanded, setIsUserExpanded] = useState(false);
  const [isAttachmentsExpanded, setIsAttachmentsExpanded] = useState(false);

  const hasSystemPrompt = !!(systemPromptAddition && systemPromptAddition.trim().length > 0);
  const hasUserMessage = !!(userMessageAddition && userMessageAddition.trim().length > 0);
  const hasAttachments = !!(attachments && attachments.length > 0);

  if (!hasSystemPrompt && !hasUserMessage && !hasAttachments) {
    return null;
  }

  const formatTimestamp = (ts: number) => {
    return new Date(ts).toLocaleTimeString();
  };

  // Helper to render an expandable section
  const renderExpandableSection = (
    title: string,
    isExpanded: boolean,
    setExpanded: (v: boolean) => void,
    badge: string,
    content: React.ReactNode,
    hasMore: boolean
  ) => (
    <div className={hasMore ? 'mb-2' : ''}>
      <button
        onClick={() => setExpanded(!isExpanded)}
        className="flex items-center gap-1 bg-transparent border-none text-[var(--nim-text)] cursor-pointer p-1 text-xs font-medium hover:bg-[var(--nim-bg-hover)] rounded w-full text-left"
      >
        <span
          style={{
            transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s ease',
            display: 'inline-block',
            fontSize: '10px',
          }}
        >
          {'\u25B6'}
        </span>
        {title}
        <span className="text-[11px] text-[var(--nim-text-muted)] font-normal ml-1">
          ({badge})
        </span>
      </button>
      {isExpanded && (
        <div className="mt-1 ml-3">
          {content}
        </div>
      )}
    </div>
  );

  return (
    <div
      className="ml-6 mt-2 rounded-md border border-[var(--nim-border)] bg-[var(--nim-bg-tertiary)] text-xs"
      style={{ maxHeight: '400px', overflowY: 'auto' }}
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
        {/* Attachments Section */}
        {hasAttachments && renderExpandableSection(
          'Attachments',
          isAttachmentsExpanded,
          setIsAttachmentsExpanded,
          `${attachments!.length} file${attachments!.length > 1 ? 's' : ''}`,
          <div className="space-y-1">
            {attachments!.map((att, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 p-2 bg-[var(--nim-bg)] rounded border border-[var(--nim-border)] text-[11px] text-[var(--nim-text-muted)]"
              >
                <span
                  className="px-1 py-0.5 rounded text-[9px] font-medium uppercase"
                  style={{
                    backgroundColor: att.type === 'image' ? 'var(--nim-info)' : 'var(--nim-primary)',
                    color: 'white',
                  }}
                >
                  {att.type}
                </span>
                <span className="font-medium text-[var(--nim-text)]">{att.filename}</span>
                {att.mimeType && (
                  <span className="text-[var(--nim-text-faint)]">({att.mimeType})</span>
                )}
              </div>
            ))}
          </div>,
          hasSystemPrompt || hasUserMessage
        )}

        {/* System Prompt Section */}
        {hasSystemPrompt && renderExpandableSection(
          'System Prompt Addition',
          isSystemExpanded,
          setIsSystemExpanded,
          `${systemPromptAddition!.length} chars`,
          <pre
            className="m-0 p-2 bg-[var(--nim-bg)] rounded border border-[var(--nim-border)] text-[11px] leading-relaxed text-[var(--nim-text-muted)] overflow-auto"
            style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '150px' }}
          >
            {systemPromptAddition}
          </pre>,
          hasUserMessage
        )}

        {/* User Message Addition Section */}
        {hasUserMessage && renderExpandableSection(
          'User Message Addition',
          isUserExpanded,
          setIsUserExpanded,
          `${userMessageAddition!.length} chars`,
          <pre
            className="m-0 p-2 bg-[var(--nim-bg)] rounded border border-[var(--nim-border)] text-[11px] leading-relaxed text-[var(--nim-text-muted)] overflow-auto"
            style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '150px' }}
          >
            {userMessageAddition}
          </pre>,
          false
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
  /** Optional: Prompt additions for debugging (system prompt, user message, and attachments) */
  promptAdditions?: {
    systemPromptAddition: string | null;
    userMessageAddition: string | null;
    attachments?: Array<{ type: string; filename: string; mimeType?: string; filepath?: string }>;
    timestamp: number;
    messageIndex: number; // Index of user message this belongs to (for stable positioning)
  } | null;
  /** Optional: Current teammates/agents from session metadata, used to show status on spawn cards */
  currentTeammates?: Array<{ agentId: string; status: 'running' | 'completed' | 'errored' | 'idle' }>;
  /** Optional: App start time (epoch ms) for rendering restart indicator line (dev mode only) */
  appStartTime?: number;
  /** Optional: Fetch file diffs caused by a specific tool call */
  getToolCallDiffs?: (toolCallItemId: string) => Promise<ToolCallDiffResult[] | null>;
  // Note: Interactive widgets read their host from interactiveWidgetHostAtom(sessionId)
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

  const args = tool.arguments as Record<string, any> | undefined;
  const fallbackPath =
    tool.targetFilePath ||
    (args?.file_path as string | undefined) ||
    (args?.filePath as string | undefined) ||
    (args?.path as string | undefined);

  const edits: any[] = [];
  const visited = new WeakSet<object>();

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

  if (args) {
    visit(args);
  }

  if (tool.result) {
    visit(tool.result);
  }

  return edits;
};

export const RichTranscriptView = React.forwardRef<
  { scrollToMessage: (index: number) => void; scrollToTop: () => void },
  RichTranscriptViewProps
>(({ sessionId, sessionStatus, isProcessing, messages, provider, settings: propsSettings, onSettingsChange, showSettings, documentContext, workspacePath, renderEmptyExtra, readFile, onOpenFile, onCompact, promptAdditions, currentTeammates, appStartTime, getToolCallDiffs }, ref) => {
  const [collapsedMessages, setCollapsedMessages] = useState<Set<number>>(new Set());
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const scrollButtonRef = useRef<HTMLDivElement>(null);
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
  const [showSearchBar, setShowSearchBar] = useState(false);
  const pendingPermissionsVisibleRef = useRef(true);
  const [showPermissionBanner, setShowPermissionBanner] = useState(false);
  const [isScrollReady, setIsScrollReady] = useState(false);
  const [isContainerVisible, setIsContainerVisible] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const viewRootRef = useRef<HTMLDivElement>(null);
  const vlistRef = useRef<VListHandle>(null);
  const messageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const settings = propsSettings || defaultSettings;

  // Save VList cache when switching sessions or unmounting.
  // This lets returning to a session skip expensive re-measurement of all item sizes.
  useEffect(() => {
    return () => {
      if (vlistRef.current && sessionId) {
        vlistCacheMap.set(sessionId, vlistRef.current.cache);
      }
    };
  }, [sessionId]);

  // Track container visibility - when parent is display:none (e.g. mode switch),
  // VList gets 0 height and renders ALL items instead of virtualizing.
  // Skip rendering the message list entirely when hidden.
  useEffect(() => {
    const el = viewRootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        setIsContainerVisible(entries[0]?.isIntersecting ?? false);
      },
      { threshold: 0 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

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

  // Compute waiting indicator text — show agent/teammate count when lead is idle but agents are running
  const waitingText = useMemo(() => {
    if (!isWaitingForResponse) return '';
    const runningAgents = currentTeammates?.filter(t => t.status === 'running') ?? [];
    if (runningAgents.length > 0) {
      // Check if the last message is from the assistant (lead finished, waiting for agents)
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.role === 'assistant') {
        const label = runningAgents.length === 1 ? 'agent' : 'agents';
        return `Waiting for ${runningAgents.length} ${label} to finish`;
      }
    }
    return 'Thinking...';
  }, [isWaitingForResponse, currentTeammates, messages]);


  // Compute effective target index for prompt additions display
  // Use the stored messageIndex if valid, otherwise find the last user message
  const promptAdditionsTargetIndex = useMemo(() => {
    if (!promptAdditions) return -1;
    const storedIndex = promptAdditions.messageIndex;
    // Check if stored index is valid and points to a user message
    if (storedIndex >= 0 && storedIndex < messages.length && messages[storedIndex]?.role === 'user') {
      return storedIndex;
    }
    // Fallback: find the last user message
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        return i;
      }
    }
    return -1;
  }, [messages, promptAdditions]);

  // Compute restart line position: find the first visible message after appStartTime
  // The red restart indicator line renders before this message, or at the bottom if all messages precede the restart
  const { restartAfterIndex, restartAtBottom } = useMemo(() => {
    if (!appStartTime || messages.length === 0) return { restartAfterIndex: -1, restartAtBottom: false };
    // If all messages are before restart, show at bottom
    if (messages[messages.length - 1].timestamp <= appStartTime) return { restartAfterIndex: -1, restartAtBottom: true };
    // Find the first message after restart that will actually be rendered visibly:
    // Skip tool messages (they render hidden, grouped with the next assistant message)
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].timestamp > appStartTime && messages[i].role !== 'tool') {
        return { restartAfterIndex: i, restartAtBottom: false };
      }
    }
    return { restartAfterIndex: -1, restartAtBottom: false };
  }, [messages, appStartTime]);

  // Find pending (unresolved) ToolPermission widgets and the VList indices where they're actually rendered.
  // Tool messages are hidden (display:none) and rendered inside the next assistant message via toolMessagesBefore,
  // so we need to find the assistant message index for scroll targeting.
  const pendingPermissionIndices = useMemo(() => {
    // Don't show banner for stopped/completed sessions.
    // Session is active if processing, running/waiting status, or teammates are still running.
    const hasActiveTeammates = currentTeammates?.some(t => t.status === 'running' || t.status === 'idle') ?? false;
    const sessionActive = isProcessing || sessionStatus === 'running' || sessionStatus === 'waiting' || hasActiveTeammates;
    if (!sessionActive) return [];
    const indices: number[] = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role === 'tool' && msg.toolCall?.name === 'ToolPermission' && !msg.toolCall.result) {
        // Find the next assistant message that renders this tool via toolMessagesBefore
        let targetIdx = i + 1;
        while (targetIdx < messages.length && messages[targetIdx].role === 'tool') {
          targetIdx++;
        }
        if (targetIdx < messages.length && messages[targetIdx].role === 'assistant') {
          indices.push(targetIdx); // Scroll to the assistant message that contains this widget
        } else {
          indices.push(i); // Orphaned tool - rendered at its own index
        }
      }
    }
    return indices;
  }, [messages, isProcessing, sessionStatus, currentTeammates]);

  // Update banner visibility when pending permissions are resolved or new ones appear
  useEffect(() => {
    if (pendingPermissionIndices.length === 0) {
      setShowPermissionBanner(false);
      pendingPermissionsVisibleRef.current = true;
    } else {
      // Always show banner initially when pending permissions exist.
      // The onScroll handler will hide it if the permissions are actually visible.
      // This fixes the case where auto-scroll pushes past the permission widget
      // while isAtBottom is true (making us incorrectly assume visibility).
      setShowPermissionBanner(true);
      pendingPermissionsVisibleRef.current = false;

      // Schedule a visibility check after auto-scroll completes (auto-scroll uses double RAF).
      // Triple RAF ensures we run after auto-scroll's double RAF + the resulting scroll event.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (vlistRef.current && pendingPermissionIndices.length > 0) {
              const offset = vlistRef.current.scrollOffset;
              const viewportSize = vlistRef.current.viewportSize;
              const firstVisibleIdx = vlistRef.current.findItemIndex(offset);
              const lastVisibleIdx = vlistRef.current.findItemIndex(offset + viewportSize);
              const anyVisible = pendingPermissionIndices.some(
                idx => idx >= firstVisibleIdx && idx <= lastVisibleIdx
              );
              pendingPermissionsVisibleRef.current = anyVisible;
              setShowPermissionBanner(!anyVisible);
            }
          });
        });
      });
    }
  }, [pendingPermissionIndices, sessionId]);

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
    },
    scrollToTop: () => {
      if (vlistRef.current) {
        vlistRef.current.scrollToIndex(0, { align: 'start' });
      }
    }
  }), []);

  // Reset scroll-ready state when session changes or container hides
  useEffect(() => {
    setIsScrollReady(false);
  }, [sessionId, isContainerVisible]);

  // Initialize scroll to bottom when session loads or container becomes visible
  useEffect(() => {
    if (!isContainerVisible) return;

    if (messages.length === 0) {
      // Empty session is ready immediately
      setIsScrollReady(true);
      return;
    }

    // Single RAF: wrapper is opacity:0 until scroll-ready, so intermediate state is invisible.
    // With itemSize hint + cache, VList can estimate scroll position accurately on first try.
    requestAnimationFrame(() => {
      if (vlistRef.current) {
        vlistRef.current.scrollToIndex(messages.length - 1, { align: 'end' });
      }
      // Let VList settle, then reveal
      requestAnimationFrame(() => {
        setIsScrollReady(true);
      });
    });
  }, [sessionId, isContainerVisible]); // Re-run when session changes or container becomes visible

  // Auto-scroll to bottom when messages change (if user was at bottom)
  useEffect(() => {
    // Read scroll state from atom - this is stable across renders
    const wasAtBottom = getSessionIsAtBottom(sessionId);

    requestAnimationFrame(() => {
      if (vlistRef.current) {
        const scrollSize = vlistRef.current.scrollSize;
        const viewportSize = vlistRef.current.viewportSize;
        const scrollOffset = vlistRef.current.scrollOffset;
        const distanceFromBottom = scrollSize - scrollOffset - viewportSize;
        const isCurrentlyAtBottom = distanceFromBottom < 100;

        // Auto-scroll if user was at bottom (from atom state) or is currently at bottom
        const shouldAutoScroll = wasAtBottom || isCurrentlyAtBottom;

        if (shouldAutoScroll) {
          // Account for the "Thinking..." indicator which is an extra item after messages
          const lastIndex = isWaitingForResponse ? messages.length : messages.length - 1;
          vlistRef.current.scrollToIndex(lastIndex, { align: 'end' });
          // Update atom to reflect we're now at bottom
          setSessionIsAtBottom(sessionId, true);
        }
      }
    });
  }, [messages, isWaitingForResponse, sessionId]);


  // Listen for routed search events from AgentWorkstreamPanel
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

    window.addEventListener('transcript:find', handleFind);
    window.addEventListener('transcript:find-next', handleFindNext);
    window.addEventListener('transcript:find-previous', handleFindPrevious);

    return () => {
      window.removeEventListener('transcript:find', handleFind);
      window.removeEventListener('transcript:find-next', handleFindNext);
      window.removeEventListener('transcript:find-previous', handleFindPrevious);
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

    // Hide Task tool calls that were cancelled as siblings of a parallel spawn.
    // These get exactly "<tool_use_error>Sibling tool call errored</tool_use_error>"
    // as their result and were never actually started.
    if (toolMsg.toolCall.name === 'Task' && (toolMsg as any).isError) {
      const result = toolMsg.toolCall.result;
      const resultStr = typeof result === 'string' ? result : '';
      if (/^\s*(<tool_use_error>)?\s*Sibling tool call errored\s*(<\/tool_use_error>)?\s*$/.test(resultStr)) {
        return null;
      }
    }

    const tool = toolMsg.toolCall;
    const toolId = tool.id || tool.name || `tool-${toolIndex}`;
    const isExpanded = expandedTools.has(toolId);
    const isSubAgent = tool.isSubAgent && tool.name === 'Task';
    const isTeammate = isSubAgent && !!(tool.teammateName || tool.teamName);
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
            getToolCallDiffs={getToolCallDiffs}
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
    const toolArgs = tool.arguments as Record<string, any> | undefined;
    const description = (isSubAgent && toolArgs?.description ? toolArgs.description : null) as string | null;
    const prompt = (isSubAgent && toolArgs?.prompt ? toolArgs.prompt : null) as string | null;

    // Extract result text
    const resultText = tool.result ? extractResultText(tool.result) : null;

    // Special styling for sub-agents and teammates
    const cardClass = isTeammate
      ? 'rich-transcript-tool-card teammate rounded border border-[var(--nim-border)] overflow-hidden'
      : isSubAgent
        ? 'rich-transcript-tool-card sub-agent rounded border border-[var(--nim-border)] overflow-hidden'
        : depth > 0
          ? 'rich-transcript-tool-card child-tool rounded border border-[var(--nim-border)] overflow-hidden bg-[var(--nim-bg-tertiary)]'
          : 'rich-transcript-tool-card rounded border border-[var(--nim-border)] overflow-hidden bg-[var(--nim-bg-secondary)]';

    return (
      <div key={`tool-${toolIndex}-${depth}`} className={`rich-transcript-tool-container mb-2 ${depth > 0 ? 'nested ml-0' : ''}`} style={{ marginLeft: depth > 0 ? '1rem' : '0' }}>
        <div className={cardClass}>
          <button onClick={() => toggleToolExpand(toolId)} className="rich-transcript-tool-button w-full py-1 px-2 flex items-center gap-1.5 text-left border-none cursor-pointer text-sm bg-transparent">
            {isTeammate ? (
              // Group icon for team teammates
              <MaterialSymbol icon="group" size={16} className="rich-transcript-tool-icon sub-agent-icon w-4 h-4 text-[var(--nim-primary)] shrink-0" />
            ) : isSubAgent ? (
              // Document/clipboard icon for sub-agents
              <MaterialSymbol icon="description" size={16} className="rich-transcript-tool-icon sub-agent-icon w-4 h-4 text-[var(--nim-primary)] shrink-0" />
            ) : (
              // Wrench icon for regular tools
              <MaterialSymbol icon="build" size={16} className="rich-transcript-tool-icon w-4 h-4 text-[var(--nim-primary)] shrink-0" />
            )}
            <span className="rich-transcript-tool-name font-mono text-sm text-[var(--nim-text)] font-medium" title={tool.name || undefined}>
              {isTeammate ? (tool.teammateName || 'Teammate') : isSubAgent ? 'Sub-Agent' : toolDisplayName}
              {isTeammate && tool.teammateMode && (
                <span className="rich-transcript-tool-subagent-type text-[var(--nim-text-muted)] font-normal text-xs ml-1">({tool.teammateMode})</span>
              )}
              {isSubAgent && !isTeammate && tool.subAgentType && (
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
            {/* Status indicator: sub-agents/teammates show live status, regular tools show success/error */}
            {isSubAgent ? (() => {
              // Look up teammate status from session metadata
              // Try tool.teammateAgentId first, then extract agent_id from result text
              let agentId = tool.teammateAgentId;
              if (!agentId && tool.result && typeof tool.result === 'string') {
                const match = tool.result.match(/agent_id:\s*(\S+)/);
                if (match) agentId = match[1].replace(/[.,]$/, '');
              }
              const teammateStatus = agentId ? currentTeammates?.find(t => t.agentId === agentId)?.status : undefined;
              // If no metadata yet but spawn succeeded (isError due to interception), assume running
              const effectiveStatus = teammateStatus || (tool.result && (toolMsg as any).isError ? 'running' : tool.result ? 'completed' : null);
              if (effectiveStatus === 'running') {
                return (
                  <span className="flex items-center gap-1 shrink-0">
                    <span className="inline-block w-3 h-3 border-2 border-[var(--nim-bg-tertiary)] border-t-[var(--nim-primary)] rounded-full animate-spin" />
                    <span className="text-[11px] text-[var(--nim-text-muted)]">Running</span>
                  </span>
                );
              }
              if (effectiveStatus === 'idle') {
                return (
                  <span className="flex items-center gap-1 shrink-0">
                    <span className="text-[var(--nim-primary)] text-[10px]">&#9675;</span>
                    <span className="text-[11px] text-[var(--nim-text-muted)]">Idle</span>
                  </span>
                );
              }
              if (effectiveStatus === 'completed') {
                return (
                  <span className="flex items-center gap-1 shrink-0">
                    <MaterialSymbol icon="check_circle" size={14} className="text-[var(--nim-success)]" />
                    <span className="text-[11px] text-[var(--nim-text-muted)]">Done</span>
                  </span>
                );
              }
              if (effectiveStatus === 'errored') {
                return (
                  <span className="flex items-center gap-1 shrink-0">
                    <MaterialSymbol icon="cancel" size={14} className="text-[var(--nim-error)]" />
                    <span className="text-[11px] text-[var(--nim-text-muted)]">Errored</span>
                  </span>
                );
              }
              // Still waiting for result / no status yet - show progress spinner if available
              if (!tool.result && tool.toolProgress) {
                return (
                  <span className="flex items-center gap-1 shrink-0">
                    <span className="inline-block w-3 h-3 border-2 border-[var(--nim-primary)] border-t-transparent rounded-full animate-spin" />
                    <span className="text-[11px] text-[var(--nim-text-muted)]">Running</span>
                  </span>
                );
              }
              return null;
            })() : (
              <>
                {tool.result && !(toolMsg as any).isError && (
                  <MaterialSymbol icon="check_circle" size={16} className="rich-transcript-tool-success w-4 h-4 text-[var(--nim-success)] shrink-0" />
                )}
                {tool.result && (toolMsg as any).isError && (
                  <MaterialSymbol icon="cancel" size={16} className="rich-transcript-tool-error w-4 h-4 text-[var(--nim-error)] shrink-0" />
                )}
              </>
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
                    {isTeammate ? 'Teammate' : 'Sub-agent'} Actions ({tool.childToolCalls!.length}):
                  </div>
                  <div className="rich-transcript-subagent-children flex flex-col gap-1 mt-2">
                    {tool.childToolCalls!.map((childMsg, childIdx) =>
                      renderToolCard(childMsg, childIdx, depth + 1)
                    )}
                  </div>
                </div>
              )}

              {/* Show progress indicator for running sub-agents/teammates */}
              {isSubAgent && !tool.result && tool.toolProgress && (
                <div className="rich-transcript-tool-section mb-1.5 flex items-center gap-2 text-xs text-[var(--nim-text-muted)]">
                  <span className="inline-block w-3 h-3 border-2 border-[var(--nim-primary)] border-t-transparent rounded-full animate-spin" />
                  <span>Running <span className="font-mono text-[var(--nim-text)]">{tool.toolProgress.toolName}</span></span>
                  <span>({Math.round(tool.toolProgress.elapsedSeconds)}s)</span>
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

              {/* File changes caused by this tool call */}
              {!isSubAgent && getToolCallDiffs && tool.id && tool.result && (
                <ToolCallChanges
                  toolCallItemId={tool.id}
                  getToolCallDiffs={getToolCallDiffs}
                  isExpanded={isExpanded}
                  workspacePath={workspacePath}
                  onOpenFile={onOpenFile}
                />
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div ref={viewRootRef} className="rich-transcript-view h-full flex flex-col bg-[var(--nim-bg)] relative overflow-x-hidden select-text">
      {/* Search Bar */}
      <TranscriptSearchBar
        isVisible={showSearchBar}
        messages={messages}
        containerRef={scrollContainerRef}
        onClose={() => setShowSearchBar(false)}
        onScrollToMessage={(index) => {
          if (vlistRef.current) {
            vlistRef.current.scrollToIndex(index, { align: 'center' });
          }
        }}
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
          ) : !isContainerVisible ? (
            /* Skip VList rendering when container is hidden (display:none parent).
               VList with 0 height renders ALL items instead of virtualizing,
               causing massive DOM bloat and style recalculation. */
            null
          ) : (
            <div className={`rich-transcript-messages rich-transcript-vlist-wrapper flex flex-col max-w-full overflow-x-hidden h-full ${isScrollReady ? 'scroll-ready' : ''}`}>
              <VList
                  ref={vlistRef}
                  className="rich-transcript-vlist !h-full !w-full"
                  style={{ height: '100%' }}
                  bufferSize={800}
                  itemSize={90}
                  cache={vlistCacheMap.get(sessionId)}
                  onScroll={(offset) => {
                    // Track if we're at the bottom for auto-scroll using per-session atom
                    if (vlistRef.current) {
                      const scrollSize = vlistRef.current.scrollSize;
                      const viewportSize = vlistRef.current.viewportSize;
                      const distanceFromBottom = scrollSize - offset - viewportSize;
                      const isAtBottom = distanceFromBottom < 50;
                      // Update the per-session atom - this persists across component remounts
                      setSessionIsAtBottom(sessionId, isAtBottom);
                      if (scrollButtonRef.current) {
                        const show = distanceFromBottom > viewportSize;
                        scrollButtonRef.current.style.opacity = show ? '1' : '0';
                        scrollButtonRef.current.style.pointerEvents = show ? '' : 'none';
                      }
                      // Check if any pending permission widgets are visible in viewport
                      if (pendingPermissionIndices.length > 0) {
                        const firstVisibleIdx = vlistRef.current.findItemIndex(offset);
                        const lastVisibleIdx = vlistRef.current.findItemIndex(offset + viewportSize);
                        const anyVisible = pendingPermissionIndices.some(
                          idx => idx >= firstVisibleIdx && idx <= lastVisibleIdx
                        );
                        if (pendingPermissionsVisibleRef.current !== anyVisible) {
                          pendingPermissionsVisibleRef.current = anyVisible;
                          setShowPermissionBanner(!anyVisible);
                        }
                      } else if (showPermissionBanner) {
                        setShowPermissionBanner(false);
                      }
                    }
                  }}
                >
                  {messages.map((message, index) => {
                    const isUser = message.role === 'user';
                    const isTool = message.role === 'tool';
                    const isCollapsed = collapsedMessages.has(index);

                    // Check if this is a Codex raw event message
                    const isCodexRawEvent = message.metadata?.codexProvider === true && message.metadata?.eventType;

                    // If this is a Codex raw event, check if it's the first in a sequence
                    if (isCodexRawEvent) {
                      // Check if previous message is also a Codex raw event
                      const prevMessage = index > 0 ? messages[index - 1] : null;
                      const prevIsCodexRawEvent = prevMessage?.metadata?.codexProvider === true && prevMessage?.metadata?.eventType;

                      if (prevIsCodexRawEvent) {
                        // This is a continuation - skip rendering (handled by the first message)
                        return <div key={`${sessionId}-${index}`} style={{ display: 'none' }} />;
                      }

                      // This is the first in a sequence - collect all consecutive Codex events
                      const codexEvents: Message[] = [message];
                      let checkIdx = index + 1;
                      while (checkIdx < messages.length) {
                        const nextMsg = messages[checkIdx];
                        if (nextMsg.metadata?.codexProvider === true && nextMsg.metadata?.eventType) {
                          codexEvents.push(nextMsg);
                          checkIdx++;
                        } else {
                          break;
                        }
                      }

                      // Render grouped Codex events
                      return (
                        <div
                          key={`${sessionId}-${index}`}
                          data-message-index={index}
                          ref={(el) => {
                            if (el) messageRefs.current.set(index, el);
                          }}
                          className="rich-transcript-message rounded-md relative max-w-full overflow-x-hidden break-words mb-2 assistant bg-[var(--nim-bg)] normal p-3"
                        >
                          <div className="rich-transcript-message-header flex items-center gap-2 mb-1.5">
                            <div className="rich-transcript-message-avatar w-7 h-7 rounded-full shrink-0 flex items-center justify-center assistant">
                              {/* No icon for Codex - provider icon handled elsewhere */}
                            </div>
                            <div className="rich-transcript-message-meta flex-1 flex items-baseline gap-2">
                              <span className="rich-transcript-message-time text-xs text-[var(--nim-text-faint)]">
                                {formatMessageTime(message.timestamp)}
                              </span>
                            </div>
                          </div>
                          <div className="rich-transcript-message-content relative ml-6">
                            <CodexOutputRenderer
                              rawEvents={codexEvents}
                              isCollapsed={isCollapsed}
                              sessionId={sessionId}
                              workspacePath={workspacePath}
                              readFile={readFile}
                              getToolCallDiffs={getToolCallDiffs}
                            />
                          </div>

                          {/* Show elapsed time at the end of a completed Codex turn */}
                          {(() => {
                            const lastEventIdx = index + codexEvents.length - 1;
                            // Don't show if still streaming (last group and waiting)
                            if (isWaitingForResponse && lastEventIdx >= messages.length - 1) return null;
                            // Find the preceding user-input message
                            let startIdx = index - 1;
                            while (startIdx >= 0 && !(messages[startIdx].role === 'user' && messages[startIdx].isUserInput !== false)) {
                              startIdx--;
                            }
                            if (startIdx < 0) return null;
                            const startTimestamp = messages[startIdx].timestamp;
                            const endTimestamp = codexEvents[codexEvents.length - 1].timestamp;
                            const duration = formatDuration(startTimestamp, endTimestamp);
                            if (!duration || duration === '0ms') return null;
                            return (
                              <div className="rich-transcript-turn-elapsed text-xs text-[var(--nim-text-faint)] mt-2 ml-6">
                                Finished in {duration}
                              </div>
                            );
                          })()}
                        </div>
                      );
                    }

                    // Hide assistant/tool messages that sit between agent notifications.
                    // These are the agent's internal processing turns after receiving a teammate/sub-agent
                    // message - they appear as dark bars with scrollbars and add visual noise.
                    // NEVER hide interactive tool widgets (ToolPermission, ExitPlanMode, etc.) that require user action.
                    // Also never hide assistant messages that would carry interactive widgets in toolMessagesBefore.
                    if (message.role === 'assistant' || message.role === 'tool') {
                      const INTERACTIVE_WIDGETS = ['ToolPermission', 'ExitPlanMode', 'AskUserQuestion', 'GitCommitProposal'];
                      const isInteractiveWidget = message.role === 'tool' && message.toolCall?.name &&
                        INTERACTIVE_WIDGETS.includes(message.toolCall.name);
                      // For assistant messages, check if preceding tool messages contain interactive widgets
                      let hasInteractiveToolsBefore = false;
                      if (message.role === 'assistant') {
                        let checkPrev = index - 1;
                        while (checkPrev >= 0 && messages[checkPrev].role === 'tool') {
                          if (messages[checkPrev].toolCall?.name && INTERACTIVE_WIDGETS.includes(messages[checkPrev].toolCall!.name)) {
                            hasInteractiveToolsBefore = true;
                            break;
                          }
                          checkPrev--;
                        }
                      }
                      if (!isInteractiveWidget && !hasInteractiveToolsBefore) {
                        // Walk back to find the nearest user message (skipping tool and assistant messages)
                        let prevIdx = index - 1;
                        while (prevIdx >= 0 && messages[prevIdx].role !== 'user') prevIdx--;
                        if (prevIdx >= 0 && messages[prevIdx].metadata?.isTeammateMessage) {
                          // The most recent user message before this is a teammate notification.
                          // Also check: is there a teammate notification after this? (i.e., we're between two)
                          // OR is there no substantive assistant content worth showing?
                          let nextUserIdx = index + 1;
                          while (nextUserIdx < messages.length && messages[nextUserIdx].role !== 'user') nextUserIdx++;
                          const nextIsTeammate = nextUserIdx < messages.length && messages[nextUserIdx].metadata?.isTeammateMessage;
                          const hasNoContent = !message.content?.trim();
                          if (nextIsTeammate || hasNoContent) {
                            return <div key={`${sessionId}-${index}`} style={{ display: 'none' }} />;
                          }
                        }
                      }
                    }

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

                    // Hide system-generated user-role messages that have no meaningful content
                    // (tool results, slash command output). These have isUserInput explicitly set to false.
                    // But keep messages with actual text content (e.g., compaction summaries).
                    if (isUser && message.isUserInput === false && !message.metadata?.isTeammateMessage && !message.content?.trim()) {
                      return <div key={`${sessionId}-${index}`} style={{ display: 'none' }} />;
                    }

                    // Render teammate/sub-agent messages as compact inline notifications
                    if (isUser && message.metadata?.isTeammateMessage) {
                      const teammateName = (message.metadata?.teammateName as string) || 'agent';
                      const label = `Received message from agent ${teammateName}`;
                      const content = message.content?.trim();
                      // Show first line as preview (truncated)
                      const firstLine = content?.split('\n')[0] || '';
                      const preview = firstLine.length > 100 ? firstLine.slice(0, 100) + '...' : firstLine;
                      const hasMoreContent = content && (content.includes('\n') || content.length > 100);
                      return (
                        <div
                          key={`${sessionId}-${index}`}
                          data-message-index={index}
                          ref={(el) => {
                            if (el) messageRefs.current.set(index, el);
                          }}
                          className="rich-transcript-message rich-transcript-teammate-notification rounded-md relative max-w-full overflow-x-hidden break-words mb-1"
                        >
                          {hasMoreContent ? (
                            <details>
                              <summary className="flex items-center gap-1.5 py-0.5 text-xs text-[var(--nim-text-faint)] hover:text-[var(--nim-text-muted)]">
                                <MaterialSymbol icon="chevron_right" size={14} className="teammate-chevron transition-transform shrink-0 w-3.5" />
                                <span className="flex-1 truncate">{label}: {preview}</span>
                                <span className="text-[10px] shrink-0">{formatMessageTime(message.timestamp)}</span>
                              </summary>
                              <div className="teammate-content ml-5 mt-1 mb-0.5">
                                <MarkdownRenderer content={content} isUser={false} />
                              </div>
                            </details>
                          ) : (
                            <div className="flex items-center gap-1.5 py-0.5 text-xs text-[var(--nim-text-faint)]">
                              <MaterialSymbol icon="chevron_right" size={14} className="shrink-0 w-3.5 invisible" />
                              <span className="flex-1 truncate">{label}: {content}</span>
                              <span className="text-[10px] shrink-0">{formatMessageTime(message.timestamp)}</span>
                            </div>
                          )}
                        </div>
                      );
                    }

                    return (
                      <div
                        key={`${sessionId}-${index}`}
                        data-message-index={index}
                        ref={(el) => {
                          if (el) messageRefs.current.set(index, el);
                        }}
                        className={`rich-transcript-message rounded-md relative max-w-full overflow-x-hidden break-words mb-2 ${isUser ? 'user bg-[var(--nim-bg-secondary)]' : 'assistant bg-[var(--nim-bg)]'} ${settings.compactMode ? 'compact p-2' : 'normal p-3'} ${!isNewGroup ? 'continuation -mt-1' : ''}`}
                      >
                        {/* Restart indicator line (dev mode only) - rendered before the first message after restart */}
                        {restartAfterIndex >= 0 && index === restartAfterIndex && (
                          <div className="flex items-center gap-3 mb-3">
                            <div className="flex-1 h-px bg-[var(--nim-error)]" />
                            <span className="text-[11px] font-medium text-[var(--nim-error)] whitespace-nowrap">
                              Nimbalyst restarted {formatMessageTime(appStartTime!)}
                            </span>
                            <div className="flex-1 h-px bg-[var(--nim-error)]" />
                          </div>
                        )}
                        {isNewGroup && (
                          <div className="rich-transcript-message-header flex items-center gap-2 mb-1.5">
                            <div className={`rich-transcript-message-avatar w-7 h-7 rounded-full shrink-0 flex items-center justify-center ${isUser ? 'user' : 'assistant'}`}>
                              {isUser ? (
                                <MaterialSymbol icon="person" size={18} />
                              ) : (
                                <ProviderIcon provider={provider || 'claude-code'} size={18} />
                              )}
                            </div>
                            <div className="rich-transcript-message-meta flex-1 flex items-baseline gap-2">
                              <span className="rich-transcript-message-sender font-medium text-[var(--nim-text)] text-sm">
                                {isUser ? 'You' : getProviderDisplayName(provider)}
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
                            provider={provider}
                          />
                        </div>

                        {/* Show elapsed time at the end of a completed assistant turn */}
                        {!isUser && (() => {
                          // Check if this is the last message in the assistant group
                          let nextNonToolIdx = index + 1;
                          while (nextNonToolIdx < messages.length && messages[nextNonToolIdx].role === 'tool') {
                            nextNonToolIdx++;
                          }
                          const isEndOfGroup = nextNonToolIdx >= messages.length || messages[nextNonToolIdx].role !== 'assistant';
                          if (!isEndOfGroup) return null;
                          // Don't show for the last assistant group if still streaming
                          if (isWaitingForResponse && nextNonToolIdx >= messages.length) return null;
                          // Find the preceding user-input message that triggered this turn
                          // Only consider genuine user input (isUserInput), not system-generated user-role messages
                          let startIdx = index - 1;
                          while (startIdx >= 0 && !(messages[startIdx].role === 'user' && messages[startIdx].isUserInput !== false)) {
                            startIdx--;
                          }
                          if (startIdx < 0) return null; // No preceding user input message
                          const startTimestamp = messages[startIdx].timestamp;
                          const endTimestamp = message.timestamp;
                          const duration = formatDuration(startTimestamp, endTimestamp);
                          if (!duration || duration === '0ms') return null;
                          return (
                            <div className="rich-transcript-turn-elapsed text-xs text-[var(--nim-text-faint)] mt-2 ml-6">
                              Finished in {duration}
                            </div>
                          );
                        })()}

                      </div>
                    );
                  })}
                  {/* Restart indicator at bottom when all messages precede the restart (dev mode only) */}
                  {restartAtBottom && (
                    <div key="restart-bottom" className="flex items-center gap-3 my-2 px-3">
                      <div className="flex-1 h-px bg-[var(--nim-error)]" />
                      <span className="text-[11px] font-medium text-[var(--nim-error)] whitespace-nowrap">
                        Nimbalyst restarted {formatMessageTime(appStartTime!)}
                      </span>
                      <div className="flex-1 h-px bg-[var(--nim-error)]" />
                    </div>
                  )}
                  {isWaitingForResponse && (
                    <div key="waiting" className="rich-transcript-waiting flex items-center gap-2 text-[var(--nim-text-muted)] italic py-2 px-4 mb-2">
                      <div className="rich-transcript-waiting-dots flex gap-1">
                        <div className="rich-transcript-waiting-dot w-2 h-2 rounded-full bg-[var(--nim-primary)]" />
                        <div className="rich-transcript-waiting-dot w-2 h-2 rounded-full bg-[var(--nim-primary)]" />
                        <div className="rich-transcript-waiting-dot w-2 h-2 rounded-full bg-[var(--nim-primary)]" />
                      </div>
                      <span className="rich-transcript-waiting-text">{waitingText}</span>
                    </div>
                  )}
              </VList>
            </div>
          )}
        </div>

        {/* Pending permissions banner - shown when pending permission widgets are scrolled out of view */}
        {showPermissionBanner && pendingPermissionIndices.length > 0 && (
          <div className="sticky bottom-12 flex justify-center z-10 pointer-events-none">
            <button
              onClick={() => {
                vlistRef.current?.scrollToIndex(pendingPermissionIndices[0], { align: 'center' });
              }}
              className="pointer-events-auto flex items-center gap-2 px-4 py-2 bg-[var(--nim-primary)] text-white rounded-full shadow-lg text-sm font-medium cursor-pointer border-none transition-all hover:brightness-110"
            >
              <MaterialSymbol icon="shield" size={16} />
              {pendingPermissionIndices.length} pending permission{pendingPermissionIndices.length > 1 ? 's' : ''} — click to review
            </button>
          </div>
        )}

        {/* Scroll to bottom button - uses ref + opacity/pointer-events to avoid layout shifts that interfere with text selection */}
        <div ref={scrollButtonRef} className="rich-transcript-scroll-button-container sticky bottom-3 flex justify-center opacity-0 transition-opacity">
          <button
            onClick={scrollToBottom}
            className="rich-transcript-scroll-button p-2 bg-[var(--nim-primary)] text-white rounded-full border-none shadow-lg cursor-pointer transition-all hover:bg-[var(--nim-primary-hover)] hover:scale-110 pointer-events-auto"
            title="Scroll to bottom"
          >
            <MaterialSymbol icon="arrow_downward" size={20} />
          </button>
        </div>
      </div>
    </div>
  );
});

RichTranscriptView.displayName = 'RichTranscriptView';
