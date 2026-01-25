/**
 * AgentWorkstreamPanel - The right side of AgentMode.
 *
 * Displays the selected workstream which could be:
 * - A single session
 * - A workstream (parent + child sessions)
 * - A worktree (worktree + associated sessions)
 *
 * Layout:
 * - WorkstreamHeader (title, provider icon, processing state, layout controls)
 * - WorkstreamEditorTabs (top - file editors for the entire workstream)
 * - WorkstreamSessionTabs (bottom - session tabs + AgentSessionPanel)
 * - FilesEditedSidebar (right - shows files edited by AI)
 *
 * File editing is at the WORKSTREAM level, not per-session.
 * Clicking a file in any session's sidebar opens it in the workstream editor tabs.
 */

import React, { useCallback, useEffect, useRef, useState, useImperativeHandle, type KeyboardEvent } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { ProviderIcon, MaterialSymbol } from '@nimbalyst/runtime';
import { WorkstreamEditorTabs, type WorkstreamEditorTabsRef } from './WorkstreamEditorTabs';
import { WorkstreamSessionTabs } from './WorkstreamSessionTabs';
import { FilesEditedSidebar } from './FilesEditedSidebar';
import { LayoutControls } from '../UnifiedAI/LayoutControls';
import {
  workstreamSessionsAtom,
  workstreamTitleAtom,
  workstreamProcessingAtom,
  sessionArchivedAtom,
  sessionStoreAtom,
  sessionParentIdDerivedAtom,
  sessionWorktreeIdAtom,
  loadSessionChildrenAtom,
  loadSessionDataAtom,
  updateSessionStoreAtom,
  type WorkstreamType,
} from '../../store';
import {
  workstreamStateAtom,
  workstreamActiveChildAtom,
  workstreamLayoutModeAtom,
  workstreamSplitRatioAtom,
  workstreamFilesSidebarVisibleAtom,
  workstreamHasOpenFilesAtom,
  setWorkstreamActiveChildAtom,
  setWorkstreamLayoutModeAtom,
  setWorkstreamSplitRatioAtom,
  toggleWorkstreamFilesSidebarAtom,
  loadWorkstreamState,
  workstreamStatesLoadedAtom,
  type WorkstreamLayoutMode,
} from '../../store/atoms/workstreamState';
import {
  filesEditedWidthAtom,
  setFilesEditedWidthAtom,
} from '../../store/atoms/agentMode';

export interface AgentWorkstreamPanelRef {
  closeActiveTab: () => void;
}

export interface AgentWorkstreamPanelProps {
  workspacePath: string;
  workstreamId: string;
  workstreamType: WorkstreamType;
  onFileOpen?: (filePath: string) => Promise<void>;
  onAddSessionToWorktree?: (worktreeId: string) => Promise<void>;
  /** Callback when a worktree is archived */
  onWorktreeArchived?: () => void;
}

/**
 * Header showing workstream title, provider icon, processing state, and layout controls.
 * Subscribes to atoms directly for isolated re-renders.
 */
