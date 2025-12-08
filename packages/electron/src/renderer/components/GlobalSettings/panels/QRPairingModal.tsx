import React, { useState, useEffect, useCallback } from 'react';
import QRCode from 'qrcode';

interface QRPairingModalProps {
  isOpen: boolean;
  onClose: () => void;
  serverUrl: string;
}

/**
 * Check if the URL is a localhost/local dev server URL
 */
function isLocalDevServer(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
  } catch {
    return false;
  }
}

/**
 * Replace localhost in URL with the given IP address
 */
function replaceLocalhostWithIP(url: string, ip: string): string {
  try {
    const parsed = new URL(url);
    parsed.hostname = ip;
    return parsed.toString().replace(/\/$/, ''); // Remove trailing slash
  } catch {
    return url;
  }
}

/**
 * QR Pairing Modal
 *
 * Shows a QR code containing the encryption key seed for pairing with mobile devices.
 * Mobile devices authenticate independently via Stytch OAuth - the QR code only shares
 * the encryption key needed for E2E encrypted sync.
 */
export function QRPairingModal({ isOpen, onClose, serverUrl }: QRPairingModalProps) {
  const [qrDataUrl, setQRDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qrPayload, setQRPayload] = useState<object | null>(null);
  const [copied, setCopied] = useState(false);

  // Local dev server detection
  const [localIP, setLocalIP] = useState<string | null>(null);
  const [useLocalIP, setUseLocalIP] = useState(true); // Default to using LAN IP for local servers
  const [effectiveUrl, setEffectiveUrl] = useState(serverUrl);

  const isLocalServer = isLocalDevServer(serverUrl);
  const isDev = import.meta.env.DEV;

  // Fetch local IP when modal opens
  useEffect(() => {
    if (isOpen && isLocalServer) {
      window.electronAPI.network.getLocalIP().then((ip: string | null) => {
        setLocalIP(ip);
      });
    }
  }, [isOpen, isLocalServer]);

  // Update effective URL when toggle changes or local IP is fetched
  useEffect(() => {
    if (isLocalServer && localIP && useLocalIP) {
      setEffectiveUrl(replaceLocalhostWithIP(serverUrl, localIP));
    } else {
      setEffectiveUrl(serverUrl);
    }
  }, [isLocalServer, localIP, useLocalIP, serverUrl]);

  const generateQR = useCallback(async () => {
    if (!effectiveUrl) {
      setError('Server URL is required');
      return;
    }

    try {
      // Get QR payload from main process (with effective URL)
      // The payload contains only serverUrl and encryptionKeySeed
      // Mobile devices authenticate independently via Stytch OAuth
      const payload = await window.electronAPI.credentials.generateQRPayload(effectiveUrl);
      setQRPayload(payload);

      // Generate QR code data URL
      const dataUrl = await QRCode.toDataURL(JSON.stringify(payload), {
        width: 280,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
        errorCorrectionLevel: 'M',
      });

      setQRDataUrl(dataUrl);
      setError(null);
      setCopied(false);
    } catch (err) {
      console.error('[QRPairingModal] Failed to generate QR:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate QR code');
    }
  }, [effectiveUrl]);

  const handleCopyPayload = async () => {
    if (!qrPayload) return;
    try {
      const jsonString = JSON.stringify(qrPayload, null, 2);
      console.log('[QRPairingModal] Copying payload:', jsonString);
      await navigator.clipboard.writeText(jsonString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('[QRPairingModal] Failed to copy:', err);
    }
  };

  // Generate QR when modal opens or effective URL changes
  useEffect(() => {
    if (isOpen && effectiveUrl) {
      generateQR();
    }
  }, [isOpen, effectiveUrl, generateQR]);

  // Clear state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setQRDataUrl(null);
      setError(null);
      setQRPayload(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="qr-modal-overlay" onClick={onClose}>
      <div className="qr-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="qr-modal-header">
          <h2 className="qr-modal-title">Pair Mobile Device</h2>
          <button className="qr-modal-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 5L5 15M5 5l10 10" />
            </svg>
          </button>
        </div>

        <div className="qr-modal-body">
          {/* Local dev server notice */}
          {isLocalServer && localIP && (
            <div className="qr-dev-notice">
              <div className="qr-dev-notice-header">
                <svg className="qr-dev-notice-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM7 5a1 1 0 112 0v3a1 1 0 11-2 0V5zm1 7a1 1 0 100-2 1 1 0 000 2z" />
                </svg>
                <span>Local Development Server</span>
              </div>
              <p className="qr-dev-notice-text">
                Your phone needs to connect via your local network IP instead of localhost.
              </p>
              <label className="qr-dev-toggle">
                <input
                  type="checkbox"
                  checked={useLocalIP}
                  onChange={(e) => setUseLocalIP(e.target.checked)}
                />
                <span className="qr-dev-toggle-text">
                  Use LAN IP: <code>{localIP}</code>
                </span>
              </label>
              <p className="qr-dev-notice-url">
                Server URL in QR: <code>{effectiveUrl}</code>
              </p>
            </div>
          )}

          {error ? (
            <div className="qr-error">
              <p>{error}</p>
              <button className="qr-regenerate-button" onClick={generateQR}>
                Try Again
              </button>
            </div>
          ) : qrDataUrl ? (
            <>
              <div className="qr-code-container">
                <img src={qrDataUrl} alt="QR Code for mobile pairing" className="qr-code-image" />
              </div>

              <div className="qr-instructions">
                <p className="qr-step">1. Open Nimbalyst on your mobile device</p>
                <p className="qr-step">2. Sign in with Google (same account as desktop)</p>
                <p className="qr-step">3. Go to Settings and tap "Scan QR Code"</p>
                <p className="qr-step">4. Point your camera at this QR code</p>
              </div>

              <div className="qr-info" style={{
                marginTop: '12px',
                padding: '12px',
                backgroundColor: 'var(--surface-secondary)',
                borderRadius: '8px',
                fontSize: '13px',
                color: 'var(--text-secondary)',
              }}>
                <p style={{ margin: 0 }}>
                  This QR code shares your encryption key for E2E encrypted sync.
                  Your mobile device will authenticate separately with Google Sign-In.
                </p>
              </div>

              <div className="qr-warning">
                <svg className="qr-warning-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM7 5a1 1 0 112 0v3a1 1 0 11-2 0V5zm1 7a1 1 0 100-2 1 1 0 000 2z" />
                </svg>
                <span>Only scan with your own device. This shares your encryption key.</span>
              </div>

              <button className="qr-regenerate-button" onClick={generateQR}>
                Regenerate QR Code
              </button>

              {/* Dev mode: Copy JSON payload for browser testing */}
              {isDev && qrPayload && (
                <div className="qr-dev-copy">
                  <button
                    className="qr-dev-copy-button"
                    onClick={handleCopyPayload}
                    style={{
                      marginTop: '12px',
                      padding: '8px 16px',
                      backgroundColor: copied ? '#22c55e' : '#f97316',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      fontWeight: 500,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      width: '100%',
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      {copied ? (
                        <path d="M20 6L9 17l-5-5" />
                      ) : (
                        <>
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                        </>
                      )}
                    </svg>
                    {copied ? 'Copied!' : 'Copy JSON (Dev Mode)'}
                  </button>
                  <p style={{
                    marginTop: '8px',
                    fontSize: '11px',
                    color: 'var(--text-tertiary)',
                    textAlign: 'center',
                  }}>
                    Paste this into the mobile app's Manual Configuration form
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="qr-loading">
              <div className="qr-spinner" />
              <p>Generating QR code...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
