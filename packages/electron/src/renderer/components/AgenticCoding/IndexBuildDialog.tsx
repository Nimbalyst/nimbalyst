import React from 'react';
import './IndexBuildDialog.css';

export interface IndexBuildDialogProps {
  isOpen: boolean;
  messageCount: number;
  isBuilding: boolean;
  onBuild: () => void;
  onSkip: () => void;
}

export const IndexBuildDialog: React.FC<IndexBuildDialogProps> = ({
  isOpen,
  messageCount,
  isBuilding,
  onBuild,
  onSkip
}) => {
  if (!isOpen) return null;

  return (
    <div className="index-build-dialog-overlay" onClick={isBuilding ? undefined : onSkip}>
      <div className="index-build-dialog" onClick={(e) => e.stopPropagation()}>
        <h2 className="index-build-dialog-title">Build Search Index?</h2>
        <p className="index-build-dialog-message">
          Your session history contains <strong>{messageCount.toLocaleString()}</strong> messages.
          Building a search index will make searches much faster, but may take a few minutes.
        </p>
        {isBuilding ? (
          <div className="index-build-dialog-progress">
            <div className="index-build-dialog-spinner" />
            <span>Building index... This may take a few minutes.</span>
          </div>
        ) : (
          <div className="index-build-dialog-buttons">
            <button
              className="index-build-dialog-button index-build-dialog-button-skip"
              onClick={onSkip}
            >
              Skip for now
            </button>
            <button
              className="index-build-dialog-button index-build-dialog-button-build"
              onClick={onBuild}
            >
              Build Index
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
