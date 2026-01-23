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
      className={`terminal-tab ${isActive ? 'active' : ''}`}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      role="tab"
      tabIndex={0}
      aria-selected={isActive}
      title={`${terminal.title}\n${terminal.cwd}\nShell: ${terminal.shellName}`}
    >
      <MaterialSymbol icon={getShellIcon(terminal.shellName)} size={14} />
      <span className="terminal-tab-title">{terminal.title}</span>
      {terminal.worktreeId && (
        <span className="terminal-tab-worktree-badge" title="Worktree terminal">
          <MaterialSymbol icon="alt_route" size={12} />
        </span>
      )}
      <span className="terminal-tab-cwd">{getAbbreviatedCwd(terminal.cwd)}</span>
      <button
        className="terminal-tab-close"
        onClick={handleCloseClick}
        title="Close terminal"
      >
        <MaterialSymbol icon="close" size={12} />
      </button>
    </div>
  );
};

// CSS is included in TerminalBottomPanel.css
