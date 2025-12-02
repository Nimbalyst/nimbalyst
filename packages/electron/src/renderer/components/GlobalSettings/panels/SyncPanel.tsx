import React, { useState, useEffect } from 'react';
import { QRPairingModal } from './QRPairingModal';

export interface SyncConfig {
  enabled: boolean;
  serverUrl: string;
  userId: string;
  authToken: string;
  enabledProjects?: string[]; // workspace paths that are enabled for sync
}

interface Project {
  path: string;
  name: string;
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [userId, setUserId] = useState<string>('');
  const [isSecureStorage, setIsSecureStorage] = useState<boolean>(false);
  const [showQRModal, setShowQRModal] = useState(false);
  const [copiedUserId, setCopiedUserId] = useState(false);

  // Load credentials info on mount
  useEffect(() => {
    async function loadCredentials() {
      try {
        const creds = await window.electronAPI.credentials.get();
        setUserId(creds.userId);
        setIsSecureStorage(creds.isSecure);
      } catch (error) {
        console.error('Failed to load credentials:', error);
      }
    }
    loadCredentials();
  }, []);

  // Load projects from workspace store
  useEffect(() => {
    async function loadProjects() {
      try {
        const workspaces = await window.electronAPI.invoke('get-recent-workspaces');
        setProjects(workspaces.map((ws: any) => ({
          path: ws.path,
          name: ws.name,
        })));
      } catch (error) {
        console.error('Failed to load workspaces:', error);
      }
    }
    loadProjects();
  }, []);

  const handleFieldChange = (field: keyof SyncConfig, value: string | boolean) => {
    onConfigChange({ ...config, [field]: value });
  };

  const handleProjectToggle = (projectPath: string, enabled: boolean) => {
    const enabledProjects = config.enabledProjects || [];
    const updated = enabled
      ? [...enabledProjects, projectPath]
      : enabledProjects.filter(p => p !== projectPath);

    onConfigChange({ ...config, enabledProjects: updated });
  };

  const isProjectEnabled = (projectPath: string): boolean => {
    // If enabledProjects is not set, default to all enabled
    if (!config.enabledProjects) return true;
    return config.enabledProjects.includes(projectPath);
  };

  const handleCopyUserId = async () => {
    try {
      await navigator.clipboard.writeText(userId);
      setCopiedUserId(true);
      setTimeout(() => setCopiedUserId(false), 2000);
    } catch (error) {
      console.error('Failed to copy user ID:', error);
    }
  };

  return (
    <div className="provider-panel">
      <div className="provider-panel-header">
        <h3 className="provider-panel-title">Session Sync</h3>
        <p className="provider-panel-description">
          Sync AI sessions across devices with end-to-end encryption.
          Pair your mobile device using a QR code to access sessions on the go.
        </p>
      </div>

      {/* Device Identity Section */}
      <div className="provider-panel-section">
        <h4 className="provider-panel-section-title">Device Identity</h4>
        <p className="provider-panel-hint" style={{ marginBottom: '12px' }}>
          Your unique device ID is auto-generated and stored securely{isSecureStorage ? ' in your system keychain' : ''}.
        </p>

        <div className="user-id-display">
          <span className="user-id-value">{userId || 'Loading...'}</span>
          <button
            className="user-id-copy-button"
            onClick={handleCopyUserId}
            disabled={!userId}
          >
            {copiedUserId ? 'Copied!' : 'Copy'}
          </button>
        </div>
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
              Configure the sync server connection. For local development, use ws://localhost:8790
            </p>

            <div className="api-key-section">
              <label className="api-key-label">Server URL</label>
              <input
                type="text"
                className="api-key-input"
                value={config.serverUrl}
                onChange={(e) => handleFieldChange('serverUrl', e.target.value)}
                placeholder="ws://localhost:8790"
              />
              <span className="api-key-hint">
                WebSocket URL of the sync server (e.g., ws://localhost:8790 or wss://sync.example.com)
              </span>
            </div>
          </div>

          {/* Mobile Pairing Section */}
          <div className="provider-panel-section">
            <h4 className="provider-panel-section-title">Mobile Device Pairing</h4>
            <p className="provider-panel-hint" style={{ marginBottom: '16px' }}>
              Scan the QR code with the Nimbalyst mobile app to sync sessions to your phone or tablet.
              The QR code contains your encrypted credentials.
            </p>

            <button
              className="pair-device-button"
              onClick={() => setShowQRModal(true)}
              disabled={!config.serverUrl}
            >
              <svg className="pair-device-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="3" height="3" />
                <rect x="18" y="14" width="3" height="3" />
                <rect x="14" y="18" width="3" height="3" />
                <rect x="18" y="18" width="3" height="3" />
              </svg>
              Pair Mobile Device
            </button>

            {!config.serverUrl && (
              <p className="provider-panel-hint" style={{ marginTop: '8px', color: 'var(--text-tertiary)' }}>
                Enter a server URL above to enable mobile pairing.
              </p>
            )}
          </div>

          <div className="provider-panel-section">
            <h4 className="provider-panel-section-title">Connection Status</h4>

            <div className="test-connection-section">
              <button
                className={`test-connection-button ${testStatus}`}
                onClick={onTestConnection}
                disabled={testStatus === 'testing' || !config.serverUrl}
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

          <div className="provider-panel-section">
            <h4 className="provider-panel-section-title">Projects to Sync</h4>
            <p className="provider-panel-hint">
              Select which projects should sync their AI sessions to other devices.
            </p>

            {projects.length === 0 ? (
              <p className="provider-panel-hint" style={{ fontStyle: 'italic', marginTop: '12px' }}>
                No projects found. Open a workspace to see projects here.
              </p>
            ) : (
              <div style={{ marginTop: '12px' }}>
                {projects.map((project) => (
                  <div key={project.path} className="setting-item">
                    <label className="setting-label">
                      <input
                        type="checkbox"
                        checked={isProjectEnabled(project.path)}
                        onChange={(e) => handleProjectToggle(project.path, e.target.checked)}
                        className="setting-checkbox"
                      />
                      <div className="setting-text">
                        <span className="setting-name">{project.name}</span>
                        <span className="setting-description" style={{ fontSize: '11px', opacity: 0.6 }}>
                          {project.path}
                        </span>
                      </div>
                    </label>
                  </div>
                ))}
              </div>
            )}
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
{`cd packages/collabv3
npm run dev`}
              </pre>
              <button
                className="test-connection-button"
                onClick={() => {
                  onConfigChange({
                    ...config,
                    serverUrl: 'ws://localhost:8790',
                  });
                }}
                style={{ marginTop: '8px' }}
              >
                Use Local Dev Server
              </button>
            </div>
          )}
        </>
      )}

      {/* QR Pairing Modal */}
      <QRPairingModal
        isOpen={showQRModal}
        onClose={() => setShowQRModal(false)}
        serverUrl={config.serverUrl}
      />
    </div>
  );
}
