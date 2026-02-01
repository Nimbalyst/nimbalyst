/**
 * FilesEditedOptionsDropdown - Unified dropdown for Files Edited sidebar options.
 *
 * Contains:
 * - Display options (Group by directory)
 * - Show options (Current changes / Session files / All uncommitted)
 * - Session filter (when multiple sessions exist)
 */

import React, { useState, useRef, useEffect } from 'react';
import { useAtomValue } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime';
import type { FileScopeMode } from '../../store/atoms/workstreamState';
import { sessionTitleAtom } from '../../store/atoms/sessions';

interface FilesEditedOptionsDropdownProps {
  /** Whether to group files by directory */
  groupByDirectory: boolean;
  /** Callback when group by directory changes */
  onGroupByDirectoryChange: (value: boolean) => void;
  /** Current file scope mode */
  fileScopeMode: FileScopeMode;
  /** Callback when file scope mode changes */
  onFileScopeModeChange: (mode: FileScopeMode) => void;
  /** Available session IDs (for workstreams with multiple sessions) */
  sessionIds?: string[];
  /** Currently selected session ID for filtering (null = all sessions) */
  filterSessionId: string | null;
  /** Callback when session filter changes */
  onFilterSessionIdChange: (sessionId: string | null) => void;
}

/** Session option component - each instance calls its own hook */
const SessionOption: React.FC<{
  sessionId: string;
  isSelected: boolean;
  onSelect: () => void;
}> = ({ sessionId, isSelected, onSelect }) => {
  const title = useAtomValue(sessionTitleAtom(sessionId));
  const displayTitle = title || `Session ${sessionId.slice(0, 8)}`;

  return (
    <label className="flex items-center gap-2 px-1 py-1 rounded cursor-pointer hover:bg-[var(--nim-bg-hover)]">
      <input
        type="radio"
        name="sessionFilter"
        checked={isSelected}
        onChange={onSelect}
        className="cursor-pointer"
      />
      <span className="text-xs text-[var(--nim-text)] truncate max-w-[150px]" title={displayTitle}>
        {displayTitle}
      </span>
    </label>
  );
};

const SCOPE_OPTIONS: Array<{ value: FileScopeMode; label: string; description: string }> = [
  { value: 'current-changes', label: 'Current changes', description: 'Files with uncommitted changes' },
  { value: 'session-files', label: 'Session files', description: 'All files touched in session' },
  { value: 'all-changes', label: 'All changes', description: 'All uncommitted files in repo' },
];

export const FilesEditedOptionsDropdown: React.FC<FilesEditedOptionsDropdownProps> = ({
  groupByDirectory,
  onGroupByDirectoryChange,
  fileScopeMode,
  onFileScopeModeChange,
  sessionIds,
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

  const hasMultipleSessions = sessionIds && sessionIds.length > 1;

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
              {sessionIds.map((sessionId) => (
                <SessionOption
                  key={sessionId}
                  sessionId={sessionId}
                  isSelected={filterSessionId === sessionId}
                  onSelect={() => onFilterSessionIdChange(sessionId)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

FilesEditedOptionsDropdown.displayName = 'FilesEditedOptionsDropdown';
