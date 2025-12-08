import React, { useState, useCallback, useEffect, useRef } from 'react';
import { MaterialSymbol, ProviderIcon } from '@nimbalyst/runtime';
import { getRelativeTimeString } from '../../utils/dateFormatting';
import './SessionListItem.css';

interface SessionListItemProps {
  id: string;
  title: string;
  createdAt: number;
  updatedAt?: number;
  isActive: boolean;
  isLoaded?: boolean; // Whether session is loaded in a tab
  isProcessing?: boolean; // Whether session is actively processing
  hasUnread?: boolean; // Whether session has unread messages
  isArchived?: boolean; // Whether session is archived
  isSelected?: boolean; // Whether session is selected for bulk actions
  sortBy?: 'updated' | 'created'; // Which timestamp to display based on sort order
  onClick: (e: React.MouseEvent) => void;
  onDelete?: () => void;
  onArchive?: () => void;
  onUnarchive?: () => void;
  provider?: string;
  model?: string;
  messageCount?: number;
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
  isArchived = false,
  isSelected = false,
  sortBy = 'updated',
  onClick,
  onDelete,
  onArchive,
  onUnarchive,
  provider,
  model,
  messageCount
}) => {
  const [isHovering, setIsHovering] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const [adjustedContextMenuPosition, setAdjustedContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

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

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setShowContextMenu(false);
    setAdjustedContextMenuPosition(null);
  }, []);

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
      className={`session-list-item ${isActive ? 'active' : ''} ${isLoaded ? 'loaded' : ''} ${isArchived ? 'archived' : ''} ${isSelected ? 'selected' : ''}`}
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
      <div className="session-list-item-icon">
        <ProviderIcon provider={provider || 'claude'} size={16} />
        {isLoaded && !isActive && (
          <div className="session-list-item-loaded-indicator" title="Loaded in tab" />
        )}
      </div>
      <div className="session-list-item-content">
        <div className="session-list-item-title">{truncatedTitle}</div>
        <div className="session-list-item-meta">
          <span className="session-list-item-datetime">{fullDateTime}</span>
          {displayModel && <span className="session-list-item-model">{displayModel}</span>}
        </div>
      </div>
      <div className="session-list-item-right">
        {isProcessing ? (
          <div className="session-list-item-status processing" title="Processing...">
            <MaterialSymbol icon="progress_activity" size={14} />
          </div>
        ) : hasUnread ? (
          <div className="session-list-item-status unread" title="Unread response">
            <MaterialSymbol icon="circle" size={8} fill />
          </div>
        ) : messageCount !== undefined ? (
          <span className="session-list-item-message-count">{messageCount}</span>
        ) : null}
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
