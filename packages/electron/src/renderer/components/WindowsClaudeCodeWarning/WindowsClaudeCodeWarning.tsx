import React from 'react';

export interface WindowsClaudeCodeWarningProps {
  isOpen: boolean;
  onClose: () => void;
  onDismiss: () => void;
  onOpenSettings: () => void;
}

const WarningIcon = () => (
  <svg
    className="windows-warning-icon-svg w-12 h-12 text-white"
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
    <div
      className="windows-warning-overlay nim-overlay"
      style={{ background: 'rgba(0, 0, 0, 0.6)' }}
      onClick={handleRemindLater}
    >
      <div
        className="windows-warning relative overflow-hidden rounded-2xl p-0 w-[460px] max-w-[90vw] nim-animate-slide-up"
        style={{
          background: 'var(--nim-bg)',
          border: '1px solid var(--nim-border)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="windows-warning-close absolute top-4 right-4 bg-transparent border-none text-[28px] cursor-pointer p-0 w-8 h-8 flex items-center justify-center leading-none z-[1] rounded-md transition-all duration-200 hover:scale-110"
          style={{ color: 'var(--nim-text-muted)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--nim-text)';
            e.currentTarget.style.background = 'var(--nim-bg-hover)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--nim-text-muted)';
            e.currentTarget.style.background = 'transparent';
          }}
          onClick={handleRemindLater}
          aria-label="Close"
        >
          &times;
        </button>

        <div className="windows-warning-content px-8 pt-12 pb-8 text-center">
          <div
            className="windows-warning-icon mx-auto mb-6 w-20 h-20 rounded-[20px] flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
              boxShadow: '0 4px 16px rgba(245, 158, 11, 0.3)'
            }}
          >
            <WarningIcon />
          </div>

          <h2
            className="windows-warning-title m-0 mb-3 text-2xl font-bold tracking-tight"
            style={{ color: 'var(--nim-text)' }}
          >
            Claude Code Installation Required
          </h2>

          <p
            className="windows-warning-message mb-8 text-[15px] leading-relaxed max-w-[380px] mx-auto"
            style={{ color: 'var(--nim-text-muted)' }}
          >
            To use Nimbalyst's AI features on Windows, you need to install Claude Code separately.
            Without it, many agentic editing features will not be available.
          </p>

          <div className="windows-warning-buttons flex justify-center mb-6">
            <button
              className="windows-warning-button windows-warning-button-primary py-3.5 px-8 rounded-lg border-none text-base font-semibold cursor-pointer whitespace-nowrap flex items-center gap-2.5 text-white transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0"
              style={{
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                boxShadow: '0 4px 12px rgba(245, 158, 11, 0.4)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = '0 6px 16px rgba(245, 158, 11, 0.5)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(245, 158, 11, 0.4)';
              }}
              onClick={handleOpenSettings}
            >
              View Installation Instructions
            </button>
          </div>

          <div
            className="windows-warning-footer pt-4 flex items-center justify-center gap-2"
            style={{ borderTop: '1px solid var(--nim-border)' }}
          >
            <button
              className="windows-warning-link bg-transparent border-none text-[13px] cursor-pointer py-1 px-2 no-underline transition-colors duration-200 hover:underline"
              style={{ color: 'var(--nim-text-muted)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--nim-text)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--nim-text-muted)';
              }}
              onClick={handleRemindLater}
            >
              Remind Me Later
            </button>
            <span
              className="windows-warning-separator text-[13px] select-none"
              style={{ color: 'var(--nim-text-faint)' }}
            >
              &bull;
            </span>
            <button
              className="windows-warning-link bg-transparent border-none text-[13px] cursor-pointer py-1 px-2 no-underline transition-colors duration-200 hover:underline"
              style={{ color: 'var(--nim-text-muted)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--nim-text)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--nim-text-muted)';
              }}
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
