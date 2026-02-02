import React, { useState, useCallback, useEffect, useRef, memo } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { MaterialSymbol, ProviderIcon } from '@nimbalyst/runtime';
import { getRelativeTimeString } from '../../utils/dateFormatting';
import { sessionOrChildProcessingAtom, sessionUnreadAtom, sessionPendingPromptAtom, sessionWaitingForQuestionAtom, sessionWaitingForPlanApprovalAtom, reparentSessionAtom, refreshSessionListAtom } from '../../store';

/**
 * Combined status indicator that subscribes to this session's state atoms.
 * Shows waiting for input, processing, pending prompt, or unread status (in priority order).
 * Only this component re-renders when the session's state changes.
 */
const SessionStatusIndicator = memo<{ sessionId: string; messageCount?: number }>(({ sessionId, messageCount }) => {
  // Use aggregated atom that checks this session AND any children (for workstreams)
  const isWaitingForQuestion = useAtomValue(sessionWaitingForQuestionAtom(sessionId));
  const isWaitingForPlanApproval = useAtomValue(sessionWaitingForPlanApprovalAtom(sessionId));
  const isProcessing = useAtomValue(sessionOrChildProcessingAtom(sessionId));
  const hasPendingPrompt = useAtomValue(sessionPendingPromptAtom(sessionId));
  const hasUnread = useAtomValue(sessionUnreadAtom(sessionId));

  // Priority: waiting for input > processing > pending prompt > unread > message count
  // Both AskUserQuestion and ExitPlanMode show the same "waiting for input" indicator
  if (isWaitingForQuestion || isWaitingForPlanApproval) {
    const title = isWaitingForQuestion ? 'Waiting for your answer' : 'Waiting for plan approval';
    return (
      <div className="session-list-item-status waiting-for-input flex items-center justify-center w-5 h-5 text-[var(--nim-warning)] animate-pulse" title={title}>
        <MaterialSymbol icon="contact_support" size={14} />
      </div>
    );
  }

  if (isProcessing) {
    return (
      <div className="session-list-item-status processing flex items-center justify-center w-5 h-5 text-[var(--nim-primary)] opacity-80" title="Processing...">
        <MaterialSymbol icon="progress_activity" size={14} className="animate-spin" />
      </div>
    );
  }

  if (hasPendingPrompt) {
    return (
      <div className="session-list-item-status pending-prompt flex items-center justify-center w-5 h-5 text-[var(--nim-warning)] animate-pulse" title="Waiting for your response">
        <MaterialSymbol icon="help" size={14} />
      </div>
    );
  }

  if (hasUnread) {
    return (
      <div className="session-list-item-status unread flex items-center justify-center w-5 h-5 text-[var(--nim-primary)]" title="Unread response">
        <MaterialSymbol icon="circle" size={8} fill />
      </div>
    );
  }

  // if (messageCount !== undefined) {
  //   return <span className="session-list-item-message-count">{messageCount}</span>;
  // }

  return null;
});

interface SessionListItemProps {
  id: string;
  title: string;
  createdAt: number;
  updatedAt?: number;
  isActive: boolean;
  isLoaded?: boolean; // Whether session is loaded in a tab
  /** @deprecated Uses Jotai atom subscription - do not pass */
  isProcessing?: boolean;
  /** @deprecated Uses Jotai atom subscription - do not pass */
  hasUnread?: boolean;
  /** @deprecated Uses Jotai atom subscription - do not pass */
  hasPendingPrompt?: boolean;
  isArchived?: boolean; // Whether session is archived
  isPinned?: boolean; // Whether session is pinned to the top
  isSelected?: boolean; // Whether session is selected for bulk actions
  sortBy?: 'updated' | 'created'; // Which timestamp to display based on sort order
  onClick: (e: React.MouseEvent) => void;
  onDelete?: () => void;
  onArchive?: () => void;
  onUnarchive?: () => void;
  onRename?: (newName: string) => void; // Callback when session is renamed
  onPinToggle?: (isPinned: boolean) => void; // Callback when pin status changes
  onBranch?: () => void; // Callback when user wants to branch this session
  provider?: string;
  model?: string;
  messageCount?: number;
  sessionType?: 'chat' | 'planning' | 'coding' | 'terminal'; // Type of session
  isWorkstream?: boolean; // Whether this session is a workstream (has children)
  isWorktreeSession?: boolean; // Whether this session belongs to a worktree (shows worktree icon)
  parentSessionId?: string | null; // Parent session ID for hierarchical workstreams
  projectPath?: string; // Workspace path for drag-drop validation
  uncommittedCount?: number; // Number of uncommitted files in this session
  branchedAt?: number; // Timestamp when this session was branched (branch tracking)
}

