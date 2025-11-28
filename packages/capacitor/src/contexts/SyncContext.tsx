import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

/**
 * Session index entry as stored in the SessionsIndex Y.Doc
 */
export interface SessionIndexEntry {
  id: string;
  title: string;
  provider: string;
  model?: string;
  mode?: 'agent' | 'planning';
  workspaceId?: string;
  workspacePath?: string;
  lastMessagePreview?: string;
  lastMessageAt: number;
  messageCount: number;
  updatedAt: number;
  createdAt: number;
  pendingExecution?: {
    messageId: string;
    sentAt: number;
    sentBy: string;
  };
}

/**
 * Represents a project/workspace
 */
export interface Project {
  id: string;
  name: string;
  path?: string;
  sessionCount: number;
}

/**
 * Sync configuration stored in local storage
 */
export interface SyncConfig {
  serverUrl: string;
  userId: string;
  authToken: string;
}

/**
 * Sync status
 */
export interface SyncStatus {
  connected: boolean;
  syncing: boolean;
  lastSyncedAt: number | null;
  error: string | null;
}

interface SyncContextValue {
  /** Current sync configuration */
  config: SyncConfig | null;
  /** Update sync configuration */
  setConfig: (config: SyncConfig | null) => void;
  /** Current sync status */
  status: SyncStatus;
  /** List of all sessions from the index */
  allSessions: SessionIndexEntry[];
  /** Filtered sessions based on selected project */
  sessions: SessionIndexEntry[];
  /** List of available projects */
  projects: Project[];
  /** Currently selected project (null = all projects) */
  selectedProject: Project | null;
  /** Select a project to filter sessions */
  selectProject: (project: Project | null) => void;
  /** Manually refresh the session list */
  refresh: () => void;
  /** Check if sync is configured */
  isConfigured: boolean;
}

const SyncContext = createContext<SyncContextValue | null>(null);

const STORAGE_KEY = 'nimbalyst_sync_config';

function loadConfig(): SyncConfig | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
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

