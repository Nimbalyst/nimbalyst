import React from 'react';
import { useSync } from '../contexts/CollabV3SyncContext';

export function SyncStatusBadge() {
  const { status, isConfigured } = useSync();

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
      <span className="status-badge connected">
        <span className="status-dot connected" />
        Connected
      </span>
    );
  }

  return (
    <span className="status-badge disconnected">
      <span className="status-dot disconnected" />
      Disconnected
    </span>
  );
}
