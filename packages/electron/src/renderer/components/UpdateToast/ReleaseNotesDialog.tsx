import React, { useEffect, useRef } from 'react';
import { marked } from 'marked';

// Configure marked for safe rendering
marked.setOptions({
  breaks: true,
  gfm: true,
});

interface ReleaseNotesDialogProps {
  currentVersion: string;
  newVersion: string;
  releaseNotes: string;
  onClose: () => void;
  onUpdate: () => void;
}

export function ReleaseNotesDialog({
  currentVersion,
  newVersion,
  releaseNotes,
  onClose,
  onUpdate,
}: ReleaseNotesDialogProps): React.ReactElement {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Handle escape key and click outside
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Parse and render markdown release notes
  const renderedReleaseNotes = React.useMemo(() => {
    if (!releaseNotes) {
      return '<p>No release notes available.</p>';
    }
    try {
      return marked.parse(releaseNotes) as string;
    } catch (err) {
      console.error('[ReleaseNotesDialog] Failed to parse release notes:', err);
      return `<p>${releaseNotes}</p>`;
    }
  }, [releaseNotes]);

  return (
    <div className="update-dialog-backdrop" data-testid="release-notes-dialog-backdrop">
      <div className="update-dialog" ref={dialogRef} role="dialog" aria-modal="true" data-testid="release-notes-dialog">
        {/* Close button */}
        <button
          className="update-dialog-close"
          onClick={onClose}
          title="Close"
          aria-label="Close"
          data-testid="release-notes-close-btn"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        {/* Header */}
        <div className="update-dialog-header">
          <h2 className="update-dialog-title">A new version of Nimbalyst is available!</h2>
        </div>

        {/* Version comparison */}
        <div className="update-dialog-version-row">
          <span className="update-dialog-version-label">You are currently on:</span>
          <span className="update-dialog-version-badge" data-testid="current-version-badge">{currentVersion}</span>
          <span className="update-dialog-version-arrow">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </span>
          <span className="update-dialog-version-label">The latest version is:</span>
          <span className="update-dialog-version-badge update-dialog-version-badge-new" data-testid="new-version-badge">{newVersion}</span>
        </div>

        {/* Release notes */}
        <div className="update-dialog-content">
          <h3 className="update-dialog-notes-title">{newVersion} - Release Notes</h3>
          <div
            className="update-dialog-notes"
            data-testid="release-notes-content"
            dangerouslySetInnerHTML={{ __html: renderedReleaseNotes }}
          />
        </div>

        {/* Action buttons */}
        <div className="update-dialog-actions">
          <button
            className="update-dialog-btn update-dialog-btn-secondary"
            onClick={onClose}
            data-testid="release-notes-later-btn"
          >
            Later
          </button>
          <button
            className="update-dialog-btn update-dialog-btn-primary"
            onClick={onUpdate}
            data-testid="release-notes-update-btn"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            Update to Nimbalyst {newVersion}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ReleaseNotesDialog;