const SELECTED_PROJECT_KEY = 'nimbalyst_selected_project';

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

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfigState] = useState<SyncConfig | null>(() => loadConfig());
  const [status, setStatus] = useState<SyncStatus>({
    connected: false,
    syncing: false,
    lastSyncedAt: null,
    error: null,
  });
  const [allSessions, setAllSessions] = useState<SessionIndexEntry[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() => loadSelectedProject());

  // Refs for Y.js objects (persist across renders)
  const docRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);

  const setConfig = useCallback((newConfig: SyncConfig | null) => {
    setConfigState(newConfig);
    saveConfig(newConfig);
  }, []);

  // Compute projects from sessions
  const projects = React.useMemo((): Project[] => {
    console.log('[SyncContext] Computing projects from', allSessions.length, 'sessions');
    const projectMap = new Map<string, Project>();

    for (const session of allSessions) {
      const workspaceId = session.workspaceId || 'default';
      const workspacePath = session.workspacePath;

      console.log('[SyncContext] Session workspace info:', {
        sessionId: session.id.substring(0, 8),
        workspaceId,
        workspacePath,
      });

      if (!projectMap.has(workspaceId)) {
        // Extract project name from workspace path
        let name = 'Default Project';
        if (workspacePath) {
          const parts = workspacePath.split('/');
          name = parts[parts.length - 1] || workspacePath;
        }

        projectMap.set(workspaceId, {
          id: workspaceId,
          name,
          path: workspacePath,
          sessionCount: 0,
        });
      }

      const project = projectMap.get(workspaceId)!;
      project.sessionCount++;
    }

    // Sort by session count descending
    const projectsList = Array.from(projectMap.values()).sort(
      (a, b) => b.sessionCount - a.sessionCount
    );

    console.log('[SyncContext] Computed projects:', projectsList);
    return projectsList;
  }, [allSessions]);

  // Filter sessions by selected project
  const sessions = React.useMemo((): SessionIndexEntry[] => {
    console.log('[SyncContext] Filtering sessions:', {
      totalSessions: allSessions.length,
      selectedProjectId,
    });

    if (!selectedProjectId) {
      console.log('[SyncContext] No project selected, showing all', allSessions.length, 'sessions');
      return allSessions;
    }

    const filtered = allSessions.filter(
      (session) => (session.workspaceId || 'default') === selectedProjectId
    );

    console.log('[SyncContext] Filtered to', filtered.length, 'sessions for project', selectedProjectId);
    return filtered;
  }, [allSessions, selectedProjectId]);

  // Get selected project object
  const selectedProject = React.useMemo((): Project | null => {
    if (!selectedProjectId) return null;
    return projects.find((p) => p.id === selectedProjectId) || null;
  }, [selectedProjectId, projects]);

  // Update sessions from Y.Doc
  const updateSessionsFromDoc = useCallback(() => {
    if (!docRef.current) {
      setAllSessions([]);
      return;
    }

    const sessionsMap = docRef.current.getMap<SessionIndexEntry>('sessions');
    const sessionList: SessionIndexEntry[] = [];

    sessionsMap.forEach((entry, id) => {
      // Y.js Map values may be plain objects or Y.js types
      // Convert to plain object if needed
      const plainEntry = typeof entry.toJSON === 'function' ? entry.toJSON() : entry;
      console.log('[SyncContext] Session entry:', id, plainEntry);
      sessionList.push({ ...plainEntry, id });
    });

    // Sort by lastMessageAt descending
    sessionList.sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
    console.log('[SyncContext] Sessions list:', sessionList);
    setAllSessions(sessionList);
  }, []);

  const selectProject = useCallback((project: Project | null) => {
    const projectId = project?.id || null;
    setSelectedProjectId(projectId);
    saveSelectedProject(projectId);
  }, []);

  const refresh = useCallback(() => {
    updateSessionsFromDoc();
  }, [updateSessionsFromDoc]);

  // Connect to SessionsIndex Y.Doc when config changes
  useEffect(() => {
    // Cleanup previous connection
    if (providerRef.current) {
      providerRef.current.disconnect();
      providerRef.current.destroy();
      providerRef.current = null;
    }
    if (docRef.current) {
      docRef.current.destroy();
      docRef.current = null;
    }

    if (!config) {
      setStatus({
        connected: false,
        syncing: false,
        lastSyncedAt: null,
        error: null,
      });
      setAllSessions([]);
      return;
    }

    // Create new Y.Doc for SessionsIndex
    const doc = new Y.Doc();
    docRef.current = doc;

    // The document ID for the sessions index follows the pattern: {userId}:index
    const documentId = `${config.userId}:index`;

    // Connect via WebSocket
    // WebsocketProvider appends the room name to the URL, so we just provide the base sync URL
    // Final URL will be: ws://localhost:8788/sync/{documentId}
    const wsUrl = `${config.serverUrl}/sync`;

    const provider = new WebsocketProvider(wsUrl, documentId, doc, {
      params: {
        authorization: `Bearer ${config.userId}:${config.authToken}`,
      },
      connect: true,
    });
    providerRef.current = provider;

    // Set up status listeners
    provider.on('status', ({ status: connStatus }: { status: string }) => {
      setStatus(prev => ({
        ...prev,
        connected: connStatus === 'connected',
        error: null,
      }));
    });

    provider.on('sync', (isSynced: boolean) => {
      setStatus(prev => ({
        ...prev,
        syncing: !isSynced,
        lastSyncedAt: isSynced ? Date.now() : prev.lastSyncedAt,
      }));

      if (isSynced) {
        updateSessionsFromDoc();
      }
    });

    provider.on('connection-error', () => {
      setStatus(prev => ({
        ...prev,
        connected: false,
        error: 'Connection failed',
      }));
    });

    // Listen for changes to the sessions map
    const sessionsMap = doc.getMap<SessionIndexEntry>('sessions');
    sessionsMap.observe(() => {
      updateSessionsFromDoc();
    });

    // Initial update
    updateSessionsFromDoc();

    // Cleanup on unmount or config change
    return () => {
      if (providerRef.current) {
        providerRef.current.disconnect();
        providerRef.current.destroy();
        providerRef.current = null;
      }
      if (docRef.current) {
        docRef.current.destroy();
        docRef.current = null;
      }
    };
  }, [config, updateSessionsFromDoc]);

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

  return (
    <SyncContext.Provider value={value}>
      {children}
    </SyncContext.Provider>
  );
}

export function useSync() {
  const context = useContext(SyncContext);
  if (!context) {
    throw new Error('useSync must be used within a SyncProvider');
  }
  return context;
}
