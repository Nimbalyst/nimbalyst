import React from 'react';
import './ModeTag.css';

export type AIMode = 'planning' | 'agent';

interface ModeTagProps {
  mode: AIMode;
  onModeChange: (mode: AIMode) => void;
}

/**
 * ModeTag - Compact toggle between Plan and Agent modes
 *
 * Plan mode: Creates plan documents, restricted to markdown files
 * Agent mode: Full tool access, write operations enabled
 */
export function ModeTag({ mode, onModeChange }: ModeTagProps) {
  const handleToggle = () => {
    onModeChange(mode === 'planning' ? 'agent' : 'planning');
  };

  return (
    <button
      className={`mode-tag mode-tag-${mode}`}
      onClick={handleToggle}
      title={mode === 'planning'
        ? 'Plan mode: Creates plan documents (click to enable full agent mode)'
        : 'Agent mode: Full tool access (click to switch to plan mode)'}
      type="button"
    >
      {mode === 'planning' ? 'Plan' : 'Agent'}
    </button>
  );
}
