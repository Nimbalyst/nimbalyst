import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { SessionIndexEntry as RuntimeSessionIndexEntry } from '@nimbalyst/runtime';
import {
  getSessionJwt,
  isAuthenticated,
  loadSession,
  type StytchSession,
} from '../services/StytchAuthService';
import { loadCredentials } from '../services/CredentialService';
import forge from 'node-forge';

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
  /** Inactivity timeout in minutes (0 = disabled) */
  inactivityTimeoutMinutes: number;
  /** Set the inactivity timeout (in minutes, 0 to disable) */
  setInactivityTimeoutMinutes: (minutes: number) => void;
  /**
   * Request desktop to create a new AI session.
   * Returns a promise that resolves with the session ID if successful.
   * The session will appear in the sessions list once created and synced.
   */
  createSession: (projectId: string, initialPrompt?: string) => Promise<{ success: boolean; sessionId?: string; error?: string }>;
  /** Whether a session creation request is in progress */
  isCreatingSession: boolean;
  /** List of currently connected devices (desktop, other mobiles, etc.) */
  connectedDevices: DeviceInfo[];
  /** Whether any desktop device is currently connected */
  isDesktopConnected: boolean;
  /**
   * Send a session control message to other devices.
   * Used for cancel, question responses, etc.
   */
  sendSessionControlMessage: (
    sessionId: string,
    type: string,
    payload?: Record<string, unknown>
  ) => void;
}

// ============================================================================
// Protocol Types (match server)
// ============================================================================

/** Encrypted queued prompt for wire protocol */
interface EncryptedQueuedPrompt {
  id: string;
  /** Encrypted prompt text (base64) */
  encrypted_prompt: string;
  /** IV for prompt decryption (base64) */
  iv: string;
  timestamp: number;
}

/** Plaintext queued prompt (after decryption) */
interface PlaintextQueuedPrompt {
  id: string;
  prompt: string;
  timestamp: number;
}

interface ServerSessionEntry {
  session_id: string;
  /** Encrypted project ID (base64) - required for wire protocol */
  encrypted_project_id: string;
  /** IV for project_id decryption (base64) */
  project_id_iv: string;
  /** Encrypted title (base64) */
  encrypted_title?: string;
  /** IV for title decryption (base64) */
  title_iv?: string;
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
  /** Encrypted queued prompts */
  encryptedQueuedPrompts?: EncryptedQueuedPrompt[];
  /** Whether there are pending interactive prompts (permissions or questions) waiting for response */
  hasPendingPrompt?: boolean;
  /** Current context usage (from /context command for Claude Code) */
  currentContext?: {
    tokens: number;
    contextWindow: number;
  };
}

