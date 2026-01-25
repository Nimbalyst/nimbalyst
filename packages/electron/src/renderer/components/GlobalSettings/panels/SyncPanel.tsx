import React, { useState, useEffect, useCallback } from 'react';
import { usePostHog } from 'posthog-js/react';
import { useAtom, useAtomValue } from 'jotai';
import { QRPairingModal } from './QRPairingModal';
import {
  syncConfigAtom,
  setSyncConfigAtom,
  type SyncConfig,
} from '../../../store/atoms/appSettings';

/** Format a timestamp as relative time (e.g., "5 minutes ago") */
function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) {
    return 'just now';
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }

  return new Date(timestamp).toLocaleDateString();
}

// SyncConfig is now exported from appSettings.ts
// Re-export for backward compatibility
export type { SyncConfig } from '../../../store/atoms/appSettings';

interface Project {
  path: string;
  name: string;
}

interface DeviceInfo {
  device_id: string;
  name: string;
  type: 'desktop' | 'mobile' | 'tablet' | 'unknown';
  platform: string;
  app_version?: string;
  connected_at: number;
  last_active_at: number;
}

// NOTE: Props have been removed - SyncPanel now uses Jotai atoms directly.
// The component is self-contained and doesn't need external config management.

interface StytchAuthState {
  isAuthenticated: boolean;
  user: {
    user_id: string;
    emails: Array<{ email: string }>;
    name?: { first_name?: string; last_name?: string };
  } | null;
}

