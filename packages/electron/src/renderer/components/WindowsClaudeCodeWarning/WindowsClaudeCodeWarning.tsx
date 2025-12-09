import React from 'react';
import './WindowsClaudeCodeWarning.css';

export interface WindowsClaudeCodeWarningProps {
  isOpen: boolean;
  onClose: () => void;
  onDismiss: () => void;
  onOpenSettings: () => void;
}

const WarningIcon = () => (
  <svg
    className="windows-warning-icon-svg"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M12 9V13M12 17H12.01M5.07183 19H18.9282C20.4678 19 21.4301 17.3333 20.6603 16L13.7321 4C12.9623 2.66667 11.0378 2.66667 10.268 4L3.33978 16C2.56998 17.3333 3.53223 19 5.07183 19Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const WindowsClaudeCodeWarning: React.FC<WindowsClaudeCodeWarningProps> = ({
  isOpen,
  onClose,
  onDismiss,
  onOpenSettings
}) => {
  if (!isOpen) return null;

  const handleOpenSettings = () => {
    onOpenSettings();
    onClose();
  };

  const handleRemindLater = () => {
    onClose();
  };

  const handleDontRemind = () => {
    window.electronAPI.send('dismiss-claude-code-windows-warning');
    onDismiss();
  };

  return (
    <div className="windows-warning-overlay" onClick={handleRemindLater}>
      <div className="windows-warning" onClick={(e) => e.stopPropagation()}>
        <button
          className="windows-warning-close"
          onClick={handleRemindLater}
          aria-label="Close"
        >
          &times;
        </button>

        <div className="windows-warning-content">
          <div className="windows-warning-icon">
            <WarningIcon />
          </div>

          <h2 className="windows-warning-title">Claude Code Installation Required</h2>

          <p className="windows-warning-message">
            To use Nimbalyst's AI features on Windows, you need to install Claude Code separately.
            Without it, many agentic editing features will not be available.
          </p>

          <div className="windows-warning-buttons">
            <button
              className="windows-warning-button windows-warning-button-primary"
              onClick={handleOpenSettings}
            >
              View Installation Instructions
            </button>
          </div>

          <div className="windows-warning-footer">
            <button
              className="windows-warning-link"
              onClick={handleRemindLater}
            >
              Remind Me Later
            </button>
            <span className="windows-warning-separator">&bull;</span>
            <button
              className="windows-warning-link"
              onClick={handleDontRemind}
            >
              Don't Show Again
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
