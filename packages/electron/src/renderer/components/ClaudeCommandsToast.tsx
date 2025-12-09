import React from 'react';
import './ClaudeCommandsToast.css';

interface ClaudeCommandsToastProps {
  onInstallAll: () => void;
  onOpenSettings: () => void;
  onSkip: () => void;
}

export function ClaudeCommandsToast({
  onInstallAll,
  onOpenSettings,
  onSkip,
}: ClaudeCommandsToastProps): React.ReactElement {
  return (
    <div className="claude-commands-toast-container">
      <div className="claude-commands-toast">
        {/* Dismiss button */}
        <button
          className="claude-commands-toast-dismiss"
          onClick={onSkip}
          title="Dismiss"
          aria-label="Dismiss"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        {/* Header with icon and text */}
        <div className="claude-commands-toast-header">
          <div className="claude-commands-toast-icon">
            <svg viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
            </svg>
          </div>
          <div className="claude-commands-toast-header-text">
            <div className="claude-commands-toast-title">
              Enhance Claude with Nimbalyst Commands
            </div>
            <div className="claude-commands-toast-subtitle">
              Install custom commands to help Claude work better with Nimbalyst features
            </div>
          </div>
        </div>

        {/* Feature tags */}
        <div className="claude-commands-toast-tags">
          <span className="claude-commands-toast-tag">
            <svg viewBox="0 0 24 24">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z" />
            </svg>
            Mockups
          </span>
          <span className="claude-commands-toast-tag">
            <svg viewBox="0 0 24 24">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14l-5-5 1.41-1.41L12 14.17l7.59-7.59L21 8l-9 9z" />
            </svg>
            Trackers
          </span>
          <span className="claude-commands-toast-tag">
            <svg viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
            </svg>
            Custom Tools
          </span>
        </div>

        {/* Action buttons */}
        <div className="claude-commands-toast-actions">
          <button
            className="claude-commands-toast-btn claude-commands-toast-btn-primary"
            onClick={onInstallAll}
          >
            Install All
          </button>
          <button
            className="claude-commands-toast-btn claude-commands-toast-btn-secondary"
            onClick={onOpenSettings}
          >
            Settings
          </button>
          <button
            className="claude-commands-toast-btn claude-commands-toast-btn-text"
            onClick={onSkip}
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