const WorkstreamHeader: React.FC<{
  workstreamId: string;
  workspacePath: string;
  worktreeId?: string | null;
  worktreePath?: string | null;
  onToggleSidebar: () => void;
  sidebarVisible: boolean;
  onArchiveStatusChange?: () => void;
  onOpenTerminal?: () => void;
}> = React.memo(({ workstreamId, workspacePath, worktreeId, worktreePath, onToggleSidebar, sidebarVisible, onArchiveStatusChange, onOpenTerminal }) => {
  const title = useAtomValue(workstreamTitleAtom(workstreamId));
  const isProcessing = useAtomValue(workstreamProcessingAtom(workstreamId));
  const sessionData = useAtomValue(sessionStoreAtom(workstreamId));
  const layoutMode = useAtomValue(workstreamLayoutModeAtom(workstreamId));
  const hasTabs = useAtomValue(workstreamHasOpenFilesAtom(workstreamId));
  const sessions = useAtomValue(workstreamSessionsAtom(workstreamId));
  const [isArchived, setIsArchived] = useState(false);
  const setLayoutMode = useSetAtom(setWorkstreamLayoutModeAtom);
  const updateSessionStore = useSetAtom(updateSessionStoreAtom);

  // Inline editing state
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(title ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  // A workstream has children if there are multiple sessions
  const hasChildren = sessions.length > 1;

  // Load archived state from atom
  const archivedFromAtom = useAtomValue(sessionArchivedAtom(workstreamId));
  useEffect(() => {
    setIsArchived(archivedFromAtom);
  }, [archivedFromAtom]);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Update edit value when title changes externally
  useEffect(() => {
    if (!isEditing) {
      setEditValue(title ?? '');
    }
  }, [title, isEditing]);

  const handleTitleClick = useCallback(() => {
    setEditValue(title ?? '');
    setIsEditing(true);
  }, [title]);

  const handleRenameSubmit = useCallback(async () => {
    const trimmedValue = editValue.trim();
    if (trimmedValue && trimmedValue !== title) {
      try {
        const result = await window.electronAPI.invoke('sessions:update-metadata', workstreamId, { title: trimmedValue });
        if (result.success) {
          const now = Date.now();
          // Update session with new title (syncs both sessionStoreAtom and sessionRegistryAtom)
          updateSessionStore({ sessionId: workstreamId, updates: { title: trimmedValue, updatedAt: now } });
        } else {
          console.error('[WorkstreamHeader] Failed to rename session:', result.error);
        }
      } catch (err) {
        console.error('[WorkstreamHeader] Error renaming session:', err);
      }
    }
    setIsEditing(false);
  }, [editValue, title, workstreamId, updateSessionStore]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRenameSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditValue(title ?? '');
      setIsEditing(false);
    }
  }, [handleRenameSubmit, title]);

  const handleLayoutChange = useCallback((mode: WorkstreamLayoutMode) => {
    setLayoutMode({ workstreamId, mode });
  }, [workstreamId, setLayoutMode]);

  const handleArchive = useCallback(async () => {
    try {
      await window.electronAPI.invoke('sessions:update-metadata', workstreamId, { isArchived: true });
      setIsArchived(true);
      onArchiveStatusChange?.();
    } catch (error) {
      console.error('[WorkstreamHeader] Failed to archive:', error);
    }
  }, [workstreamId, onArchiveStatusChange]);

  const handleUnarchive = useCallback(async () => {
    try {
      await window.electronAPI.invoke('sessions:update-metadata', workstreamId, { isArchived: false });
      setIsArchived(false);
      onArchiveStatusChange?.();
    } catch (error) {
      console.error('[WorkstreamHeader] Failed to unarchive:', error);
    }
  }, [workstreamId, onArchiveStatusChange]);

  return (
    <div className="workstream-header shrink-0 h-12 px-4 border-b border-[var(--nim-border)] bg-[var(--nim-bg)]">
      <div className="workstream-header-main flex items-center gap-3 h-full">
        <div className="workstream-header-icon shrink-0 text-[var(--nim-text-muted)]">
          {hasChildren ? (
            <MaterialSymbol icon="account_tree" size={20} />
          ) : (
            <ProviderIcon provider={sessionData?.provider || 'claude-code'} size={20} />
          )}
        </div>

        <div className="workstream-header-content min-w-0">
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              className="workstream-header-title-input text-sm font-semibold text-[var(--nim-text)] bg-[var(--nim-bg-secondary)] border border-[var(--nim-border-accent)] rounded py-0.5 px-1 m-0 outline-none w-full min-w-[150px] max-w-[300px]"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={handleKeyDown}
            />
          ) : (
            <h2
              className="workstream-header-title m-0 text-sm font-semibold text-[var(--nim-text)] whitespace-nowrap overflow-hidden text-ellipsis leading-tight cursor-pointer py-0.5 px-1 rounded transition-colors duration-150 hover:bg-[var(--nim-bg-hover)]"
              onClick={handleTitleClick}
              title="Click to rename"
            >
              {title}
            </h2>
          )}
        </div>

        {isProcessing && (
          <div className="workstream-header-processing shrink-0 flex items-center justify-center">
            <span className="workstream-header-spinner w-4 h-4 border-2 border-[var(--nim-border)] border-t-[var(--nim-primary)] rounded-full animate-spin" />
          </div>
        )}

        <div className="workstream-header-spacer flex-1" />

        {/* Layout controls - shared component with Files/Agent labels */}
        <LayoutControls
          mode={layoutMode}
          hasTabs={hasTabs}
          onModeChange={handleLayoutChange}
        />

        {/* New Terminal button - only show for worktree sessions */}
        {worktreeId && onOpenTerminal && (
          <button
            className="workstream-sidebar-toggle layout-control-btn w-7 h-7 flex items-center justify-center rounded text-[var(--nim-text-faint)] cursor-pointer border-none bg-transparent ml-2 hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text-muted)]"
            onClick={onOpenTerminal}
            title="Open terminal in worktree"
          >
            <MaterialSymbol icon="terminal" size={16} />
          </button>
        )}

        {/* Archive/Unarchive button */}
        <button
          className="workstream-archive-button flex items-center gap-1.5 h-6 px-2 rounded text-[var(--nim-text-faint)] text-[11px] font-medium cursor-pointer border-none bg-transparent hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text-muted)]"
          onClick={isArchived ? handleUnarchive : handleArchive}
          title={isArchived ? 'Unarchive session' : 'Archive session'}
        >
          <MaterialSymbol icon={isArchived ? 'unarchive' : 'archive'} size={16} />
          <span>{isArchived ? 'Unarchive session' : 'Archive session'}</span>
        </button>

        {/* Toggle files sidebar */}
        <button
          className={`workstream-sidebar-toggle w-7 h-7 flex items-center justify-center rounded cursor-pointer border-none bg-transparent ml-2 hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text-muted)] ${sidebarVisible ? 'active text-[var(--nim-primary)]' : 'text-[var(--nim-text-faint)]'}`}
          onClick={onToggleSidebar}
          title={sidebarVisible ? 'Hide edited files' : 'Show edited files'}
        >
          <MaterialSymbol icon="dock_to_right" size={16} />
        </button>
      </div>
    </div>
  );
});

