/**
 * FloatingTranscriptActions - Floating action buttons for AgentTranscriptPanel
 *
 * Provides two floating buttons in the top-right corner of the transcript:
 * 1. Prompts menu (TOC icon) - Dropdown showing all user prompts in the session
 * 2. Toggle history button - Shows/hides the file history sidebar
 *
 * This component follows the same design pattern as FloatingDocumentActionsPlugin
 * in the TabEditor, with consistent styling, positioning, and interaction patterns.
 */
import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import type { PromptMarker } from '../types';
import { formatShortTime } from '../../../utils/dateUtils';
import { MaterialSymbol } from '../../icons/MaterialSymbol';

// =============================================================================
// PromptsMenuButton - Standalone prompts menu dropdown
// =============================================================================

interface PromptsMenuButtonProps {
  prompts: PromptMarker[];
  onNavigateToPrompt: (marker: PromptMarker) => void;
  /** Optional class name for the container */
  className?: string;
  /** Optional class name for the button */
  buttonClassName?: string;
  /** Optional class name for the dropdown menu */
  dropdownClassName?: string;
  /** Use portal to render dropdown at document body (fixes position:fixed issues with transformed ancestors) */
  usePortal?: boolean;
}

/**
 * Standalone prompts menu button with dropdown.
 * Can be used independently (e.g., in mobile header) or as part of FloatingTranscriptActions.
 */
export const PromptsMenuButton: React.FC<PromptsMenuButtonProps> = ({
  prompts,
  onNavigateToPrompt,
  className,
  buttonClassName,
  dropdownClassName,
  usePortal = false
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node) &&
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setShowMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Handle prompt selection
  const handlePromptClick = (marker: PromptMarker) => {
    onNavigateToPrompt(marker);
    setShowMenu(false);
  };

  // Truncate prompt text for display
  const truncatePrompt = (text: string, maxLength: number = 80): string => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  const dropdownContent = showMenu ? (
    <div
      className={dropdownClassName || 'floating-transcript-prompts-dropdown absolute top-11 right-11 min-w-80 max-w-[480px] max-h-[500px] overflow-y-auto bg-[var(--nim-bg)] border border-[var(--nim-border)] rounded-md shadow-lg z-[11] pointer-events-auto'}
      ref={menuRef}
    >
      {prompts.length > 0 ? (
        <ul className="prompts-list list-none m-0 py-1 px-0">
          {prompts.map((prompt) => (
            <li
              key={prompt.id}
              className="prompts-item flex items-start gap-2 px-3 py-2.5 cursor-pointer transition-colors border-b border-[var(--nim-border)] last:border-b-0 hover:bg-[var(--nim-bg-hover)]"
              onClick={() => handlePromptClick(prompt)}
              title={prompt.promptText}
            >
              <div className="prompts-item-number text-[var(--nim-text-faint)] text-[11px] font-semibold min-w-8 text-right pt-0.5">#{prompt.id}</div>
              <div className="prompts-item-text flex-1 text-[var(--nim-text)] text-[13px] leading-snug overflow-hidden text-ellipsis line-clamp-2">
                {truncatePrompt(prompt.promptText)}
              </div>
              <div className="prompts-item-timestamp text-[var(--nim-text-faint)] text-[11px] whitespace-nowrap pt-0.5">
                {formatShortTime(prompt.timestamp)}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="prompts-empty py-6 px-4 text-center text-[var(--nim-text-faint)] text-[13px]">No prompts in this session</div>
      )}
    </div>
  ) : null;

  return (
    <div className={className || 'prompts-menu-container relative inline-flex'}>
      <button
        ref={buttonRef}
        className={buttonClassName || 'floating-transcript-button pointer-events-auto w-9 h-9 rounded-md border border-[var(--nim-border)] bg-[var(--nim-bg)] text-[var(--nim-text)] cursor-pointer flex items-center justify-center transition-all relative shadow-sm hover:bg-[var(--nim-bg-tertiary)] active:scale-95'}
        onClick={() => setShowMenu(!showMenu)}
        aria-label="Prompts Menu"
        title="Show prompts in this session"
      >
        {/* Table of contents icon */}
        <i className="icon table-of-contents w-5 h-5 bg-contain bg-no-repeat bg-[url('../../../images/icons/table-of-contents.svg')] dark:invert" />
        {prompts.length > 0 && (
          <span className="prompts-badge absolute -top-1 -right-1 bg-[var(--nim-primary)] text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none shadow-sm">{prompts.length}</span>
        )}
      </button>

      {/* Prompts Dropdown Menu - optionally rendered via portal */}
      {usePortal && dropdownContent
        ? ReactDOM.createPortal(dropdownContent, document.body)
        : dropdownContent}
    </div>
  );
};

// =============================================================================
// FloatingTranscriptActions - Container with prompts menu + history toggle
// =============================================================================

interface FloatingTranscriptActionsProps {
  prompts: PromptMarker[];
  /** Whether the sidebar is collapsed (only used if onToggleSidebar is provided) */
  isSidebarCollapsed?: boolean;
  /** Optional: Toggle sidebar visibility. If not provided, the toggle button is hidden. */
  onToggleSidebar?: () => void;
  onNavigateToPrompt: (marker: PromptMarker) => void;
}

export const FloatingTranscriptActions: React.FC<FloatingTranscriptActionsProps> = ({
  prompts,
  isSidebarCollapsed,
  onToggleSidebar,
  onNavigateToPrompt,
}) => {
  return (
    <div className="floating-transcript-actions absolute top-1.5 right-3 flex gap-2 z-[100] pointer-events-none">
      {/* Prompts Menu Button */}
      <PromptsMenuButton
        prompts={prompts}
        onNavigateToPrompt={onNavigateToPrompt}
      />

      {/* Toggle History Button - only shown if onToggleSidebar is provided */}
      {onToggleSidebar && (
        <button
          className="floating-transcript-button pointer-events-auto w-9 h-9 rounded-md border border-[var(--nim-border)] bg-[var(--nim-bg)] text-[var(--nim-text)] cursor-pointer flex items-center justify-center transition-all relative shadow-sm hover:bg-[var(--nim-bg-tertiary)] active:scale-95"
          onClick={onToggleSidebar}
          aria-label={isSidebarCollapsed ? 'Show file history' : 'Hide file history'}
          title={isSidebarCollapsed ? 'Show file history' : 'Hide file history'}
        >
          {isSidebarCollapsed ? (
            // Show history icon (clock to expand)
            <MaterialSymbol icon="schedule" size={20} />
          ) : (
            // Hide history icon (chevron right to collapse)
            <MaterialSymbol icon="chevron_right" size={20} />
          )}
        </button>
      )}
    </div>
  );
};
