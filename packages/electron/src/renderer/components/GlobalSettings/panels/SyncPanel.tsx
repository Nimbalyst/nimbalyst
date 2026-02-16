import React, { useState, useEffect, useCallback } from 'react';
import { usePostHog } from 'posthog-js/react';
import { useAtom } from 'jotai';
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
  deviceId: string;
  name: string;
  type: 'desktop' | 'mobile' | 'tablet' | 'unknown';
  platform: string;
  appVersion?: string;
  connectedAt: number;
  lastActiveAt: number;
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
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000]"
      onClick={onClose}
    >
      <div
        className="bg-nim rounded-xl w-[400px] max-h-[500px] overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-nim flex items-center justify-between">
          <div>
            <h3 className="m-0 text-[15px] font-semibold text-nim">
              Projects to Sync
            </h3>
            <p className="mt-1 mb-0 text-xs text-nim-faint">
              {enabledCount} of {projects.length} projects enabled
            </p>
          </div>
          <button
            onClick={onClose}
            className="bg-transparent border-none cursor-pointer p-1 text-nim-faint hover:text-nim"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 5L5 15M5 5l10 10" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-3 max-h-[350px] overflow-y-auto">
          {projects.length === 0 ? (
            <p className="text-nim-faint text-[13px] text-center py-5">
              No projects found. Open a workspace to see projects here.
            </p>
          ) : (
            projects.map((project) => (
              <label
                key={project.path}
                className="flex items-start gap-3 py-2.5 cursor-pointer border-b border-nim last:border-b-0"
              >
                <input
                  type="checkbox"
                  checked={enabledProjects.includes(project.path)}
                  onChange={(e) => onToggle(project.path, e.target.checked)}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-nim">
                    {project.name}
                  </div>
                  <div className="text-[11px] text-nim-faint overflow-hidden text-ellipsis whitespace-nowrap">
                    {project.path}
                  </div>
                </div>
              </label>
            ))
          )}
        </div>

        <div className="px-5 py-3 border-t border-nim flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-nim-primary border-none rounded-md text-white text-[13px] font-medium cursor-pointer hover:bg-nim-primary-hover"
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
  const [config, setConfig] = useAtom(syncConfigAtom);
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

  const handleProjectToggle = async (projectPath: string, enabled: boolean) => {
    // Update local atom for immediate UI feedback (set atom directly to avoid
    // the debounced sync:set-config path which does a full teardown/reinit)
    const enabledProjects = config.enabledProjects || projects.map(p => p.path);
    const updated = enabled
      ? [...enabledProjects, projectPath]
      : enabledProjects.filter(p => p !== projectPath);
    setConfig({ ...config, enabledProjects: updated });

    // Call sync:toggle-project to persist config and trigger immediate incremental sync
    try {
      await window.electronAPI.invoke('sync:toggle-project', projectPath, enabled);
    } catch (error) {
      console.error('[SyncPanel] Failed to toggle project sync:', error);
    }
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
          <div className="flex gap-2">
            <button
              onClick={() => handleEnvironmentSwitch('development')}
              className={`flex-1 px-3 py-2 text-xs border border-nim rounded-md cursor-pointer ${
                currentEnvironment === 'development'
                  ? 'bg-nim-primary text-white font-semibold'
                  : 'bg-nim-secondary text-nim-muted font-normal'
              }`}
            >
              Development
            </button>
            <button
              onClick={() => handleEnvironmentSwitch('production')}
              className={`flex-1 px-3 py-2 text-xs border border-nim rounded-md cursor-pointer ${
                currentEnvironment === 'production'
                  ? 'bg-nim-primary text-white font-semibold'
                  : 'bg-nim-secondary text-nim-muted font-normal'
              }`}
            >
              Production
            </button>
          </div>
          <p className="text-[11px] text-nim-faint mt-1.5 mb-0">
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
          <div className="flex items-center gap-3 p-3 bg-nim-secondary rounded-lg">
            <div className="w-10 h-10 rounded-full bg-nim-primary flex items-center justify-center text-white font-semibold text-base">
              {(stytchAuth.user.name?.first_name?.[0] || stytchAuth.user.emails[0]?.email[0] || '?').toUpperCase()}
            </div>
            <div className="flex-1">
              <div className="font-medium text-nim text-[13px]">
                {stytchAuth.user.name?.first_name
                  ? `${stytchAuth.user.name.first_name} ${stytchAuth.user.name.last_name || ''}`.trim()
                  : stytchAuth.user.emails[0]?.email}
              </div>
              <div className="text-[11px] text-nim-faint">
                {stytchAuth.user.emails[0]?.email}
              </div>
            </div>
            <button
              onClick={handleSignOut}
              className="px-3 py-1.5 text-xs bg-transparent border border-nim rounded text-nim-muted cursor-pointer hover:bg-nim-hover"
            >
              Sign Out
            </button>
          </div>
        ) : showAuthForm ? (
          <div className="p-4 bg-nim-secondary rounded-lg">
            {magicLinkSent ? (
              // Magic link sent confirmation
              <div className="text-center">
                <div className="w-12 h-12 mx-auto mb-3 bg-nim-primary rounded-full flex items-center justify-center">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                    <path d="M22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6z" />
                    <path d="M22 6l-10 7L2 6" />
                  </svg>
                </div>
                <h4 className="m-0 mb-2 text-nim text-[15px]">
                  Check your email
                </h4>
                <p className="m-0 mb-4 text-nim-muted text-[13px]">
                  We sent a sign-in link to <strong>{email}</strong>
                </p>
                <button
                  onClick={() => {
                    setMagicLinkSent(false);
                    setEmail('');
                    setShowAuthForm(false);
                  }}
                  className="px-4 py-2 bg-transparent border border-nim rounded-md text-nim-muted text-[13px] cursor-pointer hover:bg-nim-hover"
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
                  className={`w-full px-4 py-2.5 flex items-center justify-center gap-2.5 bg-white border border-nim rounded-md text-[#333] font-medium text-[13px] ${
                    authLoading ? 'cursor-wait opacity-70' : 'cursor-pointer opacity-100'
                  }`}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Continue with Google
                </button>

                <div className="flex items-center gap-3 my-4 text-nim-faint text-xs">
                  <div className="flex-1 h-px bg-nim" />
                  or
                  <div className="flex-1 h-px bg-nim" />
                </div>

                {/* Email Magic Link Form */}
                <form onSubmit={handleSendMagicLink}>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                    disabled={!isStytchAvailable || authLoading}
                    className="w-full px-3 py-2 mb-3 border border-nim rounded-md bg-nim text-nim text-[13px]"
                  />
                  <button
                    type="submit"
                    disabled={authLoading || !isStytchAvailable || !email}
                    className={`w-full px-4 py-2.5 bg-nim-primary border-none rounded-md text-white font-medium text-[13px] ${
                      authLoading ? 'cursor-wait' : 'cursor-pointer'
                    } ${(authLoading || !email) ? 'opacity-70' : 'opacity-100'}`}
                  >
                    {authLoading ? 'Sending...' : 'Send Sign-In Link'}
                  </button>
                </form>

                {authError && (
                  <p className="text-nim-error text-xs mt-2 mb-0">
                    {authError}
                  </p>
                )}

                <button
                  onClick={() => {
                    setShowAuthForm(false);
                    setAuthError(null);
                    setEmail('');
                  }}
                  className="block w-full mt-3 bg-transparent border-none text-nim-faint cursor-pointer text-xs hover:text-nim-muted"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="p-4 bg-nim-secondary rounded-lg text-center">
            <p className="text-[13px] text-nim-muted m-0 mb-3">
              Sign in to sync sessions across all your devices.
            </p>
            <button
              onClick={() => setShowAuthForm(true)}
              disabled={!isStytchAvailable}
              className={`px-5 py-2 bg-nim-primary border-none rounded-md text-white font-medium text-[13px] ${
                isStytchAvailable ? 'cursor-pointer opacity-100' : 'cursor-not-allowed opacity-50'
              }`}
            >
              Sign In or Create Account
            </button>
            {!isStytchAvailable && (
              <p className="text-[11px] text-nim-faint mt-2 mb-0">
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
              className="w-full px-3 py-2 text-[13px] bg-nim-secondary border border-nim rounded-md text-nim cursor-pointer"
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
                className="px-2.5 py-1 text-xs bg-nim-secondary border border-nim rounded text-nim-muted cursor-pointer hover:bg-nim-hover"
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
              <div className="flex items-center gap-4 p-4 bg-gradient-to-br from-blue-500/15 to-blue-500/5 rounded-lg border border-blue-500/20">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shrink-0">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                    <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
                    <line x1="12" y1="18" x2="12" y2="18"/>
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="text-sm font-semibold text-nim mb-1">
                    Nimbalyst for iOS
                  </div>
                  <div className="text-xs text-nim-muted mb-2">
                    View AI sessions on your iPhone or iPad
                  </div>
                  <button
                    onClick={() => window.electronAPI.openExternal('https://apps.apple.com/app/nimbalyst')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-md text-xs font-medium text-gray-900 border-none cursor-pointer hover:bg-gray-100"
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
                className="pair-device-button w-full flex items-center justify-center px-4 py-2.5 bg-nim-secondary border border-nim rounded-md text-nim font-medium text-[13px] cursor-pointer hover:bg-nim-hover disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => setShowQRModal(true)}
                disabled={!effectiveServerUrl}
              >
                <svg className="w-[18px] h-[18px] mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
              <div className="mt-3 p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
                <div className="flex items-center gap-2 mb-2.5">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                  <span className="text-[13px] font-semibold text-green-500">
                    End-to-End Encryption
                  </span>
                </div>
                <p className="m-0 mb-2.5 text-xs text-nim-muted leading-relaxed">
                  The QR code securely transfers your encryption key directly between devices.
                </p>
                <ul className="m-0 pl-5 text-xs text-nim leading-7">
                  <li>Your encryption keys never touch our servers</li>
                  <li>Only your devices can decrypt your data</li>
                  <li>Sign in with the same account on both devices</li>
                </ul>
              </div>
            </div>
          ) : (
            <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
              <h4 className="provider-panel-section-title text-base font-semibold mb-3 text-[var(--nim-text)]">Mobile Device</h4>
              <div className="p-4 bg-nim-secondary rounded-lg text-center">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-3 text-nim-faint">
                  <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
                  <line x1="12" y1="18" x2="12" y2="18"/>
                </svg>
                <p className="m-0 text-[13px] text-nim-muted">
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
                  className={`ml-2 px-1.5 py-0.5 text-[10px] bg-nim-secondary border border-nim rounded text-nim-faint ${
                    devicesLoading ? 'cursor-wait' : 'cursor-pointer hover:bg-nim-hover'
                  }`}
                >
                  Refresh
                </button>
              </h4>
              <div className="mt-2">
                {connectedDevices.map((device) => (
                  <div
                    key={device.deviceId}
                    className="flex items-center gap-2.5 px-2.5 py-2 bg-nim-secondary rounded-md mb-1.5 last:mb-0"
                  >
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                    <div className="flex-1">
                      <div className="text-[13px] text-nim">
                        {device.name}
                      </div>
                      <div className="text-[11px] text-nim-faint">
                        {device.platform} - {formatRelativeTime(device.connectedAt)}
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
