/**
 * Types for the optional Y.js sync layer.
 *
 * This module provides device sync for AI sessions using Y.js CRDTs.
 * It's designed to be completely optional - the app works without it.
 */

import type { AgentMessage } from '../ai/server/types';

export interface SyncConfig {
  /** WebSocket server URL (e.g., ws://localhost:8787 or wss://sync.nimbalyst.com) */
  serverUrl: string;

  /**
   * Function to get a fresh JWT for authentication.
   * Called before each WebSocket connection to ensure the JWT isn't expired.
   * JWTs typically expire in ~5 minutes, so this must return a fresh one.
   * The user ID is extracted from the JWT 'sub' claim.
   */
  getJwt: () => Promise<string>;

  /** Optional encryption key for E2E encryption */
  encryptionKey?: CryptoKey;

  /** Device info for presence awareness (static - set once at init) */
  deviceInfo?: DeviceInfo;

  /**
   * Function to get current device info for presence updates.
   * Called periodically (every 30s) to get up-to-date presence info.
   * If provided, takes precedence over static deviceInfo.
   */
  getDeviceInfo?: () => DeviceInfo;
}

/**
 * Information about a connected device.
 * Used for device awareness/presence in the IndexRoom.
 */
export interface DeviceInfo {
  /** Unique device ID (stable across sessions, generated per device) */
  device_id: string;
  /** Human-readable device name (e.g., "MacBook Pro", "iPhone 15") */
  name: string;
  /** Device type for icon display */
  type: 'desktop' | 'mobile' | 'tablet' | 'unknown';
  /** Platform (e.g., "macos", "ios", "windows", "android", "web") */
  platform: string;
  /** App version */
  app_version?: string;
  /** When this device connected (Unix timestamp ms) */
  connected_at: number;
  /** Last activity timestamp (Unix timestamp ms) - updated on user interaction */
  last_active_at: number;
  /** Whether the app window is currently focused (optional for backwards compatibility) */
  is_focused?: boolean;
  /** Derived status for presence display (optional for backwards compatibility) */
  status?: 'active' | 'idle' | 'away';
}

export interface SyncStatus {
  connected: boolean;
  syncing: boolean;
  lastSyncedAt: number | null;
  error: string | null;
}

export interface SyncProvider {
  /** Connect to sync server for a session */
  connect(sessionId: string): Promise<void>;

  /** Disconnect from sync server */
  disconnect(sessionId: string): void;

  /** Disconnect all sessions */
  disconnectAll(): void;

  /** Check if a session is connected */
  isConnected(sessionId: string): boolean;

  /** Get sync status for a session */
  getStatus(sessionId: string): SyncStatus;

  /** Subscribe to sync status changes */
  onStatusChange(
    sessionId: string,
    callback: (status: SyncStatus) => void
  ): () => void;

  /** Subscribe to remote changes */
  onRemoteChange(
    sessionId: string,
    callback: (change: SessionChange) => void
  ): () => void;

  /** Push local changes to sync */
  pushChange(sessionId: string, change: SessionChange): void;

  /** Bulk update the sessions index with existing sessions */
  syncSessionsToIndex?(sessions: SessionIndexData[], options?: { syncMessages?: boolean }): void;

  /** Sync projects to the ProjectsIndex (tells mobile which projects exist and are enabled) */
  syncProjectsToIndex?(projects: ProjectIndexEntry[]): void;

