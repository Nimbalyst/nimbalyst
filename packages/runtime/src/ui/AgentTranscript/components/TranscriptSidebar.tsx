import React, { useState, useEffect } from 'react';
import type { PromptMarker } from '../types';

interface TranscriptSidebarProps {
  sessionId: string;
  prompts: PromptMarker[];
  onNavigateToPrompt: (marker: PromptMarker) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export const TranscriptSidebar: React.FC<TranscriptSidebarProps> = ({
  sessionId,
  prompts,
  onNavigateToPrompt,
  isCollapsed,
  onToggleCollapse
}) => {
  const [selectedPromptId, setSelectedPromptId] = useState<number | null>(null);

  const handlePromptClick = (marker: PromptMarker) => {
    setSelectedPromptId(marker.id);
    onNavigateToPrompt(marker);
  };

  const formatDuration = (start: string, end?: string): string => {
    try {
      const startTime = new Date(start).getTime();
      const endTime = end ? new Date(end).getTime() : Date.now();
      const durationMs = endTime - startTime;

      if (durationMs < 1000) return `${durationMs}ms`;
      if (durationMs < 60000) return `${(durationMs / 1000).toFixed(1)}s`;
      const minutes = Math.floor(durationMs / 60000);
      const seconds = Math.floor((durationMs % 60000) / 1000);
      return `${minutes}m ${seconds}s`;
    } catch {
      return '';
    }
  };

  const formatTimeAgo = (timestamp: string): string => {
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);

      if (diffMins < 1) return 'just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      const diffDays = Math.floor(diffHours / 24);
      return `${diffDays}d ago`;
    } catch {
      return '';
    }
  };

  return (
    <div className={`flex transition-all duration-300 ease-in-out ${isCollapsed ? 'w-0' : 'w-64'}`}>
      {!isCollapsed && (
        <div className="w-64 bg-surface-secondary border-l border-border-primary flex flex-col h-full">
          <div className="p-4 border-b border-border-primary">
            <h3 className="font-semibold text-text-primary">Prompt History</h3>
            <p className="text-xs text-text-tertiary mt-1">Click to navigate</p>
          </div>

          <div className="flex-1 overflow-y-auto">
            {prompts.length === 0 ? (
              <div className="p-4 text-text-tertiary text-sm">
                No prompts yet. Start by entering a prompt.
              </div>
            ) : (
              <div className="space-y-1 p-2">
                {prompts.map((marker, index) => (
                  <button
                    key={marker.id}
                    onClick={() => handlePromptClick(marker)}
                    className={`w-full text-left p-3 rounded-lg transition-colors ${
                      selectedPromptId === marker.id
                        ? 'bg-interactive/20 border-interactive border'
                        : 'hover:bg-bg-hover border border-transparent'
                    }`}
                  >
                    <div className="flex items-start space-x-2">
                      <span className="text-interactive font-mono text-sm mt-0.5">
                        #{index + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-text-primary line-clamp-2">
                          {marker.promptText}
                        </div>
                        <div className="flex items-center space-x-2 text-xs text-text-tertiary mt-1">
                          <span>{formatTimeAgo(marker.timestamp)}</span>
                          {marker.completionTimestamp && (
                            <>
                              <span className="text-text-tertiary">•</span>
                              <span className="font-medium text-text-secondary">
                                {formatDuration(marker.timestamp, marker.completionTimestamp)}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
