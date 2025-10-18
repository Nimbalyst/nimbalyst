import React from 'react';
import './ModeTag.css';

export type AIMode = 'plan' | 'agent';

interface ModeTagProps {
  mode: AIMode;
  onModeChange: (mode: AIMode) => void;
}

/**
 * ModeTag - Compact toggle between Plan and Agent modes
 *
 * Plan mode: Read-only tools, safer operations
 * Agent mode: Full tool access, write operations enabled
 */
export function ModeTag({ mode, onModeChange }: ModeTagProps) {
  const handleToggle = () => {
    onModeChange(mode === 'plan' ? 'agent' : 'plan');
  };

  return (
    <button
      className={`mode-tag mode-tag-${mode}`}
      onClick={handleToggle}
      title={mode === 'plan'
        ? 'Planning mode: Read-only tools (click to enable full agent mode)'
        : 'Agent mode: Full tool access (click to switch to planning mode)'}
      type="button"
    >
      {mode === 'plan' ? 'Plan' : 'Agent'}
    </button>
  );
}
