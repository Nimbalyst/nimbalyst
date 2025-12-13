import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarcodeScanner, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning';
import { useSync, INACTIVITY_TIMEOUT_OPTIONS } from '../contexts/CollabV3SyncContext';
import { SyncStatusBadge } from '../components/SyncStatusBadge';
import {
  loadCredentials,
  clearCredentials,
  parseQRPayload,
  saveFromQRPayload,
  type SyncCredentials,
} from '../services/CredentialService';
import {
  startGoogleLogin,
  sendMagicLink,
  loadSession,
  clearSession,
  saveSession,
  type StytchSession,
} from '../services/StytchAuthService';

export function SettingsScreen() {
  const navigate = useNavigate();
  const { isAuthenticated, isPaired, serverUrl, status, reconnect, inactivityTimeoutMinutes, setInactivityTimeoutMinutes } = useSync();

  const [credentials, setCredentials] = useState<SyncCredentials | null>(null);
  const [stytchSession, setStytchSession] = useState<StytchSession | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Email login state
  const [email, setEmail] = useState('');
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  // Dev mode setup
  const [showDevSetup, setShowDevSetup] = useState(false);
  const [devJsonInput, setDevJsonInput] = useState('');
  const [devJsonError, setDevJsonError] = useState<string | null>(null);
  const [devSessionInput, setDevSessionInput] = useState('');
  const [devSessionError, setDevSessionError] = useState<string | null>(null);

  // Load credentials and session on mount
  useEffect(() => {
    async function load() {
      const creds = await loadCredentials();
      setCredentials(creds);

      const session = await loadSession();
      setStytchSession(session);
    }
    load();
  }, []);

  // Refresh stytch session after potential auth callback
  useEffect(() => {
    async function refreshSession() {
      const session = await loadSession();
      setStytchSession(session);
      if (session && isLoggingIn) {
        setIsLoggingIn(false);
      }
    }

    // Check periodically in case auth completed in background
    const interval = setInterval(refreshSession, 1000);
    return () => clearInterval(interval);
  }, [isLoggingIn]);

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
      setScanError(null);

      // Trigger reconnect to use new credentials
      await reconnect();

      // If already authenticated, go back to session list
      if (isAuthenticated) {
        navigate('/');
      }
    } catch (error) {
      console.error('[SettingsScreen] Failed to save credentials:', error);
      setScanError('Failed to save credentials');
    }
  };

  const handleGoogleLogin = async () => {
    if (!serverUrl) {
      throw new Error('handleGoogleLogin called without serverUrl - UI should prevent this');
    }

    setIsLoggingIn(true);
    setScanError(null);

    try {
      await startGoogleLogin(serverUrl);
      // Browser will open, user will authenticate, then deep link will bring them back
    } catch (error) {
      console.error('[SettingsScreen] Login error:', error);
      setScanError('Failed to start login');
      setIsLoggingIn(false);
    }
  };

  const handleDisconnect = async () => {
    await clearCredentials();
    await clearSession();
    setCredentials(null);
    setStytchSession(null);
    await reconnect();
  };

  const handleLogout = async () => {
    await clearSession();
    setStytchSession(null);
    await reconnect();
  };

  const handleSendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serverUrl) {
      throw new Error('handleSendMagicLink called without serverUrl - UI should prevent this');
    }
    if (!email) {
      setScanError('Please enter your email address');
      return;
    }

    setIsLoggingIn(true);
    setScanError(null);

    try {
      const result = await sendMagicLink(email, serverUrl);

      if (!result.success && result.error) {
        setScanError(result.error);
      } else {
        setMagicLinkSent(true);
      }
    } catch (error) {
      console.error('[SettingsScreen] Magic link error:', error);
      setScanError('Failed to send magic link');
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Determine what state we're in
  // Use serverUrl as the gate for login - it must be set before we can authenticate
  const needsPairing = !isPaired;
  const needsLogin = isPaired && !isAuthenticated && !!serverUrl;
  const isConnected = isPaired && isAuthenticated;

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header with safe area for notch */}
      <header className="flex items-center px-4 py-3 border-b border-[var(--border-primary)] bg-[var(--surface-secondary)] safe-area-top">
        <button
          onClick={() => navigate('/')}
          className="mr-3 p-1 text-[var(--text-primary)] active:opacity-70"
          aria-label="Go back"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6"/>
          </svg>
        </button>
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">Settings</h1>
      </header>

      {/* Content */}
      <main className="flex-1 p-4">
        {/* Sync Status Card */}
        <div className="mb-6 p-4 rounded-lg bg-[var(--surface-secondary)] border border-[var(--border-primary)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-[var(--text-secondary)]">Sync Status</span>
            <SyncStatusBadge />
          </div>
          {isConnected && stytchSession && (
            <div className="text-xs text-[var(--text-tertiary)]">
              Signed in as {stytchSession.email}
            </div>
          )}
          {needsLogin && (
            <div className="text-xs text-[var(--text-tertiary)]">
              QR paired - please sign in with Google
            </div>
          )}
          {needsPairing && (
            <div className="text-xs text-[var(--text-tertiary)]">
              Scan QR code from desktop app to connect
            </div>
          )}
        </div>

        {/* Error display */}
        {scanError && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-sm">
            {scanError}
          </div>
        )}

        {/* Step 1: QR Code Scanning (if not paired) */}
        {needsPairing && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">
              Step 1: Pair with Desktop
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
                Open Settings on the desktop app and show the pairing QR code.
              </p>

              <button
                onClick={handleScanQR}
                disabled={isScanning}
                className="w-full py-3 px-4 rounded-lg bg-[var(--primary-color)] text-white font-medium disabled:opacity-50"
              >
                {isScanning ? 'Scanning...' : 'Scan QR Code'}
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Login (if paired but not logged in) */}
        {needsLogin && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">
              Step 2: Sign In
            </h2>

            <div className="p-6 rounded-lg bg-[var(--surface-secondary)] border border-[var(--border-primary)]">
              {magicLinkSent ? (
                // Magic link sent confirmation
                <div className="text-center">
                  <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
                    <svg className="w-6 h-6 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                  </div>
                  <p className="text-sm text-[var(--text-primary)] font-medium mb-2">
                    Check your email
                  </p>
                  <p className="text-xs text-[var(--text-secondary)] mb-4">
                    We sent a login link to {email}
                  </p>
                  <button
                    onClick={() => {
                      setMagicLinkSent(false);
                      setEmail('');
                    }}
                    className="text-xs text-[var(--primary-color)]"
                  >
                    Use a different email
                  </button>
                </div>
              ) : (
                <>
                  <div className="text-center mb-4">
                    <svg className="w-12 h-12 mx-auto text-[var(--text-tertiary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </div>

                  <p className="text-sm text-[var(--text-secondary)] mb-4 text-center">
                    Sign in to sync your AI sessions.
                  </p>

                  {/* Google Sign In */}
                  <button
                    onClick={handleGoogleLogin}
                    disabled={isLoggingIn}
                    className="w-full py-3 px-4 rounded-lg bg-white text-gray-800 font-medium border border-gray-300 flex items-center justify-center gap-3 disabled:opacity-50 mb-4"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                    </svg>
                    {isLoggingIn ? 'Signing in...' : 'Sign in with Google'}
                  </button>

                  {/* Divider */}
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex-1 h-px bg-[var(--border-primary)]" />
                    <span className="text-xs text-[var(--text-tertiary)]">or</span>
                    <div className="flex-1 h-px bg-[var(--border-primary)]" />
                  </div>

                  {/* Email Magic Link */}
                  <form onSubmit={handleSendMagicLink}>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Enter your email"
                      className="w-full px-4 py-3 rounded-lg border border-[var(--border-primary)] bg-[var(--surface-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] mb-3"
                      disabled={isLoggingIn}
                    />
                    <button
                      type="submit"
                      disabled={isLoggingIn || !email}
                      className="w-full py-3 px-4 rounded-lg bg-[var(--primary-color)] text-white font-medium disabled:opacity-50"
                    >
                      {isLoggingIn ? 'Sending...' : 'Send login link'}
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        )}

        {/* Connected State */}
        {isConnected && (
          <>
            {/* Account Info */}
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">
                Account
              </h2>

              <div className="p-4 rounded-lg bg-[var(--surface-secondary)] border border-[var(--border-primary)]">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-[var(--primary-color)] flex items-center justify-center text-white font-medium">
                    {stytchSession?.email?.charAt(0).toUpperCase() || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{stytchSession?.email || 'Unknown'}</div>
                    <div className="text-xs text-[var(--text-tertiary)]">Google Account</div>
                  </div>
                </div>

                <button
                  onClick={handleLogout}
                  className="w-full py-2 px-4 rounded-lg border border-[var(--border-primary)] text-[var(--text-secondary)] text-sm"
                >
                  Sign Out
                </button>
              </div>
            </div>

            {/* Pairing Info */}
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">
                Pairing
              </h2>

              <div className="p-4 rounded-lg bg-[var(--surface-secondary)] border border-[var(--border-primary)]">
                <div className="text-sm text-[var(--text-secondary)] mb-1">Server</div>
                <div className="text-xs text-[var(--text-tertiary)] font-mono truncate mb-3">
                  {serverUrl || 'Not configured'}
                </div>

                {credentials?.pairedAt && (
                  <>
                    <div className="text-sm text-[var(--text-secondary)] mb-1">Paired</div>
                    <div className="text-xs text-[var(--text-tertiary)] mb-3">
                      {new Date(credentials.pairedAt).toLocaleDateString()}
                    </div>
                  </>
                )}

                <div className="text-sm text-[var(--text-secondary)] mb-1">Encryption</div>
                <div className="text-xs text-green-500 flex items-center gap-1 mb-3">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                  End-to-end encrypted
                </div>

                <button
                  onClick={handleDisconnect}
                  className="w-full py-2 px-4 rounded-lg border border-red-500/30 text-red-500 text-sm"
                >
                  Disconnect & Unpair
                </button>
              </div>
            </div>
          </>
        )}

        {/* Re-pair option when already paired but want to change */}
        {isPaired && (
          <div className="mb-6">
            <button
              onClick={handleScanQR}
              disabled={isScanning}
              className="w-full py-2 px-4 rounded-lg border border-[var(--border-primary)] text-[var(--text-secondary)] text-sm"
            >
              {isScanning ? 'Scanning...' : 'Scan New QR Code'}
            </button>
          </div>
        )}

        {/* Sleep Settings */}
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">
            Sleep Settings
          </h2>

          <div className="p-4 rounded-lg bg-[var(--surface-secondary)] border border-[var(--border-primary)]">
            <div className="text-sm text-[var(--text-secondary)] mb-2">Disconnect after inactivity</div>
            <p className="text-xs text-[var(--text-tertiary)] mb-3">
              Disconnect sync when idle to let your device sleep and save battery.
            </p>

            <select
              value={inactivityTimeoutMinutes}
              onChange={(e) => setInactivityTimeoutMinutes(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--surface-primary)] text-[var(--text-primary)]"
            >
              {INACTIVITY_TIMEOUT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Help Section */}
        <div className="mt-8 p-4 rounded-lg bg-[var(--surface-secondary)] border border-[var(--border-primary)]">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">
            How to connect
          </h3>
          <ol className="text-xs text-[var(--text-secondary)] space-y-2 list-decimal list-inside">
            <li>Open Nimbalyst on your desktop</li>
            <li>Go to Settings &gt; Session Sync</li>
            <li>Click "Pair Mobile Device" to show QR code</li>
            <li>Scan the QR code with this app</li>
            <li>Sign in with your Google account</li>
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
                      placeholder='{"version":2,"serverUrl":"wss://...","encryptionKeySeed":"...","expiresAt":...}'
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
                        // First try to parse as JSON to give better error
                        let parsed;
                        try {
                          parsed = JSON.parse(devJsonInput.trim());
                        } catch (jsonError) {
                          setDevJsonError(`JSON parse error: ${jsonError instanceof Error ? jsonError.message : 'Invalid JSON'}`);
                          return;
                        }

                        const payload = parseQRPayload(devJsonInput);
                        if (!payload) {
                          // Provide specific error based on what's missing
                          const missing = [];
                          if (typeof parsed.version !== 'number') missing.push('version');
                          if (typeof parsed.serverUrl !== 'string') missing.push('serverUrl');
                          if (typeof parsed.encryptionKeySeed !== 'string') missing.push('encryptionKeySeed');
                          if (typeof parsed.expiresAt !== 'number') missing.push('expiresAt');

                          if (missing.length > 0) {
                            setDevJsonError(`Missing or invalid fields: ${missing.join(', ')}`);
                          } else if (parsed.expiresAt < Date.now()) {
                            setDevJsonError('QR code has expired. Generate a new one from the desktop app.');
                          } else {
                            setDevJsonError('Invalid payload format.');
                          }
                          return;
                        }

                        // Save credentials from payload
                        const creds = await saveFromQRPayload(payload);
                        setCredentials(creds);

                        // Trigger reconnect
                        await reconnect();

                        setDevJsonInput('');
                        setShowDevSetup(false);

                        // If already authenticated, navigate home
                        if (isAuthenticated) {
                          navigate('/');
                        }
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

                {/* Session Token Import - for browser testing */}
                {isPaired && !isAuthenticated && (
                  <div className="mt-6 pt-6 border-t-2 border-orange-500/30">
                    <h4 className="text-sm font-semibold text-orange-500 mb-2">
                      Import Session Tokens (Browser Testing)
                    </h4>
                    <p className="text-xs text-[var(--text-secondary)] mb-3">
                      After logging in via email in a browser, copy the session JSON from the success page and paste it here.
                    </p>

                    {devSessionError && (
                      <div className="mb-3 p-2 rounded-lg bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.3)]">
                        <p className="text-xs text-[var(--error-color)]">{devSessionError}</p>
                      </div>
                    )}

                    <textarea
                      value={devSessionInput}
                      onChange={(e) => {
                        setDevSessionInput(e.target.value);
                        setDevSessionError(null);
                      }}
                      placeholder='{"sessionToken": "...", "sessionJwt": "...", ...}'
                      className="w-full h-24 p-3 rounded-lg border-2 border-orange-500/50 bg-[var(--surface-primary)] text-[var(--text-primary)] text-xs font-mono placeholder:text-[var(--text-tertiary)] resize-none"
                    />

                    <button
                      onClick={async () => {
                        try {
                          setDevSessionError(null);
                          const parsed = JSON.parse(devSessionInput.trim());

                          if (!parsed.sessionToken || !parsed.sessionJwt || !parsed.userId) {
                            const missing = [];
                            if (!parsed.sessionToken) missing.push('sessionToken');
                            if (!parsed.sessionJwt) missing.push('sessionJwt');
                            if (!parsed.userId) missing.push('userId');
                            setDevSessionError(`Missing required fields: ${missing.join(', ')}`);
                            return;
                          }

                          const session: StytchSession = {
                            sessionToken: parsed.sessionToken,
                            sessionJwt: parsed.sessionJwt,
                            userId: parsed.userId,
                            email: parsed.email || '',
                            expiresAt: parsed.expiresAt || '',
                            refreshedAt: Date.now(),
                          };

                          await saveSession(session);
                          setStytchSession(session);
                          setDevSessionInput('');

                          // Trigger reconnect
                          await reconnect();
                          navigate('/');
                        } catch (error) {
                          console.error('[SettingsScreen] Dev session import error:', error);
                          setDevSessionError(error instanceof Error ? error.message : 'Invalid JSON');
                        }
                      }}
                      disabled={!devSessionInput.trim()}
                      className="mt-3 w-full py-2 px-4 rounded-lg font-medium text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Import Session
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
