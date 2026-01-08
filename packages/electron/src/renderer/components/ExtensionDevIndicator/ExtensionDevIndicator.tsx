import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import { ExtensionErrorConsole } from './ExtensionErrorConsole';
import './ExtensionDevIndicator.css';

/**
 * Format a timestamp as a relative time string (e.g., "5m ago", "2h ago")
 */
function formatRelativeTime(startTime: number): string {
  const now = Date.now();
  const diffMs = now - startTime;
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `${diffDays}d ago`;
  } else if (diffHours > 0) {
    return `${diffHours}h ago`;
  } else if (diffMinutes > 0) {
    return `${diffMinutes}m ago`;
  } else {
    return 'just now';
  }
}

interface ExtensionDevIndicatorProps {
  onOpenSettings?: () => void;
}

export const ExtensionDevIndicator: React.FC<ExtensionDevIndicatorProps> = ({
  onOpenSettings,
}) => {
  const [isEnabled, setIsEnabled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [errorCount, setErrorCount] = useState(0);
  const [processStartTime, setProcessStartTime] = useState<number | null>(null);
  const [relativeTime, setRelativeTime] = useState<string>('');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Check for errors periodically
  const checkErrors = useCallback(async () => {
    if (!isEnabled) return;
    try {
      const result = await window.electronAPI.extensionDevTools.getLogs({
        logLevel: 'error',
        lastSeconds: 300, // 5 minutes
      });
      setErrorCount(result.logs.length);
    } catch (error) {
      // Ignore errors during check
    }
  }, [isEnabled]);

  useEffect(() => {
    checkErrors();
    const interval = setInterval(checkErrors, 5000);
    return () => clearInterval(interval);
  }, [checkErrors]);

  // Check if extension dev tools are enabled and get process info
  useEffect(() => {
    const checkEnabled = async () => {
      try {
        const enabled = await window.electronAPI.extensionDevTools.isEnabled();
        setIsEnabled(enabled);

        if (enabled) {
          const processInfo = await window.electronAPI.extensionDevTools.getProcessInfo();
          setProcessStartTime(processInfo.startTime);
          setRelativeTime(formatRelativeTime(processInfo.startTime));
        }
      } catch (error) {
        console.error('[ExtensionDevIndicator] Failed to check enabled status:', error);
        setIsEnabled(false);
      }
    };

    checkEnabled();
  }, []);

  // Update the relative time display every minute
  useEffect(() => {
    if (!processStartTime) return;

    const updateRelativeTime = () => {
      setRelativeTime(formatRelativeTime(processStartTime));
    };

    // Update every minute
    const interval = setInterval(updateRelativeTime, 60000);
    return () => clearInterval(interval);
  }, [processStartTime]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuOpen &&
        menuRef.current &&
        buttonRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  // Don't render if not enabled
  if (!isEnabled) {
    return null;
  }

  const handleRestart = async () => {
    setIsRestarting(true);
    try {
      await window.electronAPI.invoke('app:restart');
    } catch (error) {
      console.error('[ExtensionDevIndicator] Failed to restart:', error);
      setIsRestarting(false);
    }
  };

  const handleOpenSettings = () => {
    setMenuOpen(false);
    onOpenSettings?.();
  };

  const handleOpenConsole = () => {
    setMenuOpen(false);
    setConsoleOpen(true);
  };

  return (
    <>
      <ExtensionErrorConsole
        isOpen={consoleOpen}
        onClose={() => {
          setConsoleOpen(false);
          checkErrors(); // Refresh error count after closing
        }}
      />
    <div className="extension-dev-indicator-container">
      <button
        ref={buttonRef}
        className="extension-dev-indicator nav-button"
        onClick={() => setMenuOpen(!menuOpen)}
        title="Extension Development Mode"
        aria-label="Extension Development Mode"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
      >
        <MaterialSymbol icon="developer_mode" size={20} />
        <span className="extension-dev-indicator-dot" />
      </button>

      {menuOpen && (
        <div ref={menuRef} className="extension-dev-menu" role="menu">
          <div className="extension-dev-menu-header">
            <span className="extension-dev-menu-title">Extension Dev Mode</span>
          </div>

          <div className="extension-dev-menu-status">
            <MaterialSymbol icon="check_circle" size={16} />
            <span>Development tools active</span>
          </div>

          {relativeTime && (
            <div className="extension-dev-menu-uptime">
              <MaterialSymbol icon="schedule" size={16} />
              <span>Started {relativeTime}</span>
            </div>
          )}

          <div className="extension-dev-menu-divider" />

          <div className="extension-dev-menu-actions">
            <button
              className="extension-dev-menu-action"
              onClick={handleOpenConsole}
              role="menuitem"
            >
              <MaterialSymbol icon="terminal" size={18} />
              <span>
                View Logs
                {errorCount > 0 && (
                  <span className="extension-dev-error-badge">{errorCount}</span>
                )}
              </span>
            </button>

            {onOpenSettings && (
              <button
                className="extension-dev-menu-action"
                onClick={handleOpenSettings}
                role="menuitem"
              >
                <MaterialSymbol icon="settings" size={18} />
                <span>Extension Settings</span>
              </button>
            )}
            <button
                className="extension-dev-menu-action"
                onClick={handleRestart}
                disabled={isRestarting}
                role="menuitem"
            >
              <MaterialSymbol icon="refresh" size={18} />
              <span>{isRestarting ? 'Restarting...' : 'Restart Nimbalyst'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
    </>
  );
};
