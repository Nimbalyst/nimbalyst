import React, { useState, useCallback, useEffect, useRef, memo } from 'react';
import { useAtomValue } from 'jotai';
import { MaterialSymbol, ProviderIcon } from '@nimbalyst/runtime';
import { getRelativeTimeString } from '../../utils/dateFormatting';
import { sessionProcessingAtom, sessionUnreadAtom, sessionPendingPromptAtom } from '../../store';
import './SessionListItem.css';

/**
 * Combined status indicator that subscribes to this session's state atoms.
 * Shows processing, pending prompt, or unread status (in priority order).
 * Only this component re-renders when the session's state changes.
 */
const SessionStatusIndicator = memo<{ sessionId: string; messageCount?: number }>(({ sessionId, messageCount }) => {
  const isProcessing = useAtomValue(sessionProcessingAtom(sessionId));
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

  if (messageCount !== undefined) {
    return <span className="session-list-item-message-count">{messageCount}</span>;
  }

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
  provider?: string;
  model?: string;
  messageCount?: number;
  sessionType?: 'chat' | 'planning' | 'coding' | 'terminal'; // Type of session
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
  provider,
  model,
  messageCount,
  sessionType
}) => {
  const [isHovering, setIsHovering] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const [adjustedContextMenuPosition, setAdjustedContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

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
      className={`session-list-item ${isActive ? 'active' : ''} ${isLoaded ? 'loaded' : ''} ${isArchived ? 'archived' : ''} ${isSelected ? 'selected' : ''} ${isPinned ? 'pinned' : ''}`}
      onClick={onClick}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => { setIsHovering(false); setShowContextMenu(false); }}
      onContextMenu={handleContextMenu}
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
      <div className={`session-list-item-icon ${sessionType === 'terminal' ? 'terminal-icon' : ''}`}>
        {sessionType === 'terminal' ? (
          <MaterialSymbol icon="terminal" size={16} />
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
        <SessionStatusIndicator sessionId={id} messageCount={messageCount} />
        {(onArchive || onUnarchive) && (
          <button
            className={`session-list-item-archive ${isHovering ? 'visible' : ''}`}
            onClick={handleArchiveToggle}
            aria-label={isArchived ? "Unarchive session" : "Archive session"}
            title={isArchived ? "Unarchive session" : "Archive session"}
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
          <button
            className="session-list-item-context-menu-item"
            onClick={handleArchiveToggle}
          >
            {isArchived ? (
              <>
                <MaterialSymbol icon="unarchive" size={14} />
                Unarchive
              </>
            ) : (
              <>
                <MaterialSymbol icon="archive" size={14} />
                Archive
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
