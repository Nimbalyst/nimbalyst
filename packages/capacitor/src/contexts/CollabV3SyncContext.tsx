import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { SessionIndexEntry as RuntimeSessionIndexEntry } from '@nimbalyst/runtime/sync';
import {
  getSessionJwt,
  isAuthenticated,
  loadSession,
  type StytchSession,
} from '../services/StytchAuthService';
import { loadCredentials } from '../services/CredentialService';

/**
 * CollabV3 Sync Context for Mobile
 *
 * Connects to the CollabV3 sync server to fetch session list and sync messages.
 * Uses simple WebSocket protocol instead of Y.js CRDTs.
 *
 * Authentication:
 * - Uses Stytch JWT for server authentication (obtained via Google OAuth on mobile)
 * - User ID is extracted from the JWT 'sub' claim
 * - Encryption key seed is obtained via QR code pairing with desktop
 */

// ============================================================================
// Types
// ============================================================================

// Re-export the shared type from runtime
export type SessionIndexEntry = RuntimeSessionIndexEntry;

export interface Project {
  id: string;
  name: string;
  path?: string;
  sessionCount: number;
}

export interface SyncStatus {
  connected: boolean;
  syncing: boolean;
  lastSyncedAt: number | null;
  error: string | null;
}

/** Configuration needed for session room connections */
export interface SyncConnectionConfig {
  serverUrl: string;
  userId: string;
  authToken: string;
  encryptionPassphrase: string;
}

interface SyncContextValue {
  /** Whether user is authenticated with Stytch */
  isAuthenticated: boolean;
  /** Whether QR pairing is complete (has encryption key) */
  isPaired: boolean;
  /** Whether both authenticated and paired (ready to sync) */
  isConfigured: boolean;
  /** Server URL from QR pairing */
  serverUrl: string | null;
  /** Connection config for session rooms (null if not connected) */
  config: SyncConnectionConfig | null;
  status: SyncStatus;
  allSessions: SessionIndexEntry[];
  sessions: SessionIndexEntry[];
  projects: Project[];
  selectedProject: Project | null;
  selectProject: (project: Project | null) => void;
  refresh: () => void;
  /** Whether we've received the initial data from the server (true even if sessions array is empty) */
  hasReceivedInitialData: boolean;
  /**
   * Send an index update to notify other devices of queue changes.
   * This sends via the index WebSocket so desktop can receive it without
   * being connected to the specific session room.
   */
  sendIndexUpdate: (sessionId: string, update: {
    pendingExecution?: { messageId: string; sentAt: number; sentBy: 'mobile' | 'desktop' };
    queuedPrompts?: Array<{ id: string; prompt: string; timestamp: number }>;
  }) => void;
  /** Trigger a reconnection (e.g., after login) */
  reconnect: () => void;
}

// ============================================================================
// Protocol Types (match server)
// ============================================================================

interface ServerSessionEntry {
  session_id: string;
  project_id: string;
  title: string;
  provider: string;
  model?: string;
  mode?: 'agent' | 'planning';
  message_count: number;
  last_message_at: number;
  created_at: number;
  updated_at: number;
  pendingExecution?: {
    messageId: string;
    sentAt: number;
    sentBy: string;
  };
  isExecuting?: boolean;
  /** Number of prompts queued from mobile, waiting for desktop to process */
  queuedPromptCount?: number;
  /** Full queue of prompts (sent with index_update for desktop to process) */
  queuedPrompts?: Array<{ id: string; prompt: string; timestamp: number }>;
}

interface ServerProjectEntry {
  project_id: string;
  name: string;
  path?: string;
  session_count: number;
  last_activity_at: number;
  sync_enabled: boolean;
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

type ClientMessage =
  | { type: 'index_sync_request'; project_id?: string }
  | { type: 'index_update'; session: ServerSessionEntry }
  | { type: 'device_announce'; device: DeviceInfo };

type ServerMessage =
  | {
      type: 'index_sync_response';
      sessions: ServerSessionEntry[];
      projects: ServerProjectEntry[];
    }
  | {
      type: 'index_broadcast';
      session: ServerSessionEntry;
      from_connection_id?: string;
    }
  | {
      type: 'index_delete_broadcast';
      session_id: string;
      from_connection_id?: string;
    }
  | { type: 'error'; code: string; message: string };

// ============================================================================
// JWT Utilities
// ============================================================================

/**
 * Extract user ID from a JWT's 'sub' claim.
 * The JWT is a base64url encoded string in the format: header.payload.signature
 */
function extractUserIdFromJwt(jwt: string): string {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format');
    }

