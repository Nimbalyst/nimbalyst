import React from 'react';

interface DownloadProgress {
  bytesPerSecond: number;
  percent: number;
  transferred: number;
  total: number;
}

interface DownloadProgressToastProps {
  version: string;
  progress: DownloadProgress;
  onCancel: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
}

function estimateTimeRemaining(bytesPerSecond: number, remaining: number): string {
  if (bytesPerSecond <= 0 || remaining <= 0) {
    return 'Calculating...';
  }

  const secondsRemaining = remaining / bytesPerSecond;

  if (secondsRemaining < 60) {
    return 'Less than 1 minute remaining';
  } else if (secondsRemaining < 3600) {
    const minutes = Math.ceil(secondsRemaining / 60);
    return `About ${minutes} minute${minutes > 1 ? 's' : ''} remaining`;
  } else {
    const hours = Math.floor(secondsRemaining / 3600);
    const minutes = Math.ceil((secondsRemaining % 3600) / 60);
    return `About ${hours}h ${minutes}m remaining`;
  }
}

export function DownloadProgressToast({
  version,
  progress,
  onCancel,
}: DownloadProgressToastProps): React.ReactElement {
  const remaining = progress.total - progress.transferred;
  const timeRemaining = estimateTimeRemaining(progress.bytesPerSecond, remaining);
  const percent = Math.round(progress.percent);

  return (
    <div className="update-toast update-toast-download" data-testid="download-progress-toast">
      {/* Header */}
      <div className="update-toast-title">
        Downloading Nimbalyst {version}...
      </div>

      {/* Progress section */}
      <div className="update-toast-progress-section">
        {/* App icon placeholder */}
        <div className="update-toast-app-icon">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
        </div>

        {/* Progress details */}
        <div className="update-toast-progress-details">
          <div className="update-toast-progress-text" data-testid="download-progress-text">
            {formatBytes(progress.transferred)} of {formatBytes(progress.total)}
          </div>
          <div className="update-toast-progress-bar">
            <div
              className="update-toast-progress-fill"
              style={{ width: `${percent}%` }}
              data-testid="download-progress-fill"
              data-percent={percent}
            />
          </div>
        </div>
      </div>

      {/* Time remaining */}
      <div className="update-toast-time-remaining" data-testid="download-time-remaining">
        {timeRemaining}
      </div>

      {/* Action buttons */}
      <div className="update-toast-actions">
        <button
          className="update-toast-btn update-toast-btn-secondary"
          onClick={onCancel}
          data-testid="download-cancel-btn"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default DownloadProgressToast;
