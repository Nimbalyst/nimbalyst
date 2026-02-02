/**
 * FilesScopeDropdown - Title dropdown for Files Edited sidebar scope selection.
 *
 * Replaces the static "Files Edited" title with an interactive dropdown that:
 * - Shows the current scope mode as the title
 * - Displays context subtitle (session/workstream/worktree)
 * - Allows changing scope mode and session filter
 * - Contains display options (group by directory)
 */

import React, { useState, useRef, useEffect } from 'react';
import { useAtomValue } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime';
import type { FileScopeMode } from '../../store/atoms/workstreamState';
import { sessionTitleAtom } from '../../store/atoms/sessions';

interface FilesScopeDropdownProps {
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
  /** Whether to group files by directory */
  groupByDirectory: boolean;
  /** Callback when group by directory changes */
  onGroupByDirectoryChange: (value: boolean) => void;
  /** Whether this is a worktree session */
  isWorktree: boolean;
  /** Number of sessions in the workstream */
  workstreamSessionCount: number;
  /** Name of the worktree (if applicable) */
  worktreeName?: string;
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
    <label className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-[var(--nim-bg-hover)]">
      <input
        type="radio"
        name="sessionFilter"
        checked={isSelected}
        onChange={onSelect}
        className="cursor-pointer"
      />
      <span className="text-xs text-[var(--nim-text)] truncate max-w-[180px]" title={displayTitle}>
        {displayTitle}
      </span>
    </label>
  );
};

/** Label mapping for scope modes */
const SCOPE_MODE_LABELS: Record<FileScopeMode, { title: string; description: string }> = {
  'current-changes': {
    title: 'Uncommitted Session Edits',
    description: 'Files edited by AI with uncommitted changes'
  },
  'session-files': {
    title: 'All Session Edits',
    description: 'All files touched by AI'
  },
  'all-changes': {
    title: 'All Uncommitted Files',
    description: 'All uncommitted files in repository'
  }
};

/** Get context subtitle based on current state */
function getScopeContext(
  mode: FileScopeMode,
  isWorktree: boolean,
  sessionCount: number,
  filterSessionId: string | null,
  worktreeName?: string
): string {
  if (mode === 'all-changes') {
    if (isWorktree && worktreeName) {
      return `in worktree ${worktreeName}`;
    }
    return isWorktree ? 'in this Worktree' : 'in this Workspace';
  }

  if (filterSessionId) {
    return 'in this Session';
  }

  if (sessionCount > 1) {
    return `in this Workstream (${sessionCount} sessions)`;
  }

  return 'in this Session';
}

