import React, { useState, useCallback, useEffect, useRef } from 'react';
import { getRelativeTimeString } from '../../utils/dateFormatting';
import { ProviderIcon } from '../icons/ProviderIcons';
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

  // Use updatedAt if available, otherwise fall back to createdAt
  const timestamp = updatedAt || createdAt;
  const relativeTime = getRelativeTimeString(timestamp);

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
          onClick();
        }
      }}
      aria-label={`Session: ${truncatedTitle}, created ${relativeTime}${isLoaded ? ' (loaded in tab)' : ''}${isArchived ? ' (archived)' : ''}`}
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
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32 16" strokeLinecap="round">
                <animateTransform
                  attributeName="transform"
                  type="rotate"
                  from="0 12 12"
                  to="360 12 12"
                  dur="1s"
                  repeatCount="indefinite"
                />
              </circle>
            </svg>
          </div>
        ) : hasUnread ? (
          <div className="session-list-item-status unread" title="Unread response">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="8" cy="8" r="4" fill="currentColor" />
            </svg>
          </div>
        ) : messageCount !== undefined ? (
          <span className="session-list-item-message-count">{messageCount}</span>
        ) : null}
        {(onArchive || onUnarchive) && (
          <button
            className={`session-list-item-archive ${isHovering && !isActive ? 'visible' : ''}`}
            onClick={handleArchiveToggle}
            aria-label={isArchived ? "Unarchive session" : "Archive session"}
            title={isArchived ? "Unarchive session" : "Archive session"}
            disabled={isActive}
          >
            {isArchived ? (
              // Unarchive icon (box with arrow out)
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 5h12M4 5v8a1 1 0 001 1h6a1 1 0 001-1V5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M8 11V7M6 9l2-2 2 2" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            ) : (
              // Archive icon (box with arrow in)
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 5h12M4 5v8a1 1 0 001 1h6a1 1 0 001-1V5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M8 7v4M6 9l2 2 2-2" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
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
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M2 5h12M4 5v8a1 1 0 001 1h6a1 1 0 001-1V5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M8 11V7M6 9l2-2 2 2" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Unarchive
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M2 5h12M4 5v8a1 1 0 001 1h6a1 1 0 001-1V5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M8 7v4M6 9l2 2 2-2" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Archive
              </>
            )}
          </button>
          {onDelete && (
            <button
              className="session-list-item-context-menu-item destructive"
              onClick={handleDelete}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 4h12M5.333 4V2.667A.667.667 0 016 2h4a.667.667 0 01.667.667V4M12.667 4v9.333a1.333 1.333 0 01-1.334 1.334H4.667a1.333 1.333 0 01-1.334-1.334V4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
};
