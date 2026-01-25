/**
 * GitCommitConfirmationWidget
 *
 * Custom tool widget that renders when AI calls git_commit_proposal.
 * Shows the proposed commit with file selection and message editing.
 */

import React, { useState, useCallback } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';

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
      <div className="git-commit-widget nim-panel max-w-[600px]">
        <div className="git-commit-widget__header nim-panel-header text-[13px] font-semibold">
          <MaterialSymbol
            icon={commitResult.success ? 'check_circle' : 'error'}
            size={16}
          />
          <span className="git-commit-widget__title flex-1 text-[var(--nim-text)]">
            {commitResult.success ? 'Commit Successful' : 'Commit Failed'}
          </span>
        </div>
        <div className="git-commit-widget__content p-4 flex flex-col gap-4">
          {commitResult.success ? (
            <div className="git-commit-widget__success flex flex-col gap-2 p-4 rounded-md bg-[color-mix(in_srgb,var(--nim-success)_15%,var(--nim-bg))]">
              <div className="git-commit-widget__commit-hash font-[var(--nim-font-mono)] text-[11px] text-[var(--nim-primary)] font-semibold">
                {commitResult.commitHash?.slice(0, 7)}
              </div>
              <div className="git-commit-widget__commit-message text-xs text-[var(--nim-text)] font-medium whitespace-pre-wrap">
                {commitMessage}
              </div>
              <div className="git-commit-widget__files-count text-[11px] text-[var(--nim-text-muted)]">
                {filesToStage.size} file{filesToStage.size !== 1 ? 's' : ''} committed
              </div>
            </div>
          ) : (
            <div className="git-commit-widget__error p-4 rounded-md text-xs bg-[color-mix(in_srgb,var(--nim-error)_15%,var(--nim-bg))] text-[var(--nim-error)]">
              {commitResult.error}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="git-commit-widget nim-panel max-w-[600px]">
      <div className="git-commit-widget__header nim-panel-header text-[13px] font-semibold">
        <MaterialSymbol icon="commit" size={16} />
        <span className="git-commit-widget__title flex-1 text-[var(--nim-text)]">
          Commit Proposal
        </span>
      </div>

      <div className="git-commit-widget__content p-4 flex flex-col gap-4">
        {/* Reasoning */}
        {reasoning && (
          <div className="git-commit-widget__section flex flex-col gap-2">
            <div className="git-commit-widget__section-title nim-section-label">
              Analysis
            </div>
            <div className="git-commit-widget__reasoning p-3 bg-[var(--nim-bg)] rounded-md text-xs text-[var(--nim-text-muted)] leading-relaxed">
              {reasoning}
            </div>
          </div>
        )}

        {/* Files to Stage */}
        <div className="git-commit-widget__section flex flex-col gap-2">
          <div className="git-commit-widget__section-title nim-section-label">
            Files to Stage ({filesToStage.size})
          </div>
          <div className="git-commit-widget__files nim-scrollbar flex flex-col gap-1 max-h-[200px] overflow-y-auto">
            {initialFilesToStage.map((filePath) => {
              const isSelected = filesToStage.has(filePath);
              return (
                <div
                  key={filePath}
                  className={`git-commit-widget__file flex items-center gap-2 py-2 px-3 bg-[var(--nim-bg)] border border-[var(--nim-border)] rounded cursor-pointer transition-all duration-150 hover:bg-[var(--nim-bg-tertiary)] ${isSelected ? 'selected border-[var(--nim-primary)] bg-[var(--nim-bg-tertiary)]' : ''}`}
                  onClick={() => toggleFile(filePath)}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    readOnly
                    className="pointer-events-none"
                  />
                  <span className="git-commit-widget__file-name text-xs font-medium text-[var(--nim-text)]">
                    {filePath.split('/').pop()}
                  </span>
                  <span className="git-commit-widget__file-path flex-1 text-[11px] text-[var(--nim-text-faint)] overflow-hidden text-ellipsis whitespace-nowrap">
                    {filePath}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Commit Message */}
        <div className="git-commit-widget__section flex flex-col gap-2">
          <div className="git-commit-widget__section-title nim-section-label">
            Commit Message
          </div>
          <textarea
            className="git-commit-widget__commit-message-input w-full p-3 border border-[var(--nim-border)] rounded-md bg-[var(--nim-bg)] text-[var(--nim-text)] text-xs font-[var(--nim-font-mono)] resize-y leading-normal focus:outline-none focus:border-[var(--nim-primary)]"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            rows={6}
          />
        </div>

        {/* Actions */}
        <div className="git-commit-widget__actions flex gap-2 justify-end pt-2 border-t border-[var(--nim-border)]">
          <button
            className="git-commit-widget__btn git-commit-widget__btn--secondary nim-btn-secondary text-xs font-semibold"
            onClick={handleCancel}
            disabled={isCommitting}
          >
            Cancel
          </button>
          <button
            className="git-commit-widget__btn git-commit-widget__btn--primary nim-btn-primary text-xs font-semibold"
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