  /** Fetch the current server index to compare with local state */
  fetchIndex?(): Promise<{
    sessions: Array<{
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
        sentBy: 'mobile' | 'desktop';
      };
      isExecuting?: boolean;
    }>;
    projects: Array<{
      project_id: string;
      name: string;
      session_count: number;
      last_activity_at: number;
      sync_enabled: boolean;
    }>;
  }>;

  /** Subscribe to index changes (session updates broadcast to all connected clients) */
  onIndexChange?(callback: (sessionId: string, entry: {
    session_id: string;
    title?: string;
    provider?: string;
    model?: string;
    mode?: 'agent' | 'planning';
    message_count?: number;
    updated_at?: number;
    pendingExecution?: {
      messageId: string;
      sentAt: number;
      sentBy: 'mobile' | 'desktop';
    };
    isExecuting?: boolean;
    /** Number of prompts queued from mobile, waiting for desktop to process */
    queuedPromptCount?: number;
    /** Full queue of prompts (sent via index_update for desktop to process) */
    queuedPrompts?: Array<{ id: string; prompt: string; timestamp: number }>;
  }) => void): () => void;

  /** Get cached metadata for a session (populated from sync_response and metadata_broadcast) */
  getCachedMetadata?(sessionId: string): {
    queuedPrompts?: Array<{
      id: string;
      prompt: string;
      timestamp: number;
    }>;
    [key: string]: unknown;
  } | undefined;

  /** Get cached index entry for a session (populated from index_sync_response and index_broadcast)
   * Note: Returns decrypted values - title is always present after decryption */
  getCachedIndexEntry?(sessionId: string): {
    session_id: string;
    project_id: string;
    /** Decrypted title (always present in cache) */
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
      sentBy: 'mobile' | 'desktop';
    };
    isExecuting?: boolean;
    /** Decrypted queued prompts */
    queuedPrompts?: Array<{ id: string; prompt: string; timestamp: number }>;
  } | undefined;

  /** Subscribe to session creation requests from other devices (e.g., mobile) */
  onCreateSessionRequest?(callback: (request: CreateSessionRequest) => void): () => void;

  /** Send a response to a session creation request */
  sendCreateSessionResponse?(response: CreateSessionResponse): Promise<void>;

  /** Send a session creation request (for mobile to request desktop to create a session) */
  sendCreateSessionRequest?(request: CreateSessionRequest): Promise<void>;

  /** Subscribe to session creation responses (for mobile to receive response from desktop) */
  onCreateSessionResponse?(callback: (response: CreateSessionResponse) => void): () => void;

  /** Send a generic session control message (cross-device via IndexRoom) */
  sendSessionControlMessage?(message: SessionControlMessage): Promise<void>;

  /** Subscribe to session control messages from other devices */
  onSessionControlMessage?(callback: (message: SessionControlMessage) => void): () => void;

  /**
   * Request the sync server to send a push notification to mobile devices.
   * Used when agent completes execution and user should be notified on mobile.
   * The server will check device presence before sending (suppresses if mobile is active).
   */
  requestMobilePush?(sessionId: string, title: string, body: string): Promise<void>;

  /** Get list of currently connected devices */
  getConnectedDevices?(): DeviceInfo[];

  /** Subscribe to device status changes (devices joining/leaving) */
  onDeviceStatusChange?(callback: (devices: DeviceInfo[]) => void): () => void;

  /**
   * Send encrypted settings to all connected mobile devices.
   * Used by desktop to share sensitive settings like API keys.
   */
  syncSettings?(settings: SyncedSettings): Promise<void>;

  /**
   * Subscribe to settings sync messages from other devices.
   * Used by mobile to receive settings from desktop.
   */
  onSettingsSync?(callback: (settings: SyncedSettings) => void): () => void;

  /**
   * Attempt to reconnect the index connection.
   * Called when network connectivity is restored after being offline.
   * Safe to call even if already connected (will no-op).
   */
  reconnectIndex?(): Promise<void>;
}

/** Session data for bulk index sync */
export interface SessionIndexData {
  id: string;
  title: string;
  provider: string;
  model?: string;
  mode?: string;
  workspaceId?: string;
  workspacePath?: string;
  messageCount: number;
  updatedAt: number;
  createdAt: number;
  /** Current context usage (from /context command for Claude Code) */
  currentContext?: {
    tokens: number;
    contextWindow: number;
  };
  /** Optional messages to sync to the session Y.Doc */
  messages?: AgentMessage[];
}

/** Types of changes that can be synced */
export type SessionChange =
  | { type: 'message_added'; message: AgentMessage }
  | { type: 'metadata_updated'; metadata: Partial<SyncedSessionMetadata> }
  | { type: 'session_deleted' };

// AgentMessage is imported from ai/server/types.ts - the real database type
// We sync the raw database format, both sides transform it for UI using transformAgentMessagesToUI()

/** Queued prompt for cross-device sync */
export interface SyncedQueuedPrompt {
  id: string;           // Unique ID for this queued item
  prompt: string;       // The user's message
  timestamp: number;    // When queued
  // Note: documentContext and attachments are NOT synced - they're device-local
}

