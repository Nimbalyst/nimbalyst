import React from 'react';
import { useSync } from '../contexts/CollabV3SyncContext';

export function SyncStatusBadge() {
  const { status, isConfigured, isDesktopConnected } = useSync();

  if (!isConfigured) {
    return (
      <span className="status-badge disconnected">
        <span className="status-dot disconnected" />
        Not configured
      </span>
    );
  }

  if (status.error) {
    return (
      <span className="status-badge disconnected">
        <span className="status-dot disconnected" />
        Error
      </span>
    );
  }

  if (status.syncing) {
    return (
      <span className="status-badge syncing">
        <span className="status-dot syncing" />
        Syncing
      </span>
    );
  }

  if (status.connected) {
    return (
      <div className="flex items-center gap-2">
        {/* Desktop connection indicator */}
        <span
          className={`status-badge ${isDesktopConnected ? 'connected' : 'disconnected'}`}
          title={isDesktopConnected ? 'Desktop is connected' : 'Desktop is not connected'}
        >
          {/* Desktop icon */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect width="20" height="14" x="2" y="3" rx="2" />
            <line x1="8" x2="16" y1="21" y2="21" />
            <line x1="12" x2="12" y1="17" y2="21" />
          </svg>
          <span className={`status-dot ${isDesktopConnected ? 'connected' : 'disconnected'}`} />
        </span>
      </div>
    );
  }

  return (
    <span className="status-badge disconnected">
      <span className="status-dot disconnected" />
      Disconnected
    </span>
  );
}
