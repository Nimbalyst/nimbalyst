/**
 * @deprecated This component will be replaced by the unified session architecture.
 * See nimbalyst-local/plans/unified-session-architecture.md for migration plan.
 * The old AgenticPanel uses this component with React useState, causing massive re-renders.
 * The new AgentMode architecture uses SessionTranscript via AgentSessionPanel with Jotai atoms instead.
 */

import React, { useCallback, useRef, useImperativeHandle, forwardRef, useEffect, useState } from 'react';
import { useAtom, useSetAtom, useAtomValue } from 'jotai';
import { TodoItem, FileEditsSidebar, FileEditSummary } from '@nimbalyst/runtime';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import type { SessionData } from '@nimbalyst/runtime/ai/server/types';
import { PendingReviewBanner } from '../AIChat/PendingReviewBanner';
import type { TypeaheadOption } from '../Typeahead/GenericTypeahead';
import type { AIMode } from './ModeTag';
import { diffTreeGroupByDirectoryAtom, setDiffTreeGroupByDirectoryAtom } from '../../store/atoms/projectState';
import { SessionEditorArea, SessionEditorAreaRef } from './SessionEditorArea';
import { AgentSessionHeader } from '../AgenticCoding/AgentSessionHeader';
import { SessionTranscript, SessionTranscriptRef } from './SessionTranscript';
import {
  sessionEditorStateAtom,
  setSessionSplitRatioAtom,
  // NOTE: Most session atoms (sessionDataAtom, sessionProcessingAtom, etc.) are now
  // managed by SessionTranscript to avoid double subscriptions and re-renders.
  // AISessionView only needs atoms for:
  // 1. Layout (sessionEditorStateAtom, setSessionSplitRatioAtom)
  // 2. Hierarchical session UI (workstream tabs)
  sessionDataAtom,
  sessionLoadingAtom,
  loadSessionDataAtom,
  // Hierarchical session atoms (for workstream tab UI)
  sessionChildrenAtom,
  sessionActiveChildAtom,
  sessionHasChildrenAtom,
  loadSessionChildrenAtom,
  setActiveChildSessionAtom,
  createChildSessionAtom,
} from '../../store';
import { convertToWorkstreamAtom } from '../../store/atoms/sessions';
import type { SessionListItem } from '@nimbalyst/runtime/ai/adapters/sessionStore';

// Todo interface for sidebar display
interface Todo {
  status: 'pending' | 'in_progress' | 'completed';
  content: string;
  activeForm: string;
}

export interface AISessionViewRef {
  focusInput: () => void;
  getInputElement?: () => HTMLInputElement | HTMLTextAreaElement | null;
  /** Open a file in the session's embedded editor (for non-worktree sessions) */
  openFileInSessionEditor?: (filePath: string) => void;
}

export interface AISessionViewProps {
  // Identity - only sessionId is required, component loads its own data
  sessionId: string;

  // UI mode: chat = sidebar mode, agent = full window mode
  mode: 'chat' | 'agent';

  // Context
  workspacePath: string;
  documentContext?: any; // DocumentContext type

  // Visibility - parent controls which session is active
  isActive?: boolean;

  // File mention support
  fileMentionOptions?: TypeaheadOption[];
  onFileMentionSearch?: (query: string) => void;
  onFileMentionSelect?: (option: TypeaheadOption) => void;

  // Click handlers
  onFileClick?: (filePath: string) => void;
  onTodoClick?: (todo: TodoItem) => void;

  // History navigation (up/down arrow in input)
  onNavigateHistory?: (sessionId: string, direction: 'up' | 'down') => void;

  // Callbacks for tab management (parent still manages open/close)
  onCloseAndArchive?: (sessionId: string) => void;
  onSessionTitleChanged?: (sessionId: string, title: string) => void;
  // Navigate to a different session (e.g., after creating a workstream)
  onNavigateToSession?: (sessionId: string) => void;
}

// NOTE: TranscriptSectionComponent was removed - it's now replaced by SessionTranscript
// which provides proper encapsulation of transcript + input state via Jotai atoms.