/** Session metadata that gets synced */
export interface SyncedSessionMetadata {
  title?: string;
  mode?: string;
  provider?: string;
  model?: string;
  workspaceId?: string;
  workspacePath?: string;
  isArchived?: boolean;
  draftInput?: string;
  updatedAt: number;
  /** Queued prompts waiting to be processed by desktop */
  queuedPrompts?: SyncedQueuedPrompt[];
  /** Signals that a message is waiting for desktop to process it */
  pendingExecution?: {
    messageId: string;
    sentAt: number;
    sentBy: 'mobile' | 'desktop';
  };
  /** Whether the session is currently executing (processing AI request) */
  isExecuting?: boolean;
  /** Current context usage (from /context command for Claude Code) */
  currentContext?: {
    tokens: number;         // Current tokens in context window
    contextWindow: number;  // Max context window size
  };
}

/**
 * Session entry in the session index
 * Used for session list display on both desktop and mobile
 */
export interface SessionIndexEntry {
  id: string;
  title: string;
  provider: string;
  model?: string;
  mode?: 'agent' | 'planning';
  workspaceId?: string;
  workspacePath?: string;
  lastMessageAt: number;
  lastMessagePreview?: string;
  messageCount: number;
  updatedAt: number;
  createdAt: number;
  /** Signals that a message is waiting for desktop to process it */
  pendingExecution?: {
    messageId: string;
    sentAt: number;
    sentBy: 'mobile' | 'desktop';
  };
  /** Whether the session is currently executing (processing AI request) */
  isExecuting?: boolean;
  /** Whether there are pending interactive prompts (permissions or questions) waiting for response */
  hasPendingPrompt?: boolean;
  /** Current context usage (from /context command for Claude Code) */
  currentContext?: {
    tokens: number;         // Current tokens in context window
    contextWindow: number;  // Max context window size
  };
}

/**
 * Project/workspace entry in the ProjectsIndex Y.Doc
 * Lists all available projects so mobile knows what exists
 */
export interface ProjectIndexEntry {
  id: string; // workspace path
  name: string; // project name (extracted from path)
  path: string; // full workspace path
  sessionCount: number; // number of sessions in this project
  lastActivityAt: number; // timestamp of most recent session activity
  enabled: boolean; // whether this project is enabled for sync (user controlled)
}

/**
 * Request to create a new AI session from mobile.
 * Sent via index WebSocket, processed by desktop.
 */
export interface CreateSessionRequest {
  /** Unique request ID for tracking */
  requestId: string;
  /** Project/workspace ID to create the session in */
  projectId: string;
  /** Optional initial prompt to send after session creation */
  initialPrompt?: string;
  /** Timestamp when request was created */
  timestamp: number;
}

/**
 * Response to a create session request.
 * Sent by desktop after session is created.
 */
export interface CreateSessionResponse {
  /** Request ID this is responding to */
  requestId: string;
  /** Whether session creation succeeded */
  success: boolean;
  /** Session ID if created successfully */
  sessionId?: string;
  /** Error message if creation failed */
  error?: string;
}

/**
 * Generic session control message.
 * The sync layer just passes these through - interpretation is up to the receiver.
 */
export interface SessionControlMessage {
  /** Session ID this message is for */
  sessionId: string;
  /** Message type - receiver decides how to handle */
  type: string;
  /** Arbitrary payload - receiver interprets based on type */
  payload?: Record<string, unknown>;
  /** Timestamp when message was sent */
  timestamp: number;
  /** Device that sent the message */
  sentBy: 'desktop' | 'mobile';
}

/**
 * Voice mode settings synced from desktop.
 */
export interface SyncedVoiceModeSettings {
  /** Which voice to use (OpenAI Realtime API voices) */
  voice?: 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'sage' | 'shimmer' | 'verse' | 'marin' | 'cedar';
  /** Delay before auto-submitting voice commands (ms) */
  submitDelayMs?: number;
}

/**
 * Settings that can be synced from desktop to mobile.
 * These are sensitive settings that should be encrypted in transit.
 */
export interface SyncedSettings {
  /** OpenAI API key for voice transcription */
  openaiApiKey?: string;
  /** Voice mode settings */
  voiceMode?: SyncedVoiceModeSettings;
  /** Version for handling future upgrades */
  version: number;
}

/**
 * Encrypted settings payload for wire transmission.
 */
export interface EncryptedSettingsPayload {
  /** Encrypted JSON blob containing SyncedSettings (base64) */
  encrypted_settings: string;
  /** IV for settings decryption (base64) */
  settings_iv: string;
  /** Device ID of sender */
  device_id: string;
  /** Timestamp of settings change */
  timestamp: number;
  /** Version to handle upgrades */
  version: number;
}