    // Decode the payload (second part)
    const payload = parts[1];
    // Add padding if needed for base64 decoding
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    const decoded = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
    const parsed = JSON.parse(decoded);

    if (!parsed.sub) {
      throw new Error('JWT missing sub claim');
    }

    return parsed.sub;
  } catch (error) {
    console.error('[CollabV3] Failed to extract user ID from JWT:', error);
    throw new Error('Invalid JWT: cannot extract user ID');
  }
}

// ============================================================================
// Storage
// ============================================================================

const SELECTED_PROJECT_KEY = 'nimbalyst_selected_project';
const DEVICE_ID_KEY = 'nimbalyst_device_id';

/**
 * Get or generate a stable device ID for this device.
 */
function getOrCreateDeviceId(): string {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    // Generate a random device ID
    deviceId = 'mobile-' + Math.random().toString(36).substring(2, 15) +
               Math.random().toString(36).substring(2, 15);
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

/**
 * Detect the platform and device type.
 */
function detectPlatform(): { platform: string; type: 'mobile' | 'tablet' | 'unknown' } {
  const userAgent = navigator.userAgent.toLowerCase();

  // Check for iPad
  if (/ipad/.test(userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    return { platform: 'ios', type: 'tablet' };
  }

  // Check for iPhone
  if (/iphone/.test(userAgent)) {
    return { platform: 'ios', type: 'mobile' };
  }

  // Check for Android tablet vs phone (tablets typically have larger screens)
  if (/android/.test(userAgent)) {
    // Android tablets usually don't have "mobile" in user agent
    if (!/mobile/.test(userAgent)) {
      return { platform: 'android', type: 'tablet' };
    }
    return { platform: 'android', type: 'mobile' };
  }

  return { platform: 'web', type: 'unknown' };
}

/**
 * Get a friendly device name.
 */
function getDeviceName(): string {
  const { platform, type } = detectPlatform();

  if (platform === 'ios') {
    return type === 'tablet' ? 'iPad' : 'iPhone';
  }
  if (platform === 'android') {
    return type === 'tablet' ? 'Android Tablet' : 'Android Phone';
  }
  return 'Mobile Device';
}

/**
 * Get device info for sending to the server.
 */
function getDeviceInfo(): DeviceInfo {
  const { platform, type } = detectPlatform();

  return {
    device_id: getOrCreateDeviceId(),
    name: getDeviceName(),
    type,
    platform,
    app_version: '1.0.0', // TODO: Get from Capacitor app info
    connected_at: Date.now(),
    last_active_at: Date.now(),
  };
}

function loadSelectedProject(): string | null {
  try {
    return localStorage.getItem(SELECTED_PROJECT_KEY);
  } catch {
    return null;
  }
}

function saveSelectedProject(projectId: string | null) {
  if (projectId) {
    localStorage.setItem(SELECTED_PROJECT_KEY, projectId);
  } else {
    localStorage.removeItem(SELECTED_PROJECT_KEY);
  }
}

// ============================================================================
// Context
// ============================================================================

const SyncContext = createContext<SyncContextValue | null>(null);

export function CollabV3SyncProvider({ children }: { children: React.ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [paired, setPaired] = useState(false);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<SyncStatus>({
    connected: false,
    syncing: false,
    lastSyncedAt: null,
    error: null,
  });
  const [allSessions, setAllSessions] = useState<SessionIndexEntry[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() =>
    loadSelectedProject()
  );
  // Track whether we've received initial data from the server
  const [hasReceivedInitialData, setHasReceivedInitialData] = useState(false);
  // Connection config for session rooms (set when connected)
  const [connectionConfig, setConnectionConfig] = useState<SyncConnectionConfig | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const deviceAnnounceIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Check auth and pairing status on mount
  useEffect(() => {
    async function checkStatus() {
      const authed = await isAuthenticated();
      setAuthenticated(authed);

      const creds = await loadCredentials();
      setPaired(creds !== null);
      setServerUrl(creds?.serverUrl ?? null);
    }
    checkStatus();
  }, []);

  // Filter sessions by selected project
  const sessions = React.useMemo((): SessionIndexEntry[] => {
    if (!selectedProjectId) {
      return allSessions;
    }
    return allSessions.filter((session) => {
      const sessionWorkspace = session.workspaceId || 'default';
      return sessionWorkspace === selectedProjectId;
    });
  }, [allSessions, selectedProjectId]);

  // Get selected project object
  const selectedProject = React.useMemo((): Project | null => {
    if (!selectedProjectId) return null;
    return projects.find((p) => p.id === selectedProjectId) || null;
  }, [selectedProjectId, projects]);

  const selectProject = useCallback((project: Project | null) => {
    const projectId = project?.id || null;
    setSelectedProjectId(projectId);
    saveSelectedProject(projectId);
  }, []);

  // Convert server session to client format
  const convertSession = useCallback((server: ServerSessionEntry): SessionIndexEntry => {
    return {
      id: server.session_id,
      title: server.title,
      provider: server.provider,
      model: server.model,
      mode: server.mode,
      workspaceId: server.project_id,
      workspacePath: server.project_id,
      lastMessageAt: server.last_message_at,
      messageCount: server.message_count,
      updatedAt: server.updated_at,
      createdAt: server.created_at,
      // Cast sentBy to the expected literal type (server sends string)
      pendingExecution: server.pendingExecution ? {
        ...server.pendingExecution,
        sentBy: server.pendingExecution.sentBy as 'mobile' | 'desktop',
      } : undefined,
      isExecuting: server.isExecuting,
    };
  }, []);

  // Convert server project to client format
  const convertProject = useCallback((server: ServerProjectEntry): Project => {
    return {
      id: server.project_id,
      name: server.name,
      path: server.path,
      sessionCount: server.session_count,
    };
  }, []);

  // Handle incoming messages
  const handleMessage = useCallback(
    (data: string) => {
      try {
        const message: ServerMessage = JSON.parse(data);

        switch (message.type) {
          case 'index_sync_response': {
            console.log('[CollabV3] Received index_sync_response with', message.sessions.length, 'sessions and', message.projects.length, 'projects');
            const convertedSessions = message.sessions.map(convertSession);
            const convertedProjects = message.projects.map(convertProject);

            // Sort sessions by updated_at to match desktop sort order
            convertedSessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
            // Sort projects by session count
            convertedProjects.sort((a, b) => b.sessionCount - a.sessionCount);

            setAllSessions(convertedSessions);
            setProjects(convertedProjects);
            setHasReceivedInitialData(true);
            setStatus((prev) => ({
              ...prev,
              syncing: false,
              lastSyncedAt: Date.now(),
            }));

            console.log(
              '[CollabV3] Synced',
              convertedSessions.length,
              'sessions and',
              convertedProjects.length,
              'projects'
            );
            break;
          }

          case 'index_broadcast': {
            const updatedSession = convertSession(message.session);
            setAllSessions((prev) => {
              const existing = prev.findIndex((s) => s.id === updatedSession.id);
              if (existing >= 0) {
                const updated = [...prev];
                updated[existing] = updatedSession;
                // Sort by updated_at to match desktop sort order
                return updated.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
              } else {
                // Sort by updated_at to match desktop sort order
                return [updatedSession, ...prev].sort(
                  (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
                );
              }
            });
            // console.log('[CollabV3] Session updated:', updatedSession.id);
            break;
          }

          case 'index_delete_broadcast': {
            const deletedSessionId = message.session_id;
            setAllSessions((prev) => prev.filter((s) => s.id !== deletedSessionId));
            // console.log('[CollabV3] Session deleted:', deletedSessionId);
            break;
          }

          case 'error': {
            console.error('[CollabV3] Server error:', message.code, message.message);
            setStatus((prev) => ({
              ...prev,
              error: message.message,
            }));
            break;
          }
        }
      } catch (err) {
        console.error('[CollabV3] Failed to parse message:', err);
      }
    },
    [convertSession, convertProject]
  );

  // Request sync
  const requestSync = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const request: ClientMessage = { type: 'index_sync_request' };
      wsRef.current.send(JSON.stringify(request));
      setStatus((prev) => ({ ...prev, syncing: true }));
    }
  }, []);

  // Send an index update to notify other devices
  const sendIndexUpdate = useCallback(
    (sessionId: string, update: {
      pendingExecution?: { messageId: string; sentAt: number; sentBy: 'mobile' | 'desktop' };
      queuedPrompts?: Array<{ id: string; prompt: string; timestamp: number }>;
    }) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        console.warn('[CollabV3] Cannot send index update - not connected');
        return;
      }

      // Find the session in our cache to get its project_id
      const session = allSessions.find((s) => s.id === sessionId);
      if (!session) {
        console.warn('[CollabV3] Cannot send index update - session not found:', sessionId);
        return;
      }

      const msg: ClientMessage = {
        type: 'index_update',
        session: {
          session_id: sessionId,
          project_id: session.workspaceId || 'default',
          title: session.title,
          provider: session.provider,
          model: session.model,
          mode: session.mode,
          message_count: session.messageCount,
          last_message_at: session.lastMessageAt,
          created_at: session.createdAt,
          updated_at: Date.now(),
          pendingExecution: update.pendingExecution,
          queuedPromptCount: update.queuedPrompts?.length ?? 0,
          queuedPrompts: update.queuedPrompts,
        },
      };

      // console.log('[CollabV3] Sending index_update for session:', sessionId, 'queuedPrompts:', update.queuedPrompts?.length ?? 0);
      wsRef.current.send(JSON.stringify(msg));
    },
    [allSessions]
  );

  // Connect to IndexRoom
  const connect = useCallback(async () => {
    // Need both auth and pairing
    if (!authenticated || !serverUrl) {
      console.log('[CollabV3] Cannot connect - not authenticated or not paired');
      return;
    }

    // Clear any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Get credentials for encryption key
    const creds = await loadCredentials();
    if (!creds) {
      console.error('[CollabV3] No credentials available, cannot connect');
      setConnectionConfig(null);
      return;
    }

    // Get fresh JWT
    let jwt: string;
    try {
      const freshJwt = await getSessionJwt(serverUrl);
      if (!freshJwt) {
        console.error('[CollabV3] No JWT available, cannot connect');
        setStatus((prev) => ({
          ...prev,
          connected: false,
          error: 'Not authenticated',
        }));
        setConnectionConfig(null);
        return;
      }
      jwt = freshJwt;
    } catch (error) {
      console.error('[CollabV3] Failed to get JWT:', error);
      setStatus((prev) => ({
        ...prev,
        connected: false,
        error: 'Authentication error',
      }));
      setConnectionConfig(null);
      return;
    }

    // Extract user ID from JWT
    let userId: string;
    try {
      userId = extractUserIdFromJwt(jwt);
    } catch (error) {
      console.error('[CollabV3] Invalid JWT, cannot connect:', error);
      setStatus((prev) => ({
        ...prev,
        connected: false,
        error: 'Invalid authentication token',
      }));
      setConnectionConfig(null);
      return;
    }

    // Set connection config for session rooms
    setConnectionConfig({
      serverUrl,
      userId,
      authToken: jwt,
      encryptionPassphrase: creds.encryptionKeySeed,
    });

    // Build WebSocket URL
    const baseUrl = serverUrl.replace(/\/$/, '');
    const wsBase = baseUrl.replace(/^http/, 'ws');
    const roomId = `user:${userId}:index`;
    // Pass JWT via query parameter (WebSocket doesn't support custom headers in browsers)
    const wsUrl = `${wsBase}/sync/${roomId}?token=${encodeURIComponent(jwt)}`;

    console.log('[CollabV3] Connecting to room:', roomId, 'userId:', userId);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      // console.log('[CollabV3] Connected to index');
      setStatus((prev) => ({
        ...prev,
        connected: true,
        error: null,
      }));

      // Helper to announce device
      const announceDevice = () => {
        if (ws.readyState === WebSocket.OPEN) {
          const deviceInfo = getDeviceInfo();
          const announceMsg: ClientMessage = {
            type: 'device_announce',
            device: deviceInfo,
          };
          ws.send(JSON.stringify(announceMsg));
          // console.log('[CollabV3] Announced device:', deviceInfo.name, deviceInfo.type, deviceInfo.platform);
        }
      };

      // Announce this device to the server
      announceDevice();

      // Set up periodic re-announcement to handle server hibernation
      if (deviceAnnounceIntervalRef.current) {
        clearInterval(deviceAnnounceIntervalRef.current);
      }
      deviceAnnounceIntervalRef.current = setInterval(announceDevice, 30000);

      // Request initial sync
      requestSync();
    };

    ws.onclose = () => {
      // console.log('[CollabV3] Disconnected from index');
      setStatus((prev) => ({
        ...prev,
        connected: false,
      }));
      wsRef.current = null;

      // Clear device announce interval
      if (deviceAnnounceIntervalRef.current) {
        clearInterval(deviceAnnounceIntervalRef.current);
        deviceAnnounceIntervalRef.current = null;
      }

      // Attempt reconnect after 5 seconds
      reconnectTimeoutRef.current = setTimeout(() => {
        if (authenticated && serverUrl) {
          // console.log('[CollabV3] Attempting reconnect...');
          connect();
        }
      }, 5000);
    };

    ws.onerror = (event) => {
      console.error('[CollabV3] WebSocket error:', event);
      setStatus((prev) => ({
        ...prev,
        connected: false,
        error: 'Connection error',
      }));
    };

    ws.onmessage = (event) => {
      handleMessage(event.data);
    };
  }, [authenticated, serverUrl, handleMessage, requestSync]);

  // Disconnect
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (deviceAnnounceIntervalRef.current) {
      clearInterval(deviceAnnounceIntervalRef.current);
      deviceAnnounceIntervalRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnectionConfig(null);
  }, []);

  // Refresh
  const refresh = useCallback(() => {
    requestSync();
  }, [requestSync]);

  // Reconnect (e.g., after login)
  const reconnect = useCallback(async () => {
    // Refresh auth/pairing status
    const authed = await isAuthenticated();
    setAuthenticated(authed);

    const creds = await loadCredentials();
    setPaired(creds !== null);
    setServerUrl(creds?.serverUrl ?? null);

    // Reset state
    setHasReceivedInitialData(false);

    // Disconnect and reconnect
    disconnect();
    if (authed && creds?.serverUrl) {
      // Small delay to ensure disconnect completes
      setTimeout(() => {
        connect();
      }, 100);
    }
  }, [connect, disconnect]);

  // Connect when both authenticated and paired
  useEffect(() => {
    if (authenticated && paired && serverUrl) {
      // Reset initial data flag when reconnecting
      setHasReceivedInitialData(false);
      connect();
    } else {
      disconnect();
      setAllSessions([]);
      setProjects([]);
      setHasReceivedInitialData(false);
      setStatus({
        connected: false,
        syncing: false,
        lastSyncedAt: null,
        error: null,
      });
    }

    return () => {
      disconnect();
    };
  }, [authenticated, paired, serverUrl, connect, disconnect]);

  // Handle app visibility changes (reconnect when app comes to foreground)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && authenticated && paired && serverUrl && !wsRef.current) {
        // console.log('[CollabV3] App became visible, reconnecting...');
        connect();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [authenticated, paired, serverUrl, connect]);

  const value: SyncContextValue = {
    isAuthenticated: authenticated,
    isPaired: paired,
    isConfigured: authenticated && paired,
    serverUrl,
    config: connectionConfig,
    status,
    allSessions,
    sessions,
    projects,
    selectedProject,
    selectProject,
    refresh,
    hasReceivedInitialData,
    sendIndexUpdate,
    reconnect,
  };

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useCollabV3Sync() {
  const context = useContext(SyncContext);
  if (!context) {
    throw new Error('useCollabV3Sync must be used within a CollabV3SyncProvider');
  }
  return context;
}

// Re-export as useSync for compatibility
export const useSync = useCollabV3Sync;