export const FilesScopeDropdown: React.FC<FilesScopeDropdownProps> = ({
  fileScopeMode,
  onFileScopeModeChange,
  sessionIds,
  filterSessionId,
  onFilterSessionIdChange,
  groupByDirectory,
  onGroupByDirectoryChange,
  isWorktree,
  workstreamSessionCount,
  worktreeName,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

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
  const currentLabel = SCOPE_MODE_LABELS[fileScopeMode];
  const contextSubtitle = getScopeContext(fileScopeMode, isWorktree, workstreamSessionCount, filterSessionId, worktreeName);

  // Calculate menu position when opening
  const handleToggle = () => {
    if (!isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 4,
        left: rect.left,
      });
    }
    setIsOpen(!isOpen);
  };

  return (
    <div ref={dropdownRef} className="files-scope-dropdown flex-1 min-w-0">
      {/* Dropdown trigger - acts as the title */}
      <button
        ref={triggerRef}
        onClick={handleToggle}
        data-testid="files-scope-dropdown"
        className={`files-scope-dropdown__trigger flex flex-col items-start gap-0 px-2 py-1 -mx-2 -my-1 border-none rounded cursor-pointer transition-colors ${
          isOpen ? 'bg-[var(--nim-bg-tertiary)]' : 'bg-transparent hover:bg-[var(--nim-bg-hover)]'
        }`}
      >
        <div className="files-scope-dropdown__title-row flex items-center gap-1">
          <MaterialSymbol icon="description" size={16} className="text-[var(--nim-text-muted)]" />
          <span className="files-scope-dropdown__title text-sm font-medium text-[var(--nim-text)] truncate">
            {currentLabel.title}
          </span>
          <MaterialSymbol
            icon="expand_more"
            size={16}
            className={`files-scope-dropdown__chevron text-[var(--nim-text-muted)] transition-transform duration-200 ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </div>
        <span className="files-scope-dropdown__subtitle text-xs text-[var(--nim-text-muted)] pl-5">
          {contextSubtitle}
        </span>
      </button>

      {/* Dropdown panel */}
      {isOpen && menuPosition && (
        <div
          className="files-scope-dropdown__menu fixed z-50 min-w-[260px] bg-[var(--nim-bg)] border border-[var(--nim-border)] rounded-lg shadow-lg overflow-hidden"
          style={{
            top: `${menuPosition.top}px`,
            left: `${menuPosition.left}px`,
          }}
        >
          {/* Show Files section */}
          <div className="files-scope-dropdown__section px-3 py-2 border-b border-[var(--nim-border)]">
            <div className="files-scope-dropdown__section-header text-[10px] font-semibold text-[var(--nim-text-faint)] uppercase tracking-wide mb-1.5">
              Show Files
            </div>
            {(Object.entries(SCOPE_MODE_LABELS) as [FileScopeMode, { title: string; description: string }][]).map(
              ([mode, { title, description }]) => {
                // Customize description for all-changes mode when in a worktree
                const displayDescription = mode === 'all-changes' && isWorktree && worktreeName
                  ? `All uncommitted files in worktree ${worktreeName}`
                  : description;

                return (
                  <label
                    key={mode}
                    className="files-scope-dropdown__option flex items-start gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-[var(--nim-bg-hover)]"
                  >
                    <input
                      type="radio"
                      name="fileScopeMode"
                      checked={fileScopeMode === mode}
                      onChange={() => {
                        onFileScopeModeChange(mode);
                      }}
                      className="cursor-pointer mt-0.5"
                    />
                    <div className="files-scope-dropdown__option-content flex flex-col">
                      <span className="files-scope-dropdown__option-title text-xs font-medium text-[var(--nim-text)]">
                        {title}
                      </span>
                      <span className="files-scope-dropdown__option-description text-[10px] text-[var(--nim-text-muted)]">
                        {displayDescription}
                      </span>
                    </div>
                  </label>
                );
              }
            )}
          </div>

          {/* Scope section - only show if multiple sessions and not in all-changes mode */}
          {hasMultipleSessions && fileScopeMode !== 'all-changes' && (
            <div className="files-scope-dropdown__section px-3 py-2 border-b border-[var(--nim-border)]">
              <div className="files-scope-dropdown__section-header text-[10px] font-semibold text-[var(--nim-text-faint)] uppercase tracking-wide mb-1.5">
                Scope
              </div>
              <label className="files-scope-dropdown__option flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-[var(--nim-bg-hover)]">
                <input
                  type="radio"
                  name="sessionFilter"
                  checked={filterSessionId === null}
                  onChange={() => onFilterSessionIdChange(null)}
                  className="cursor-pointer"
                />
                <span className="text-xs text-[var(--nim-text)]">
                  All sessions ({sessionIds.length})
                </span>
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

          {/* Display section */}
          <div className="files-scope-dropdown__section px-3 py-2">
            <div className="files-scope-dropdown__section-header text-[10px] font-semibold text-[var(--nim-text-faint)] uppercase tracking-wide mb-1.5">
              Display
            </div>
            <label className="files-scope-dropdown__option flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-[var(--nim-bg-hover)]">
              <input
                type="checkbox"
                checked={groupByDirectory}
                onChange={(e) => onGroupByDirectoryChange(e.target.checked)}
                className="cursor-pointer"
              />
              <span className="text-xs text-[var(--nim-text)]">Group by directory</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
};

FilesScopeDropdown.displayName = 'FilesScopeDropdown';
