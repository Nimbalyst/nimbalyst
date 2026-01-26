import React, { useState } from 'react';
import { ClaudeCommandsLearnMoreDialog } from './ClaudeCommandsLearnMoreDialog';

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
  const [showLearnMore, setShowLearnMore] = useState(false);
  return (
    <div className="claude-commands-toast-container fixed bottom-5 left-5 z-[1000]">
      <div
        className="claude-commands-toast relative w-[380px] rounded-xl p-4 px-5 bg-nim-secondary border border-nim shadow-[0_10px_25px_-5px_rgba(0,0,0,0.3),0_4px_10px_-2px_rgba(0,0,0,0.2)]"
      >
        {/* Dismiss button */}
        <button
          className="claude-commands-toast-dismiss absolute top-3 right-3 w-6 h-6 border-none bg-transparent cursor-pointer rounded flex items-center justify-center p-0 transition-colors duration-200 text-[var(--nim-text-faint)] hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text-muted)]"
          onClick={onSkip}
          title="Dismiss"
          aria-label="Dismiss"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        {/* Header with icon and text */}
        <div className="claude-commands-toast-header flex items-center gap-3 mb-3 pr-7">
          <div
            className="claude-commands-toast-icon w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-gradient-to-br from-amber-600 to-amber-500"
          >
            <svg className="w-[18px] h-[18px] fill-white" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
            </svg>
          </div>
          <div className="claude-commands-toast-header-text flex-1">
            <div className="claude-commands-toast-title text-sm font-semibold text-[var(--nim-text)] mb-1">
              Enhance Claude with Nimbalyst Commands
            </div>
            <div className="claude-commands-toast-subtitle text-xs text-[var(--nim-text-muted)] leading-relaxed">
              Install custom commands to help Claude work better with Nimbalyst features.
              <br />
              <br />
              This will also create a git-ignored nimbalyst-local folder to hold plans and mockups.{' '}
              <button
                className="claude-commands-toast-learn-more bg-none border-none p-0 text-xs font-[inherit] text-[var(--nim-primary)] cursor-pointer underline transition-colors duration-200 hover:text-[var(--nim-primary-hover)]"
                onClick={() => setShowLearnMore(true)}
              >
                Learn more
              </button>
            </div>
          </div>
        </div>

        {/* Feature tags */}
        <div className="claude-commands-toast-tags flex gap-2 mb-4 flex-wrap">
          <span className="claude-commands-toast-tag inline-flex items-center gap-1.5 py-1 px-2.5 bg-[var(--nim-bg-tertiary)] rounded-md text-[11px] text-[var(--nim-text-muted)]">
            <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z" />
            </svg>
            Mockups
          </span>
          <span className="claude-commands-toast-tag inline-flex items-center gap-1.5 py-1 px-2.5 bg-[var(--nim-bg-tertiary)] rounded-md text-[11px] text-[var(--nim-text-muted)]">
            <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14l-5-5 1.41-1.41L12 14.17l7.59-7.59L21 8l-9 9z" />
            </svg>
            Trackers
          </span>
          <span className="claude-commands-toast-tag inline-flex items-center gap-1.5 py-1 px-2.5 bg-[var(--nim-bg-tertiary)] rounded-md text-[11px] text-[var(--nim-text-muted)]">
            <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
            </svg>
            Custom Tools
          </span>
        </div>

        {/* Action buttons */}
        <div className="claude-commands-toast-actions flex gap-2">
          <button
            className="claude-commands-toast-btn claude-commands-toast-btn-primary nim-btn-primary flex-1"
            onClick={onInstallAll}
          >
            Install All
          </button>
          <button
            className="claude-commands-toast-btn claude-commands-toast-btn-secondary nim-btn-secondary"
            onClick={onOpenSettings}
          >
            Settings
          </button>
          <button
            className="claude-commands-toast-btn claude-commands-toast-btn-text nim-btn-ghost py-2 px-3"
            onClick={onSkip}
          >
            Skip
          </button>
        </div>
      </div>

      <ClaudeCommandsLearnMoreDialog
        isOpen={showLearnMore}
        onClose={() => setShowLearnMore(false)}
        onOpenSettings={onOpenSettings}
      />
    </div>
  );
}
