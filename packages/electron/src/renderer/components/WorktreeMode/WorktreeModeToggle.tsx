import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import './WorktreeModeToggle.css';

export type WorktreeContentMode = 'agent' | 'files' | 'changes';

interface WorktreeModeToggleProps {
  mode: WorktreeContentMode;
  onChange: (mode: WorktreeContentMode) => void;
}

const MODE_OPTIONS: Array<{ value: WorktreeContentMode; label: string; icon: string }> = [
  { value: 'agent', label: 'Agent', icon: 'schedule' },
  { value: 'files', label: 'Files', icon: 'description' },
  { value: 'changes', label: 'Changes', icon: 'difference' }
];

export function WorktreeModeToggle({ mode, onChange }: WorktreeModeToggleProps) {
  return (
    <div className="worktree-mode-toggle">
      {MODE_OPTIONS.map(option => {
        const isActive = option.value === mode;
        return (
          <button
            key={option.value}
            type="button"
            className={isActive ? 'is-active' : ''}
            onClick={() => onChange(option.value)}
            aria-pressed={isActive}
          >
            <MaterialSymbol icon={option.icon} size={16} />
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default WorktreeModeToggle;
