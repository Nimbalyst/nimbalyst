import React, { useState, useRef, useEffect } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import './SquashCommitModal.css';

interface SquashCommitModalProps {
  isOpen: boolean;
  commitCount: number;
  warningMessage?: string;
  isChecking?: boolean;
  onConfirm: (message: string) => void;
  onCancel: () => void;
}

export function SquashCommitModal({
  isOpen,
  commitCount,
  warningMessage,
  isChecking = false,
  onConfirm,
  onCancel
}: SquashCommitModalProps) {
  const [message, setMessage] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Detect platform for keyboard shortcut hint
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const submitShortcut = isMac ? 'Cmd+Enter' : 'Ctrl+Enter';

  useEffect(() => {
    if (isOpen && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim()) {
      onConfirm(message.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    }
    // Allow Ctrl+Enter or Cmd+Enter to submit
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (message.trim()) {
        onConfirm(message.trim());
      }
    }
  };

  return (
    <div className="squash-commit-modal-overlay" onClick={onCancel}>
      <div className="squash-commit-modal" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={handleSubmit}>
          <div className="squash-commit-modal-header">
            <h3 className="squash-commit-modal-title">Squash {commitCount} Commits</h3>
            <button
              type="button"
              className="squash-commit-modal-close"
              onClick={onCancel}
              title="Close"
            >
              <MaterialSymbol icon="close" size={20} />
            </button>
          </div>

          {warningMessage && (
            <div className="squash-commit-modal-warning">
              <MaterialSymbol icon="warning" size={20} />
              <span>{warningMessage}</span>
            </div>
          )}

          <div className="squash-commit-modal-body">
            <label htmlFor="commit-message" className="squash-commit-modal-label">
              Commit Message
            </label>
            <textarea
              ref={textareaRef}
              id="commit-message"
              className="squash-commit-modal-textarea"
              placeholder="Enter commit message for squashed commit..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={5}
            />
            <div className="squash-commit-modal-hint">
              Press {submitShortcut} to submit
            </div>
          </div>

          <div className="squash-commit-modal-buttons">
            <button
              type="button"
              className="squash-commit-modal-button squash-commit-modal-cancel"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="squash-commit-modal-button squash-commit-modal-confirm"
              disabled={!message.trim() || isChecking}
            >
              {isChecking ? 'Checking...' : 'Squash Commits'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default SquashCommitModal;
