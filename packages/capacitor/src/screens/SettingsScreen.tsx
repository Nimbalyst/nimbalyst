import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSync } from '../contexts/SyncContext';
import { SyncStatusBadge } from '../components/SyncStatusBadge';

export function SettingsScreen() {
  const navigate = useNavigate();
  const { config, setConfig, status, isConfigured } = useSync();

  const [serverUrl, setServerUrl] = useState(config?.serverUrl ?? 'ws://localhost:8788');
  const [userId, setUserId] = useState(config?.userId ?? '');
  const [authToken, setAuthToken] = useState(config?.authToken ?? '');

  // Update form when config changes
  useEffect(() => {
    if (config) {
      setServerUrl(config.serverUrl);
      setUserId(config.userId);
      setAuthToken(config.authToken);
    }
  }, [config]);

  const handleSave = () => {
    if (serverUrl && userId && authToken) {
      setConfig({
        serverUrl: serverUrl.trim(),
        userId: userId.trim(),
        authToken: authToken.trim(),
      });
    }
  };

  const handleDisconnect = () => {
    setConfig(null);
    setServerUrl('ws://localhost:8788');
    setUserId('');
    setAuthToken('');
  };

  const isValid = serverUrl.trim() !== '' && userId.trim() !== '' && authToken.trim() !== '';

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <header className="flex items-center px-4 py-3 border-b border-[var(--border-primary)] bg-[var(--surface-secondary)]">
        <button
          onClick={() => navigate('/')}
          className="mr-3 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6"/>
          </svg>
        </button>
        <h1 className="text-lg font-semibold">Settings</h1>
      </header>

      {/* Content */}
      <main className="flex-1 p-4">
        {/* Sync Status Card */}
        <div className="mb-6 p-4 rounded-lg bg-[var(--surface-secondary)] border border-[var(--border-primary)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-[var(--text-secondary)]">Sync Status</span>
            <SyncStatusBadge />
          </div>
          {isConfigured && (
            <div className="text-xs text-[var(--text-tertiary)]">
              Connected to {config?.serverUrl}
            </div>
          )}
          {!isConfigured && (
            <div className="text-xs text-[var(--text-tertiary)]">
              Configure sync settings below to connect
            </div>
          )}
        </div>

        {/* Sync Configuration */}
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">
            Sync Configuration
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
                Server URL
              </label>
              <input
                type="text"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="ws://localhost:8788"
                className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--surface-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)]"
              />
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                WebSocket URL of your sync server
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
                User ID
              </label>
              <input
                type="text"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="your-user-id"
                className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--surface-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
                Auth Token
              </label>
              <input
                type="password"
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                placeholder="your-auth-token"
                className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--surface-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)]"
              />
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                Authentication token from QR code or manual setup
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3">
          <button
            onClick={handleSave}
            disabled={!isValid}
            className="w-full py-3 px-4 rounded-lg font-medium text-white bg-[var(--primary-color)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {isConfigured ? 'Update Configuration' : 'Connect'}
          </button>

          {isConfigured && (
            <button
              onClick={handleDisconnect}
              className="w-full py-3 px-4 rounded-lg font-medium text-[var(--error-color)] bg-transparent border border-[var(--error-color)] hover:bg-[var(--error-color)] hover:text-white transition-colors"
            >
              Disconnect
            </button>
          )}
        </div>

        {/* Help Section */}
        <div className="mt-8 p-4 rounded-lg bg-[var(--surface-secondary)] border border-[var(--border-primary)]">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">
            How to connect
          </h3>
          <ol className="text-xs text-[var(--text-secondary)] space-y-2 list-decimal list-inside">
            <li>Start the sync server: <code className="bg-[var(--surface-tertiary)] px-1 rounded">cd packages/collabv2 && npm run dev</code></li>
            <li>Enter the server URL (default: ws://localhost:8788)</li>
            <li>Enter your user ID and auth token</li>
            <li>Tap Connect to start syncing</li>
          </ol>
        </div>
      </main>
    </div>
  );
}
