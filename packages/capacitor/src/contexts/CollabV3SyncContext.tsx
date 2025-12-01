import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

/**
 * CollabV3 Sync Context for Mobile
 *
 * Connects to the CollabV3 sync server to fetch session list and sync messages.
 * Uses simple WebSocket protocol instead of Y.js CRDTs.
 */

// ============================================================================
// Types
// ============================================================================

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
  pendingExecution?: {
    messageId: string;
    sentAt: number;
    sentBy: string;
  };
}

export interface Project {
  id: string;
  name: string;
  path?: string;
  sessionCount: number;
}

export interface SyncConfig {
  serverUrl: string;
  userId: string;
  authToken: string;
  encryptionPassphrase?: string;
}

export interface SyncStatus {
  connected: boolean;
  syncing: boolean;
  lastSyncedAt: number | null;
  error: string | null;
}

interface SyncContextValue {
  config: SyncConfig | null;
  setConfig: (config: SyncConfig | null) => void;
  status: SyncStatus;
  allSessions: SessionIndexEntry[];
  sessions: SessionIndexEntry[];
  projects: Project[];
  selectedProject: Project | null;
  selectProject: (project: Project | null) => void;
  refresh: () => void;
  isConfigured: boolean;
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
}

interface ServerProjectEntry {
  project_id: string;
  name: string;
  path?: string;
  session_count: number;
  last_activity_at: number;
  sync_enabled: boolean;
}

type ClientMessage =
  | { type: 'index_sync_request'; project_id?: string }
  | { type: 'index_update'; session: ServerSessionEntry };

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
// Storage
// ============================================================================

const STORAGE_KEY = 'nimbalyst_sync_config_v3';
const SELECTED_PROJECT_KEY = 'nimbalyst_selected_project';

function loadConfig(): SyncConfig | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
    // Try legacy key
    const legacy = localStorage.getItem('nimbalyst_sync_config');
    if (legacy) {
      const legacyConfig = JSON.parse(legacy);
      // Migrate to v3 key
      localStorage.setItem(STORAGE_KEY, JSON.stringify(legacyConfig));
      return legacyConfig;
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

function saveConfig(config: SyncConfig | null) {
  if (config) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
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
  const [config, setConfigState] = useState<SyncConfig | null>(() => loadConfig());
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

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const setConfig = useCallback((newConfig: SyncConfig | null) => {
    setConfigState(newConfig);
    saveConfig(newConfig);
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
            const convertedSessions = message.sessions.map(convertSession);
            const convertedProjects = message.projects.map(convertProject);

            // Sort sessions by last message time
            convertedSessions.sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
            // Sort projects by session count
            convertedProjects.sort((a, b) => b.sessionCount - a.sessionCount);

            setAllSessions(convertedSessions);
            setProjects(convertedProjects);
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
                return updated.sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
              } else {
                return [updatedSession, ...prev].sort(
                  (a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0)
                );
              }
            });
            console.log('[CollabV3] Session updated:', updatedSession.id);
            break;
          }

          case 'index_delete_broadcast': {
            const deletedSessionId = message.session_id;
            setAllSessions((prev) => prev.filter((s) => s.id !== deletedSessionId));
            console.log('[CollabV3] Session deleted:', deletedSessionId);
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

  // Connect to IndexRoom
  const connect = useCallback(() => {
    if (!config) return;

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

    // Build WebSocket URL
    const baseUrl = config.serverUrl.replace(/\/$/, '');
    const wsBase = baseUrl.replace(/^http/, 'ws');
    const roomId = `user:${config.userId}:index`;
    const wsUrl = `${wsBase}/sync/${roomId}?user_id=${config.userId}&token=${config.authToken}`;

    console.log('[CollabV3] Connecting to:', wsUrl);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[CollabV3] Connected to index');
      setStatus((prev) => ({
        ...prev,
        connected: true,
        error: null,
      }));
      // Request initial sync
      requestSync();
    };

    ws.onclose = () => {
      console.log('[CollabV3] Disconnected from index');
      setStatus((prev) => ({
        ...prev,
        connected: false,
      }));
      wsRef.current = null;

      // Attempt reconnect after 5 seconds
      reconnectTimeoutRef.current = setTimeout(() => {
        if (config) {
          console.log('[CollabV3] Attempting reconnect...');
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
  }, [config, handleMessage, requestSync]);

  // Disconnect
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  // Refresh
  const refresh = useCallback(() => {
    requestSync();
  }, [requestSync]);

  // Connect when config changes
  useEffect(() => {
    if (config) {
      connect();
    } else {
      disconnect();
      setAllSessions([]);
      setProjects([]);
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
  }, [config, connect, disconnect]);

  // Handle app visibility changes (reconnect when app comes to foreground)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && config && !wsRef.current) {
        console.log('[CollabV3] App became visible, reconnecting...');
        connect();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [config, connect]);

  const value: SyncContextValue = {
    config,
    setConfig,
    status,
    allSessions,
    sessions,
    projects,
    selectedProject,
    selectProject,
    refresh,
    isConfigured: config !== null,
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
