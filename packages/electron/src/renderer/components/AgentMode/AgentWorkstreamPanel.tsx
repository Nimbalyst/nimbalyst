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

import React, { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
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
  type WorkstreamLayoutMode,
} from '../../store/atoms/workstreamState';
import './AgentWorkstreamPanel.css';

export interface AgentWorkstreamPanelProps {
  workspacePath: string;
  workstreamId: string;
  workstreamType: WorkstreamType;
  onFileOpen?: (filePath: string) => Promise<void>;
}

/**
 * Header showing workstream title, provider icon, processing state, and layout controls.
 * Subscribes to atoms directly for isolated re-renders.
 */
const WorkstreamHeader: React.FC<{
  workstreamId: string;
  onToggleSidebar: () => void;
  sidebarVisible: boolean;
  onArchiveStatusChange?: () => void;
}> = React.memo(({ workstreamId, onToggleSidebar, sidebarVisible, onArchiveStatusChange }) => {
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
  const [editValue, setEditValue] = useState(title);
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
      setEditValue(title);
    }
  }, [title, isEditing]);

  const handleTitleClick = useCallback(() => {
    setEditValue(title);
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
      setEditValue(title);
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
    <div className="workstream-header">
      <div className="workstream-header-main">
        <div className="workstream-header-icon">
          {hasChildren ? (
            <MaterialSymbol icon="account_tree" size={20} />
          ) : (
            <ProviderIcon provider={sessionData?.provider || 'claude-code'} size={20} />
          )}
        </div>

        <div className="workstream-header-content">
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              className="workstream-header-title-input"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={handleKeyDown}
            />
          ) : (
            <h2
              className="workstream-header-title"
              onClick={handleTitleClick}
              title="Click to rename"
            >
              {title}
            </h2>
          )}
        </div>

        {isProcessing && (
          <div className="workstream-header-processing">
            <span className="workstream-header-spinner" />
          </div>
        )}

        <div className="workstream-header-spacer" />

        {/* Layout controls - shared component with Files/Agent labels */}
        <LayoutControls
          mode={layoutMode}
          hasTabs={hasTabs}
          onModeChange={handleLayoutChange}
        />

        {/* Archive/Unarchive button */}
        <button
          className="workstream-sidebar-toggle layout-control-btn with-label"
          onClick={isArchived ? handleUnarchive : handleArchive}
          title={isArchived ? 'Unarchive session' : 'Archive session'}
        >
          <MaterialSymbol icon={isArchived ? 'unarchive' : 'archive'} size={16} />
          {isArchived ? 'Unarchive session' : 'Archive session'}
        </button>

        {/* Toggle files sidebar */}
        <button
          className={`workstream-sidebar-toggle ${sidebarVisible ? 'active' : ''}`}
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
export const AgentWorkstreamPanel: React.FC<AgentWorkstreamPanelProps> = React.memo(({
  workspacePath,
  workstreamId,
  workstreamType,
  onFileOpen,
}) => {
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
  const toggleSidebar = useSetAtom(toggleWorkstreamFilesSidebarAtom);
  const setSplitRatio = useSetAtom(setWorkstreamSplitRatioAtom);

  // Load persisted state when workstream changes
  useEffect(() => {
    loadWorkstreamState(workstreamId);
  }, [workstreamId]);

  // Load session data and children when workstream changes
  // This is critical for workstreams with child sessions to work properly
  const loadSessionData = useSetAtom(loadSessionDataAtom);
  const loadSessionChildren = useSetAtom(loadSessionChildrenAtom);

  useEffect(() => {
    if (!workstreamId || !workspacePath) return;

    // Load session data if not already loaded
    // Check if we have the minimal data we need (parentId and worktreeId)
    if (sessionParentId === undefined && sessionWorktreeId === undefined) {
      // console.log('[AgentWorkstreamPanel] Loading session data for:', workstreamId);
      loadSessionData({ sessionId: workstreamId, workspacePath });
    }
  }, [workstreamId, workspacePath, sessionParentId, sessionWorktreeId, loadSessionData]);

  useEffect(() => {
    // console.log('[AgentWorkstreamPanel] Children effect - workstreamId:', workstreamId, 'sessionParentId:', sessionParentId);
    if (!workstreamId || !workspacePath || sessionParentId === undefined) return;

    // Load child sessions for this workstream
    // This populates sessionChildrenAtom which workstreamSessionsAtom depends on
    if (!sessionParentId) {
      // This is a root session - load its children
      // console.log('[AgentWorkstreamPanel] Loading children for root session:', workstreamId);
      loadSessionChildren({ parentSessionId: workstreamId, workspacePath });
    }
  }, [workstreamId, workspacePath, sessionParentId, loadSessionChildren]);

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

  // Local state for sidebar width and drag states
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const [isDraggingVertical, setIsDraggingVertical] = useState(false);
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);

  // Ref for the content container (used for resize calculations)
  const contentRef = useRef<HTMLDivElement>(null);

  // Ref for the editor area to check focus
  const editorAreaRef = useRef<HTMLDivElement>(null);

  // For single sessions, the workstreamId IS the sessionId
  // For workstreams, ensure activeSessionId is actually in the sessions array
  // (the parent workstream ID should not be used as the active session)
  const effectiveActiveSessionId = (activeSessionId && sessions.includes(activeSessionId))
    ? activeSessionId
    : sessions[0] || null;

  // console.log('[AgentWorkstreamPanel] Render - workstreamId:', workstreamId, 'sessions:', sessions, 'activeSessionId:', activeSessionId, 'effectiveActiveSessionId:', effectiveActiveSessionId);

  const handleSessionSelect = useCallback((sessionId: string) => {
    setActiveSession({ workstreamId, childId: sessionId });
  }, [workstreamId, setActiveSession]);

  // Track pending file open when switching to split mode
  const pendingFileOpenRef = useRef<string | null>(null);

  // File clicks open in the workstream editor tabs
  const setLayoutMode = useSetAtom(setWorkstreamLayoutModeAtom);
  const handleFileClick = useCallback((filePath: string) => {
    if (editorTabsRef.current) {
      // Editor is mounted, open the file directly
      editorTabsRef.current.openFile(filePath);
    } else {
      // Editor not mounted (transcript mode), switch to split and queue file open
      pendingFileOpenRef.current = filePath;
      setLayoutMode({ workstreamId, mode: 'split' });
    }
  }, [workstreamId, setLayoutMode]);

  const handleToggleSidebar = useCallback(() => {
    toggleSidebar(workstreamId);
  }, [workstreamId, toggleSidebar]);

  // Open pending file once editor mounts after layout mode change
  useEffect(() => {
    if (pendingFileOpenRef.current && editorTabsRef.current) {
      editorTabsRef.current.openFile(pendingFileOpenRef.current);
      pendingFileOpenRef.current = null;
    }
  }, [layoutMode]); // Re-run when layout mode changes (editor becomes mounted)

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
      const newWidth = Math.max(150, Math.min(startWidth + deltaX, 500));
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
      } else if (effectiveActiveSessionId) {
        // Transcript has focus - dispatch to transcript with sessionId
        window.dispatchEvent(new CustomEvent('menu:find', {
          detail: { sessionId: effectiveActiveSessionId }
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
      } else if (effectiveActiveSessionId) {
        // Transcript has focus - dispatch to transcript with sessionId
        window.dispatchEvent(new CustomEvent('menu:find-next', {
          detail: { sessionId: effectiveActiveSessionId }
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
      } else if (effectiveActiveSessionId) {
        // Transcript has focus - dispatch to transcript with sessionId
        window.dispatchEvent(new CustomEvent('menu:find-previous', {
          detail: { sessionId: effectiveActiveSessionId }
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
  }, [effectiveActiveSessionId]);

  // Determine what to show based on layout mode
  const showEditorTabs = layoutMode === 'split' || layoutMode === 'editor';
  const showSessionTabs = layoutMode === 'split' || layoutMode === 'transcript';

  return (
    <div className="agent-workstream-panel">
      {/* Main column - header + content */}
      <div className="agent-workstream-panel-main">
        <WorkstreamHeader
          workstreamId={workstreamId}
          onToggleSidebar={handleToggleSidebar}
          sidebarVisible={sidebarVisible}
        />

        <div ref={contentRef} className="agent-workstream-panel-content">
          {/* Editor tabs for the entire workstream */}
          {showEditorTabs && (
            <div
              ref={editorAreaRef}
              className={`agent-workstream-editor-area ${layoutMode === 'editor' ? 'maximized' : ''}`}
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
              className={`agent-workstream-vertical-resizer ${isDraggingVertical ? 'dragging' : ''}`}
              onMouseDown={handleVerticalResizeStart}
            />
          )}

          {/* Session tabs + active session panel */}
          {showSessionTabs && (
            <div className={`agent-workstream-session-area ${layoutMode === 'transcript' ? 'maximized' : ''}`}>
              <WorkstreamSessionTabs
                workspacePath={workspacePath}
                workstreamId={workstreamId}
                sessions={sessions}
                activeSessionId={effectiveActiveSessionId}
                onSessionSelect={handleSessionSelect}
                onFileClick={handleFileClick}
              />
            </div>
          )}
        </div>
      </div>

      {/* Sidebar resizer */}
      {sidebarVisible && effectiveActiveSessionId && (
        <div
          className={`agent-workstream-sidebar-resizer ${isDraggingSidebar ? 'dragging' : ''}`}
          onMouseDown={handleSidebarResizeStart}
        />
      )}

      {/* Files edited sidebar - full height on the right, sibling of main column */}
      {sidebarVisible && (
        <FilesEditedSidebar
          workstreamId={workstreamId}
          activeSessionId={effectiveActiveSessionId}
          workspacePath={workspacePath}
          onFileClick={handleFileClick}
          width={sidebarWidth}
        />
      )}
    </div>
  );
});

AgentWorkstreamPanel.displayName = 'AgentWorkstreamPanel';
