import React, { useState } from 'react';
import './ContextLimitWidget.css';

interface ContextLimitWidgetProps {
  sessionId?: string;
  isLastMessage?: boolean; // Only show compact button on the last message
  onCompact?: () => void; // Callback to trigger /compact command
}

export const ContextLimitWidget: React.FC<ContextLimitWidgetProps> = ({ sessionId, isLastMessage = false, onCompact }) => {
  const [isCompacting, setIsCompacting] = useState(false);

  const handleCompact = () => {
    setIsCompacting(true);
    onCompact?.();
  };

  return (
    <div className="context-limit-widget">
      <div className="context-limit-header">
        <span className="context-limit-icon">!</span>
        <span className="context-limit-title">Context limit exceeded</span>
      </div>

      <div className="context-limit-message">
        {isLastMessage
          ? 'This conversation has grown too large for the model\'s context window. Compact the conversation history to continue.'
          : 'This conversation exceeded the model\'s context window at this point.'}
      </div>

      {isLastMessage && (
        <div className="context-limit-actions">
          <button
            onClick={handleCompact}
            disabled={isCompacting}
            className="compact-button"
          >
            {isCompacting ? 'Compacting...' : 'Compact'}
          </button>
        </div>
      )}
    </div>
  );
};
