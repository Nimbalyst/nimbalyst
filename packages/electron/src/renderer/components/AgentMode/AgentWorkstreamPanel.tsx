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
import { getWorktreeNameFromPath } from '../../utils/pathUtils';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { ProviderIcon, MaterialSymbol, SearchReplaceStateManager } from '@nimbalyst/runtime';
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
  setActiveSessionInWorkstreamAtom,
  type WorkstreamType,
} from '../../store';
import {
  workstreamStateAtom,
  workstreamActiveChildAtom,
  workstreamLayoutModeAtom,
  workstreamSplitRatioAtom,
  workstreamFilesSidebarVisibleAtom,
  workstreamHasOpenFilesAtom,
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
import { ArchiveWorktreeDialog } from './ArchiveWorktreeDialog';
import { useArchiveWorktreeDialog } from '../../hooks/useArchiveWorktreeDialog';
import { detectFileType, type SerializableDocumentContext } from '../../hooks/useDocumentContext';
import { getTextSelection } from '../UnifiedAI/TextSelectionIndicator';
import { terminalListAtom, setActiveTerminal, loadTerminals } from '../../store/atoms/terminals';

export interface AgentWorkstreamPanelRef {
  closeActiveTab: () => void;
}

export interface AgentWorkstreamPanelProps {
  workspacePath: string;
  workstreamId: string;
  workstreamType: WorkstreamType;
  onFileOpen?: (filePath: string) => Promise<void>;
  onAddSessionToWorktree?: (worktreeId: string) => Promise<void>;
  onCreateWorktreeSession?: (worktreeId: string) => Promise<string | null>;
  /** Callback when a worktree is archived */
  onWorktreeArchived?: () => void;
  /** Whether the workspace is a git repository */
  isGitRepo?: boolean;
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
  onCreateNewTerminal?: () => void;
  onShowArchiveDialog?: () => void;
}> = React.memo(({ workstreamId, workspacePath, worktreeId, worktreePath, onToggleSidebar, sidebarVisible, onArchiveStatusChange, onOpenTerminal, onCreateNewTerminal, onShowArchiveDialog }) => {
  const title = useAtomValue(workstreamTitleAtom(workstreamId));
  const isProcessing = useAtomValue(workstreamProcessingAtom(workstreamId));
  const sessionData = useAtomValue(sessionStoreAtom(workstreamId));
  const layoutMode = useAtomValue(workstreamLayoutModeAtom(workstreamId));
  const hasTabs = useAtomValue(workstreamHasOpenFilesAtom(workstreamId));
  const sessions = useAtomValue(workstreamSessionsAtom(workstreamId));
  const [isArchived, setIsArchived] = useAtom(sessionArchivedAtom(workstreamId));
  const setLayoutMode = useSetAtom(setWorkstreamLayoutModeAtom);
  const updateSessionStore = useSetAtom(updateSessionStoreAtom);

  // Inline editing state
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(title ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  // Terminal button context menu state
  const [terminalContextMenu, setTerminalContextMenu] = useState<{ x: number; y: number } | null>(null);
  const terminalContextMenuRef = useRef<HTMLDivElement>(null);

  // Close context menu when clicking outside
  useEffect(() => {
    if (!terminalContextMenu) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (terminalContextMenuRef.current && !terminalContextMenuRef.current.contains(e.target as Node)) {
        setTerminalContextMenu(null);
      }
    };

    const handleEscape = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTerminalContextMenu(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [terminalContextMenu]);

  const handleTerminalContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setTerminalContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleNewTerminalClick = useCallback(() => {
    setTerminalContextMenu(null);
    onCreateNewTerminal?.();
  }, [onCreateNewTerminal]);

  // A workstream has children if there are multiple sessions
  const hasChildren = sessions.length > 1;

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

  // Determine session type label for archive button
  const getSessionTypeLabel = useCallback(() => {
    if (worktreeId) return 'Worktree';
    if (hasChildren) return 'Workstream';
    return 'Session';
  }, [worktreeId, hasChildren]);

  const handleArchive = useCallback(async () => {
    // For worktrees, show confirmation dialog first
    if (worktreeId && onShowArchiveDialog) {
      onShowArchiveDialog();
      return;
    }

    try {
      await window.electronAPI.invoke('sessions:update-metadata', workstreamId, { isArchived: true });
      setIsArchived(true);
      // Update atom state for immediate UI feedback across all components
      updateSessionStore({ sessionId: workstreamId, updates: { isArchived: true } });
      onArchiveStatusChange?.();
    } catch (error) {
      console.error('[WorkstreamHeader] Failed to archive:', error);
    }
  }, [workstreamId, worktreeId, onArchiveStatusChange, onShowArchiveDialog, updateSessionStore]);

  const handleUnarchive = useCallback(async () => {
    try {
      await window.electronAPI.invoke('sessions:update-metadata', workstreamId, { isArchived: false });
      setIsArchived(false);
      // Update atom state for immediate UI feedback across all components
      updateSessionStore({ sessionId: workstreamId, updates: { isArchived: false } });
      onArchiveStatusChange?.();
    } catch (error) {
      console.error('[WorkstreamHeader] Failed to unarchive:', error);
    }
  }, [workstreamId, onArchiveStatusChange, updateSessionStore]);

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

        {/* Terminal button - only show for worktree sessions, positioned before layout controls */}
        {worktreeId && onOpenTerminal && (
          <button
            className="workstream-terminal-btn w-8 h-8 flex items-center justify-center rounded text-[var(--nim-text-faint)] cursor-pointer border-none bg-transparent hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text-muted)] mr-2"
            onClick={onOpenTerminal}
            onContextMenu={handleTerminalContextMenu}
            title="Open terminal in worktree"
          >
            <MaterialSymbol icon="terminal" size={20} />
          </button>
        )}

        {/* Terminal button context menu */}
        {terminalContextMenu && (
          <div
            ref={terminalContextMenuRef}
            className="fixed p-1 min-w-[140px] rounded-md z-[10000] text-[13px] backdrop-blur-[10px] shadow-[0_4px_12px_rgba(0,0,0,0.15)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.5)]"
            style={{
              left: terminalContextMenu.x,
              top: terminalContextMenu.y,
              background: 'var(--nim-bg)',
              border: '1px solid var(--nim-border)',
            }}
          >
            <div
              className="flex items-center gap-2.5 px-3 py-1.5 rounded cursor-pointer transition-colors text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)]"
              onClick={handleNewTerminalClick}
            >
              <MaterialSymbol icon="add" size={18} />
              <span>New Terminal</span>
            </div>
          </div>
        )}

        {/* Layout controls - shared component with Files/Agent labels */}
        <LayoutControls
          mode={layoutMode}
          hasTabs={hasTabs}
          onModeChange={handleLayoutChange}
        />

        {/* Archive/Unarchive button */}
        <button
          className="workstream-archive-button flex items-center gap-1.5 h-8 px-2 rounded text-[var(--nim-text-faint)] text-[11px] font-medium cursor-pointer border-none bg-transparent hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text-muted)]"
          onClick={isArchived ? handleUnarchive : handleArchive}
          title={isArchived ? `Unarchive ${getSessionTypeLabel().toLowerCase()}` : `Archive ${getSessionTypeLabel().toLowerCase()}`}
        >
          <MaterialSymbol icon={isArchived ? 'unarchive' : 'archive'} size={18} />
          <span>{isArchived ? `Unarchive ${getSessionTypeLabel()}` : `Archive ${getSessionTypeLabel()}`}</span>
        </button>

        {/* Toggle files sidebar */}
        <button
          className={`workstream-sidebar-toggle w-8 h-8 flex items-center justify-center rounded cursor-pointer border-none bg-transparent ml-2 hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text-muted)] ${sidebarVisible ? 'active text-[var(--nim-primary)]' : 'text-[var(--nim-text-faint)]'}`}
          onClick={onToggleSidebar}
          title={sidebarVisible ? 'Hide edited files' : 'Show edited files'}
        >
          <MaterialSymbol icon="dock_to_right" size={20} />
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
  onCreateWorktreeSession,
  onWorktreeArchived,
  isGitRepo = false,
}, ref) => {
  // Ref to the workstream editor tabs for opening files
  const editorTabsRef = useRef<WorkstreamEditorTabsRef>(null);

  // Get sessions in this workstream
  const sessions = useAtomValue(workstreamSessionsAtom(workstreamId));
  const activeSessionId = useAtomValue(workstreamActiveChildAtom(workstreamId));
  const setActiveSession = useSetAtom(setActiveSessionInWorkstreamAtom);

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

  // Session store for updating archived state
  const updateSessionStore = useSetAtom(updateSessionStoreAtom);

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

  // Track which workstreams have had their children loaded to prevent re-loading
  // on session data updates (which would reset activeChildId and cause focus stealing)
  const childrenLoadedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!workstreamId || !workspacePath) return;

    // Load session data if not already loaded
    // sessionDataLoaded is null when no data has been fetched yet
    if (sessionDataLoaded === null) {
      // console.log('[AgentWorkstreamPanel] Session data not loaded, fetching for:', workstreamId);
      loadSessionData({ sessionId: workstreamId, workspacePath });
    }
  }, [workstreamId, workspacePath, sessionDataLoaded, loadSessionData]);

  useEffect(() => {
    // Wait for both session data AND workstream states to be loaded before loading children
    // This ensures persisted activeChildId is available when loadSessionChildrenAtom runs
    if (!workstreamId || !workspacePath || sessionDataLoaded === null || !workstreamStatesLoaded) {
      // console.log('[AgentWorkstreamPanel] Children effect - waiting for:', {
      //   workstreamId: !!workstreamId,
      //   workspacePath: !!workspacePath,
      //   sessionDataLoaded: sessionDataLoaded !== null,
      //   workstreamStatesLoaded,
      // });
      return;
    }

    // Only load children once per workstream to prevent focus stealing
    // When session data updates (e.g., new messages), we don't want to reload children
    // because loadSessionChildrenAtom resets activeChildId which causes the active tab to change
    if (childrenLoadedRef.current.has(workstreamId)) {
      return;
    }

    // Load child sessions for this workstream
    // This populates sessionChildrenAtom which workstreamSessionsAtom depends on
    // sessionParentId === null means this IS a root session (not a child of another session)
    if (sessionParentId === null) {
      // This is a root session - load its children
      // console.log('[AgentWorkstreamPanel] Loading children for root session:', workstreamId);
      loadSessionChildren({ parentSessionId: workstreamId, workspacePath });
      childrenLoadedRef.current.add(workstreamId);
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

  // Archive worktree dialog hook
  const {
    dialogState: archiveDialogState,
    showDialog: showArchiveDialog,
    closeDialog: closeArchiveDialog,
    confirmArchive,
  } = useArchiveWorktreeDialog();

  // Ref for the content container (used for resize calculations)
  const contentRef = useRef<HTMLDivElement>(null);

  // Ref for the editor area to check focus
  const editorAreaRef = useRef<HTMLDivElement>(null);

  // Ref for the session/transcript area to check focus
  const sessionAreaRef = useRef<HTMLDivElement>(null);

  // Track which panel (editor vs session) was last clicked/focused.
  // Used by CMD+F to determine where to route find, since document.activeElement
  // is unreliable (e.g., clicking a tab bar or non-focusable area doesn't set activeElement
  // inside the editor area). Defaults to 'session' since that's the primary panel.
  const lastFocusedPanelRef = useRef<'editor' | 'session'>('session');

  // For single sessions, activeSessionId should be the session itself
  // For workstreams, activeSessionId should be one of the children
  // We trust the atom state - no fallback that masks bugs

  const handleSessionSelect = useCallback((sessionId: string) => {
    setActiveSession({ workstreamId, sessionId });
  }, [workstreamId, setActiveSession]);

  // Archive a child session
  const handleSessionArchive = useCallback(async (sessionId: string) => {
    try {
      await window.electronAPI.invoke('sessions:update-metadata', sessionId, { isArchived: true });
      updateSessionStore({ sessionId, updates: { isArchived: true } });
    } catch (error) {
      console.error('[AgentWorkstreamPanel] Failed to archive session:', error);
    }
  }, [updateSessionStore]);

  // Unarchive a child session
  const handleSessionUnarchive = useCallback(async (sessionId: string) => {
    try {
      await window.electronAPI.invoke('sessions:update-metadata', sessionId, { isArchived: false });
      updateSessionStore({ sessionId, updates: { isArchived: false } });
    } catch (error) {
      console.error('[AgentWorkstreamPanel] Failed to unarchive session:', error);
    }
  }, [updateSessionStore]);

  // Rename a session
  // If this is a worktree with only one session, also rename the worktree to keep them in sync
  const handleSessionRename = useCallback(async (sessionId: string, newName: string) => {
    try {
      console.log('[AgentWorkstreamPanel] Renaming session', { sessionId, newName, sessionWorktreeId, sessionsLength: sessions.length });
      const result = await window.electronAPI.invoke('sessions:update-metadata', sessionId, { title: newName });
      if (result.success) {
        const now = Date.now();
        updateSessionStore({ sessionId, updates: { title: newName, updatedAt: now } });

        // If this is a single-session worktree, also rename the worktree
        if (sessionWorktreeId && sessions.length === 1) {
          console.log('[AgentWorkstreamPanel] Also renaming worktree', { sessionWorktreeId, newName });
          const worktreeResult = await window.electronAPI.invoke('worktree:update-display-name', sessionWorktreeId, newName);
          console.log('[AgentWorkstreamPanel] Worktree rename result', worktreeResult);
        }
      } else {
        console.error('[AgentWorkstreamPanel] Failed to rename session:', result.error);
      }
    } catch (error) {
      console.error('[AgentWorkstreamPanel] Error renaming session:', error);
    }
  }, [updateSessionStore, sessionWorktreeId, sessions.length]);

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

  // Get document context from the workstream editor tabs (for AI selection/file context)
  // This is called on-demand when sending a message to capture fresh selection state
  const getDocumentContext = useCallback(async (): Promise<SerializableDocumentContext> => {
    const activeTab = editorTabsRef.current?.getActiveTab();
    if (!activeTab) {
      return {
        filePath: undefined,
        content: undefined,
        fileType: undefined,
        textSelection: undefined,
        textSelectionTimestamp: undefined,
      };
    }

    const fileType = detectFileType(activeTab.filePath);

    // Get text selection if it matches the current file
    const textSelectionData = getTextSelection();
    const textSelection = textSelectionData && textSelectionData.filePath === activeTab.filePath
      ? textSelectionData
      : undefined;

    // Get mockup fields if viewing a mockup
    const mockupSelection = fileType === 'mockup' ? (window as any).__mockupSelectedElement : undefined;
    const mockupDrawing = fileType === 'mockup' ? (window as any).__mockupDrawing : undefined;

    return {
      filePath: activeTab.filePath,
      content: activeTab.content,
      fileType,
      textSelection,
      textSelectionTimestamp: textSelection?.timestamp,
      mockupSelection,
      mockupDrawing,
    };
  }, []);

  const handleToggleSidebar = useCallback(() => {
    toggleSidebar(workstreamId);
  }, [workstreamId, toggleSidebar]);

  // Archive dialog handler
  const handleShowArchiveDialog = useCallback(async () => {
    if (!sessionWorktreeId || !worktreePath) return;
    await showArchiveDialog({
      worktreeId: sessionWorktreeId,
      worktreeName: getWorktreeNameFromPath(worktreePath, 'worktree'),
      worktreePath,
    });
  }, [sessionWorktreeId, worktreePath, showArchiveDialog]);

  const handleConfirmArchive = useCallback(async () => {
    await confirmArchive(workspacePath, onWorktreeArchived);
  }, [workspacePath, onWorktreeArchived, confirmArchive]);

  // Get terminal list for checking existing terminals
  const terminals = useAtomValue(terminalListAtom);

  // Open a terminal in the worktree directory (reuses existing if available)
  const handleOpenTerminal = useCallback(async () => {
    if (!sessionWorktreeId || !worktreePath) return;

    // Check if there's already a terminal for this worktree
    const existingTerminal = terminals.find(t => t.worktreeId === sessionWorktreeId);
    if (existingTerminal) {
      // Reuse existing terminal - activate it and show panel
      setActiveTerminal(existingTerminal.id);
      await window.electronAPI.terminal.setActive(workspacePath, existingTerminal.id);
      window.dispatchEvent(new CustomEvent('terminal:show'));
      // Dispatch event to trigger focus animation on the terminal tab
      window.dispatchEvent(new CustomEvent('terminal:focused', {
        detail: { terminalId: existingTerminal.id }
      }));
      return;
    }

    // No existing terminal, create a new one
    try {
      const result = await window.electronAPI.terminal.create(workspacePath, {
        cwd: worktreePath,
        worktreeId: sessionWorktreeId,
        title: `Terminal (${getWorktreeNameFromPath(worktreePath)})`,
        source: 'worktree',
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
  }, [workspacePath, sessionWorktreeId, worktreePath, terminals]);

  // Create a new terminal (for right-click context menu)
  const handleCreateNewTerminal = useCallback(async () => {
    if (!sessionWorktreeId || !worktreePath) return;

    try {
      const result = await window.electronAPI.terminal.create(workspacePath, {
        cwd: worktreePath,
        worktreeId: sessionWorktreeId,
        title: `Terminal (${getWorktreeNameFromPath(worktreePath)})`,
        source: 'worktree',
      });

      if (result.success && result.terminalId) {
        window.dispatchEvent(new CustomEvent('terminal:created', {
          detail: { terminalId: result.terminalId }
        }));
        window.dispatchEvent(new CustomEvent('terminal:show'));
      }
    } catch (error) {
      console.error('[AgentWorkstreamPanel] Failed to create terminal:', error);
    }
  }, [workspacePath, sessionWorktreeId, worktreePath]);

  // Determine what to show based on layout mode
  // Editor tabs are shown in editor and split modes
  const showEditorTabs = layoutMode === 'split' || layoutMode === 'editor';
  // Session tabs are always shown - in editor mode, the transcript is collapsed but tabs + input remain visible
  const showSessionTabs = true;
  // Collapse the transcript content (hide messages) when in editor mode
  const collapseTranscript = layoutMode === 'editor';

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

  // Track which panel was last clicked to route CMD+F correctly.
  // document.activeElement is unreliable because clicking tab bars, non-focusable
  // areas, or scrolling in the editor area doesn't necessarily move activeElement
  // into that area. mousedown on the panel container is a reliable proxy.
  useEffect(() => {
    const editorArea = editorAreaRef.current;
    const sessionArea = sessionAreaRef.current;

    const handleEditorClick = () => { lastFocusedPanelRef.current = 'editor'; };
    const handleSessionClick = () => { lastFocusedPanelRef.current = 'session'; };

    editorArea?.addEventListener('mousedown', handleEditorClick, true);
    sessionArea?.addEventListener('mousedown', handleSessionClick, true);

    return () => {
      editorArea?.removeEventListener('mousedown', handleEditorClick, true);
      sessionArea?.removeEventListener('mousedown', handleSessionClick, true);
    };
  }, [showEditorTabs, showSessionTabs]);

  // Trigger find in the active editor. Two strategies based on editor type:
  // - Monaco: dispatch synthetic Cmd+F keydown to its internal textarea, which
  //   Monaco's keybinding system processes to open its built-in find widget.
  // - Lexical: use SearchReplaceStateManager.toggle() directly (same as Files mode).
  //   We can't use synthetic keydown because Lexical's SearchReplacePlugin checks
  //   isEditorActive (based on React state), which won't be true synchronously
  //   after focusing the contenteditable.
  const triggerEditorFind = useCallback(() => {
    const editorArea = editorAreaRef.current;
    if (!editorArea) {
      console.log('[AgentWorkstreamPanel] triggerEditorFind: no editorArea ref');
      return;
    }

    const monacoTextarea = editorArea.querySelector<HTMLTextAreaElement>('.monaco-editor .inputarea textarea');

    if (monacoTextarea) {
      console.log('[AgentWorkstreamPanel] triggerEditorFind: dispatching to Monaco textarea');
      monacoTextarea.focus();
      monacoTextarea.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'f', code: 'KeyF', metaKey: true,
        bubbles: true, cancelable: true,
      }));
    } else {
      // Lexical or other editor - use SearchReplaceStateManager
      const activeFilePath = editorTabsRef.current?.getActiveFilePath();
      if (activeFilePath) {
        console.log('[AgentWorkstreamPanel] triggerEditorFind: toggling SearchReplaceStateManager for', activeFilePath);
        SearchReplaceStateManager.toggle(activeFilePath);
      } else {
        console.log('[AgentWorkstreamPanel] triggerEditorFind: no active file path');
      }
    }
  }, []);

  // Dispatch find-next/find-prev keyboard events to the active editor.
  // These only work when the editor already has focus (find dialog is open).
  const dispatchEditorKeyEvent = useCallback((key: string, code: string, meta: boolean, shift = false) => {
    const editorArea = editorAreaRef.current;
    if (!editorArea) return;

    const monacoTextarea = editorArea.querySelector<HTMLTextAreaElement>('.monaco-editor .inputarea textarea');
    const target = monacoTextarea || document;

    target.dispatchEvent(new KeyboardEvent('keydown', {
      key, code, metaKey: meta, shiftKey: shift,
      bubbles: true, cancelable: true,
    }));
  }, []);

  // Handle CMD+F routing based on which panel was last interacted with.
  // Editor panel: triggerEditorFind handles Monaco vs Lexical differently.
  // Session panel: dispatch transcript:find CustomEvent.
  useEffect(() => {
    const handleFind = () => {
      const activeFilePath = editorTabsRef.current?.getActiveFilePath();
      const editorIsTarget = lastFocusedPanelRef.current === 'editor' && activeFilePath;

      console.log('[AgentWorkstreamPanel] handleFind: lastFocusedPanel=' + lastFocusedPanelRef.current +
        ' activeFilePath=' + activeFilePath + ' activeSessionId=' + activeSessionId);

      if (editorIsTarget) {
        triggerEditorFind();
      } else if (activeSessionId) {
        window.dispatchEvent(new CustomEvent('transcript:find', {
          detail: { sessionId: activeSessionId }
        }));
      }
    };

    const handleFindNext = () => {
      if (lastFocusedPanelRef.current === 'editor' && editorTabsRef.current?.getActiveFilePath()) {
        dispatchEditorKeyEvent('g', 'KeyG', true);
      } else if (activeSessionId) {
        window.dispatchEvent(new CustomEvent('transcript:find-next', {
          detail: { sessionId: activeSessionId }
        }));
      }
    };

    const handleFindPrevious = () => {
      if (lastFocusedPanelRef.current === 'editor' && editorTabsRef.current?.getActiveFilePath()) {
        dispatchEditorKeyEvent('g', 'KeyG', true, true);
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
  }, [activeSessionId, triggerEditorFind, dispatchEditorKeyEvent]);

  // Expose ref methods
  useImperativeHandle(ref, () => ({
    closeActiveTab: () => {
      // Only close editor tabs if the editor panel was last focused
      if (lastFocusedPanelRef.current === 'editor' && editorTabsRef.current) {
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
          onCreateNewTerminal={sessionWorktreeId ? handleCreateNewTerminal : undefined}
          onShowArchiveDialog={sessionWorktreeId ? handleShowArchiveDialog : undefined}
          onArchiveStatusChange={onWorktreeArchived}
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
            <div ref={sessionAreaRef} className={`agent-workstream-session-area flex flex-col overflow-hidden ${collapseTranscript ? 'shrink-0' : 'flex-1 min-h-0'} ${layoutMode === 'transcript' ? 'maximized' : ''}`}>
              <WorkstreamSessionTabs
                workspacePath={workspacePath}
                workstreamId={workstreamId}
                sessions={sessions}
                activeSessionId={activeSessionId}
                onSessionSelect={handleSessionSelect}
                onFileClick={handleFileClick}
                worktreeId={sessionWorktreeId}
                onAddSessionToWorktree={onAddSessionToWorktree}
                onCreateWorktreeSession={onCreateWorktreeSession}
                onSessionArchive={handleSessionArchive}
                onSessionUnarchive={handleSessionUnarchive}
                onSessionRename={handleSessionRename}
                getDocumentContext={getDocumentContext}
                collapseTranscript={collapseTranscript}
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
          onOpenInFilesMode={onFileOpen}
          width={sidebarWidth}
          worktreeId={sessionWorktreeId}
          worktreePath={worktreePath}
          onWorktreeArchived={onWorktreeArchived}
          isGitRepo={isGitRepo}
        />
      )}

      {/* Archive worktree confirmation dialog */}
      {archiveDialogState && (
        <ArchiveWorktreeDialog
          worktreeName={archiveDialogState.worktreeName}
          onArchive={handleConfirmArchive}
          onKeep={closeArchiveDialog}
          hasUncommittedChanges={archiveDialogState.hasUncommittedChanges}
          uncommittedFileCount={archiveDialogState.uncommittedFileCount}
        />
      )}
    </div>
  );
}));

AgentWorkstreamPanel.displayName = 'AgentWorkstreamPanel';
