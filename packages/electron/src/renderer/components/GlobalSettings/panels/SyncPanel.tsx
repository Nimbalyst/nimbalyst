import React from 'react';

export interface SyncConfig {
  enabled: boolean;
  serverUrl: string;
  userId: string;
  authToken: string;
}

interface SyncPanelProps {
  config: SyncConfig;
  onConfigChange: (config: SyncConfig) => void;
  onTestConnection: () => void;
  testStatus: 'idle' | 'testing' | 'success' | 'error';
  testMessage?: string;
}

export function SyncPanel({
  config,
  onConfigChange,
  onTestConnection,
  testStatus,
  testMessage,
}: SyncPanelProps) {
  const isDevelopment = import.meta.env.DEV;

  const handleFieldChange = (field: keyof SyncConfig, value: string | boolean) => {
    onConfigChange({ ...config, [field]: value });
  };

  return (
    <div className="provider-panel">
      <div className="provider-panel-header">
        <h3 className="provider-panel-title">Session Sync</h3>
        <p className="provider-panel-description">
          Sync AI sessions across devices using Y.js real-time collaboration.
          This is an experimental feature for development and testing.
        </p>
      </div>

      <div className="provider-panel-section">
        <h4 className="provider-panel-section-title">Enable Sync</h4>

        <div className="setting-item">
          <label className="setting-label">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => handleFieldChange('enabled', e.target.checked)}
              className="setting-checkbox"
            />
            <div className="setting-text">
              <span className="setting-name">Enable Session Sync</span>
              <span className="setting-description">
                When enabled, AI sessions will sync to other devices connected to the same server.
                Requires a running sync server.
              </span>
            </div>
          </label>
        </div>
      </div>

      {config.enabled && (
        <>
          <div className="provider-panel-section">
            <h4 className="provider-panel-section-title">Server Configuration</h4>
            <p className="provider-panel-hint">
              Configure the sync server connection. For local development, use ws://localhost:8788
            </p>

            <div className="api-key-section">
              <label className="api-key-label">Server URL</label>
              <input
                type="text"
                className="api-key-input"
                value={config.serverUrl}
                onChange={(e) => handleFieldChange('serverUrl', e.target.value)}
                placeholder="ws://localhost:8788"
              />
              <span className="api-key-hint">
                WebSocket URL of the sync server (e.g., ws://localhost:8788 or wss://sync.example.com)
              </span>
            </div>

            <div className="api-key-section">
              <label className="api-key-label">User ID</label>
              <input
                type="text"
                className="api-key-input"
                value={config.userId}
                onChange={(e) => handleFieldChange('userId', e.target.value)}
                placeholder="your-user-id"
              />
              <span className="api-key-hint">
                Your unique user identifier for session routing
              </span>
            </div>

            <div className="api-key-section">
              <label className="api-key-label">Auth Token</label>
              <input
                type="password"
                className="api-key-input"
                value={config.authToken}
                onChange={(e) => handleFieldChange('authToken', e.target.value)}
                placeholder="your-auth-token"
              />
              <span className="api-key-hint">
                Authentication token for the sync server
              </span>
            </div>
          </div>

          <div className="provider-panel-section">
            <h4 className="provider-panel-section-title">Connection Status</h4>

            <div className="test-connection-section">
              <button
                className={`test-connection-button ${testStatus}`}
                onClick={onTestConnection}
                disabled={testStatus === 'testing' || !config.serverUrl || !config.userId}
              >
                {testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
              </button>

              {testStatus === 'success' && (
                <span className="test-status success">Connected successfully</span>
              )}
              {testStatus === 'error' && (
                <span className="test-status error">{testMessage || 'Connection failed'}</span>
              )}
            </div>
          </div>

          {isDevelopment && (
            <div className="provider-panel-section">
              <h4 className="provider-panel-section-title">Quick Setup (Development)</h4>
              <p className="provider-panel-hint">
                To start a local sync server:
              </p>
              <pre style={{
                background: 'var(--surface-secondary)',
                padding: '12px',
                borderRadius: '6px',
                fontSize: '12px',
                overflow: 'auto',
                margin: '8px 0'
              }}>
{`cd packages/collabv2
npm run db:migrate  # First time only
npm run dev`}
              </pre>
              <button
                className="test-connection-button"
                onClick={() => {
                  onConfigChange({
                    ...config,
                    serverUrl: 'ws://localhost:8788',
                    userId: 'dev-user',
                    authToken: 'dev-token',
                  });
                }}
                style={{ marginTop: '8px' }}
              >
                Use Local Dev Defaults
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
