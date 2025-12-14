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
import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import type { PromptMarker } from '../types';
import { formatShortTime } from '../../../utils/dateUtils';
import { MaterialSymbol } from '../../icons/MaterialSymbol';
import './FloatingTranscriptActions.css';

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
      className={dropdownClassName || 'floating-transcript-prompts-dropdown'}
      ref={menuRef}
    >
      {prompts.length > 0 ? (
        <ul className="prompts-list">
          {prompts.map((prompt) => (
            <li
              key={prompt.id}
              className="prompts-item"
              onClick={() => handlePromptClick(prompt)}
              title={prompt.promptText}
            >
              <div className="prompts-item-number">#{prompt.id}</div>
              <div className="prompts-item-text">
                {truncatePrompt(prompt.promptText)}
              </div>
              <div className="prompts-item-timestamp">
                {formatShortTime(prompt.timestamp)}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="prompts-empty">No prompts in this session</div>
      )}
    </div>
  ) : null;

  return (
    <div className={className || 'prompts-menu-container'}>
      <button
        ref={buttonRef}
        className={buttonClassName || 'floating-transcript-button'}
        onClick={() => setShowMenu(!showMenu)}
        aria-label="Prompts Menu"
        title="Show prompts in this session"
      >
        {/* Table of contents icon */}
        <i className="icon table-of-contents" />
        {prompts.length > 0 && (
          <span className="prompts-badge">{prompts.length}</span>
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
  isSidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onNavigateToPrompt: (marker: PromptMarker) => void;
  /** Optional callback to close and archive the session */
  onCloseAndArchive?: () => void;
}

export const FloatingTranscriptActions: React.FC<FloatingTranscriptActionsProps> = ({
  prompts,
  isSidebarCollapsed,
  onToggleSidebar,
  onNavigateToPrompt,
  onCloseAndArchive
}) => {
  const historyButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="floating-transcript-actions">
      {/* Close and Archive Button */}
      {onCloseAndArchive && (
        <button
          className="floating-transcript-button"
          onClick={onCloseAndArchive}
          aria-label="Close and archive session"
          title="Close and archive session"
        >
          <MaterialSymbol icon="archive" size={20} />
        </button>
      )}

      {/* Prompts Menu Button */}
      <PromptsMenuButton
        prompts={prompts}
        onNavigateToPrompt={onNavigateToPrompt}
      />

      {/* Toggle History Button */}
      <button
        ref={historyButtonRef}
        className="floating-transcript-button"
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
    </div>
  );
};
