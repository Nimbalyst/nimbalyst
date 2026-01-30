/**
 * FilesEditedOptionsDropdown - Unified dropdown for Files Edited sidebar options.
 *
 * Contains:
 * - Display options (Group by directory)
 * - Show options (Current changes / Session files / All uncommitted)
 * - Session filter (when multiple sessions exist)
 */

import React, { useState, useRef, useEffect } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import type { FileScopeMode } from '../../store/atoms/workstreamState';

interface SessionInfo {
  id: string;
  title: string;
}

interface FilesEditedOptionsDropdownProps {
  /** Whether to group files by directory */
  groupByDirectory: boolean;
  /** Callback when group by directory changes */
  onGroupByDirectoryChange: (value: boolean) => void;
  /** Current file scope mode */
  fileScopeMode: FileScopeMode;
  /** Callback when file scope mode changes */
  onFileScopeModeChange: (mode: FileScopeMode) => void;
  /** Available sessions (for workstreams with multiple sessions) */
  sessions?: SessionInfo[];
  /** Currently selected session ID for filtering (null = all sessions) */
  filterSessionId: string | null;
  /** Callback when session filter changes */
  onFilterSessionIdChange: (sessionId: string | null) => void;
}

const SCOPE_OPTIONS: Array<{ value: FileScopeMode; label: string; description: string }> = [
  { value: 'current-changes', label: 'Current changes', description: 'Files with uncommitted changes' },
  { value: 'session-files', label: 'Session files', description: 'All files touched in session' },
  { value: 'all-uncommitted', label: 'All uncommitted', description: 'All uncommitted files in repo' },
];

export const FilesEditedOptionsDropdown: React.FC<FilesEditedOptionsDropdownProps> = ({
  groupByDirectory,
  onGroupByDirectoryChange,
  fileScopeMode,
  onFileScopeModeChange,
  sessions,
  filterSessionId,
  onFilterSessionIdChange,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Close dropdown on escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  const hasMultipleSessions = sessions && sessions.length > 1;

  return (
    <div ref={dropdownRef} className="relative">
      {/* Dropdown trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center justify-center w-6 h-6 border-none rounded bg-transparent text-[var(--nim-text-muted)] cursor-pointer hover:bg-[var(--nim-bg-tertiary)] ${isOpen ? 'bg-[var(--nim-bg-tertiary)]' : ''}`}
        title="View options"
      >
        <MaterialSymbol icon="tune" size={16} />
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div className="absolute top-full right-0 mt-1 z-50 min-w-[200px] bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded-md shadow-lg">
          {/* Display section */}
          <div className="px-2 py-1.5 border-b border-[var(--nim-border)]">
            <div className="text-[10px] font-semibold text-[var(--nim-text-faint)] uppercase tracking-wide mb-1">
              Display
            </div>
            <label className="flex items-center gap-2 px-1 py-1 rounded cursor-pointer hover:bg-[var(--nim-bg-hover)]">
              <input
                type="checkbox"
                checked={groupByDirectory}
                onChange={(e) => onGroupByDirectoryChange(e.target.checked)}
                className="cursor-pointer"
              />
              <span className="text-xs text-[var(--nim-text)]">Group by directory</span>
            </label>
          </div>

          {/* Show section */}
          <div className="px-2 py-1.5 border-b border-[var(--nim-border)]">
            <div className="text-[10px] font-semibold text-[var(--nim-text-faint)] uppercase tracking-wide mb-1">
              Show
            </div>
            {SCOPE_OPTIONS.map((option) => (
              <label
                key={option.value}
                className="flex items-center gap-2 px-1 py-1 rounded cursor-pointer hover:bg-[var(--nim-bg-hover)]"
              >
                <input
                  type="radio"
                  name="fileScopeMode"
                  checked={fileScopeMode === option.value}
                  onChange={() => onFileScopeModeChange(option.value)}
                  className="cursor-pointer"
                />
                <span className="text-xs text-[var(--nim-text)]">{option.label}</span>
              </label>
            ))}
          </div>

          {/* Session section - only show if multiple sessions */}
          {hasMultipleSessions && (
            <div className="px-2 py-1.5">
              <div className="text-[10px] font-semibold text-[var(--nim-text-faint)] uppercase tracking-wide mb-1">
                Session
              </div>
              <label className="flex items-center gap-2 px-1 py-1 rounded cursor-pointer hover:bg-[var(--nim-bg-hover)]">
                <input
                  type="radio"
                  name="sessionFilter"
                  checked={filterSessionId === null}
                  onChange={() => onFilterSessionIdChange(null)}
                  className="cursor-pointer"
                />
                <span className="text-xs text-[var(--nim-text)]">All sessions</span>
              </label>
              {sessions.map((session) => (
                <label
                  key={session.id}
                  className="flex items-center gap-2 px-1 py-1 rounded cursor-pointer hover:bg-[var(--nim-bg-hover)]"
                >
                  <input
                    type="radio"
                    name="sessionFilter"
                    checked={filterSessionId === session.id}
                    onChange={() => onFilterSessionIdChange(session.id)}
                    className="cursor-pointer"
                  />
                  <span className="text-xs text-[var(--nim-text)] truncate max-w-[150px]" title={session.title}>
                    {session.title || `Session ${session.id.slice(0, 8)}`}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

FilesEditedOptionsDropdown.displayName = 'FilesEditedOptionsDropdown';
