import React from 'react';
import './WorktreeOnboardingModal.css';

export interface WorktreeOnboardingModalProps {
  isOpen: boolean;
  onContinue: () => void;
  onCancel: () => void;
}

export const WorktreeOnboardingModal: React.FC<WorktreeOnboardingModalProps> = ({
  isOpen,
  onContinue,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div className="worktree-onboarding-overlay" onClick={onCancel}>
      <div className="worktree-onboarding-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="worktree-onboarding-header">
          <span className="material-symbols-outlined worktree-onboarding-icon">
            account_tree
          </span>
          <h2>What is a Worktree?</h2>
        </div>

        <div className="worktree-onboarding-content">
          <p className="worktree-onboarding-description">
            Worktrees create a git branch in an <strong>isolated directory</strong>, separate from your main repository.
            This gives you a safe place to make changes without affecting the rest of your code.
          </p>

          <div className="worktree-onboarding-benefits">
            <div className="worktree-benefit">
              <span className="material-symbols-outlined benefit-icon">shield</span>
              <div className="benefit-text">
                <strong>Safe experimentation</strong>
                <span>AI changes stay in a separate branch</span>
              </div>
            </div>
            <div className="worktree-benefit">
              <span className="material-symbols-outlined benefit-icon">rate_review</span>
              <div className="benefit-text">
                <strong>Easy review</strong>
                <span>Review and merge changes when ready</span>
              </div>
            </div>
            <div className="worktree-benefit">
              <span className="material-symbols-outlined benefit-icon">stacks</span>
              <div className="benefit-text">
                <strong>Parallel work</strong>
                <span>Run multiple experiments simultaneously</span>
              </div>
            </div>
          </div>
        </div>

        <div className="worktree-onboarding-footer">
          <button
            className="worktree-onboarding-secondary-button"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="worktree-onboarding-primary-button"
            onClick={onContinue}
          >
            Create Worktree
          </button>
        </div>
      </div>
    </div>
  );
};
