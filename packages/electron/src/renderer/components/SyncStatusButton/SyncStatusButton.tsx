import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import './SyncStatusButton.css';

export interface SyncConfig {
  enabled: boolean;
  serverUrl: string;
  userId: string;
  authToken: string;
  enabledProjects?: string[];
}

export interface SyncStats {
  sessionCount: number;
  lastSyncedAt: number | null;
}

export interface SyncStatus {
  appConfigured: boolean;       // Is sync configured at the app level?
  projectEnabled: boolean;      // Is current project enabled for sync?
  connected: boolean;           // Is the connection active?
  syncing: boolean;             // Is a sync in progress?
  error: string | null;
  stats: SyncStats;
}

interface SyncStatusButtonProps {
  workspacePath?: string;
  onOpenSettings?: () => void;
}

export const SyncStatusButton: React.FC<SyncStatusButtonProps> = ({ workspacePath, onOpenSettings }) => {
  const [status, setStatus] = useState<SyncStatus>({
    appConfigured: false,
    projectEnabled: false,
    connected: false,
    syncing: false,
    error: null,
    stats: {
      sessionCount: 0,
      lastSyncedAt: null,
    },
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Fetch sync status (called once on mount and when workspace changes)
  const fetchStatus = useCallback(async () => {
    try {
      const result = await window.electronAPI.invoke('sync:get-status', workspacePath);
      if (result) {
        setStatus(result);
      }
    } catch (error) {
      console.error('[SyncStatusButton] Failed to fetch sync status:', error);
    }
  }, [workspacePath]);

  // Initial fetch and subscribe to status changes (no polling)
  useEffect(() => {
    fetchStatus();

    // Subscribe to sync status changes (main process will broadcast)
    window.electronAPI.invoke('sync:subscribe-status');

    // Listen for status change events
    const handleStatusChange = (newStatus: { connected: boolean; syncing: boolean; error: string | null }) => {
      setStatus(prev => ({
        ...prev,
        connected: newStatus.connected,
        syncing: newStatus.syncing,
        error: newStatus.error,
      }));
    };

    const unsubscribe = window.electronAPI.on('sync:status-changed', handleStatusChange);
    return () => {
      unsubscribe?.();
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

  // Don't render if sync is not configured at all
  if (!status.appConfigured) {
    return null;
  }

  const handleToggleProjectSync = async () => {
    try {
      await window.electronAPI.invoke('sync:toggle-project', workspacePath, !status.projectEnabled);
      await fetchStatus();
    } catch (error) {
      console.error('[SyncStatusButton] Failed to toggle project sync:', error);
    }
  };

  const handleOpenSettings = () => {
    setMenuOpen(false);
    if (onOpenSettings) {
      onOpenSettings();
    }
  };

  const getStatusIcon = (): string => {
    if (!status.projectEnabled) {
      return 'cloud_off';
    }
    if (status.error) {
      return 'cloud_off';
    }
    if (status.syncing) {
      return 'cloud_sync';
    }
    if (status.connected) {
      return 'cloud_done';
    }
    return 'cloud_off';
  };

  const getStatusClass = (): string => {
    if (!status.projectEnabled) {
      return 'disabled';
    }
    if (status.error) {
      return 'error';
    }
    if (status.syncing) {
      return 'syncing';
    }
    if (status.connected) {
      return 'connected';
    }
    return 'disconnected';
  };

  const getStatusLabel = (): string => {
    if (!status.projectEnabled) {
      return 'Sync disabled for this project';
    }
    if (status.error) {
      return 'Sync error';
    }
    if (status.syncing) {
      return 'Syncing...';
    }
    if (status.connected) {
      return 'Sync connected';
    }
    return 'Sync disconnected';
  };

  const formatLastSync = (): string => {
    if (!status.stats.lastSyncedAt) {
      return 'Never';
    }
    const date = new Date(status.stats.lastSyncedAt);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) {
      return 'Just now';
    }
    if (diffMins < 60) {
      return `${diffMins}m ago`;
    }
    if (diffHours < 24) {
      return `${diffHours}h ago`;
    }
    return `${diffDays}d ago`;
  };

  return (
    <div className="sync-status-button-container">
      <button
        ref={buttonRef}
        className={`sync-status-button nav-button ${getStatusClass()}`}
        onClick={() => setMenuOpen(!menuOpen)}
        title={getStatusLabel()}
        aria-label={getStatusLabel()}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
      >
        <MaterialSymbol icon={getStatusIcon()} size={20} />
        <span className={`sync-indicator ${getStatusClass()}`} />
      </button>

      {menuOpen && (
        <div ref={menuRef} className="sync-menu" role="menu">
          <div className="sync-menu-header">
            <span className="sync-menu-title">Session Sync</span>
            <span className={`sync-status-badge ${getStatusClass()}`}>
              {status.projectEnabled ? (status.connected ? 'Connected' : 'Disconnected') : 'Disabled'}
            </span>
          </div>

          {status.error && (
            <div className="sync-menu-error">
              <MaterialSymbol icon="error" size={16} />
              <span>{status.error}</span>
            </div>
          )}

          <div className="sync-menu-stats">
            <div className="sync-stat">
              <span className="sync-stat-label">Sessions synced</span>
              <span className="sync-stat-value">{status.stats.sessionCount}</span>
            </div>
            <div className="sync-stat">
              <span className="sync-stat-label">Last sync</span>
              <span className="sync-stat-value">{formatLastSync()}</span>
            </div>
          </div>

          <div className="sync-menu-divider" />

          <div className="sync-menu-actions">
            <button
              className="sync-menu-action"
              onClick={handleToggleProjectSync}
              role="menuitem"
            >
              <MaterialSymbol icon={status.projectEnabled ? 'toggle_on' : 'toggle_off'} size={18} />
              <span>{status.projectEnabled ? 'Disable sync for this project' : 'Enable sync for this project'}</span>
            </button>
            <button
              className="sync-menu-action"
              onClick={handleOpenSettings}
              role="menuitem"
            >
              <MaterialSymbol icon="settings" size={18} />
              <span>Sync settings</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
