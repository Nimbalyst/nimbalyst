import React, { useState, useCallback, useEffect, useRef, memo } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { MaterialSymbol, ProviderIcon } from '@nimbalyst/runtime';
import { getRelativeTimeString } from '../../utils/dateFormatting';
import { sessionOrChildProcessingAtom, sessionUnreadAtom, sessionPendingPromptAtom, reparentSessionAtom, refreshSessionListAtom } from '../../store';
import './SessionListItem.css';

/**
 * Combined status indicator that subscribes to this session's state atoms.
 * Shows processing, pending prompt, or unread status (in priority order).
 * Only this component re-renders when the session's state changes.
 */
const SessionStatusIndicator = memo<{ sessionId: string; messageCount?: number }>(({ sessionId, messageCount }) => {
  // Use aggregated atom that checks this session AND any children (for workstreams)
  const isProcessing = useAtomValue(sessionOrChildProcessingAtom(sessionId));
  const hasPendingPrompt = useAtomValue(sessionPendingPromptAtom(sessionId));
  const hasUnread = useAtomValue(sessionUnreadAtom(sessionId));

  // Priority: processing > pending prompt > unread > message count
  if (isProcessing) {
    return (
      <div className="session-list-item-status processing" title="Processing...">
        <MaterialSymbol icon="progress_activity" size={14} />
      </div>
    );
  }

  if (hasPendingPrompt) {
    return (
      <div className="session-list-item-status pending-prompt" title="Waiting for your response">
        <MaterialSymbol icon="help" size={14} />
      </div>
    );
  }

  if (hasUnread) {
    return (
      <div className="session-list-item-status unread" title="Unread response">
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
      className={`session-list-item ${isActive ? 'active' : ''} ${isLoaded ? 'loaded' : ''} ${isArchived ? 'archived' : ''} ${isSelected ? 'selected' : ''} ${isPinned ? 'pinned' : ''} ${isDragging ? 'dragging' : ''} ${isValidDropTarget ? 'drop-target-valid' : ''}`}
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
      <div className={`session-list-item-icon ${sessionType === 'terminal' ? 'terminal-icon' : ''} ${isWorkstream ? 'workstream-icon' : ''}`}>
        {sessionType === 'terminal' ? (
          <MaterialSymbol icon="terminal" size={16} />
        ) : isWorkstream ? (
          <MaterialSymbol icon="account_tree" size={16} />
        ) : (
          <ProviderIcon provider={provider || 'claude'} size={16} />
        )}
        {isLoaded && !isActive && (
          <div className="session-list-item-loaded-indicator" title="Loaded in tab" />
        )}
      </div>
      {isPinned && (
        <MaterialSymbol icon="push_pin" size={12} className="session-list-item-pin-icon" />
      )}
      {branchedAt && (
        <MaterialSymbol icon="fork_right" size={12} className="session-list-item-branch-icon" title="Branched conversation" />
      )}
      <div className="session-list-item-content">
        {isRenaming ? (
          <input
            ref={renameInputRef}
            type="text"
            className="session-list-item-rename-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={handleRenameSubmit}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <>
            <div className="session-list-item-title">{truncatedTitle}</div>
            <div className="session-list-item-meta">
              <span className="session-list-item-datetime" title={fullDateTime}>{relativeTime}</span>
              {displayModel && <span className="session-list-item-model">{displayModel}</span>}
            </div>
          </>
        )}
      </div>
      <div className="session-list-item-right">
        {uncommittedCount !== undefined && uncommittedCount > 0 && (
          <span className="session-list-item-badge uncommitted" title={`${uncommittedCount} uncommitted change${uncommittedCount !== 1 ? 's' : ''}`}>
            {uncommittedCount}
          </span>
        )}
        <SessionStatusIndicator sessionId={id} messageCount={messageCount} />
        {(onArchive || onUnarchive) && (
          <button
            className={`session-list-item-archive ${isHovering ? 'visible' : ''}`}
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
          className="session-list-item-context-menu"
          style={{
            left: (adjustedContextMenuPosition || contextMenuPosition).x,
            top: (adjustedContextMenuPosition || contextMenuPosition).y
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {onRename && (
            <button
              className="session-list-item-context-menu-item"
              onClick={handleRenameClick}
            >
              <MaterialSymbol icon="edit" size={14} />
              Rename
            </button>
          )}
          {onPinToggle && (
            <button
              className="session-list-item-context-menu-item"
              onClick={handlePinToggle}
            >
              <MaterialSymbol icon="push_pin" size={14} />
              {isPinned ? 'Unpin' : 'Pin'}
            </button>
          )}
          {onBranch && (
            <button
              className="session-list-item-context-menu-item"
              onClick={handleBranch}
            >
              <MaterialSymbol icon="fork_right" size={14} />
              Branch conversation
            </button>
          )}
          <button
            className="session-list-item-context-menu-item"
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
              className="session-list-item-context-menu-item destructive"
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