// Project Picker Popup Component
function ProjectPickerPopup({
  isOpen,
  onClose,
  projects,
  enabledProjects,
  onToggle,
}: {
  isOpen: boolean;
  onClose: () => void;
  projects: Project[];
  enabledProjects: string[];
  onToggle: (path: string, enabled: boolean) => void;
}) {
  if (!isOpen) return null;

  const enabledCount = projects.filter(p => enabledProjects.includes(p.path)).length;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--surface-primary)',
          borderRadius: '12px',
          width: '400px',
          maxHeight: '500px',
          overflow: 'hidden',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.3)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border-primary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
              Projects to Sync
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-tertiary)' }}>
              {enabledCount} of {projects.length} projects enabled
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
              color: 'var(--text-tertiary)',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 5L5 15M5 5l10 10" />
            </svg>
          </button>
        </div>

        <div style={{
          padding: '12px 20px',
          maxHeight: '350px',
          overflowY: 'auto',
        }}>
          {projects.length === 0 ? (
            <p style={{ color: 'var(--text-tertiary)', fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>
              No projects found. Open a workspace to see projects here.
            </p>
          ) : (
            projects.map((project) => (
              <label
                key={project.path}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px',
                  padding: '10px 0',
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--border-primary)',
                }}
              >
                <input
                  type="checkbox"
                  checked={enabledProjects.includes(project.path)}
                  onChange={(e) => onToggle(project.path, e.target.checked)}
                  style={{ marginTop: '2px' }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>
                    {project.name}
                  </div>
                  <div style={{
                    fontSize: '11px',
                    color: 'var(--text-tertiary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {project.path}
                  </div>
                </div>
              </label>
            ))
          )}
        </div>

        <div style={{
          padding: '12px 20px',
          borderTop: '1px solid var(--border-primary)',
          display: 'flex',
          justifyContent: 'flex-end',
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              background: 'var(--primary-color)',
              border: 'none',
              borderRadius: '6px',
              color: 'white',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export function SyncPanel() {
  const posthog = usePostHog();
  const isDevelopment = import.meta.env.DEV;

  // Sync config from Jotai atom
  const config = useAtomValue(syncConfigAtom);
  const [, updateConfig] = useAtom(setSyncConfigAtom);

  // Compute effective server URL early so it can be used throughout
  // Only honor config.environment in dev builds - production always uses production sync
  // Default to production even in dev builds (user must explicitly switch to development)
  const PRODUCTION_SYNC_URL = 'wss://sync.nimbalyst.com';
  const DEVELOPMENT_SYNC_URL = 'ws://localhost:8790';
  const effectiveEnvironment = isDevelopment ? config.environment : undefined;
  const currentEnvironment = effectiveEnvironment || 'production';
  const effectiveServerUrl = currentEnvironment === 'development' ? DEVELOPMENT_SYNC_URL : PRODUCTION_SYNC_URL;

  const [projects, setProjects] = useState<Project[]>([]);
  const [showQRModal, setShowQRModal] = useState(false);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [connectedDevices, setConnectedDevices] = useState<DeviceInfo[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [stytchAuth, setStytchAuth] = useState<StytchAuthState>({
    isAuthenticated: false,
    user: null,
  });

  // Auth UI state
  const [showAuthForm, setShowAuthForm] = useState(false);
  const [email, setEmail] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  const isStytchAvailable = !!window.electronAPI?.stytch;

  // Load Stytch auth state on mount
  useEffect(() => {
    async function loadStytchAuth() {
      if (!window.electronAPI?.stytch) return;
      try {
        const state = await window.electronAPI.stytch.getAuthState();
        setStytchAuth({
          isAuthenticated: state.isAuthenticated,
          user: state.user,
        });
      } catch (error) {
        console.error('Failed to load Stytch auth state:', error);
      }
    }

    loadStytchAuth();

    if (!window.electronAPI?.stytch) return;

    // Subscribe to auth state changes in main process (registers the IPC broadcast listener)
    window.electronAPI.stytch.subscribeAuthState();

    // Listen for auth state change IPC events
    const unsubscribe = window.electronAPI.stytch.onAuthStateChange((state: StytchAuthState) => {
      setStytchAuth({
        isAuthenticated: state.isAuthenticated,
        user: state.user,
      });

      // Set email in PostHog for identity linking when user logs in via Stytch
      const userEmail = state.user?.emails?.[0]?.email;
      if (state.isAuthenticated && userEmail && posthog) {
        posthog.people.set({ email: userEmail });
      }
    });

    return unsubscribe;
  }, [posthog]);

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

  // Load connected devices when sync is enabled
  const loadDevices = async () => {
    if (!config.enabled || !effectiveServerUrl) {
      setConnectedDevices([]);
      return;
    }

    setDevicesLoading(true);
    setDevicesError(null);
    try {
      const result = await window.electronAPI.invoke('sync:get-devices');
      if (result.success) {
        setConnectedDevices(result.devices || []);
      } else {
        setDevicesError(result.error || 'Failed to load devices');
        setConnectedDevices([]);
      }
    } catch (error) {
      console.error('Failed to load devices:', error);
      setDevicesError('Failed to load devices');
      setConnectedDevices([]);
    } finally {
      setDevicesLoading(false);
    }
  };

  useEffect(() => {
    if (config.enabled && effectiveServerUrl) {
      loadDevices();
      const interval = setInterval(loadDevices, 30000);
      return () => clearInterval(interval);
    } else {
      setConnectedDevices([]);
      return undefined;
    }
  }, [config.enabled, effectiveServerUrl]);

  const handleFieldChange = (field: keyof SyncConfig, value: string | boolean | number) => {
    updateConfig({ [field]: value });
  };

  const handleProjectToggle = (projectPath: string, enabled: boolean) => {
    const enabledProjects = config.enabledProjects || projects.map(p => p.path);
    const updated = enabled
      ? [...enabledProjects, projectPath]
      : enabledProjects.filter(p => p !== projectPath);
    updateConfig({ enabledProjects: updated });
  };

  // Environment switch handler (dev only)
  // Saves config immediately so auth endpoints use the correct server
  const handleEnvironmentSwitch = async (newEnv: 'development' | 'production') => {
    // Build new config with environment - serverUrl is derived by the backend from environment
    // Don't set serverUrl explicitly to avoid stale persisted values
    const newConfig = { ...config, environment: newEnv, serverUrl: '' };

    // Update atom (will trigger debounced persistence, but we also save immediately below)
    updateConfig({ environment: newEnv, serverUrl: '' });

    // Save immediately so main process has correct config for auth
    // (This bypasses debounce because auth needs the config right away)
    try {
      await window.electronAPI.invoke('sync:set-config', newConfig);
    } catch (err) {
      console.error('Failed to save sync config:', err);
      setAuthError(`Failed to save config: ${err}`);
      return;
    }

    // Switch Stytch environment (this will sign out the user)
    if (!window.electronAPI?.stytch?.switchEnvironment) {
      console.error('Stytch API not available - cannot switch environment');
      setAuthError('Stytch API not available. Try restarting the app.');
      return;
    }

    try {
      await window.electronAPI.stytch.switchEnvironment(newEnv);
    } catch (err) {
      console.error('Failed to switch Stytch environment:', err);
      setAuthError(`Failed to switch environment: ${err}`);
    }
  };

  // Auth handlers
  const handleGoogleSignIn = async () => {
    if (!window.electronAPI?.stytch) return;
    setAuthLoading(true);
    setAuthError(null);
    try {
      const result = await window.electronAPI.stytch.signInWithGoogle();
      if (!result.success && result.error) {
        setAuthError(result.error);
      } else {
        setShowAuthForm(false);
      }
    } catch (err) {
      setAuthError(String(err));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!window.electronAPI?.stytch) return;
    if (!email) {
      setAuthError('Email is required');
      return;
    }

    setAuthLoading(true);
    setAuthError(null);
    try {
      const result = await window.electronAPI.stytch.sendMagicLink(email);

      if (!result.success && result.error) {
        setAuthError(result.error);
      } else {
        setMagicLinkSent(true);
      }
    } catch (err) {
      setAuthError(String(err));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    if (!window.electronAPI?.stytch) return;
    try {
      await window.electronAPI.stytch.signOut();
    } catch (err) {
      console.error('Sign out error:', err);
    }
  };

  const enabledProjectCount = config.enabledProjects
    ? config.enabledProjects.length
    : projects.length;

  return (
    <div className="provider-panel flex flex-col">
      <div className="provider-panel-header mb-6 pb-4 border-b border-[var(--nim-border)]">
        <h3 className="provider-panel-title text-xl font-semibold leading-tight mb-2 text-[var(--nim-text)]">Account & Sync</h3>
        <p className="provider-panel-description text-sm leading-relaxed text-[var(--nim-text-muted)]">
          Sign in to sync AI sessions across devices with end-to-end encryption.
        </p>
      </div>

      {/* Environment Toggle - Dev Only */}
      {isDevelopment && (
        <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
          <h4 className="provider-panel-section-title text-base font-semibold mb-3 text-[var(--nim-text)]">Environment (Dev Only)</h4>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => handleEnvironmentSwitch('development')}
              style={{
                flex: 1,
                padding: '8px 12px',
                fontSize: '12px',
                background: currentEnvironment === 'development' ? 'var(--primary-color)' : 'var(--surface-secondary)',
                color: currentEnvironment === 'development' ? 'white' : 'var(--text-secondary)',
                border: '1px solid var(--border-primary)',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: currentEnvironment === 'development' ? 600 : 400,
              }}
            >
              Development
            </button>
            <button
              onClick={() => handleEnvironmentSwitch('production')}
              style={{
                flex: 1,
                padding: '8px 12px',
                fontSize: '12px',
                background: currentEnvironment === 'production' ? 'var(--primary-color)' : 'var(--surface-secondary)',
                color: currentEnvironment === 'production' ? 'white' : 'var(--text-secondary)',
                border: '1px solid var(--border-primary)',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: currentEnvironment === 'production' ? 600 : 400,
              }}
            >
              Production
            </button>
          </div>
          <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '6px', marginBottom: 0 }}>
            {currentEnvironment === 'development'
              ? 'Using test Stytch + localhost:8790'
              : 'Using live Stytch + sync.nimbalyst.com'}
          </p>
        </div>
      )}

      {/* Account Section */}
      <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
        <h4 className="provider-panel-section-title text-base font-semibold mb-3 text-[var(--nim-text)]">Account</h4>

        {stytchAuth.isAuthenticated && stytchAuth.user ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '12px',
            background: 'var(--surface-secondary)',
            borderRadius: '8px',
          }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              background: 'var(--primary-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontWeight: 600,
              fontSize: '16px',
            }}>
              {(stytchAuth.user.name?.first_name?.[0] || stytchAuth.user.emails[0]?.email[0] || '?').toUpperCase()}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, color: 'var(--text-primary)', fontSize: '13px' }}>
                {stytchAuth.user.name?.first_name
                  ? `${stytchAuth.user.name.first_name} ${stytchAuth.user.name.last_name || ''}`.trim()
                  : stytchAuth.user.emails[0]?.email}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                {stytchAuth.user.emails[0]?.email}
              </div>
            </div>
            <button
              onClick={handleSignOut}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                background: 'transparent',
                border: '1px solid var(--border-primary)',
                borderRadius: '4px',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              Sign Out
            </button>
          </div>
        ) : showAuthForm ? (
          <div style={{
            padding: '16px',
            background: 'var(--surface-secondary)',
            borderRadius: '8px',
          }}>
            {magicLinkSent ? (
              // Magic link sent confirmation
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  width: '48px',
                  height: '48px',
                  margin: '0 auto 12px',
                  background: 'var(--primary-color)',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                    <path d="M22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6z" />
                    <path d="M22 6l-10 7L2 6" />
                  </svg>
                </div>
                <h4 style={{ margin: '0 0 8px', color: 'var(--text-primary)', fontSize: '15px' }}>
                  Check your email
                </h4>
                <p style={{ margin: '0 0 16px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                  We sent a sign-in link to <strong>{email}</strong>
                </p>
                <button
                  onClick={() => {
                    setMagicLinkSent(false);
                    setEmail('');
                    setShowAuthForm(false);
                  }}
                  style={{
                    padding: '8px 16px',
                    background: 'transparent',
                    border: '1px solid var(--border-primary)',
                    borderRadius: '6px',
                    color: 'var(--text-secondary)',
                    fontSize: '13px',
                    cursor: 'pointer',
                  }}
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                {/* Google Sign In */}
                <button
                  onClick={handleGoogleSignIn}
                  disabled={authLoading || !isStytchAvailable}
                  style={{
                    width: '100%',
                    padding: '10px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '10px',
                    background: 'white',
                    border: '1px solid var(--border-primary)',
                    borderRadius: '6px',
                    cursor: authLoading ? 'wait' : 'pointer',
                    opacity: authLoading ? 0.7 : 1,
                    color: '#333',
                    fontWeight: 500,
                    fontSize: '13px',
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Continue with Google
                </button>

                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  margin: '16px 0',
                  color: 'var(--text-tertiary)',
                  fontSize: '12px',
                }}>
                  <div style={{ flex: 1, height: '1px', background: 'var(--border-primary)' }} />
                  or
                  <div style={{ flex: 1, height: '1px', background: 'var(--border-primary)' }} />
                </div>

                {/* Email Magic Link Form */}
                <form onSubmit={handleSendMagicLink}>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                    disabled={!isStytchAvailable || authLoading}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      marginBottom: '12px',
                      border: '1px solid var(--border-primary)',
                      borderRadius: '6px',
                      background: 'var(--surface-primary)',
                      color: 'var(--text-primary)',
                      fontSize: '13px',
                    }}
                  />
                  <button
                    type="submit"
                    disabled={authLoading || !isStytchAvailable || !email}
                    style={{
                      width: '100%',
                      padding: '10px 16px',
                      background: 'var(--primary-color)',
                      border: 'none',
                      borderRadius: '6px',
                      color: 'white',
                      fontWeight: 500,
                      fontSize: '13px',
                      cursor: authLoading ? 'wait' : 'pointer',
                      opacity: (authLoading || !email) ? 0.7 : 1,
                    }}
                  >
                    {authLoading ? 'Sending...' : 'Send Sign-In Link'}
                  </button>
                </form>

                {authError && (
                  <p style={{ color: 'var(--error-color, #ef4444)', fontSize: '12px', marginTop: '8px', marginBottom: 0 }}>
                    {authError}
                  </p>
                )}

                <button
                  onClick={() => {
                    setShowAuthForm(false);
                    setAuthError(null);
                    setEmail('');
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    marginTop: '12px',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-tertiary)',
                    cursor: 'pointer',
                    fontSize: '12px',
                  }}
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        ) : (
          <div style={{
            padding: '16px',
            background: 'var(--surface-secondary)',
            borderRadius: '8px',
            textAlign: 'center',
          }}>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 12px' }}>
              Sign in to sync sessions across all your devices.
            </p>
            <button
              onClick={() => setShowAuthForm(true)}
              disabled={!isStytchAvailable}
              style={{
                padding: '8px 20px',
                background: 'var(--primary-color)',
                border: 'none',
                borderRadius: '6px',
                color: 'white',
                fontWeight: 500,
                fontSize: '13px',
                cursor: isStytchAvailable ? 'pointer' : 'not-allowed',
                opacity: isStytchAvailable ? 1 : 0.5,
              }}
            >
              Sign In or Create Account
            </button>
            {!isStytchAvailable && (
              <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '8px', marginBottom: 0 }}>
                Restart the app to enable authentication.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Sync Settings */}
      <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
        <h4 className="provider-panel-section-title text-base font-semibold mb-3 text-[var(--nim-text)]">Sync Settings</h4>

        <div className="setting-item py-3">
          <label className="setting-label flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => handleFieldChange('enabled', e.target.checked)}
              className="setting-checkbox w-4 h-4 mt-0.5 cursor-pointer shrink-0 accent-[var(--nim-primary)]"
            />
            <div className="setting-text flex flex-col gap-0.5">
              <span className="setting-name text-sm font-medium text-[var(--nim-text)]">Enable Session Sync</span>
              <span className="setting-description text-xs leading-relaxed text-[var(--nim-text-muted)]">
                Sync AI sessions to other devices connected to the same server.
              </span>
            </div>
          </label>
        </div>

        {config.enabled && (
          <div className="setting-item py-3 mt-3">
            <div className="setting-text flex flex-col gap-0.5 mb-2">
              <span className="setting-name text-sm font-medium text-[var(--nim-text)]">Idle Timeout</span>
              <span className="setting-description text-xs leading-relaxed text-[var(--nim-text-muted)]">
                Minutes of inactivity before mobile push notifications are sent.
              </span>
            </div>
            <select
              value={config.idleTimeoutMinutes ?? 5}
              onChange={(e) => handleFieldChange('idleTimeoutMinutes', Number(e.target.value))}
              style={{
                padding: '8px 12px',
                fontSize: '13px',
                background: 'var(--surface-secondary)',
                border: '1px solid var(--border-primary)',
                borderRadius: '6px',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                width: '100%',
              }}
            >
              <option value={1}>1 minute (for testing)</option>
              <option value={2}>2 minutes</option>
              <option value={5}>5 minutes (default)</option>
              <option value={10}>10 minutes</option>
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
            </select>
          </div>
        )}
      </div>

      {config.enabled && (
        <>
          {/* Projects */}
          <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
            <div className="flex items-center justify-between">
              <h4 className="provider-panel-section-title text-base font-semibold text-[var(--nim-text)] m-0">Projects</h4>
              <button
                onClick={() => setShowProjectPicker(true)}
                style={{
                  padding: '4px 10px',
                  fontSize: '12px',
                  background: 'var(--surface-secondary)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: '4px',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                {enabledProjectCount} of {projects.length} enabled
              </button>
            </div>
            <p className="text-sm leading-relaxed text-[var(--nim-text-muted)] mt-1">
              Choose which projects sync their AI sessions.
            </p>
          </div>

          {/* Get the Mobile App - only show when authenticated */}
          {stytchAuth.isAuthenticated && (
            <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
              <h4 className="provider-panel-section-title text-base font-semibold mb-3 text-[var(--nim-text)]">Get the Mobile App</h4>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
                padding: '16px',
                background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(59, 130, 246, 0.05) 100%)',
                borderRadius: '8px',
                border: '1px solid rgba(59, 130, 246, 0.2)',
              }}>
                <div style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '12px',
                  background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                    <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
                    <line x1="12" y1="18" x2="12" y2="18"/>
                  </svg>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                    Nimbalyst for iOS
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                    View AI sessions on your iPhone or iPad
                  </div>
                  <button
                    onClick={() => window.electronAPI.openExternal('https://apps.apple.com/app/nimbalyst')}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 12px',
                      background: 'white',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 500,
                      color: '#111827',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
                    </svg>
                    Download on App Store
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Mobile Pairing - only show when authenticated */}
          {stytchAuth.isAuthenticated ? (
            <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
              <h4 className="provider-panel-section-title text-base font-semibold mb-3 text-[var(--nim-text)]">Mobile Device</h4>
              <button
                className="pair-device-button"
                onClick={() => setShowQRModal(true)}
                disabled={!effectiveServerUrl}
                style={{ width: '100%' }}
              >
                <svg style={{ width: '18px', height: '18px', marginRight: '8px' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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

              {/* Encryption Explanation */}
              <div style={{
                marginTop: '12px',
                padding: '16px',
                background: 'rgba(34, 197, 94, 0.1)',
                border: '1px solid rgba(34, 197, 94, 0.2)',
                borderRadius: '8px',
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '10px',
                }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#22c55e' }}>
                    End-to-End Encryption
                  </span>
                </div>
                <p style={{ margin: '0 0 10px', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  The QR code securely transfers your encryption key directly between devices.
                </p>
                <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '12px', color: 'var(--text-primary)', lineHeight: 1.7 }}>
                  <li>Your encryption keys never touch our servers</li>
                  <li>Only your devices can decrypt your data</li>
                  <li>Sign in with the same account on both devices</li>
                </ul>
              </div>
            </div>
          ) : (
            <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
              <h4 className="provider-panel-section-title text-base font-semibold mb-3 text-[var(--nim-text)]">Mobile Device</h4>
              <div style={{
                padding: '16px',
                background: 'var(--surface-secondary)',
                borderRadius: '8px',
                textAlign: 'center',
              }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" style={{ margin: '0 auto 12px' }}>
                  <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
                  <line x1="12" y1="18" x2="12" y2="18"/>
                </svg>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
                  Sign in above to pair your mobile device
                </p>
              </div>
            </div>
          )}

          {/* Connected Devices */}
          {connectedDevices.length > 0 && (
            <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
              <h4 className="provider-panel-section-title text-base font-semibold mb-3 text-[var(--nim-text)]">
                Online Devices
                <button
                  onClick={loadDevices}
                  disabled={devicesLoading}
                  style={{
                    marginLeft: '8px',
                    padding: '2px 6px',
                    fontSize: '10px',
                    background: 'var(--surface-secondary)',
                    border: '1px solid var(--border-primary)',
                    borderRadius: '3px',
                    cursor: devicesLoading ? 'wait' : 'pointer',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  Refresh
                </button>
              </h4>
              <div style={{ marginTop: '8px' }}>
                {connectedDevices.map((device) => (
                  <div
                    key={device.device_id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '8px 10px',
                      background: 'var(--surface-secondary)',
                      borderRadius: '6px',
                      marginBottom: '6px',
                    }}
                  >
                    <div style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: '#22c55e',
                    }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                        {device.name}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                        {device.platform} - {formatRelativeTime(device.connected_at)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Modals */}
      <QRPairingModal
        isOpen={showQRModal}
        onClose={() => setShowQRModal(false)}
        serverUrl={effectiveServerUrl}
      />

      <ProjectPickerPopup
        isOpen={showProjectPicker}
        onClose={() => setShowProjectPicker(false)}
        projects={projects}
        enabledProjects={config.enabledProjects || projects.map(p => p.path)}
        onToggle={handleProjectToggle}
      />
    </div>
  );
}
