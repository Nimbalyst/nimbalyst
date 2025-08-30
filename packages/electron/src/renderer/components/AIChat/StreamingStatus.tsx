import React, { useState } from 'react';
import './StreamingStatus.css';

interface StreamingStatusProps {
  isActive: boolean;
  content?: string;
  position?: string;
  mode?: string;
  onCancel?: () => void;
}

export function StreamingStatus({ isActive, content, position, mode, onCancel }: StreamingStatusProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const getStatusText = () => {
    if (!isActive) {
      const location = position || 'editor';
      return `✅ Content streamed to ${location}`;
    }
    return `📝 Streaming to ${position || 'cursor position'}...`;
  };

  return (
    <div className={`streaming-status ${isActive ? 'active' : 'complete'}`}>
      <div 
        className="streaming-status-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className="streaming-status-icon">
          {isExpanded ? '▼' : '▶'}
        </span>
        <span className="streaming-status-text">
          {getStatusText()}
        </span>
        {isActive && onCancel && (
          <button 
            className="streaming-status-cancel"
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
            title="Cancel streaming"
          >
            Cancel
          </button>
        )}
        {!isActive && (
          <span className="streaming-status-badge">
            Inserted
          </span>
        )}
      </div>
      
      {isExpanded && content && (
        <div className="streaming-status-content">
          <pre>{content}</pre>
        </div>
      )}
    </div>
  );
}