export const SessionListItem: React.FC<SessionListItemProps> = ({
  id,
  title,
  createdAt,
  updatedAt,
  isActive,
  isLoaded = false,
  isProcessing = false,
  hasUnread = false,
  hasPendingPrompt = false,
  isArchived = false,
  isPinned = false,
  isSelected = false,
  sortBy = 'updated',
  onClick,
  onDelete,
  onArchive,
  onUnarchive,
  onRename,
  onPinToggle,
  onBranch,
  provider,
  model,
  messageCount,
  sessionType,
  isWorkstream = false,
  isWorktreeSession = false,
  parentSessionId = null,
  projectPath,
  uncommittedCount,
  branchedAt,
}) => {
  const [isHovering, setIsHovering] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const [adjustedContextMenuPosition, setAdjustedContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isValidDropTarget, setIsValidDropTarget] = useState(false);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Atom setters for drag-drop
  const reparentSession = useSetAtom(reparentSessionAtom);
  const refreshSessionList = useSetAtom(refreshSessionListAtom);

  // Determine if this session can be dragged
  // Can drag if: (1) Has a parent (is a child session), OR (2) Is an orphan (no parent, no children)
  const isDraggable = parentSessionId !== null || !isWorkstream;

  // Determine if this session can accept drops (only workstreams can be drop targets)
  const isDropTarget = isWorkstream;

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowContextMenu(false);
    if (onDelete) {
      onDelete();
    }
  };

  const handleArchiveToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowContextMenu(false);
    if (isArchived && onUnarchive) {
      onUnarchive();
    } else if (!isArchived && onArchive) {
      onArchive();
    }
  };

  const handlePinToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowContextMenu(false);
    if (onPinToggle) {
      onPinToggle(!isPinned);
    }
  };

  const handleBranch = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowContextMenu(false);
    if (onBranch) {
      onBranch();
    }
  };

  const handleCopySessionId = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowContextMenu(false);
    navigator.clipboard.writeText(id);
  };

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setShowContextMenu(false);
    setAdjustedContextMenuPosition(null);
    setIsRenaming(false);
  }, []);

  const handleRenameClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowContextMenu(false);
    setRenameValue(title);
    setIsRenaming(true);
  };

  const handleRenameSubmit = () => {
    const trimmedValue = renameValue.trim();
    if (trimmedValue && trimmedValue !== title && onRename) {
      onRename(trimmedValue);
    }
    setIsRenaming(false);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRenameSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsRenaming(false);
    }
  };

  // Drag-and-drop handlers
  const handleDragStart = useCallback((e: React.DragEvent) => {
    if (!isDraggable || !projectPath) {
      e.preventDefault();
      return;
    }

    const dragData = {
      sessionId: id,
      parentId: parentSessionId,
      workspacePath: projectPath,
    };

    e.dataTransfer.setData('application/x-nimbalyst-session', JSON.stringify(dragData));
    e.dataTransfer.effectAllowed = 'move';
    setIsDragging(true);
  }, [isDraggable, id, parentSessionId, projectPath]);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!isDropTarget) return;

    // Check if dragging a session
    const hasSessionData = e.dataTransfer.types.includes('application/x-nimbalyst-session');
    if (!hasSessionData) return;

    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsValidDropTarget(true);
  }, [isDropTarget]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear drop target if actually leaving the element
    // (not when entering a child element)
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (!e.currentTarget.contains(relatedTarget)) {
      setIsValidDropTarget(false);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsValidDropTarget(false);

    const dataStr = e.dataTransfer.getData('application/x-nimbalyst-session');
    if (!dataStr || !projectPath) return;

    try {
      const { sessionId, parentId, workspacePath } = JSON.parse(dataStr);

      // Validate same workspace
      if (workspacePath !== projectPath) {
        console.error('[SessionListItem] Cannot move session between workspaces');
        return;
      }

      // Validate not dropping on self
      if (sessionId === id) {
        console.error('[SessionListItem] Cannot drop session on itself');
        return;
      }

      // Validate not dropping on current parent (no-op)
      if (parentId === id) {
        console.log('[SessionListItem] Session already belongs to this workstream');
        return;
      }

      // Execute reparent
      console.log(`[SessionListItem] Reparenting session ${sessionId} from ${parentId} to ${id}`);
      const success = await reparentSession({
        sessionId,
        oldParentId: parentId,
        newParentId: id,
        workspacePath: projectPath,
      });

      if (success) {
        // Refresh session list to ensure consistency
        await refreshSessionList();

        // Track analytics
        if (window.electronAPI) {
          await window.electronAPI.invoke('analytics:track', {
            event: 'session_reparented',
            properties: {
              had_previous_parent: parentId !== null,
              workspace_path: projectPath,
            },
          });
        }
      }
    } catch (error) {
      console.error('[SessionListItem] Failed to handle drop:', error);
    }
  }, [projectPath, id, reparentSession, refreshSessionList]);

  // Auto-focus and select text when rename input appears
  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  // Adjust context menu position to keep it within viewport
  useEffect(() => {
    if (showContextMenu && contextMenuRef.current) {
      const rect = contextMenuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let newX = contextMenuPosition.x;
      let newY = contextMenuPosition.y;

      // If menu extends beyond right edge, shift it left
      if (contextMenuPosition.x + rect.width > viewportWidth) {
        newX = contextMenuPosition.x - rect.width;
      }
      // If menu extends beyond bottom edge, shift it up
      if (contextMenuPosition.y + rect.height > viewportHeight) {
        newY = contextMenuPosition.y - rect.height;
      }

      // Ensure menu doesn't go off the left or top edge
      newX = Math.max(0, newX);
      newY = Math.max(0, newY);

      if (newX !== contextMenuPosition.x || newY !== contextMenuPosition.y) {
        setAdjustedContextMenuPosition({ x: newX, y: newY });
      }
    }
  }, [showContextMenu, contextMenuPosition]);

  // Get the first line of the title (truncate if too long)
  const displayTitle = title || 'Untitled Session';
  const truncatedTitle = displayTitle.length > 40
    ? displayTitle.substring(0, 40) + '...'
    : displayTitle;

  // Show timestamp based on current sort order
  const timestamp = sortBy === 'updated' ? (updatedAt || createdAt) : createdAt;
  const relativeTime = getRelativeTimeString(timestamp);
  const timestampLabel = sortBy === 'updated' ? 'updated' : 'created';

  // Format the full datetime for display in local timezone
  const fullDateTime = new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short'
  });

  // Extract model ID from provider:model format
  const displayModel = model?.includes(':') ? model.split(':')[1] : model;

  return (
    <div
        id={"session-list-item-" + id}
      className={`session-list-item relative flex items-start gap-2.5 py-1 px-3 pl-8 cursor-pointer rounded mx-2 transition-[background-color,opacity] duration-150 select-none
        hover:bg-[var(--nim-bg-hover)]
        focus:outline-2 focus:outline-[var(--nim-border-focus)] focus:-outline-offset-2
        ${isActive ? 'active bg-[var(--nim-bg-selected)]' : ''}
        ${isLoaded ? 'loaded' : ''}
        ${isArchived ? 'archived opacity-60 hover:opacity-80' : ''}
        ${isSelected ? 'selected bg-[var(--nim-bg-selected)]' : ''}
        ${isPinned ? 'pinned' : ''}
        ${isDragging ? 'dragging opacity-50 cursor-grabbing' : ''}
        ${isValidDropTarget ? 'drop-target-valid bg-[rgba(83,89,93,0.4)] border-2 border-dashed border-[var(--nim-primary)]' : ''}
        ${isDraggable ? 'cursor-grab' : ''}
      `}
      onClick={onClick}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => { setIsHovering(false); setShowContextMenu(false); }}
      onContextMenu={handleContextMenu}
      draggable={isDraggable}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(e as unknown as React.MouseEvent);
        }
      }}
      aria-label={`Session: ${truncatedTitle}, ${timestampLabel} ${relativeTime}${isLoaded ? ' (loaded in tab)' : ''}${isArchived ? ' (archived)' : ''}`}
      aria-current={isActive ? 'page' : undefined}
    >
      <div className={`session-list-item-icon shrink-0 mt-0.5 text-[var(--nim-text-muted)] flex items-center relative ${isActive ? '[&]:text-[var(--nim-primary)] [&_svg]:text-[var(--nim-primary)]' : '[&_svg]:text-[var(--nim-text-muted)]'} ${sessionType === 'terminal' ? 'terminal-icon' : ''} ${isWorkstream ? 'workstream-icon' : ''} ${isWorktreeSession ? 'worktree-icon' : ''}`}>
        {sessionType === 'terminal' ? (
          <MaterialSymbol icon="terminal" size={16} />
        ) : isWorktreeSession ? (
          // Worktree icon (git branching visual)
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="3" y="2" width="3" height="3" rx="0.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
            <rect x="10" y="2" width="3" height="3" rx="0.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
            <rect x="3" y="11" width="3" height="3" rx="0.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
            <path d="M4.5 5v3.5a1.5 1.5 0 0 0 1.5 1.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M11.5 5v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        ) : isWorkstream ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="8" cy="4" r="1.5" fill="currentColor"/>
            <circle cx="4" cy="12" r="1.5" fill="currentColor"/>
            <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
            <line x1="7.5" y1="5.2" x2="4.5" y2="10.8" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
            <line x1="8.5" y1="5.2" x2="11.5" y2="10.8" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
          </svg>
        ) : (
          <ProviderIcon provider={provider || 'claude'} size={16} />
        )}
      </div>
      {isPinned && (
        <MaterialSymbol icon="push_pin" size={12} className={`session-list-item-pin-icon shrink-0 -ml-1 opacity-70 ${isActive ? 'text-[var(--nim-primary)] opacity-80' : 'text-[var(--nim-text-faint)]'}`} />
      )}
      {branchedAt && (
        <MaterialSymbol icon="fork_right" size={12} className={`session-list-item-branch-icon shrink-0 -ml-1 opacity-60 ${isActive ? 'text-[var(--nim-primary)] opacity-70' : 'text-[var(--nim-text-faint)]'}`} title="Branched conversation" />
      )}
      <div className="session-list-item-content flex-1 min-w-0 overflow-hidden">
        {isRenaming ? (
          <input
            ref={renameInputRef}
            type="text"
            className="session-list-item-rename-input w-full px-2 py-1 text-[0.8125rem] font-medium border border-[var(--nim-primary)] rounded bg-[var(--nim-bg)] text-[var(--nim-text)] outline-none box-border"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={handleRenameSubmit}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <>
            <div className={`session-list-item-title text-[0.8125rem] text-[var(--nim-text)] font-medium overflow-hidden text-ellipsis whitespace-nowrap mb-0.5 transition-colors duration-150 ${isActive ? 'font-semibold' : ''} ${isArchived ? 'text-[var(--nim-text-faint)]' : ''}`}>{truncatedTitle}</div>
            <div className="session-list-item-meta flex gap-1.5 text-[0.6875rem] text-[var(--nim-text-faint)] items-center mt-0.5">
              <span className="session-list-item-datetime text-[0.6875rem] text-[var(--nim-text-faint)] whitespace-nowrap transition-colors duration-150" title={fullDateTime}>{relativeTime}</span>
              {displayModel && <span className="session-list-item-model overflow-hidden text-ellipsis whitespace-nowrap">{displayModel}</span>}
            </div>
          </>
        )}
      </div>
      <div className="session-list-item-right shrink-0 flex items-center gap-1.5 ml-auto">
        {uncommittedCount !== undefined && uncommittedCount > 0 && (
          <span className="session-list-item-badge uncommitted text-[0.6875rem] px-1.5 py-0.5 rounded-xl font-semibold whitespace-nowrap bg-[rgba(245,158,11,0.15)] text-[var(--nim-warning)]" title={`${uncommittedCount} uncommitted change${uncommittedCount !== 1 ? 's' : ''}`}>
            {uncommittedCount}
          </span>
        )}
        <SessionStatusIndicator sessionId={id} messageCount={messageCount} />
        {(onArchive || onUnarchive) && (
          <button
            className={`session-list-item-archive shrink-0 flex items-center justify-center w-5 h-5 p-0 bg-transparent border-none rounded text-[var(--nim-text-faint)] cursor-pointer transition-all duration-150 focus:outline-2 focus:outline-[var(--nim-border-focus)] focus:outline-offset-1
              ${isHovering ? 'visible opacity-70 pointer-events-auto hover:bg-[var(--nim-bg-tertiary)] hover:text-[var(--nim-text)] hover:opacity-100' : 'opacity-0 pointer-events-none'}
              disabled:cursor-default disabled:opacity-0 disabled:pointer-events-none
            `}
            onClick={handleArchiveToggle}
            aria-label={isArchived ? `Unarchive ${isWorkstream ? 'workstream' : 'session'}` : `Archive ${isWorkstream ? 'workstream' : 'session'}`}
            title={isArchived ? `Unarchive ${isWorkstream ? 'workstream' : 'session'}` : `Archive ${isWorkstream ? 'workstream' : 'session'}`}
          >
            {isArchived ? (
              <MaterialSymbol icon="unarchive" size={14} />
            ) : (
              <MaterialSymbol icon="archive" size={14} />
            )}
          </button>
        )}
      </div>

      {/* Context Menu */}
      {showContextMenu && (
        <div
          ref={contextMenuRef}
          className="session-list-item-context-menu fixed z-[1000] min-w-[140px] p-1 bg-[var(--nim-bg)] border border-[var(--nim-border)] rounded-md shadow-[0_4px_12px_rgba(0,0,0,0.15)]"
          style={{
            left: (adjustedContextMenuPosition || contextMenuPosition).x,
            top: (adjustedContextMenuPosition || contextMenuPosition).y
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {onRename && (
            <button
              className="session-list-item-context-menu-item flex items-center gap-2 w-full px-2.5 py-2 bg-transparent border-none rounded text-[var(--nim-text)] text-[0.8125rem] cursor-pointer text-left transition-colors duration-150 hover:bg-[var(--nim-bg-hover)] [&_svg]:shrink-0"
              onClick={handleRenameClick}
            >
              <MaterialSymbol icon="edit" size={14} />
              Rename
            </button>
          )}
          {onPinToggle && (
            <button
              className="session-list-item-context-menu-item flex items-center gap-2 w-full px-2.5 py-2 bg-transparent border-none rounded text-[var(--nim-text)] text-[0.8125rem] cursor-pointer text-left transition-colors duration-150 hover:bg-[var(--nim-bg-hover)] [&_svg]:shrink-0"
              onClick={handlePinToggle}
            >
              <MaterialSymbol icon="push_pin" size={14} />
              {isPinned ? 'Unpin' : 'Pin'}
            </button>
          )}
          {onBranch && (
            <button
              className="session-list-item-context-menu-item flex items-center gap-2 w-full px-2.5 py-2 bg-transparent border-none rounded text-[var(--nim-text)] text-[0.8125rem] cursor-pointer text-left transition-colors duration-150 hover:bg-[var(--nim-bg-hover)] [&_svg]:shrink-0"
              onClick={handleBranch}
            >
              <MaterialSymbol icon="fork_right" size={14} />
              Branch conversation
            </button>
          )}
          <button
            className="session-list-item-context-menu-item flex items-center gap-2 w-full px-2.5 py-2 bg-transparent border-none rounded text-[var(--nim-text)] text-[0.8125rem] cursor-pointer text-left transition-colors duration-150 hover:bg-[var(--nim-bg-hover)] [&_svg]:shrink-0"
            onClick={handleCopySessionId}
          >
            <MaterialSymbol icon="content_copy" size={14} />
            Copy Session ID
          </button>
          <button
            className="session-list-item-context-menu-item flex items-center gap-2 w-full px-2.5 py-2 bg-transparent border-none rounded text-[var(--nim-text)] text-[0.8125rem] cursor-pointer text-left transition-colors duration-150 hover:bg-[var(--nim-bg-hover)] [&_svg]:shrink-0"
            onClick={handleArchiveToggle}
          >
            {isArchived ? (
              <>
                <MaterialSymbol icon="unarchive" size={14} />
                Unarchive {isWorkstream ? 'Workstream' : 'Session'}
              </>
            ) : (
              <>
                <MaterialSymbol icon="archive" size={14} />
                Archive {isWorkstream ? 'Workstream' : 'Session'}
              </>
            )}
          </button>
          {onDelete && (
            <button
              className="session-list-item-context-menu-item destructive flex items-center gap-2 w-full px-2.5 py-2 bg-transparent border-none rounded text-[var(--nim-error)] text-[0.8125rem] cursor-pointer text-left transition-colors duration-150 hover:bg-[var(--nim-error)] hover:text-white [&_svg]:shrink-0"
              onClick={handleDelete}
            >
              <MaterialSymbol icon="delete" size={14} />
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
};