interface ServerProjectEntry {
  /** Encrypted project ID (base64) - required for wire protocol */
  encrypted_project_id: string;
  /** IV for project_id decryption (base64) */
  project_id_iv: string;
  /** Encrypted project name (base64) - required for wire protocol */
  encrypted_name: string;
  /** IV for name decryption (base64) */
  name_iv: string;
  /** Encrypted project path (base64) - optional */
  encrypted_path?: string;
  /** IV for path decryption (base64) */
  path_iv?: string;
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

/** Encrypted create session request for wire protocol */
interface EncryptedCreateSessionRequest {
  request_id: string;
  /** Encrypted project ID (base64) - required for wire protocol */
  encrypted_project_id: string;
  /** IV for project_id decryption (base64) */
  project_id_iv: string;
  /** Encrypted initial prompt (base64), optional */
  encrypted_initial_prompt?: string;
  /** IV for prompt decryption (base64), required if encrypted_initial_prompt present */
  initial_prompt_iv?: string;
  timestamp: number;
}

/** Encrypted create session response for wire protocol */
interface EncryptedCreateSessionResponse {
  request_id: string;
  success: boolean;
  session_id?: string;
  error?: string;
}

type ClientMessage =
  | { type: 'index_sync_request'; project_id?: string }
  | { type: 'index_update'; session: ServerSessionEntry }
  | { type: 'device_announce'; device: DeviceInfo }
  | { type: 'create_session_request'; request: EncryptedCreateSessionRequest }
  | { type: 'session_control'; message: { session_id: string; message_type: string; payload?: Record<string, unknown>; timestamp: number; sent_by: 'desktop' | 'mobile' } };

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
  | {
      type: 'project_broadcast';
      project: ServerProjectEntry;
      from_connection_id?: string;
    }
  | {
      type: 'create_session_response_broadcast';
      response: EncryptedCreateSessionResponse;
      from_connection_id?: string;
    }
  | { type: 'error'; code: string; message: string }
  | { type: 'devices_list'; devices: DeviceInfo[] }
  | { type: 'device_joined'; device: DeviceInfo }
  | { type: 'device_left'; device_id: string };

// ============================================================================
// Encryption Utilities (using node-forge for mobile compatibility)
// ============================================================================

// Key type for forge-based encryption
type ForgeKey = string; // Raw key bytes as binary string

/**
 * Derive encryption key from passphrase using PBKDF2.
 * Returns raw key bytes as a binary string (compatible with forge).
 */
async function deriveEncryptionKey(passphrase: string, salt: string): Promise<ForgeKey> {
  // Use forge's PBKDF2 - returns binary string
  const key = forge.pkcs5.pbkdf2(passphrase, salt, 100000, 32, 'sha256');
  return key;
}

/**
 * Encrypt content using AES-GCM.
 */
async function encrypt(
  content: string,
  key: ForgeKey
): Promise<{ encrypted: string; iv: string }> {
  // Generate random IV (12 bytes for GCM)
  const iv = forge.random.getBytesSync(12);

  // Create cipher
  const cipher = forge.cipher.createCipher('AES-GCM', key);
  cipher.start({ iv, tagLength: 128 });
  cipher.update(forge.util.createBuffer(content, 'utf8'));
  cipher.finish();

  // Get encrypted data and auth tag
  const encrypted = cipher.output.getBytes();
  const tag = cipher.mode.tag.getBytes();

  // Combine encrypted + tag (this is how Web Crypto API returns it)
  const combined = encrypted + tag;

  return {
    encrypted: forge.util.encode64(combined),
    iv: forge.util.encode64(iv),
  };
}

/**
 * Decrypt content using AES-GCM.
 */
async function decrypt(encrypted: string, iv: string, key: ForgeKey): Promise<string> {
  const encryptedBytes = forge.util.decode64(encrypted);
  const ivBytes = forge.util.decode64(iv);

  // Split encrypted data and tag (tag is last 16 bytes)
  const tagLength = 16;
  const ciphertext = encryptedBytes.slice(0, -tagLength);
  const tag = encryptedBytes.slice(-tagLength);

  // Create decipher
  const decipher = forge.cipher.createDecipher('AES-GCM', key);
  decipher.start({
    iv: ivBytes,
    tagLength: 128,
    tag: forge.util.createBuffer(tag),
  });
  decipher.update(forge.util.createBuffer(ciphertext));

  const success = decipher.finish();
  if (!success) {
    throw new Error('Decryption failed - authentication tag mismatch');
  }

  // Cast to any because forge types don't expose the encoding parameter
  return (decipher.output as { toString(encoding: string): string }).toString('utf8');
}

/**
 * Encrypt queued prompts for wire transmission.
 */
async function encryptQueuedPrompts(
  prompts: PlaintextQueuedPrompt[],
  key: ForgeKey
): Promise<EncryptedQueuedPrompt[]> {
  return Promise.all(
    prompts.map(async (prompt) => {
      const { encrypted, iv } = await encrypt(prompt.prompt, key);
      return {
        id: prompt.id,
        encrypted_prompt: encrypted,
        iv,
        timestamp: prompt.timestamp,
      };
    })
  );
}

/**
 * Decrypt queued prompts received from wire.
 */
async function decryptQueuedPrompts(
  prompts: EncryptedQueuedPrompt[],
  key: ForgeKey
): Promise<PlaintextQueuedPrompt[]> {
  return Promise.all(
    prompts.map(async (prompt) => {
      const decryptedPrompt = await decrypt(prompt.encrypted_prompt, prompt.iv, key);
      return {
        id: prompt.id,
        prompt: decryptedPrompt,
        timestamp: prompt.timestamp,
      };
    })
  );
}

/**
 * Encrypt a session title for wire transmission.
 */
async function encryptTitle(
  title: string,
  key: ForgeKey
): Promise<{ encrypted_title: string; title_iv: string }> {
  const { encrypted, iv } = await encrypt(title, key);
  return {
    encrypted_title: encrypted,
    title_iv: iv,
  };
}

/**
 * Decrypt a session title received from wire.
 */
async function decryptTitle(
  encrypted_title: string,
  title_iv: string,
  key: ForgeKey
): Promise<string> {
  return decrypt(encrypted_title, title_iv, key);
}

/**
 * Fixed IV for project_id encryption (must match desktop).
 * Using a fixed IV makes encryption deterministic so the same project_id always
 * produces the same ciphertext, allowing the server to deduplicate by encrypted value.
 */
const PROJECT_ID_FIXED_IV = 'cHJvamVjdF9pZF9p'; // base64 of "project_id_i"

/**
 * Encrypt a project ID for wire transmission.
 * Uses a fixed IV so the same project_id always produces the same ciphertext,
 * enabling server-side deduplication.
 */
async function encryptProjectId(
  projectId: string,
  key: ForgeKey
): Promise<{ encrypted_project_id: string; project_id_iv: string }> {
  // Decode the fixed IV from base64
  const ivBytes = forge.util.decode64(PROJECT_ID_FIXED_IV);

  // Create cipher with fixed IV
  const cipher = forge.cipher.createCipher('AES-GCM', key);
  cipher.start({ iv: ivBytes });
  cipher.update(forge.util.createBuffer(projectId, 'utf8'));
  cipher.finish();

  // Get encrypted data and auth tag
  const encrypted = cipher.output.getBytes();
  const tag = cipher.mode.tag.getBytes();

  // Combine encrypted data and tag, then base64 encode
  const combined = encrypted + tag;
  const encryptedBase64 = forge.util.encode64(combined);

  return {
    encrypted_project_id: encryptedBase64,
    project_id_iv: PROJECT_ID_FIXED_IV,
  };
}

/**
 * Decrypt a project ID received from wire.
 */
async function decryptProjectId(
  encrypted_project_id: string,
  project_id_iv: string,
  key: ForgeKey
): Promise<string> {
  return decrypt(encrypted_project_id, project_id_iv, key);
}

/**
 * Decrypt a project name received from wire.
 */
async function decryptProjectName(
  encrypted_name: string,
  name_iv: string,
  key: ForgeKey
): Promise<string> {
  return decrypt(encrypted_name, name_iv, key);
}

/**
 * Decrypt a project path received from wire.
 */
async function decryptProjectPath(
  encrypted_path: string,
  path_iv: string,
  key: ForgeKey
): Promise<string> {
  return decrypt(encrypted_path, path_iv, key);
}

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
const INACTIVITY_TIMEOUT_KEY = 'nimbalyst_inactivity_timeout';

// Default: Disconnect WebSocket after 2 minutes of inactivity to allow device to sleep
const DEFAULT_INACTIVITY_TIMEOUT_MS = 2 * 60 * 1000;

// Available timeout options (in minutes)
export const INACTIVITY_TIMEOUT_OPTIONS = [
  { value: 0, label: 'Never (keep awake)' },
  { value: 1, label: '1 minute' },
  { value: 2, label: '2 minutes' },
  { value: 5, label: '5 minutes' },
  { value: 10, label: '10 minutes' },
];

function loadInactivityTimeout(): number {
  try {
    const stored = localStorage.getItem(INACTIVITY_TIMEOUT_KEY);
    if (stored !== null) {
      const minutes = parseInt(stored, 10);
      if (!isNaN(minutes) && minutes >= 0) {
        return minutes * 60 * 1000;
      }
    }
  } catch {
    // Ignore
  }
  return DEFAULT_INACTIVITY_TIMEOUT_MS;
}

function saveInactivityTimeout(minutes: number): void {
  localStorage.setItem(INACTIVITY_TIMEOUT_KEY, String(minutes));
}

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
  // Inactivity timeout setting (in ms, 0 = disabled)
  const [inactivityTimeoutMs, setInactivityTimeoutMs] = useState(() => loadInactivityTimeout());
  // Session creation state
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  // Connected devices tracking
  const [connectedDevices, setConnectedDevices] = useState<DeviceInfo[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const deviceAnnounceIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const inactivityTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Pending session creation requests (by requestId)
  const pendingSessionCreationsRef = useRef<Map<string, {
    resolve: (result: { success: boolean; sessionId?: string; error?: string }) => void;
    timeout: NodeJS.Timeout;
  }>>(new Map());
  // Encryption key derived from credentials
  const encryptionKeyRef = useRef<ForgeKey | null>(null);

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
  const convertSession = useCallback(async (server: ServerSessionEntry): Promise<SessionIndexEntry> => {
    // Decrypt project_id - encrypted project_id is required
    let projectId: string;
    if (server.encrypted_project_id && server.project_id_iv) {
      if (!encryptionKeyRef.current) {
        console.error('[CollabV3] Cannot decrypt project_id - no encryption key available for session:', server.session_id);
        projectId = 'unknown';
      } else {
        try {
          projectId = await decryptProjectId(server.encrypted_project_id, server.project_id_iv, encryptionKeyRef.current);
        } catch (err) {
          console.error('[CollabV3] Failed to decrypt session project_id for', server.session_id, ':', err);
          projectId = 'unknown';
        }
      }
    } else {
      console.warn('[CollabV3] No encrypted project_id from server for session:', server.session_id);
      projectId = 'unknown';
    }

    // Decrypt title - encrypted titles are required
    let title: string;
    if (server.encrypted_title && server.title_iv) {
      if (!encryptionKeyRef.current) {
        console.error('[CollabV3] Cannot decrypt title - no encryption key available for session:', server.session_id);
        title = 'Untitled (no key)';
      } else {
        try {
          title = await decryptTitle(server.encrypted_title, server.title_iv, encryptionKeyRef.current);
        } catch (err) {
          console.error('[CollabV3] Failed to decrypt session title for', server.session_id, ':', err);
          title = 'Untitled (decrypt failed)';
        }
      }
    } else {
      // No encrypted title from server - desktop hasn't synced title yet
      console.warn('[CollabV3] No encrypted title from server for session:', server.session_id,
        'encrypted_title:', !!server.encrypted_title, 'title_iv:', !!server.title_iv);
      title = 'Untitled';
    }

    return {
      id: server.session_id,
      title,
      provider: server.provider,
      model: server.model,
      mode: server.mode,
      workspaceId: projectId,
      workspacePath: projectId,
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
      hasPendingPrompt: server.hasPendingPrompt,
      currentContext: server.currentContext,
    };
  }, []);

  // Convert server project to client format
  const convertProject = useCallback(async (server: ServerProjectEntry): Promise<Project> => {
    // Decrypt project_id - encrypted project_id is required
    let projectId: string;
    if (server.encrypted_project_id && server.project_id_iv) {
      if (!encryptionKeyRef.current) {
        console.error('[CollabV3] Cannot decrypt project_id - no encryption key available');
        projectId = 'unknown';
      } else {
        try {
          projectId = await decryptProjectId(server.encrypted_project_id, server.project_id_iv, encryptionKeyRef.current);
        } catch (err) {
          console.error('[CollabV3] Failed to decrypt project_id:', err);
          projectId = 'unknown';
        }
      }
    } else {
      projectId = 'unknown';
    }

    // Decrypt name - encrypted name is required
    let name: string;
    if (server.encrypted_name && server.name_iv) {
      if (!encryptionKeyRef.current) {
        name = projectId.split('/').pop() ?? 'Unknown';
      } else {
        try {
          name = await decryptProjectName(server.encrypted_name, server.name_iv, encryptionKeyRef.current);
        } catch (err) {
          console.error('[CollabV3] Failed to decrypt project name:', err);
          name = projectId.split('/').pop() ?? 'Unknown';
        }
      }
    } else {
      name = projectId.split('/').pop() ?? 'Unknown';
    }

    // Decrypt path if present
    let path: string | undefined;
    if (server.encrypted_path && server.path_iv && encryptionKeyRef.current) {
      try {
        path = await decryptProjectPath(server.encrypted_path, server.path_iv, encryptionKeyRef.current);
      } catch (err) {
        console.error('[CollabV3] Failed to decrypt project path:', err);
      }
    }

    return {
      id: projectId,
      name,
      path,
      sessionCount: server.session_count,
    };
  }, []);

  // Handle incoming messages
  const handleMessage = useCallback(
    async (data: string) => {
      try {
        const message: ServerMessage = JSON.parse(data);

        switch (message.type) {
          case 'index_sync_response': {
            console.log('[CollabV3] Received index_sync_response with', message.sessions.length, 'sessions and', message.projects.length, 'projects');
            // Convert sessions and projects with decryption (async)
            const convertedSessions = await Promise.all(message.sessions.map(convertSession));
            const allConvertedProjects = await Promise.all(message.projects.map(convertProject));

            // Filter out projects with "unknown" id (failed to decrypt) and deduplicate by id
            const seenProjectIds = new Set<string>();
            const convertedProjects = allConvertedProjects.filter((p) => {
              if (p.id === 'unknown') return false;
              if (seenProjectIds.has(p.id)) return false;
              seenProjectIds.add(p.id);
              return true;
            });

            // Sort sessions by updated_at to match desktop sort order
            convertedSessions.sort((a: SessionIndexEntry, b: SessionIndexEntry) => (b.updatedAt || 0) - (a.updatedAt || 0));
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
              'projects (filtered from',
              allConvertedProjects.length,
              ')'
            );
            break;
          }

          case 'index_broadcast': {
            console.log('[CollabV3] Received index_broadcast for session:', message.session.session_id);
            const updatedSession = await convertSession(message.session);
            console.log('[CollabV3] Converted session:', updatedSession.id, updatedSession.title);
            setAllSessions((prev) => {
              const existing = prev.findIndex((s) => s.id === updatedSession.id);
              if (existing >= 0) {
                console.log('[CollabV3] Updating existing session:', updatedSession.id);
                const updated = [...prev];
                updated[existing] = updatedSession;
                // Sort by updated_at to match desktop sort order
                return updated.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
              } else {
                console.log('[CollabV3] Adding new session:', updatedSession.id);
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

          case 'project_broadcast': {
            // New project was created - add it to our projects list
            const newProject = await convertProject(message.project);

            // Skip projects that failed to decrypt
            if (newProject.id === 'unknown') {
              console.log('[CollabV3] Skipping project with unknown id (failed to decrypt)');
              break;
            }

            setProjects((prev) => {
              // Check if project already exists - deduplicate
              const existing = prev.findIndex((p) => p.id === newProject.id);
              if (existing >= 0) {
                const updated = [...prev];
                updated[existing] = newProject;
                return updated.sort((a, b) => b.sessionCount - a.sessionCount);
              }
              // Add new project and sort by session count
              return [...prev, newProject].sort((a, b) => b.sessionCount - a.sessionCount);
            });
            console.log('[CollabV3] New project received:', newProject.name);
            break;
          }

          case 'create_session_response_broadcast': {
            // Desktop responded to our session creation request
            const response = message.response;
            console.log('[CollabV3] Received create_session_response:', response.request_id, 'success:', response.success, 'sessionId:', response.session_id);

            const pending = pendingSessionCreationsRef.current.get(response.request_id);
            if (pending) {
              console.log('[CollabV3] Found pending request, resolving...');
              clearTimeout(pending.timeout);
              pendingSessionCreationsRef.current.delete(response.request_id);
              setIsCreatingSession(false);
              pending.resolve({
                success: response.success,
                sessionId: response.session_id,
                error: response.error,
              });
            } else {
              console.log('[CollabV3] No pending request found for:', response.request_id);
            }
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

          case 'devices_list': {
            // console.log('[CollabV3] Received devices list:', message.devices.length, 'devices');
            setConnectedDevices(message.devices);
            break;
          }

          case 'device_joined': {
            // console.log('[CollabV3] Device joined:', message.device.name);
            setConnectedDevices((prev) => {
              // Check if already in list (shouldn't happen, but be safe)
              if (prev.some((d) => d.device_id === message.device.device_id)) {
                return prev.map((d) =>
                  d.device_id === message.device.device_id ? message.device : d
                );
              }
              return [...prev, message.device];
            });
            break;
          }

          case 'device_left': {
            // console.log('[CollabV3] Device left:', message.device_id);
            setConnectedDevices((prev) =>
              prev.filter((d) => d.device_id !== message.device_id)
            );
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
    async (sessionId: string, update: {
      pendingExecution?: { messageId: string; sentAt: number; sentBy: 'mobile' | 'desktop' };
      queuedPrompts?: Array<{ id: string; prompt: string; timestamp: number }>;
    }) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        console.warn('[CollabV3] Cannot send index update - not connected');
        return;
      }

      // Find the session in our cache to get its metadata
      // If session not found, use minimal data - server will merge with existing session
      const session = allSessions.find((s) => s.id === sessionId);
      if (!session) {
        console.warn('[CollabV3] Session not in cache, sending update with minimal data:', sessionId);
      }

      // Encryption is required for all sensitive fields
      if (!encryptionKeyRef.current) {
        throw new Error('[CollabV3] Cannot send index update: no encryption key available');
      }

      // Encrypt project_id
      const projectId = session?.workspaceId || 'default';
      const { encrypted_project_id, project_id_iv } = await encryptProjectId(projectId, encryptionKeyRef.current);

      const serverSession: ServerSessionEntry = {
        session_id: sessionId,
        encrypted_project_id,
        project_id_iv,
        provider: session?.provider || 'unknown',
        model: session?.model,
        mode: session?.mode,
        message_count: session?.messageCount || 0,
        last_message_at: session?.lastMessageAt || Date.now(),
        created_at: session?.createdAt || Date.now(),
        updated_at: Date.now(),
        pendingExecution: update.pendingExecution,
        queuedPromptCount: update.queuedPrompts?.length ?? 0,
      };

      // Encrypt title
      if (session?.title) {
        try {
          const { encrypted_title, title_iv } = await encryptTitle(session.title, encryptionKeyRef.current);
          serverSession.encrypted_title = encrypted_title;
          serverSession.title_iv = title_iv;
        } catch (err) {
          console.error('[CollabV3] Failed to encrypt title:', err);
        }
      }

      // Encrypt queued prompts
      if (update.queuedPrompts && update.queuedPrompts.length > 0) {
        try {
          serverSession.encryptedQueuedPrompts = await encryptQueuedPrompts(update.queuedPrompts, encryptionKeyRef.current);
        } catch (err) {
          console.error('[CollabV3] Failed to encrypt queued prompts:', err);
          throw err;
        }
      }

      const msg: ClientMessage = {
        type: 'index_update',
        session: serverSession,
      };

      console.log('[CollabV3] DEBUG Sending index_update for session:', sessionId, {
        queuedPrompts: update.queuedPrompts?.length ?? 0,
        hasEncryptedQueuedPrompts: !!serverSession.encryptedQueuedPrompts,
        encryptedQueuedPromptsCount: serverSession.encryptedQueuedPrompts?.length ?? 0,
      });
      wsRef.current.send(JSON.stringify(msg));
    },
    [allSessions]
  );

  // Create a new session on the desktop
  const createSession = useCallback(
    async (projectId: string, initialPrompt?: string): Promise<{ success: boolean; sessionId?: string; error?: string }> => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        return { success: false, error: 'Not connected to sync server' };
      }

      // Encryption is required
      if (!encryptionKeyRef.current) {
        return { success: false, error: 'No encryption key available' };
      }

      // Generate a unique request ID
      const requestId = `mobile-create-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      setIsCreatingSession(true);

      // Encrypt project_id upfront
      let encrypted_project_id: string;
      let project_id_iv: string;
      try {
        const result = await encryptProjectId(projectId, encryptionKeyRef.current);
        encrypted_project_id = result.encrypted_project_id;
        project_id_iv = result.project_id_iv;
      } catch (err) {
        console.error('[CollabV3] Failed to encrypt project_id:', err);
        setIsCreatingSession(false);
        return { success: false, error: 'Failed to encrypt project ID' };
      }

      return new Promise((resolve) => {
        // Set a timeout for the request
        const timeout = setTimeout(() => {
          pendingSessionCreationsRef.current.delete(requestId);
          setIsCreatingSession(false);
          resolve({ success: false, error: 'Session creation request timed out' });
        }, 30000); // 30 second timeout

        // Store the pending request
        pendingSessionCreationsRef.current.set(requestId, { resolve, timeout });

        // Build the request with encrypted project_id
        const wireRequest: EncryptedCreateSessionRequest = {
          request_id: requestId,
          encrypted_project_id,
          project_id_iv,
          timestamp: Date.now(),
        };

        // Encrypt initial prompt if present (async operation)
        const sendRequest = async () => {
          if (initialPrompt && encryptionKeyRef.current) {
            try {
              const { encrypted, iv } = await encrypt(initialPrompt, encryptionKeyRef.current);
              wireRequest.encrypted_initial_prompt = encrypted;
              wireRequest.initial_prompt_iv = iv;
            } catch (err) {
              console.error('[CollabV3] Failed to encrypt initial prompt:', err);
            }
          }

          const msg: ClientMessage = { type: 'create_session_request', request: wireRequest };
          // Debug logging - uncomment if needed
          // console.log('[CollabV3] Sending create_session_request:', requestId, 'project:', projectId);
          wsRef.current?.send(JSON.stringify(msg));
        };

        sendRequest();
      });
    },
    []
  );

  // Send a generic session control message to other devices
  const sendSessionControlMessage = useCallback(
    (sessionId: string, type: string, payload?: Record<string, unknown>) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        console.warn('[CollabV3] Cannot send session control message - not connected');
        return;
      }

      const msg: ClientMessage = {
        type: 'session_control',
        message: {
          session_id: sessionId,
          message_type: type,
          payload,
          timestamp: Date.now(),
          sent_by: 'mobile',
        },
      };

      console.log('[CollabV3] Sending session_control:', sessionId, type);
      wsRef.current.send(JSON.stringify(msg));
    },
    []
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

    // Derive encryption key for metadata encryption
    try {
      const key = await deriveEncryptionKey(creds.encryptionKeySeed, `nimbalyst:${userId}`);
      encryptionKeyRef.current = key;
      console.log('[CollabV3] Derived encryption key for metadata');
    } catch (err) {
      console.error('[CollabV3] Failed to derive encryption key:', err);
      // Continue without encryption - will use plaintext fallback
      encryptionKeyRef.current = null;
    }

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
    if (inactivityTimeoutRef.current) {
      clearTimeout(inactivityTimeoutRef.current);
      inactivityTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnectionConfig(null);
  }, []);

  // Start inactivity timer (called after connection opens)
  const startInactivityTimer = useCallback(() => {
    if (inactivityTimeoutRef.current) {
      clearTimeout(inactivityTimeoutRef.current);
      inactivityTimeoutRef.current = null;
    }

    // If timeout is disabled (0), don't set a timer
    if (inactivityTimeoutMs === 0) {
      return;
    }

    inactivityTimeoutRef.current = setTimeout(() => {
      if (wsRef.current) {
        console.log('[CollabV3] Disconnecting due to inactivity to allow device sleep');
        wsRef.current.close();
        wsRef.current = null;
        // Don't trigger automatic reconnect - wait for user activity
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
      }
    }, inactivityTimeoutMs);
  }, [inactivityTimeoutMs]);

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

  // Start inactivity timer when connected
  useEffect(() => {
    if (status.connected) {
      startInactivityTimer();
    }
  }, [status.connected, startInactivityTimer]);

  // Handle user activity - reset inactivity timer and reconnect if disconnected
  useEffect(() => {
    const handleUserActivity = () => {
      // If disconnected due to inactivity, reconnect
      if (!wsRef.current && authenticated && paired && serverUrl) {
        console.log('[CollabV3] User activity detected, reconnecting...');
        connect();
      } else if (wsRef.current) {
        // Reset inactivity timer if still connected
        startInactivityTimer();
      }
    };

    // Listen for touch and scroll events (mobile-focused)
    document.addEventListener('touchstart', handleUserActivity, { passive: true });
    document.addEventListener('scroll', handleUserActivity, { passive: true });

    return () => {
      document.removeEventListener('touchstart', handleUserActivity);
      document.removeEventListener('scroll', handleUserActivity);
    };
  }, [authenticated, paired, serverUrl, connect, startInactivityTimer]);

  // Setter for inactivity timeout
  const setInactivityTimeoutMinutes = useCallback((minutes: number) => {
    saveInactivityTimeout(minutes);
    setInactivityTimeoutMs(minutes * 60 * 1000);
  }, []);

  // Check if any desktop device is connected
  const isDesktopConnected = connectedDevices.some((d) => d.type === 'desktop');

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
    inactivityTimeoutMinutes: inactivityTimeoutMs / 60000,
    setInactivityTimeoutMinutes,
    createSession,
    isCreatingSession,
    connectedDevices,
    isDesktopConnected,
    sendSessionControlMessage,
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
