/**
 * GitCommitConfirmationWidget
 *
 * Custom tool widget that renders when AI calls git_commit_proposal.
 * Shows the proposed commit with file selection and message editing.
 */

import React, { useState, useCallback } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import './GitCommitConfirmationWidget.css';

interface GitCommitConfirmationWidgetProps {
  workspacePath: string;
  filesToStage: string[];
  commitMessage: string;
  reasoning: string;
  onConfirm?: (filesToStage: string[], commitMessage: string) => void;
  onCancel?: () => void;
}

export const GitCommitConfirmationWidget: React.FC<GitCommitConfirmationWidgetProps> = ({
  workspacePath,
  filesToStage: initialFilesToStage,
  commitMessage: initialCommitMessage,
  reasoning,
  onConfirm,
  onCancel,
}) => {
  const [filesToStage, setFilesToStage] = useState<Set<string>>(new Set(initialFilesToStage));
  const [commitMessage, setCommitMessage] = useState(initialCommitMessage);
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<{
    success: boolean;
    commitHash?: string;
    error?: string;
  } | null>(null);

  const toggleFile = useCallback((filePath: string) => {
    setFilesToStage((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }, []);

  const handleConfirm = useCallback(async () => {
    if (filesToStage.size === 0 || !commitMessage.trim()) {
      return;
    }

    setIsCommitting(true);
    try {
      if (window.electron) {
        const result = await window.electron.invoke(
          'git:commit',
          workspacePath,
          commitMessage,
          Array.from(filesToStage)
        );
        setCommitResult(result as any);

        if (result.success && onConfirm) {
          onConfirm(Array.from(filesToStage), commitMessage);
        }
      }
    } catch (error) {
      setCommitResult({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsCommitting(false);
    }
  }, [workspacePath, filesToStage, commitMessage, onConfirm]);

  const handleCancel = useCallback(() => {
    if (onCancel) {
      onCancel();
    }
  }, [onCancel]);

  // If commit was already made, show result
  if (commitResult) {
    return (
      <div className="git-commit-widget">
        <div className="git-commit-widget__header">
          <MaterialSymbol
            icon={commitResult.success ? 'check_circle' : 'error'}
            size={16}
          />
          <span className="git-commit-widget__title">
            {commitResult.success ? 'Commit Successful' : 'Commit Failed'}
          </span>
        </div>
        <div className="git-commit-widget__content">
          {commitResult.success ? (
            <div className="git-commit-widget__success">
              <div className="git-commit-widget__commit-hash">
                {commitResult.commitHash?.slice(0, 7)}
              </div>
              <div className="git-commit-widget__commit-message">{commitMessage}</div>
              <div className="git-commit-widget__files-count">
                {filesToStage.size} file{filesToStage.size !== 1 ? 's' : ''} committed
              </div>
            </div>
          ) : (
            <div className="git-commit-widget__error">{commitResult.error}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="git-commit-widget">
      <div className="git-commit-widget__header">
        <MaterialSymbol icon="commit" size={16} />
        <span className="git-commit-widget__title">Commit Proposal</span>
      </div>

      <div className="git-commit-widget__content">
        {/* Reasoning */}
        {reasoning && (
          <div className="git-commit-widget__section">
            <div className="git-commit-widget__section-title">Analysis</div>
            <div className="git-commit-widget__reasoning">{reasoning}</div>
          </div>
        )}

        {/* Files to Stage */}
        <div className="git-commit-widget__section">
          <div className="git-commit-widget__section-title">
            Files to Stage ({filesToStage.size})
          </div>
          <div className="git-commit-widget__files">
            {initialFilesToStage.map((filePath) => {
              const isSelected = filesToStage.has(filePath);
              return (
                <div
                  key={filePath}
                  className={`git-commit-widget__file ${isSelected ? 'selected' : ''}`}
                  onClick={() => toggleFile(filePath)}
                >
                  <input type="checkbox" checked={isSelected} readOnly />
                  <span className="git-commit-widget__file-name">
                    {filePath.split('/').pop()}
                  </span>
                  <span className="git-commit-widget__file-path">{filePath}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Commit Message */}
        <div className="git-commit-widget__section">
          <div className="git-commit-widget__section-title">Commit Message</div>
          <textarea
            className="git-commit-widget__commit-message-input"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            rows={6}
          />
        </div>

        {/* Actions */}
        <div className="git-commit-widget__actions">
          <button
            className="git-commit-widget__btn git-commit-widget__btn--secondary"
            onClick={handleCancel}
            disabled={isCommitting}
          >
            Cancel
          </button>
          <button
            className="git-commit-widget__btn git-commit-widget__btn--primary"
            onClick={handleConfirm}
            disabled={isCommitting || filesToStage.size === 0 || !commitMessage.trim()}
          >
            {isCommitting ? 'Committing...' : 'Confirm & Commit'}
          </button>
        </div>
      </div>
    </div>
  );
};
