import React, { ReactNode } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
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
        <MaterialSymbol
          icon="chevron_right"
          size={12}
          className={`collapsible-group-chevron ${isExpanded ? 'expanded' : ''}`}
        />
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
