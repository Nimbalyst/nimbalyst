import React from 'react';
import './PromptQueueList.css';

export interface QueuedPrompt {
  id: string;
  prompt: string;
  timestamp: number;
}

interface PromptQueueListProps {
  queue: QueuedPrompt[];
  onCancel: (id: string) => void;
}

/**
- PromptQueueList - Displays queued prompts waiting to be processed
 */
export function PromptQueueList({ queue, onCancel }: PromptQueueListProps) {
  if (queue.length === 0) {
    return null;
  }

  return (
    <div className="prompt-queue-list">
      <div className="prompt-queue-header">
        <span className="prompt-queue-count">{queue.length} queued</span>
      </div>
      <div className="prompt-queue-items">
        {queue.map((item, index) => (
          <div key={item.id} className="prompt-queue-item">
            <span className="prompt-queue-number">{index + 1}</span>
            <span className="prompt-queue-text">{item.prompt}</span>
            <button
              className="prompt-queue-cancel"
              onClick={() => onCancel(item.id)}
              title="Cancel this prompt"
              type="button"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
