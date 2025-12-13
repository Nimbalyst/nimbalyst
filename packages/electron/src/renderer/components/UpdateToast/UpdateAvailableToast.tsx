import React from 'react';

interface UpdateAvailableToastProps {
  version: string;
  onUpdateNow: () => void;
  onViewReleaseNotes: () => void;
  onRemindLater: () => void;
  onDismiss: () => void;
}

export function UpdateAvailableToast({
  version,
  onUpdateNow,
  onViewReleaseNotes,
  onRemindLater,
  onDismiss,
}: UpdateAvailableToastProps): React.ReactElement {
  return (
    <div className="update-toast" data-testid="update-available-toast">
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
      <div className="update-toast-title" data-testid="update-toast-version">
        New Version: Nimbalyst {version}
      </div>
      <div className="update-toast-subtitle">
        There's a new app update available to download
      </div>

      {/* Action buttons */}
      <div className="update-toast-actions">
        <button
          className="update-toast-btn update-toast-btn-primary"
          onClick={onUpdateNow}
          data-testid="update-now-btn"
        >
          Update Now
        </button>
        <button
          className="update-toast-btn update-toast-btn-secondary"
          onClick={onViewReleaseNotes}
          data-testid="release-notes-btn"
        >
          Release Notes
        </button>
        <button
          className="update-toast-btn update-toast-btn-text"
          onClick={onRemindLater}
          data-testid="remind-later-btn"
        >
          Remind me later
        </button>
      </div>
    </div>
  );
}

export default UpdateAvailableToast;
