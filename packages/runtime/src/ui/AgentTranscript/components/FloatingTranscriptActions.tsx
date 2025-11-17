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
import type { PromptMarker } from '../types';
import './FloatingTranscriptActions.css';

interface FloatingTranscriptActionsProps {
  prompts: PromptMarker[];
  isSidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onNavigateToPrompt: (marker: PromptMarker) => void;
}

export const FloatingTranscriptActions: React.FC<FloatingTranscriptActionsProps> = ({
  prompts,
  isSidebarCollapsed,
  onToggleSidebar,
  onNavigateToPrompt
}) => {
  const [showPromptsMenu, setShowPromptsMenu] = useState(false);
  const promptsButtonRef = useRef<HTMLButtonElement>(null);
  const promptsMenuRef = useRef<HTMLDivElement>(null);
  const historyButtonRef = useRef<HTMLButtonElement>(null);

  // Close prompts menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        promptsButtonRef.current &&
        !promptsButtonRef.current.contains(event.target as Node) &&
        promptsMenuRef.current &&
        !promptsMenuRef.current.contains(event.target as Node)
      ) {
        setShowPromptsMenu(false);
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
    setShowPromptsMenu(false);
  };

  // Truncate prompt text for display
  const truncatePrompt = (text: string, maxLength: number = 80): string => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  return (
    <div className="floating-transcript-actions">
      {/* Table of Contents / Prompts Menu Button */}
      <button
        ref={promptsButtonRef}
        className="floating-transcript-button"
        onClick={() => setShowPromptsMenu(!showPromptsMenu)}
        aria-label="Prompts Menu"
        title="Show prompts in this session"
      >
        {/* Same icon used in FloatingDocumentActionsPlugin */}
        <i className="icon table-of-contents" />
        {prompts.length > 0 && (
          <span className="prompts-badge">{prompts.length}</span>
        )}
      </button>

      {/* Prompts Dropdown Menu */}
      {showPromptsMenu && (
        <div className="floating-transcript-prompts-dropdown" ref={promptsMenuRef}>
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
                    {new Date(prompt.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="prompts-empty">No prompts in this session</div>
          )}
        </div>
      )}

      {/* Toggle History Button */}
      <button
        ref={historyButtonRef}
        className="floating-transcript-button"
        onClick={onToggleSidebar}
        aria-label={isSidebarCollapsed ? 'Show file history' : 'Hide file history'}
        title={isSidebarCollapsed ? 'Show file history' : 'Hide file history'}
      >
        {isSidebarCollapsed ? (
          // Show history icon (chevron left to expand)
          <>
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: '20px', height: '20px' }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </>
        ) : (
          // Hide history icon (chevron right to collapse)
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: '20px', height: '20px' }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        )}
      </button>
    </div>
  );
};
