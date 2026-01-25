/**
 * TerminalTab - Tab component for terminal instances in the bottom panel
 */

import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';

interface TerminalInstance {
  id: string;
  title: string;
  shellName: string;
  shellPath: string;
  cwd: string;
  worktreeId?: string;
  createdAt: number;
  lastActiveAt: number;
  historyFile?: string;
}

interface TerminalTabProps {
  terminal: TerminalInstance;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
}

export const TerminalTab: React.FC<TerminalTabProps> = ({
  terminal,
  isActive,
  onSelect,
  onClose,
}) => {
  // Get shell icon based on shell name
  const getShellIcon = (shellName: string): string => {
    const name = shellName.toLowerCase();
    if (name.includes('zsh')) return 'terminal';
    if (name.includes('bash')) return 'terminal';
    if (name.includes('fish')) return 'terminal';
    if (name.includes('powershell') || name.includes('pwsh')) return 'terminal';
    return 'terminal';
  };

  // Get abbreviated CWD for display
  const getAbbreviatedCwd = (cwd: string): string => {
    const parts = cwd.split('/');
    if (parts.length <= 2) return cwd;
    return `.../${parts.slice(-2).join('/')}`;
  };

  const handleCloseClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect();
    }
  };

  return (
    <div
      className={`terminal-tab group flex items-center gap-1 px-2 py-1 bg-transparent border-none text-xs cursor-pointer rounded whitespace-nowrap max-w-[200px] transition-colors duration-150 hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)] ${isActive ? 'active bg-[var(--nim-bg)] text-[var(--nim-text)] font-medium' : 'text-[var(--nim-text-muted)]'}`}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      role="tab"
      tabIndex={0}
      aria-selected={isActive}
      title={`${terminal.title}\n${terminal.cwd}\nShell: ${terminal.shellName}`}
    >
      <MaterialSymbol icon={getShellIcon(terminal.shellName)} size={14} />
      <span className="terminal-tab-title overflow-hidden text-ellipsis shrink min-w-0">{terminal.title}</span>
      {terminal.worktreeId && (
        <span className="terminal-tab-worktree-badge flex items-center justify-center p-px bg-[var(--nim-accent-subtle)] rounded-sm text-[var(--nim-primary)] shrink-0" title="Worktree terminal">
          <MaterialSymbol icon="alt_route" size={12} />
        </span>
      )}
      <span className={`terminal-tab-cwd text-[10px] overflow-hidden text-ellipsis shrink min-w-0 ${isActive ? 'text-[var(--nim-text-muted)]' : 'text-[var(--nim-text-faint)]'}`}>{getAbbreviatedCwd(terminal.cwd)}</span>
      <button
        className="terminal-tab-close hidden group-hover:flex items-center justify-center w-4 h-4 p-0 bg-transparent border-none text-[var(--nim-text-faint)] cursor-pointer rounded-sm shrink-0 ml-0.5 transition-colors duration-150 hover:bg-[var(--nim-bg-tertiary)] hover:text-[var(--nim-text)]"
        onClick={handleCloseClick}
        title="Close terminal"
      >
        <MaterialSymbol icon="close" size={12} />
      </button>
    </div>
  );
};
