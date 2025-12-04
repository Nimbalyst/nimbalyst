import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarcodeScanner, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning';
import { useSync } from '../contexts/CollabV3SyncContext';
import { SyncStatusBadge } from '../components/SyncStatusBadge';
import {
  loadCredentials,
  clearCredentials,
  parseQRPayload,
  saveFromQRPayload,
  toSyncConfig,
  type SyncCredentials,
} from '../services/CredentialService';

export function SettingsScreen() {
  const navigate = useNavigate();
  const { config, setConfig, status, isConfigured } = useSync();

  const [credentials, setCredentials] = useState<SyncCredentials | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [showManualEntry, setShowManualEntry] = useState(false);

  // Manual entry form state (fallback)
  const [serverUrl, setServerUrl] = useState(config?.serverUrl ?? 'ws://localhost:8790');
  const [userId, setUserId] = useState(config?.userId ?? '');
  const [authToken, setAuthToken] = useState(config?.authToken ?? '');
  const [encryptionKey, setEncryptionKey] = useState('');

  // Dev mode setup
  const [showDevSetup, setShowDevSetup] = useState(false);
  const [devJsonInput, setDevJsonInput] = useState('');
  const [devJsonError, setDevJsonError] = useState<string | null>(null);

  // Load credentials on mount
  useEffect(() => {
    async function load() {
      const creds = await loadCredentials();
      setCredentials(creds);
      if (creds) {
        // Also load into sync context
        const syncConfig = await toSyncConfig();
        if (syncConfig) {
          setConfig(syncConfig);
        }
      }
    }
    load();
  }, [setConfig]);

  // Update form when config changes
  useEffect(() => {
    if (config) {
      setServerUrl(config.serverUrl);
      setUserId(config.userId);
      setAuthToken(config.authToken);
    }
  }, [config]);

  const handleScanQR = async () => {
    setScanError(null);

    try {
      // Check if barcode scanning is supported
      const { supported } = await BarcodeScanner.isSupported();
      if (!supported) {
        setScanError('Barcode scanning is not supported on this device');
        return;
      }

      // Request camera permission
      const { camera } = await BarcodeScanner.requestPermissions();
      if (camera !== 'granted' && camera !== 'limited') {
        setScanError('Camera permission is required to scan QR codes');
        return;
      }

      setIsScanning(true);

      // Start scanning
      const result = await BarcodeScanner.scan({
        formats: [BarcodeFormat.QrCode],
      });

      setIsScanning(false);

      if (result.barcodes.length > 0) {
        const rawValue = result.barcodes[0].rawValue;
        if (rawValue) {
          await handleQRData(rawValue);
        } else {
          setScanError('Could not read QR code data');
        }
      } else {
        setScanError('No QR code detected');
      }
    } catch (error) {
      setIsScanning(false);
      console.error('[SettingsScreen] Scan error:', error);
      setScanError(error instanceof Error ? error.message : 'Failed to scan QR code');
    }
  };

  const handleQRData = async (data: string) => {
    const payload = parseQRPayload(data);
    if (!payload) {
      setScanError('Invalid QR code. Please scan a Nimbalyst pairing QR code.');
      return;
    }

    try {
      // Save credentials from QR payload
      const creds = await saveFromQRPayload(payload);
      setCredentials(creds);

      // Update sync config
      const syncConfig = await toSyncConfig();
      if (syncConfig) {
        setConfig(syncConfig);
      }

      setScanError(null);
      // Navigate back to session list
      navigate('/');
    } catch (error) {
      console.error('[SettingsScreen] Failed to save credentials:', error);
      setScanError('Failed to save credentials');
    }
  };

  const handleDisconnect = async () => {
    await clearCredentials();
    setCredentials(null);
    setConfig(null);
    setServerUrl('ws://localhost:8790');
    setUserId('');
    setAuthToken('');
    setEncryptionKey('');
  };

  // Manual entry save
  const handleManualSave = () => {
    if (serverUrl && userId && authToken) {
      setConfig({
        serverUrl: serverUrl.trim(),
        userId: userId.trim(),
        authToken: authToken.trim(),
        encryptionPassphrase: encryptionKey.trim() || undefined,
      });
      setShowManualEntry(false);
    }
  };

  const isManualValid = serverUrl.trim() !== '' && userId.trim() !== '' && authToken.trim() !== '';

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
          {isConfigured && credentials && (
            <div className="text-xs text-[var(--text-tertiary)]">
              Connected as {credentials.userId.slice(0, 8)}...
            </div>
          )}
          {!isConfigured && (
            <div className="text-xs text-[var(--text-tertiary)]">
              Scan QR code from desktop app to connect
            </div>
          )}
        </div>

        {/* QR Code Scanning Section */}
        {!isConfigured && !showManualEntry && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">
              Pair with Desktop
            </h2>

            <div className="p-6 rounded-lg bg-[var(--surface-secondary)] border border-[var(--border-primary)] text-center">
              <div className="mb-4">
                <svg className="w-16 h-16 mx-auto text-[var(--text-tertiary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="3" height="3" />
                  <rect x="18" y="14" width="3" height="3" />
                  <rect x="14" y="18" width="3" height="3" />
                  <rect x="18" y="18" width="3" height="3" />
                </svg>
              </div>

              <p className="text-sm text-[var(--text-secondary)] mb-4">
                Scan the QR code from Nimbalyst desktop app to sync your sessions securely.
              </p>

              <button
                onClick={handleScanQR}
                disabled={isScanning}
                className="w-full py-3 px-4 rounded-lg font-medium text-white bg-[var(--primary-color)] hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {isScanning ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Scanning...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                    </svg>
                    Scan QR Code
                  </span>
                )}
              </button>

              {scanError && (
                <div className="mt-3 p-3 rounded-lg bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.3)]">
                  <p className="text-sm text-[var(--error-color)]">{scanError}</p>
                </div>
              )}

              <button
                onClick={() => setShowManualEntry(true)}
                className="mt-4 text-sm text-[var(--text-tertiary)] underline"
              >
                Enter manually instead
              </button>
            </div>
          </div>
        )}

        {/* Manual Entry Section */}
        {showManualEntry && !isConfigured && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
                Manual Configuration
              </h2>
              <button
                onClick={() => setShowManualEntry(false)}
                className="text-sm text-[var(--primary-color)]"
              >
                Back to QR
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
                  Server URL
                </label>
                <input
                  type="text"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="ws://localhost:8790"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--surface-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)]"
                />
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
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
                  Encryption Key (Optional)
                </label>
                <input
                  type="password"
                  value={encryptionKey}
                  onChange={(e) => setEncryptionKey(e.target.value)}
                  placeholder="encryption-key-from-qr"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--surface-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)]"
                />
                <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                  Required for end-to-end encryption. Get this from the QR code.
                </p>
              </div>

              <button
                onClick={handleManualSave}
                disabled={!isManualValid}
                className="w-full py-3 px-4 rounded-lg font-medium text-white bg-[var(--primary-color)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              >
                Connect
              </button>
            </div>
          </div>
        )}

        {/* Connected State */}
        {isConfigured && credentials && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">
              Connection Details
            </h2>

            <div className="p-4 rounded-lg bg-[var(--surface-secondary)] border border-[var(--border-primary)] space-y-3">
              <div>
                <span className="text-xs text-[var(--text-tertiary)]">Server</span>
                <p className="text-sm text-[var(--text-primary)] font-mono truncate">
                  {credentials.serverUrl}
                </p>
              </div>

              <div>
                <span className="text-xs text-[var(--text-tertiary)]">User ID</span>
                <p className="text-sm text-[var(--text-primary)] font-mono truncate">
                  {credentials.userId}
                </p>
              </div>

              <div>
                <span className="text-xs text-[var(--text-tertiary)]">Paired</span>
                <p className="text-sm text-[var(--text-primary)]">
                  {new Date(credentials.pairedAt).toLocaleDateString()}
                </p>
              </div>

              <div>
                <span className="text-xs text-[var(--text-tertiary)]">Encryption</span>
                <p className="text-sm text-[var(--success-color)] flex items-center gap-1">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                  End-to-end encrypted
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        {isConfigured && (
          <div className="space-y-3">
            <button
              onClick={handleDisconnect}
              className="w-full py-3 px-4 rounded-lg font-medium text-[var(--error-color)] bg-transparent border border-[var(--error-color)] hover:bg-[var(--error-color)] hover:text-white transition-colors"
            >
              Disconnect
            </button>
          </div>
        )}

        {/* Help Section */}
        <div className="mt-8 p-4 rounded-lg bg-[var(--surface-secondary)] border border-[var(--border-primary)]">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">
            How to connect
          </h3>
          <ol className="text-xs text-[var(--text-secondary)] space-y-2 list-decimal list-inside">
            <li>Open Nimbalyst on your desktop</li>
            <li>Go to Settings &gt; Session Sync</li>
            <li>Enable sync and configure the server</li>
            <li>Click "Pair Mobile Device"</li>
            <li>Scan the QR code with this app</li>
          </ol>
        </div>

        {/* Dev Mode Setup - Only visible in development */}
        {import.meta.env.DEV && (
          <div className="mt-8">
            <button
              onClick={() => setShowDevSetup(!showDevSetup)}
              className="w-full py-3 px-4 rounded-lg font-medium text-white bg-orange-500 hover:bg-orange-600 transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
              {showDevSetup ? 'Hide Dev Setup' : 'Dev Mode Setup'}
            </button>

            {showDevSetup && (
              <div className="mt-4 p-4 rounded-lg bg-orange-500/10 border-2 border-orange-500/50">
                <h3 className="text-sm font-semibold text-orange-500 mb-3 flex items-center gap-2">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  Development Only
                </h3>
                <p className="text-xs text-[var(--text-secondary)] mb-4">
                  To test sync in a desktop browser:
                </p>

                <ol className="text-xs text-[var(--text-secondary)] space-y-2 list-decimal list-inside mb-4">
                  <li>Open Nimbalyst desktop app (in dev mode)</li>
                  <li>Go to Settings &gt; Session Sync</li>
                  <li>Click "Pair Mobile Device"</li>
                  <li>Click the orange "Copy JSON (Dev Mode)" button</li>
                  <li>Paste the JSON below</li>
                </ol>

                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-orange-500 mb-1">
                      Paste QR JSON Payload
                    </label>
                    <textarea
                      value={devJsonInput}
                      onChange={(e) => {
                        setDevJsonInput(e.target.value);
                        setDevJsonError(null);
                      }}
                      placeholder='{"version":1,"serverUrl":"ws://...","userId":"...","authToken":"...","encryptionKeySeed":"...","expiresAt":...}'
                      className="w-full px-3 py-2 rounded-lg border border-orange-500/50 bg-[var(--surface-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono text-xs"
                      rows={4}
                    />
                  </div>

                  {devJsonError && (
                    <div className="p-2 rounded-lg bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.3)]">
                      <p className="text-xs text-[var(--error-color)]">{devJsonError}</p>
                    </div>
                  )}

                  <button
                    onClick={async () => {
                      try {
                        const payload = parseQRPayload(devJsonInput);
                        if (!payload) {
                          setDevJsonError('Invalid JSON format. Make sure to copy the full payload from the desktop app.');
                          return;
                        }

                        // Save credentials from payload
                        const creds = await saveFromQRPayload(payload);
                        setCredentials(creds);

                        // Update sync config
                        const syncConfig = await toSyncConfig();
                        if (syncConfig) {
                          setConfig(syncConfig);
                        }

                        setDevJsonInput('');
                        setShowDevSetup(false);
                        navigate('/');
                      } catch (error) {
                        console.error('[SettingsScreen] Dev setup error:', error);
                        setDevJsonError(error instanceof Error ? error.message : 'Failed to parse JSON');
                      }
                    }}
                    disabled={!devJsonInput.trim()}
                    className="w-full py-2 px-4 rounded-lg font-medium text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Connect with JSON
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
