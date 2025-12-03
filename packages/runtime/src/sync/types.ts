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

  /** User ID for authentication and routing */
  userId: string;

  /** Auth token for server authentication */
  authToken: string;

  /** Optional encryption key for E2E encryption (Phase 2) */
  encryptionKey?: CryptoKey;

  /** Device info for presence awareness */
  deviceInfo?: DeviceInfo;
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
  /** Last activity timestamp (Unix timestamp ms) */
  last_active_at: number;
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
