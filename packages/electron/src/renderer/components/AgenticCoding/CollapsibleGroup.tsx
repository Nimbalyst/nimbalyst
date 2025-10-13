import React, { ReactNode } from 'react';
import './CollapsibleGroup.css';

interface CollapsibleGroupProps {
  title: string;
  isExpanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  count?: number;
}

export const CollapsibleGroup: React.FC<CollapsibleGroupProps> = ({
  title,
  isExpanded,
  onToggle,
  children,
  count
}) => {
  return (
    <div className="collapsible-group">
      <button
        className="collapsible-group-header"
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-label={`${title} group, ${isExpanded ? 'expanded' : 'collapsed'}`}
      >
        <svg
          className={`collapsible-group-chevron ${isExpanded ? 'expanded' : ''}`}
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M4 3L7 6L4 9"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="collapsible-group-title">{title}</span>
        {count !== undefined && (
          <span className="collapsible-group-count">{count}</span>
        )}
      </button>
      {isExpanded && (
        <div className="collapsible-group-content">
          {children}
        </div>
      )}
    </div>
  );
};
