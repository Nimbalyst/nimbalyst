import React, { useEffect, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useDiffCommands } from './index';
import './DiffToolbar.css';

/**
 * Toolbar component that appears when there are diff nodes in the document
 * Shows approve/reject buttons for all diffs
 */
export function DiffToolbar() {
  const [editor] = useLexicalComposerContext();
  const { hasDiffs, approveDiffs, rejectDiffs } = useDiffCommands();
  const [hasDiffNodes, setHasDiffNodes] = useState(false);

  useEffect(() => {
    // Check for diffs on mount and when editor changes
    const checkDiffs = () => {
      const hasNodes = hasDiffs();
      setHasDiffNodes(hasNodes);
    };

    // Initial check
    checkDiffs();

    // Listen for editor updates
    const unregister = editor.registerUpdateListener(() => {
      checkDiffs();
    });

    return () => {
      unregister();
    };
  }, [editor, hasDiffs]);

  if (!hasDiffNodes) {
    return null;
  }

  return (
    <div className="diff-toolbar">
      <div className="diff-toolbar-content">
        <span className="diff-toolbar-label">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 1L9 5L13 6L9 7L8 11L7 7L3 6L7 5L8 1Z" fill="currentColor"/>
          </svg>
          Suggested changes
        </span>
        <div className="diff-toolbar-actions">
          <button 
            className="diff-toolbar-button diff-toolbar-approve"
            onClick={approveDiffs}
            title="Accept all changes"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M12 3L5 10L2 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Accept All
          </button>
          <button 
            className="diff-toolbar-button diff-toolbar-reject"
            onClick={rejectDiffs}
            title="Reject all changes"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M10 4L4 10M4 4L10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            Reject All
          </button>
        </div>
      </div>
    </div>
  );
}