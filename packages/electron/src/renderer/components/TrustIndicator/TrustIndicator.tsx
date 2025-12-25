import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import './TrustIndicator.css';

export interface TrustStatus {
  trustedAt?: number;
  permissionMode: 'ask' | 'allow-all' | 'bypass-all' | null;
}

interface TrustIndicatorProps {
  workspacePath?: string | null;
  onOpenSettings: () => void;
  onChangeMode?: () => void;
}

export const TrustIndicator: React.FC<TrustIndicatorProps> = ({
  workspacePath,
  onOpenSettings,
  onChangeMode,
}) => {
  const [status, setStatus] = useState<TrustStatus | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Fetch trust status
  const fetchStatus = useCallback(async () => {
    if (!workspacePath) return;

    try {
      const result = await window.electronAPI.invoke('permissions:getWorkspacePermissions', workspacePath);
      if (result) {
        setStatus({
          trustedAt: result.trustedAt,
          permissionMode: result.permissionMode,
        });
      }
    } catch (error) {
      console.error('[TrustIndicator] Failed to fetch trust status:', error);
    }
  }, [workspacePath]);

  // Initial fetch and listen for changes
  useEffect(() => {
    fetchStatus();

    // Listen for permission changes
    const handlePermissionChange = () => {
      fetchStatus();
    };

    window.electronAPI.on('permissions:changed', handlePermissionChange);
    return () => {
      window.electronAPI.off?.('permissions:changed', handlePermissionChange);
    };
  }, [fetchStatus]);

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

  // Don't render if no workspace
  if (!workspacePath) {
    return null;
  }

  const handleTrustWorkspace = async () => {
    try {
      await window.electronAPI.invoke('permissions:trustWorkspace', workspacePath);
      await fetchStatus();
      setMenuOpen(false);
    } catch (error) {
      console.error('[TrustIndicator] Failed to trust workspace:', error);
    }
  };

  const handleRevokeWorkspaceTrust = async () => {
    try {
      await window.electronAPI.invoke('permissions:revokeWorkspaceTrust', workspacePath);
      await fetchStatus();
      setMenuOpen(false);
    } catch (error) {
      console.error('[TrustIndicator] Failed to revoke workspace trust:', error);
    }
  };

  const handleOpenSettings = () => {
    setMenuOpen(false);
    onOpenSettings();
  };

  const handleChangeMode = async () => {
    if (!workspacePath) return;

    // Just close the menu and trigger the callback to show the toast
    // Don't revoke trust - that happens only if user picks a new mode
    setMenuOpen(false);
    onChangeMode?.();
  };

  const isTrusted = status?.permissionMode !== null && status?.permissionMode !== undefined;

  const getStatusIcon = (): string => {
    if (!status) {
      return 'shield';
    }
    if (isTrusted) {
      if (status.permissionMode === 'bypass-all') return 'warning';
      if (status.permissionMode === 'allow-all') return 'shield';
      return 'verified_user';
    }
    return 'gpp_maybe';
  };

  const getStatusClass = (): string => {
    if (!status) {
      return 'loading';
    }
    if (isTrusted) {
      if (status.permissionMode === 'bypass-all') return 'bypass-all';
      if (status.permissionMode === 'allow-all') return 'allow-all';
      return 'trusted';
    }
    return 'untrusted';
  };

  const getStatusLabel = (): string => {
    if (!status) {
      return 'Loading trust status...';
    }
    if (isTrusted) {
      if (status.permissionMode === 'bypass-all') {
        return 'Bypass All Checks mode (dangerous)';
      }
      if (status.permissionMode === 'allow-all') {
        return 'Allow All Edits mode';
      }
      return 'Ask mode enabled';
    }
    return 'Workspace not trusted for agent';
  };

  const getStatusDescription = (): string => {
    if (!status) {
      return '';
    }
    if (isTrusted) {
      if (status.permissionMode === 'bypass-all') {
        return 'All operations auto-approved without any prompts. Use at your own risk.';
      }
      if (status.permissionMode === 'allow-all') {
        return 'File operations auto-approved. Bash and web requests follow Claude Code settings.';
      }
      return 'Agent asks before running commands. Approvals saved to .claude/settings.local.json.';
    }
    return 'Trust this workspace to allow the AI agent to run commands.';
  };

  return (
    <div className="trust-indicator-container">
      <button
        ref={buttonRef}
        className={`trust-indicator nav-button ${getStatusClass()}`}
        onClick={() => setMenuOpen(!menuOpen)}
        title={getStatusLabel()}
        aria-label={getStatusLabel()}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
      >
        <MaterialSymbol icon={getStatusIcon()} size={20} />
        <span className={`trust-indicator-dot ${getStatusClass()}`} />
      </button>

      {menuOpen && (
        <div ref={menuRef} className="trust-menu" role="menu">
          <div className="trust-menu-header">
            <span className="trust-menu-title">Agent Permissions</span>
          </div>

          {/* Current mode - prominent display */}
          <div className={`trust-menu-current-mode ${getStatusClass()}`}>
            <div className="trust-menu-current-mode-label">Current mode:</div>
            <div className="trust-menu-current-mode-value">
              <MaterialSymbol
                icon={getStatusIcon()}
                size={20}
              />
              <span>
                {isTrusted
                  ? (status?.permissionMode === 'bypass-all' ? 'Bypass All Checks' : status?.permissionMode === 'allow-all' ? 'Allow All Edits' : 'Ask')
                  : 'Not Trusted'}
              </span>
            </div>
            <div className="trust-menu-current-mode-description">
              {getStatusDescription()}
            </div>
          </div>

          {status?.trustedAt && (
            <div className="trust-menu-date">
              Trusted {new Date(status.trustedAt).toLocaleDateString()}
            </div>
          )}

          <div className="trust-menu-divider" />

          <div className="trust-menu-actions">
              <button
                className="trust-menu-action"
                onClick={handleChangeMode}
                role="menuitem"
              >
                <MaterialSymbol icon="swap_horiz" size={18} />
                <span>Change permission mode</span>
              </button>
            <button
              className="trust-menu-action"
              onClick={handleOpenSettings}
              role="menuitem"
            >
              <MaterialSymbol icon="settings" size={18} />
              <span>Permission settings</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
