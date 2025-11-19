/**
 * MonacoDiffApprovalBar - Approval UI for Monaco diff mode
 *
 * This component provides Accept All / Reject All buttons when
 * Monaco editor is in diff mode, showing AI-generated changes.
 *
 * Kept separate from the Lexical DiffApprovalBar to avoid coupling.
 */

import React from 'react';
import './MonacoDiffApprovalBar.css';

export interface MonacoDiffApprovalBarProps {
  onAcceptAll: () => void;
  onRejectAll: () => void;
  fileName?: string;
}

export const MonacoDiffApprovalBar: React.FC<MonacoDiffApprovalBarProps> = ({
  onAcceptAll,
  onRejectAll,
  fileName,
}) => {
  const handleAcceptClick = () => {
    try {
      onAcceptAll();
    } catch (error) {
      console.error('[MonacoDiffApprovalBar] Error calling onAcceptAll:', error);
    }
  };

  const handleRejectClick = () => {
    onRejectAll();
  };

  return (
    <div className="monaco-diff-approval-bar">
      <div className="monaco-diff-approval-bar-content">
        <div className="monaco-diff-approval-bar-info">
          <span className="monaco-diff-approval-bar-label">
            AI changes to {fileName || 'file'}
          </span>
        </div>
        <div className="monaco-diff-approval-bar-actions">
          <button
            className="monaco-diff-approval-bar-button monaco-diff-approval-bar-button-reject"
            onClick={handleRejectClick}
            type="button"
          >
            Reject All
          </button>
          <button
            className="monaco-diff-approval-bar-button monaco-diff-approval-bar-button-accept"
            onClick={handleAcceptClick}
            type="button"
          >
            Accept All
          </button>
        </div>
      </div>
    </div>
  );
};
