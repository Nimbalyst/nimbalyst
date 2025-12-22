import React, { useState, useEffect, useRef } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import './ExtensionDevIndicator.css';

interface ExtensionDevIndicatorProps {
  onOpenSettings?: () => void;
}

export const ExtensionDevIndicator: React.FC<ExtensionDevIndicatorProps> = ({
  onOpenSettings,
}) => {
  const [isEnabled, setIsEnabled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Check if extension dev tools are enabled
  useEffect(() => {
    const checkEnabled = async () => {
      try {
        const enabled = await window.electronAPI.extensionDevTools.isEnabled();
        setIsEnabled(enabled);
      } catch (error) {
        console.error('[ExtensionDevIndicator] Failed to check enabled status:', error);
        setIsEnabled(false);
      }
    };

    checkEnabled();
  }, []);

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

  return (
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

          <div className="extension-dev-menu-divider" />

          <div className="extension-dev-menu-actions">
            <button
              className="extension-dev-menu-action"
              onClick={handleRestart}
              disabled={isRestarting}
              role="menuitem"
            >
              <MaterialSymbol icon="refresh" size={18} />
              <span>{isRestarting ? 'Restarting...' : 'Restart Nimbalyst'}</span>
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
          </div>
        </div>
      )}
    </div>
  );
};
