import React, { useState } from 'react';
import { getRelativeTimeString } from '../../utils/dateFormatting';
import './SessionListItem.css';

interface SessionListItemProps {
  id: string;
  title: string;
  createdAt: number;
  isActive: boolean;
  onClick: () => void;
  onDelete?: () => void;
}

export const SessionListItem: React.FC<SessionListItemProps> = ({
  id,
  title,
  createdAt,
  isActive,
  onClick,
  onDelete
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

  return (
    <div
      className={`session-list-item ${isActive ? 'active' : ''}`}
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
      aria-label={`Session: ${truncatedTitle}, created ${relativeTime}`}
      aria-current={isActive ? 'page' : undefined}
    >
      <div className="session-list-item-content">
        <div className="session-list-item-title">{truncatedTitle}</div>
        <div className="session-list-item-timestamp">{relativeTime}</div>
      </div>
      {isHovering && onDelete && !isActive && (
        <button
          className="session-list-item-delete"
          onClick={handleDelete}
          aria-label="Delete session"
          title="Delete session"
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
  );
};
