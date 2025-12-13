import React from 'react';

interface UpdateReadyToastProps {
  version: string;
  onRelaunch: () => void;
  onDoItLater: () => void;
  onDismiss: () => void;
}

export function UpdateReadyToast({
  version,
  onRelaunch,
  onDoItLater,
  onDismiss,
}: UpdateReadyToastProps): React.ReactElement {
  return (
    <div className="update-toast" data-testid="update-ready-toast">
      {/* Dismiss button */}
      <button
        className="update-toast-dismiss"
        onClick={onDismiss}
        title="Dismiss"
        aria-label="Dismiss"
        data-testid="update-toast-dismiss"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>

      {/* Header */}
      <div className="update-toast-title">
        Nimbalyst update is ready
      </div>
      <div className="update-toast-subtitle">
        The app needs to be restarted to apply the update
      </div>

      {/* Action buttons */}
      <div className="update-toast-actions">
        <button
          className="update-toast-btn update-toast-btn-primary"
          onClick={onRelaunch}
          data-testid="relaunch-btn"
        >
          Relaunch
        </button>
        <button
          className="update-toast-btn update-toast-btn-secondary"
          onClick={onDoItLater}
          data-testid="do-it-later-btn"
        >
          Later
        </button>
      </div>
    </div>
  );
}

export default UpdateReadyToast;