WorkstreamHeader.displayName = 'WorkstreamHeader';

/**
 * AgentWorkstreamPanel renders the selected workstream.
 *
 * File clicks open in the workstream-level editor tabs, not per-session.
 */
export const AgentWorkstreamPanel = React.memo(React.forwardRef<AgentWorkstreamPanelRef, AgentWorkstreamPanelProps>(({
  workspacePath,
  workstreamId,
  workstreamType,
  onFileOpen,
  onAddSessionToWorktree,
  onWorktreeArchived,
}, ref) => {
  // Ref to the workstream editor tabs for opening files
  const editorTabsRef = useRef<WorkstreamEditorTabsRef>(null);

  // Get sessions in this workstream
  const sessions = useAtomValue(workstreamSessionsAtom(workstreamId));
  const activeSessionId = useAtomValue(workstreamActiveChildAtom(workstreamId));
  const setActiveSession = useSetAtom(setWorkstreamActiveChildAtom);

  // Worktree state - resolve worktree path if this is a worktree session
  const [worktreePath, setWorktreePath] = useState<string | null>(null);
  const sessionParentId = useAtomValue(sessionParentIdDerivedAtom(workstreamId));
  const sessionWorktreeId = useAtomValue(sessionWorktreeIdAtom(workstreamId));

  // Debug: log when activeSessionId changes
  // useEffect(() => {
  //   console.log(`[AgentWorkstreamPanel] activeSessionId changed for ${workstreamId}:`, activeSessionId);
  // }, [workstreamId, activeSessionId]);

  // Layout state (persisted via workstreamStateAtom)
  const layoutMode = useAtomValue(workstreamLayoutModeAtom(workstreamId));
  const sidebarVisible = useAtomValue(workstreamFilesSidebarVisibleAtom(workstreamId));
  const splitRatio = useAtomValue(workstreamSplitRatioAtom(workstreamId));
  const hasTabs = useAtomValue(workstreamHasOpenFilesAtom(workstreamId));
  const toggleSidebar = useSetAtom(toggleWorkstreamFilesSidebarAtom);
  const setSplitRatio = useSetAtom(setWorkstreamSplitRatioAtom);
  const setLayoutMode = useSetAtom(setWorkstreamLayoutModeAtom);

  // Files sidebar width (project-level state from agentMode)
  const sidebarWidth = useAtomValue(filesEditedWidthAtom);
  const setSidebarWidth = useSetAtom(setFilesEditedWidthAtom);

  // Load persisted state when workstream changes
  useEffect(() => {
    loadWorkstreamState(workstreamId);
  }, [workstreamId]);

  // Auto-collapse editor area when last tab is closed
  // Use a ref to track if we just opened a file to prevent immediate collapse
  const justOpenedFileRef = useRef(false);

  useEffect(() => {
    // If we're in editor or split mode and there are no tabs, switch to transcript mode
    // But don't collapse if we just opened a file (wait for it to actually open)
    if (!hasTabs && (layoutMode === 'editor' || layoutMode === 'split') && !justOpenedFileRef.current) {
      setLayoutMode({ workstreamId, mode: 'transcript' });
    }
    // Reset the flag after each check
    justOpenedFileRef.current = false;
  }, [hasTabs, layoutMode, workstreamId, setLayoutMode]);

  // Load session data and children when workstream changes
  // This is critical for workstreams with child sessions to work properly
  const loadSessionData = useSetAtom(loadSessionDataAtom);
  const loadSessionChildren = useSetAtom(loadSessionChildrenAtom);

  // Get session data to check if it's been loaded
  const sessionDataLoaded = useAtomValue(sessionStoreAtom(workstreamId));

  // Wait for workstream states to be loaded from disk before loading children
  // This prevents race conditions where children load before persisted activeChildId is restored
  const workstreamStatesLoaded = useAtomValue(workstreamStatesLoadedAtom);

  useEffect(() => {
    if (!workstreamId || !workspacePath) return;

    // Load session data if not already loaded
    // sessionDataLoaded is null when no data has been fetched yet
    if (sessionDataLoaded === null) {
      console.log('[AgentWorkstreamPanel] Session data not loaded, fetching for:', workstreamId);
      loadSessionData({ sessionId: workstreamId, workspacePath });
    }
  }, [workstreamId, workspacePath, sessionDataLoaded, loadSessionData]);

  useEffect(() => {
    // Wait for both session data AND workstream states to be loaded before loading children
    // This ensures persisted activeChildId is available when loadSessionChildrenAtom runs
    if (!workstreamId || !workspacePath || sessionDataLoaded === null || !workstreamStatesLoaded) {
      console.log('[AgentWorkstreamPanel] Children effect - waiting for:', {
        workstreamId: !!workstreamId,
        workspacePath: !!workspacePath,
        sessionDataLoaded: sessionDataLoaded !== null,
        workstreamStatesLoaded,
      });
      return;
    }

    // Load child sessions for this workstream
    // This populates sessionChildrenAtom which workstreamSessionsAtom depends on
    // sessionParentId === null means this IS a root session (not a child of another session)
    if (sessionParentId === null) {
      // This is a root session - load its children
      // console.log('[AgentWorkstreamPanel] Loading children for root session:', workstreamId);
      loadSessionChildren({ parentSessionId: workstreamId, workspacePath });
    }
  }, [workstreamId, workspacePath, sessionDataLoaded, sessionParentId, workstreamStatesLoaded, loadSessionChildren]);

  // Resolve worktree path if this is a worktree session
  useEffect(() => {
    if (!sessionWorktreeId) {
      setWorktreePath(null);
      return;
    }

    // Query worktree path via IPC
    (async () => {
      try {
        const result = await window.electronAPI.invoke('worktree:get', sessionWorktreeId);
        if (result?.success && result.worktree) {
          setWorktreePath(result.worktree.path);
          // console.log('[AgentWorkstreamPanel] Resolved worktree path:', result.worktree.path);
        } else {
          console.error('[AgentWorkstreamPanel] Failed to resolve worktree path:', result?.error);
          setWorktreePath(null);
        }
      } catch (error) {
        console.error('[AgentWorkstreamPanel] Error resolving worktree path:', error);
        setWorktreePath(null);
      }
    })();
  }, [sessionWorktreeId]);

  // Local state for drag states
  const [isDraggingVertical, setIsDraggingVertical] = useState(false);
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);

  // Ref for the content container (used for resize calculations)
  const contentRef = useRef<HTMLDivElement>(null);

  // Ref for the editor area to check focus
  const editorAreaRef = useRef<HTMLDivElement>(null);

  // For single sessions, activeSessionId should be the session itself
  // For workstreams, activeSessionId should be one of the children
  // We trust the atom state - no fallback that masks bugs

  const handleSessionSelect = useCallback((sessionId: string) => {
    setActiveSession({ workstreamId, childId: sessionId });
  }, [workstreamId, setActiveSession]);

  // Track pending file open when switching to split mode
  const pendingFileOpenRef = useRef<string | null>(null);

  // File clicks open in the workstream editor tabs
  const handleFileClick = useCallback((filePath: string) => {
    if (editorTabsRef.current) {
      // Editor is mounted, open the file directly
      editorTabsRef.current.openFile(filePath);
    } else {
      // Editor not mounted (transcript mode), switch to split and queue file open
      // Set flag to prevent auto-collapse during this transition
      justOpenedFileRef.current = true;
      pendingFileOpenRef.current = filePath;
      setLayoutMode({ workstreamId, mode: 'split' });
    }
  }, [workstreamId, setLayoutMode]);

  const handleToggleSidebar = useCallback(() => {
    toggleSidebar(workstreamId);
  }, [workstreamId, toggleSidebar]);

  // Open a terminal in the worktree directory
  const handleOpenTerminal = useCallback(async () => {
    if (!sessionWorktreeId || !worktreePath) return;

    try {
      // Create terminal with worktree association
      const result = await window.electronAPI.terminal.create(workspacePath, {
        cwd: worktreePath,
        worktreeId: sessionWorktreeId,
        title: `Terminal (${worktreePath.split('/').pop()})`,
      });

      if (result.success && result.terminalId) {
        // Dispatch event to notify TerminalBottomPanel about the new terminal
        window.dispatchEvent(new CustomEvent('terminal:created', {
          detail: { terminalId: result.terminalId }
        }));
        // Dispatch event to notify App.tsx to show terminal panel
        window.dispatchEvent(new CustomEvent('terminal:show'));
      }
    } catch (error) {
      console.error('[AgentWorkstreamPanel] Failed to create terminal:', error);
    }
  }, [workspacePath, sessionWorktreeId, worktreePath]);

  // Determine what to show based on layout mode
  const showEditorTabs = layoutMode === 'split' || layoutMode === 'editor';
  const showSessionTabs = layoutMode === 'split' || layoutMode === 'transcript';

  // Open pending file once editor mounts after layout mode change
  useEffect(() => {
    if (pendingFileOpenRef.current && showEditorTabs && editorTabsRef.current) {
      editorTabsRef.current.openFile(pendingFileOpenRef.current);
      pendingFileOpenRef.current = null;
    }
  }, [showEditorTabs]); // Re-run when editor becomes visible

  // Vertical resizer (between editor and session) - uses split ratio like AISessionView
  const handleVerticalResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingVertical(true);

    const container = contentRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const containerHeight = containerRect.height;
    const startY = e.clientY;
    const startRatio = splitRatio;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startY;
      const currentHeight = startRatio * containerHeight;
      const newHeight = currentHeight + deltaY;
      const newRatio = newHeight / containerHeight;

      // Clamp between 10% and 90%
      const clampedRatio = Math.max(0.1, Math.min(0.9, newRatio));
      setSplitRatio({ workstreamId, ratio: clampedRatio });
    };

    const handleMouseUp = () => {
      setIsDraggingVertical(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }, [workstreamId, splitRatio, setSplitRatio]);

  // Sidebar resizer (between content and sidebar)
  const handleSidebarResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingSidebar(true);
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = startX - moveEvent.clientX;
      const newWidth = startWidth + deltaX;
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
  }, [sidebarWidth, setSidebarWidth]);

  // Handle CMD+F routing based on focus
  // Route to editor if editor has focus, otherwise route to transcript
  useEffect(() => {
    const handleFind = () => {
      // Check if the editor area has focus
      const activeElement = document.activeElement;
      const editorHasFocus = editorAreaRef.current?.contains(activeElement);

      if (editorHasFocus && editorTabsRef.current) {
        // Editor has focus - trigger find in the active editor
        // Monaco and Lexical handle CMD+F natively, so we dispatch a keyboard event
        // to simulate the user pressing CMD+F directly in the focused editor
        const event = new KeyboardEvent('keydown', {
          key: 'f',
          code: 'KeyF',
          metaKey: true,
          bubbles: true,
          cancelable: true,
        });
        activeElement?.dispatchEvent(event);
      } else if (activeSessionId) {
        // Transcript has focus - dispatch to transcript with sessionId
        window.dispatchEvent(new CustomEvent('menu:find', {
          detail: { sessionId: activeSessionId }
        }));
      }
    };

    const handleFindNext = () => {
      const activeElement = document.activeElement;
      const editorHasFocus = editorAreaRef.current?.contains(activeElement);

      if (editorHasFocus) {
        // Editor has focus - trigger find next in the active editor
        const event = new KeyboardEvent('keydown', {
          key: 'g',
          code: 'KeyG',
          metaKey: true,
          bubbles: true,
          cancelable: true,
        });
        activeElement?.dispatchEvent(event);
      } else if (activeSessionId) {
        // Transcript has focus - dispatch to transcript with sessionId
        window.dispatchEvent(new CustomEvent('menu:find-next', {
          detail: { sessionId: activeSessionId }
        }));
      }
    };

    const handleFindPrevious = () => {
      const activeElement = document.activeElement;
      const editorHasFocus = editorAreaRef.current?.contains(activeElement);

      if (editorHasFocus) {
        // Editor has focus - trigger find previous in the active editor
        const event = new KeyboardEvent('keydown', {
          key: 'g',
          code: 'KeyG',
          metaKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        });
        activeElement?.dispatchEvent(event);
      } else if (activeSessionId) {
        // Transcript has focus - dispatch to transcript with sessionId
        window.dispatchEvent(new CustomEvent('menu:find-previous', {
          detail: { sessionId: activeSessionId }
        }));
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
  }, [activeSessionId]);

  // Expose ref methods
  useImperativeHandle(ref, () => ({
    closeActiveTab: () => {
      // Only close editor tabs if the editor area has focus
      const activeElement = document.activeElement;
      const editorHasFocus = editorAreaRef.current?.contains(activeElement);

      if (editorHasFocus && editorTabsRef.current) {
        // Close the active editor tab
        editorTabsRef.current.closeActiveTab();
      }
      // If transcript has focus, do nothing - we don't want to close AI sessions with CMD+W
    }
  }), []);

  return (
    <div className="agent-workstream-panel flex flex-row h-full overflow-hidden">
      {/* Main column - header + content */}
      <div className="agent-workstream-panel-main flex flex-col flex-1 min-w-0 overflow-hidden">
        <WorkstreamHeader
          workstreamId={workstreamId}
          workspacePath={workspacePath}
          worktreeId={sessionWorktreeId}
          worktreePath={worktreePath}
          onToggleSidebar={handleToggleSidebar}
          sidebarVisible={sidebarVisible}
          onOpenTerminal={sessionWorktreeId ? handleOpenTerminal : undefined}
        />

        <div ref={contentRef} className="agent-workstream-panel-content flex-1 min-h-0 flex flex-col overflow-hidden">
          {/* Editor tabs for the entire workstream */}
          {showEditorTabs && (
            <div
              ref={editorAreaRef}
              className={`agent-workstream-editor-area shrink-0 border-b border-[var(--nim-border)] min-h-0 flex flex-col ${layoutMode === 'editor' ? 'maximized flex-1 border-b-0' : ''}`}
              style={layoutMode === 'split' ? { height: `${splitRatio * 100}%`, minHeight: '100px' } : undefined}
            >
              <WorkstreamEditorTabs
                key={workstreamId}
                ref={editorTabsRef}
                workstreamId={workstreamId}
                workspacePath={workspacePath}
                basePath={worktreePath || workspacePath}
                isActive={true}
              />
            </div>
          )}

          {/* Vertical resizer between editor and session */}
          {layoutMode === 'split' && (
            <div
              className={`agent-workstream-vertical-resizer h-1 shrink-0 cursor-ns-resize bg-[var(--nim-border)] transition-colors duration-150 hover:bg-[var(--nim-primary)] ${isDraggingVertical ? 'dragging bg-[var(--nim-primary)]' : ''}`}
              onMouseDown={handleVerticalResizeStart}
            />
          )}

          {/* Session tabs + active session panel */}
          {showSessionTabs && (
            <div className={`agent-workstream-session-area flex-1 min-h-0 flex flex-col overflow-hidden ${layoutMode === 'transcript' ? 'maximized' : ''}`}>
              <WorkstreamSessionTabs
                workspacePath={workspacePath}
                workstreamId={workstreamId}
                sessions={sessions}
                activeSessionId={activeSessionId}
                onSessionSelect={handleSessionSelect}
                onFileClick={handleFileClick}
                worktreeId={sessionWorktreeId}
                onAddSessionToWorktree={onAddSessionToWorktree}
              />
            </div>
          )}
        </div>
      </div>

      {/* Sidebar resizer */}
      {sidebarVisible && activeSessionId && (
        <div
          className={`agent-workstream-sidebar-resizer w-1 shrink-0 cursor-ew-resize bg-[var(--nim-border)] transition-colors duration-150 hover:bg-[var(--nim-primary)] ${isDraggingSidebar ? 'dragging bg-[var(--nim-primary)]' : ''}`}
          onMouseDown={handleSidebarResizeStart}
        />
      )}

      {/* Files edited sidebar - full height on the right, sibling of main column */}
      {sidebarVisible && (
        <FilesEditedSidebar
          workstreamId={workstreamId}
          activeSessionId={activeSessionId}
          workspacePath={workspacePath}
          onFileClick={handleFileClick}
          width={sidebarWidth}
          worktreeId={sessionWorktreeId}
          worktreePath={worktreePath}
          onWorktreeArchived={onWorktreeArchived}
        />
      )}
    </div>
  );
}));

AgentWorkstreamPanel.displayName = 'AgentWorkstreamPanel';
