import React from 'react';

export interface QueuedPrompt {
  id: string;
  prompt: string;
  timestamp: number;
}

interface PromptQueueListProps {
  queue: QueuedPrompt[];
  onCancel: (id: string) => void;
  onEdit?: (id: string, prompt: string) => void;
}

/**
- PromptQueueList - Displays queued prompts waiting to be processed
 */
export function PromptQueueList({ queue, onCancel, onEdit }: PromptQueueListProps) {
  if (queue.length === 0) {
    return null;
  }

  return (
    <div className="prompt-queue-list px-3 py-2 border-b border-nim bg-nim-secondary">
      <div className="prompt-queue-header flex items-center mb-1.5">
        <span className="prompt-queue-count text-[11px] font-medium text-nim-secondary uppercase tracking-wide">{queue.length} queued</span>
      </div>
      <div className="prompt-queue-items flex flex-col gap-1">
        {queue.map((item, index) => (
          <div key={item.id} className="prompt-queue-item flex items-center gap-2 px-2 py-1.5 bg-nim-tertiary border border-nim rounded text-[13px]">
            <span className="prompt-queue-number shrink-0 w-[18px] h-[18px] flex items-center justify-center bg-nim-tertiary rounded-full text-[11px] font-medium text-nim-secondary">{index + 1}</span>
            <span className="prompt-queue-text flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-nim-primary">{item.prompt}</span>
            {onEdit && (
              <button
                className="prompt-queue-edit shrink-0 w-5 h-5 flex items-center justify-center bg-transparent border-none rounded text-nim-secondary cursor-pointer text-sm leading-none p-0 transition-all duration-150 hover:bg-nim-hover hover:text-nim-primary"
                onClick={() => onEdit(item.id, item.prompt)}
                title="Edit this prompt"
                type="button"
              >
                &#x270E;
              </button>
            )}
            <button
              className="prompt-queue-cancel shrink-0 w-5 h-5 flex items-center justify-center bg-transparent border-none rounded text-nim-secondary cursor-pointer text-lg leading-none p-0 transition-all duration-150 hover:bg-nim-hover hover:text-nim-primary"
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
