import React, { useState } from 'react';
import { getRelativeTimeString } from '../../utils/dateFormatting';
import { ProviderIcon } from '../icons/ProviderIcons';
import './SessionListItem.css';

interface SessionListItemProps {
  id: string;
  title: string;
  createdAt: number;
  isActive: boolean;
  isLoaded?: boolean; // Whether session is loaded in a tab
  isProcessing?: boolean; // Whether session is actively processing
  hasUnread?: boolean; // Whether session has unread messages
  onClick: () => void;
  onDelete?: () => void;
  provider?: string;
  model?: string;
  messageCount?: number;
}

export const SessionListItem: React.FC<SessionListItemProps> = ({
  id,
  title,
  createdAt,
  isActive,
  isLoaded = false,
  isProcessing = false,
  hasUnread = false,
  onClick,
  onDelete,
  provider,
  model,
  messageCount
}) => {
  const [isHovering, setIsHovering] = useState(false);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDelete) {
      onDelete();
    }
  };

  // Get the first line of the title (truncate if too long)
  const displayTitle = title || 'Untitled Session';
  const truncatedTitle = displayTitle.length > 40
    ? displayTitle.substring(0, 40) + '...'
    : displayTitle;

  const relativeTime = getRelativeTimeString(createdAt);

  // Extract model ID from provider:model format
  const displayModel = model?.includes(':') ? model.split(':')[1] : model;

  return (
    <div
        id={"session-list-item-" + id}
      className={`session-list-item ${isActive ? 'active' : ''} ${isLoaded ? 'loaded' : ''}`}
      onClick={onClick}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      aria-label={`Session: ${truncatedTitle}, created ${relativeTime}${isLoaded ? ' (loaded in tab)' : ''}`}
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
        {onDelete && (
          <button
            className={`session-list-item-delete ${isHovering && !isActive ? 'visible' : ''}`}
            onClick={handleDelete}
            aria-label="Delete session"
            title="Delete session"
            disabled={isActive}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M10.5 3.5L3.5 10.5M3.5 3.5L10.5 10.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
};