/**
 * AISessionView component encapsulates all UI for a single AI session.
 *
 * Key features:
 * - Renders all UI for one session (FileGutter + Transcript + Input)
 * - Manages session-specific state (draft input, attachments)
 * - Continues to receive/process stream updates even when hidden (!isActive)
 * - Hides features in chat mode (no right panel, simpler UI)
 * - All session-specific state lives here (isolated from other sessions)
 *
 * The component uses `display: none` when not active instead of unmounting,
 * which allows background streaming to continue and provides instant tab switching.
 */
const AISessionViewComponent = forwardRef<AISessionViewRef, AISessionViewProps>(({
  sessionId,
  mode,
  workspacePath,
  documentContext,
  fileMentionOptions = [],
  onFileMentionSearch,
  onFileMentionSelect,
  onFileClick,
  onTodoClick,
  onNavigateHistory,
  onCloseAndArchive,
  onSessionTitleChanged,
  onNavigateToSession,
  isActive = true, // Default to true for backwards compatibility
}, ref) => {
  const sessionTranscriptRef = useRef<SessionTranscriptRef>(null);

  // ============================================================
  // Session state - MINIMAL subscriptions to avoid re-renders
  // Most session state (processing, mode, model, archived, etc.) is now
  // managed by SessionTranscript. AISessionView only needs:
  // 1. sessionData for layout decisions and workstream tabs
  // 2. loadSessionData to trigger initial load
  // ============================================================
  const sessionData = useAtomValue(sessionDataAtom(sessionId));
  const isDataLoading = useAtomValue(sessionLoadingAtom(sessionId));
  const loadSessionData = useSetAtom(loadSessionDataAtom);

  // ============================================================
  // Hierarchical session state (workstreams)
  // ============================================================
  const childSessionIds = useAtomValue(sessionChildrenAtom(sessionId));
  const [activeChildId, setActiveChildId] = useAtom(sessionActiveChildAtom(sessionId));
  const hasChildren = useAtomValue(sessionHasChildrenAtom(sessionId));
  const loadSessionChildren = useSetAtom(loadSessionChildrenAtom);
  const convertToWorkstream = useSetAtom(convertToWorkstreamAtom);
  const setActiveChild = useSetAtom(setActiveChildSessionAtom);
  const createChildSession = useSetAtom(createChildSessionAtom);

  // Child session data cache (for displaying titles in tabs)
  const [childSessionData, setChildSessionData] = useState<Map<string, SessionListItem>>(new Map());

  // NOTE: Most session-specific state (draft input, attachments, processing, confirmations)
  // is now managed by SessionTranscript. This eliminates duplicate atom subscriptions.
  // We still need todos for the sidebar display.
  const [todos, setTodos] = useState<Todo[]>([]);

  // ============================================================
  // Files sidebar state (for agent mode non-worktree sessions)
  // ============================================================
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);
  const [fileEdits, setFileEdits] = useState<FileEditSummary[]>([]);
  const [pendingReviewFilesMain, setPendingReviewFilesMain] = useState<Set<string>>(new Set());

  // Diff tree grouping state (for files sidebar)
  const [groupByDirectory] = useAtom(diffTreeGroupByDirectoryAtom);
  const setDiffTreeGroupByDirectory = useSetAtom(setDiffTreeGroupByDirectoryAtom);

  const setGroupByDirectory = useCallback((value: boolean) => {
    if (workspacePath) {
      setDiffTreeGroupByDirectory({ groupByDirectory: value, workspacePath });
    }
  }, [workspacePath, setDiffTreeGroupByDirectory]);

  // ============================================================
  // Load session data on mount
  // ============================================================
  useEffect(() => {
    if (!sessionId || !workspacePath) return;

    // Load session data if not already loaded
    if (!sessionData) {
      loadSessionData({ sessionId, workspacePath });
    }
  }, [sessionId, workspacePath, sessionData, loadSessionData]);

  // ============================================================
  // Load child sessions when session has children (hierarchical sessions)
  // This enables workstream-style grouped sessions
  // ============================================================
  useEffect(() => {
    if (!sessionId || !workspacePath || !sessionData) return;

    // Check if this session might have children (from childCount in list data or from metadata)
    // We load children proactively so tabs can be displayed
    // The atoms will dedupe if already loaded
    const parentSessionId = sessionData.parentSessionId;
    if (!parentSessionId) {
      // This is a root session - check if it has children to load
      loadSessionChildren({ parentSessionId: sessionId, workspacePath });
    }
  }, [sessionId, workspacePath, sessionData, loadSessionChildren]);

  // Fetch child session data when we have children (for tab titles)
  useEffect(() => {
    if (!hasChildren || childSessionIds.length === 0 || !workspacePath) return;

    const fetchChildData = async () => {
      try {
        const result = await window.electronAPI.invoke('sessions:list-children', sessionId, workspacePath);
        if (result.success && result.children) {
          const newData = new Map<string, SessionListItem>();
          for (const child of result.children) {
            newData.set(child.id, child);
          }
          setChildSessionData(newData);
        }
      } catch (err) {
        console.error('[AISessionView] Failed to fetch child session data:', err);
      }
    };

    fetchChildData();
  }, [sessionId, hasChildren, childSessionIds, workspacePath]);

  // NOTE: IPC event subscriptions (ai:message-logged, session:title-updated, ai:tokenUsageUpdated)
  // are now handled by SessionTranscript to avoid duplicate subscriptions.

  // Determine if we should show the session editor area
  const isWorktreeSession = Boolean(sessionData?.worktreeId && sessionData?.worktreePath);
  // Show editor area only for parent sessions (not nested children) - parent handles editor
  const showSessionEditor = mode === 'agent' && !isWorktreeSession;

  // NOTE: The following IPC event handlers have been removed as they are now handled by SessionTranscript:
  // - ai:exitPlanModeConfirm
  // - ai:askUserQuestion
  // - ai:askUserQuestionAnswered
  // - ai:sessionCancelled
  // - ai:toolPermission
  // - ai:toolPermissionResolved
  // - ai:queuedPromptsReceived
  // - ai:promptClaimed
  // This prevents duplicate event handling and re-renders.

  // Extract todos from session metadata when sessionData changes
  useEffect(() => {
    const currentTodos = sessionData?.metadata?.currentTodos;
    if (Array.isArray(currentTodos)) {
      // console.log(`[AISessionView] Extracting todos for session ${sessionId}:`, currentTodos);
      setTodos(currentTodos);
    } else {
      // console.log(`[AISessionView] No todos found in session metadata for ${sessionId}`);
      setTodos([]);
    }
  }, [sessionId, sessionData?.metadata?.currentTodos]);

  // ============================================================
  // Files sidebar data fetching (for agent mode non-worktree sessions)
  // ============================================================
  // Show sidebar only for parent sessions (not nested children) - sidebar is shared across workstream
  const showFileSidebar = mode === 'agent' && !isWorktreeSession;

  // Fetch file edits for this session (or all sessions in workstream)
  // For workstreams, aggregate files from parent + all child sessions
  useEffect(() => {
    if (!showFileSidebar) return;

    const fetchFileLinks = async () => {
      try {
        if (typeof window !== 'undefined' && window.electronAPI) {
          // Get all session IDs to fetch (parent + children for workstreams)
          const sessionIdsToFetch = [sessionId];
          if (hasChildren && childSessionIds.length > 0) {
            sessionIdsToFetch.push(...childSessionIds);
          }

          // Fetch files from all sessions and aggregate
          const allFileEdits: FileEditSummary[] = [];
          const seenPaths = new Set<string>();

          for (const sid of sessionIdsToFetch) {
            const result = await window.electronAPI.invoke('session-files:get-by-session', sid);
            if (result.success && result.files) {
              for (const file of result.files) {
                // Dedupe by path - keep the most recent edit
                if (!seenPaths.has(file.filePath)) {
                  seenPaths.add(file.filePath);
                  allFileEdits.push({
                    filePath: file.filePath,
                    linkType: file.linkType,
                    operation: file.metadata?.operation,
                    linesAdded: file.metadata?.linesAdded,
                    linesRemoved: file.metadata?.linesRemoved,
                    timestamp: new Date(file.timestamp).toISOString(),
                    metadata: file.metadata
                  });
                }
              }
            }
          }
          setFileEdits(allFileEdits);
        }
      } catch (error) {
        console.error('[AISessionView] Failed to fetch file links:', error);
      }
    };

    fetchFileLinks();

    // Listen for file updates from any session in the workstream
    const handleFileUpdate = async (updatedSessionId: string) => {
      const relevantSessionIds = [sessionId, ...childSessionIds];
      if (relevantSessionIds.includes(updatedSessionId)) {
        fetchFileLinks();
      }
    };

    const cleanup = window.electronAPI?.on?.('session-files:updated', handleFileUpdate);
    return () => {
      cleanup?.();
    };
  }, [sessionId, showFileSidebar, hasChildren, childSessionIds]);

  // Fetch pending review files for sidebar (aggregate across workstream)
  useEffect(() => {
    if (!showFileSidebar || !workspacePath) {
      setPendingReviewFilesMain(new Set());
      return;
    }

    const fetchPendingFiles = async () => {
      try {
        if (window.electronAPI?.history?.getPendingFilesForSession) {
          // Get all session IDs to fetch (parent + children for workstreams)
          const sessionIdsToFetch = [sessionId];
          if (hasChildren && childSessionIds.length > 0) {
            sessionIdsToFetch.push(...childSessionIds);
          }

          // Aggregate pending files from all sessions
          const allPendingFiles = new Set<string>();
          for (const sid of sessionIdsToFetch) {
            const files = await window.electronAPI.history.getPendingFilesForSession(workspacePath, sid);
            for (const file of files) {
              allPendingFiles.add(file);
            }
          }
          setPendingReviewFilesMain(allPendingFiles);
        }
      } catch (error) {
        console.error('[AISessionView] Failed to fetch pending review files for sidebar:', error);
      }
    };

    fetchPendingFiles();

    const unsubscribePendingCleared = window.electronAPI?.history?.onPendingCleared?.(
      (data: { workspacePath: string; sessionId?: string; clearedFiles: string[] }) => {
        if (data.workspacePath === workspacePath) {
          fetchPendingFiles();
        }
      }
    );

    const unsubscribePendingCount = window.electronAPI?.history?.onPendingCountChanged?.(
      (data: { workspacePath: string; count: number }) => {
        if (data.workspacePath === workspacePath) {
          fetchPendingFiles();
        }
      }
    );

    return () => {
      unsubscribePendingCleared?.();
      unsubscribePendingCount?.();
    };
  }, [sessionId, workspacePath, showFileSidebar, hasChildren, childSessionIds]);

  // Ref for session editor area (for non-worktree sessions)
  const sessionEditorRef = useRef<SessionEditorAreaRef>(null);

  // Get effective document context - for agent mode, use session's active tab instead of prop
  const getEffectiveDocumentContext = useCallback(() => {
    // In agent mode with embedded editor, prefer the session's active file
    if (showSessionEditor) {
      const activeFilePath = sessionEditorRef.current?.getActiveFilePath();
      if (activeFilePath) {
        // For agent mode, we just need the file path - claude-code can read the content via MCP
        return {
          filePath: activeFilePath,
          content: undefined, // Agent can read file content via tools
          fileType: activeFilePath.split('.').pop() || undefined,
        };
      }
      // No active tab in session editor, return undefined (no context)
      return undefined;
    }
    // In chat mode or worktree mode, use the documentContext prop from parent
    return documentContext;
  }, [showSessionEditor, documentContext]);

  // Expose methods through ref
  useImperativeHandle(ref, () => ({
    focusInput: () => {
      // Forward to SessionTranscript's focusInput method
      sessionTranscriptRef.current?.focusInput();
    },
    openFileInSessionEditor: (filePath: string) => {
      sessionEditorRef.current?.openFile(filePath);
    }
  }));

  // NOTE: handleInputChange, handleAttachmentAdd, handleAttachmentRemove, handleQueue,
  // handleSend, handleCancel are now handled by SessionTranscript.
  // Removing them from here prevents double atom subscriptions and re-renders.

  // Handle file click
  const handleFileClick = useCallback((filePath: string) => {
    if (onFileClick) {
      onFileClick(filePath);
    }
  }, [onFileClick]);

  // Handle todo click
  const handleTodoClick = useCallback((todo: TodoItem) => {
    if (onTodoClick) {
      onTodoClick(todo);
    }
  }, [onTodoClick]);

  // Handle history navigation
  const handleNavigateHistory = useCallback((direction: 'up' | 'down') => {
    if (onNavigateHistory) {
      onNavigateHistory(sessionId, direction);
    }
  }, [sessionId, onNavigateHistory]);

  // NOTE: handleCancelQueuedPrompt, handleEditQueuedPrompt, handleCloseAndArchive, handleUnarchive
  // are now handled by SessionTranscript

  // Handle creating a new workstream from this session
  // This creates a parent session, makes this session a child, and creates a new sibling
  const handleNewWorkstreamSession = useCallback(async () => {
    if (!workspacePath || hasChildren) return;
    try {
      const parentSessionId = await convertToWorkstream({
        sessionId,
        workspacePath,
      });
      if (parentSessionId) {
        // Navigate to the new parent session to see the workstream tabs
        onNavigateToSession?.(parentSessionId);
      }
    } catch (error) {
      console.error('[AISessionView] Failed to create workstream:', error);
    }
  }, [sessionId, workspacePath, hasChildren, convertToWorkstream, onNavigateToSession]);

  // Handle child session tab click (for workstreams)
  const handleChildTabClick = useCallback((childId: string | null) => {
    setActiveChild({ parentSessionId: sessionId, childSessionId: childId });
  }, [sessionId, setActiveChild]);

  // Handle creating a new child session (for workstreams)
  const handleNewChildSession = useCallback(async () => {
    console.log('[AISessionView] handleNewChildSession called', { sessionId, workspacePath, hasChildren });
    if (!workspacePath) {
      console.log('[AISessionView] handleNewChildSession: no workspacePath, returning');
      return;
    }
    try {
      const newSessionId = await createChildSession({
        parentSessionId: sessionId,
        workspacePath,
      });
      console.log('[AISessionView] handleNewChildSession: created child session', newSessionId);
    } catch (err) {
      console.error('[AISessionView] Failed to create child session:', err);
    }
  }, [sessionId, workspacePath, hasChildren, createChildSession]);

  // NOTE: handleAIModeChange, handleModelChange, handleCommandSelect are now handled by SessionTranscript

  // Handle sidebar resize drag (for files sidebar)
  const handleSidebarResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingSidebar(true);
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = startX - moveEvent.clientX;
      const newWidth = Math.max(180, Math.min(400, startWidth + deltaX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDraggingSidebar(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  }, [sidebarWidth]);

  // NOTE: Feature flags (enableSlashCommands, enableAttachments, enableHistoryNavigation)
  // and lastUserMessageTimestamp are now computed in SessionTranscript

  // Get session editor layout state for non-worktree sessions
  const sessionEditorState = useAtomValue(sessionEditorStateAtom(sessionId));
  const setSessionSplitRatio = useSetAtom(setSessionSplitRatioAtom);

  // Ref for the left column container (used for resize calculations)
  const leftColumnRef = useRef<HTMLDivElement>(null);

  // Handle transcript header resize drag
  const handleTranscriptResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = leftColumnRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const containerHeight = containerRect.height;
    const startY = e.clientY;
    const startRatio = sessionEditorState.splitRatio;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startY;
      const currentHeight = startRatio * containerHeight;
      const newHeight = currentHeight + deltaY;
      const newRatio = newHeight / containerHeight;

      // Clamp between 10% and 90%
      const clampedRatio = Math.max(0.1, Math.min(0.9, newRatio));
      setSessionSplitRatio({ sessionId, ratio: clampedRatio });
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }, [sessionId, sessionEditorState.splitRatio, setSessionSplitRatio]);

  // Calculate transcript section style based on layout mode
  // Important: TranscriptSection returns a fragment, so we need the wrapper to handle flex sizing
  // and the inner content already has flex: 1 on the AgentTranscriptPanel wrapper
  const transcriptStyle = React.useMemo((): React.CSSProperties => {
    if (!showSessionEditor || sessionEditorState.layoutMode === 'transcript') {
      // Full height when no session editor or transcript-only mode
      return { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 };
    }
    if (sessionEditorState.layoutMode === 'editor') {
      // Hidden when editor is maximized - use flex: 0 to collapse but keep in DOM for state
      return { flex: 0, height: 0, overflow: 'hidden', minHeight: 0 };
    }
    // Split mode: take remaining space
    return { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: '100px' };
  }, [showSessionEditor, sessionEditorState.layoutMode]);

  // Calculate wrapper style for editor + transcript area (excludes input)
  // When in editor mode, this should expand to fill space
  const editorTranscriptWrapperStyle = React.useMemo((): React.CSSProperties => {
    return { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 };
  }, []);

  // Show loading state while session data is being fetched
  if (!sessionData) {
    return (
      <div
        style={{
          height: '100%',
          display: isActive ? 'flex' : 'none',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-secondary)',
        }}
        data-session-id={sessionId}
        data-active={isActive}
      >
        {isDataLoading ? 'Loading session...' : 'Session not found'}
      </div>
    );
  }

  return (
    <div
      style={{
        height: '100%',
        display: isActive ? 'flex' : 'none', // Use display:none to keep mounted but hidden
        flexDirection: 'row', // Horizontal: main content on left, full-height sidebar on right
        overflow: 'hidden'
      }}
      data-session-id={sessionId}
      data-active={isActive}
    >
      {/* Left side: Header + Content (vertical stack) */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {/* Session Header - only in agent mode */}
        {mode === 'agent' && (
          <AgentSessionHeader
            sessionData={sessionData}
            workspacePath={workspacePath}
          />
        )}

        {/* Content area: Editor + Transcript + Input */}
        <div ref={leftColumnRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          {/* Wrapper for Editor + Transcript (flex: 1 to fill space, input stays at bottom) */}
          <div style={editorTranscriptWrapperStyle}>
            {/* Session Editor Area - for non-worktree agent mode sessions */}
            {showSessionEditor && (
              <SessionEditorArea
                ref={sessionEditorRef}
                sessionId={sessionId}
                workspacePath={workspacePath}
                isActive={isActive}
              />
            )}

            {/* Transcript header - contains workstream tabs, draggable to resize in split mode */}
            {showSessionEditor && sessionEditorState.layoutMode !== 'editor' && (
              <div
                className="transcript-header"
                onMouseDown={sessionEditorState.layoutMode === 'split' ? handleTranscriptResizeStart : undefined}
                style={{
                  borderTop: '3px solid var(--border-primary)',
                  borderBottom: '1px solid var(--border-primary)',
                  backgroundColor: 'var(--surface-secondary)',
                  flexShrink: 0,
                  cursor: sessionEditorState.layoutMode === 'split' ? 'ns-resize' : 'default',
                }}
                title={sessionEditorState.layoutMode === 'split' ? 'Drag to resize' : undefined}
              >
                {/* Workstream session tabs - always shown, single tab is fine */}
                <div
                  className="workstream-tabs"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '2px',
                    padding: '4px 0.75rem 6px',
                    overflowX: 'auto',
                  }}
                >
                  {hasChildren && childSessionIds.length > 0 ? (
                    <>
                      {/* Parent session tab - shows the parent's actual title, not "Main" */}
                      <button
                        type="button"
                        onClick={() => handleChildTabClick(null)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '5px 10px',
                          border: 'none',
                          background: activeChildId === null ? 'var(--surface-tertiary)' : 'transparent',
                          color: activeChildId === null ? 'var(--text-primary)' : 'var(--text-secondary)',
                          fontSize: '12px',
                          fontWeight: 500,
                          cursor: 'pointer',
                          borderRadius: '4px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {sessionData.title || 'Session'}
                      </button>

                      {/* Child session tabs */}
                      {childSessionIds.map(childId => {
                        const childData = childSessionData.get(childId);
                        const childTitle = childData?.title || 'Session';
                        const isActiveTab = activeChildId === childId;

                        return (
                          <button
                            key={childId}
                            type="button"
                            onClick={() => handleChildTabClick(childId)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              padding: '5px 10px',
                              border: 'none',
                              background: isActiveTab ? 'var(--surface-tertiary)' : 'transparent',
                              color: isActiveTab ? 'var(--text-primary)' : 'var(--text-secondary)',
                              fontSize: '12px',
                              fontWeight: 500,
                              cursor: 'pointer',
                              borderRadius: '4px',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {childTitle}
                          </button>
                        );
                      })}

                      {/* New session button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          console.log('[AISessionView] Plus button clicked (in workstream)', e);
                          e.stopPropagation();
                          handleNewChildSession();
                        }}
                        title="New session in workstream"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: '24px',
                          height: '24px',
                          padding: 0,
                          border: 'none',
                          background: 'transparent',
                          color: 'var(--text-tertiary)',
                          cursor: 'pointer',
                          borderRadius: '4px',
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="12" y1="5" x2="12" y2="19" />
                          <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                      </button>
                    </>
                  ) : (
                    <>
                      {/* Single session - show tab with session title and "New Workstream Session" button */}
                      <button
                        type="button"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '5px 10px',
                          border: 'none',
                          background: 'var(--surface-tertiary)',
                          color: 'var(--text-primary)',
                          fontSize: '12px',
                          fontWeight: 500,
                          cursor: 'default',
                          borderRadius: '4px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {sessionData.title || 'Session'}
                      </button>
                      <button
                        type="button"
                        onClick={handleNewWorkstreamSession}
                        title="New session in workstream"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: '24px',
                          height: '24px',
                          padding: 0,
                          border: 'none',
                          background: 'transparent',
                          color: 'var(--text-tertiary)',
                          cursor: 'pointer',
                          borderRadius: '4px',
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="12" y1="5" x2="12" y2="19" />
                          <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Render the appropriate session transcript based on active tab */}
            {/* Use SessionTranscript for proper encapsulation - each session owns its state */}
            <SessionTranscript
              ref={sessionTranscriptRef}
              key={activeChildId ?? sessionId}  // Key ensures remount on session switch
              sessionId={activeChildId ?? sessionId}
              workspacePath={workspacePath}
              mode={mode}
              hideSidebar={showSessionEditor}
              onFileClick={handleFileClick}
              onTodoClick={handleTodoClick}
              onNavigateHistory={onNavigateHistory}
              onCloseAndArchive={onCloseAndArchive}
              onSessionTitleChanged={onSessionTitleChanged}
              documentContext={documentContext}
            />
          {/* SessionTranscript handles its own input, confirmations, etc. */}
          </div>
        </div>
      </div>

      {/* Files Sidebar - only for agent mode non-worktree sessions (full height, sibling to left side) */}
      {showFileSidebar && (
          <>
            {/* Draggable Divider */}
            <div
              onMouseDown={handleSidebarResizeStart}
              style={{
                width: '4px',
                cursor: 'ew-resize',
                background: isDraggingSidebar ? 'var(--border-focus)' : 'var(--border-primary)',
                transition: isDraggingSidebar ? 'none' : 'background-color 0.15s ease',
                flexShrink: 0
              }}
            />
            <div
              className="session-files-sidebar"
              style={{
                width: `${sidebarWidth}px`,
                display: 'flex',
                flexDirection: 'column',
                flexShrink: 0,
                borderLeft: '1px solid var(--border-primary)',
                backgroundColor: 'var(--surface-secondary)'
              }}
            >
              {/* Header with Files label and controls */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.5rem 0.75rem',
                borderBottom: '1px solid var(--border-primary)',
                backgroundColor: 'var(--surface-secondary)'
              }}>
                <MaterialSymbol icon="description" size={16} />
                <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>Files Edited</span>
                {/* Controls */}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.25rem' }}>
                  <button
                    onClick={() => setGroupByDirectory(!groupByDirectory)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '24px',
                      height: '24px',
                      border: 'none',
                      borderRadius: '4px',
                      background: groupByDirectory ? 'var(--surface-tertiary)' : 'transparent',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer'
                    }}
                    title="Group by directory"
                  >
                    <MaterialSymbol icon="folder" size={16} />
                  </button>
                  <button
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('file-edits-sidebar:expand-all'));
                    }}
                    disabled={!groupByDirectory}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '24px',
                      height: '24px',
                      border: 'none',
                      borderRadius: '4px',
                      background: 'transparent',
                      color: groupByDirectory ? 'var(--text-secondary)' : 'var(--text-disabled)',
                      cursor: groupByDirectory ? 'pointer' : 'default',
                      opacity: groupByDirectory ? 1 : 0.5
                    }}
                    title="Expand all"
                  >
                    <MaterialSymbol icon="unfold_more" size={16} />
                  </button>
                  <button
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('file-edits-sidebar:collapse-all'));
                    }}
                    disabled={!groupByDirectory}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '24px',
                      height: '24px',
                      border: 'none',
                      borderRadius: '4px',
                      background: 'transparent',
                      color: groupByDirectory ? 'var(--text-secondary)' : 'var(--text-disabled)',
                      cursor: groupByDirectory ? 'pointer' : 'default',
                      opacity: groupByDirectory ? 1 : 0.5
                    }}
                    title="Collapse all"
                  >
                    <MaterialSymbol icon="unfold_less" size={16} />
                  </button>
                </div>
              </div>

              {/* Pending review banner */}
              <PendingReviewBanner workspacePath={workspacePath} sessionId={sessionId} />

              {/* Files Content */}
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <FileEditsSidebar
                  fileEdits={fileEdits}
                  onFileClick={handleFileClick}
                  workspacePath={workspacePath}
                  pendingReviewFiles={pendingReviewFilesMain}
                  groupByDirectory={groupByDirectory}
                  onGroupByDirectoryChange={setGroupByDirectory}
                  hideControls
                />
              </div>

              {/* Todo list below file edits */}
              {Array.isArray(todos) && todos.length > 0 && (
                <div style={{
                  borderTop: '1px solid var(--border-primary)',
                  backgroundColor: 'var(--surface-secondary)',
                  padding: '0.75rem',
                  maxHeight: '150px',
                  overflow: 'auto'
                }}>
                  <div style={{ marginBottom: '0.5rem', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
                    Tasks ({todos.filter(t => t.status === 'completed').length}/{todos.length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    {todos.map((todo, index) => {
                      const displayText = todo.status === 'in_progress' ? todo.activeForm : todo.content;
                      return (
                        <div key={index} style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '0.5rem',
                          fontSize: '0.75rem',
                          color: 'var(--text-primary)',
                          opacity: todo.status === 'completed' ? 0.6 : 1
                        }}>
                          <div style={{ marginTop: '2px', flexShrink: 0 }}>
                            {todo.status === 'pending' && <span style={{ fontSize: '0.625rem' }}>○</span>}
                            {todo.status === 'in_progress' && <span style={{ fontSize: '0.625rem', animation: 'spin 1s linear infinite' }}>◐</span>}
                            {todo.status === 'completed' && <span style={{ fontSize: '0.625rem', color: 'var(--primary-color)' }}>●</span>}
                          </div>
                          <div style={{ flex: 1, wordBreak: 'break-word' }}>{displayText}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
    </div>
  );
});

AISessionViewComponent.displayName = 'AISessionView';

// Memoize to prevent re-renders when props haven't changed
// Using default shallow comparison - isActive changes will trigger re-render
export const AISessionView = React.memo(AISessionViewComponent);
