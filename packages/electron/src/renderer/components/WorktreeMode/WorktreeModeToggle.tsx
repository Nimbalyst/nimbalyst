import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';

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
    <div className="worktree-mode-toggle inline-flex items-center gap-1 bg-nim-bg-secondary rounded-full p-1 mb-2">
      {MODE_OPTIONS.map(option => {
        const isActive = option.value === mode;
        return (
          <button
            key={option.value}
            type="button"
            className={`inline-flex items-center gap-1.5 border-none rounded-full py-1.5 px-3 text-xs font-medium cursor-pointer transition-colors ${
              isActive
                ? 'is-active bg-nim-accent text-white shadow-sm'
                : 'text-nim-text-secondary bg-transparent hover:bg-white/[0.08] hover:text-nim-text-primary'
            }`}
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
