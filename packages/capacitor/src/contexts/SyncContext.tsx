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
  const [projectsFromIndex, setProjectsFromIndex] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() => loadSelectedProject());

  // Refs for Y.js objects (persist across renders)
  const docRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const projectsDocRef = useRef<Y.Doc | null>(null);
  const projectsProviderRef = useRef<WebsocketProvider | null>(null);

  const setConfig = useCallback((newConfig: SyncConfig | null) => {
    setConfigState(newConfig);
    saveConfig(newConfig);
  }, []);

  // Projects MUST come from ProjectsIndex - desktop is the source of truth
  const projects = React.useMemo((): Project[] => {
    console.log('[SyncContext] Projects from ProjectsIndex:', projectsFromIndex.length);
    return projectsFromIndex;
  }, [projectsFromIndex]);

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

    const filtered = allSessions.filter((session) => {
      // Check both workspaceId and workspacePath (desktop uses workspaceId = path)
      const sessionWorkspace = session.workspaceId || session.workspacePath || 'default';
      const matches = sessionWorkspace === selectedProjectId;

      // Debug log first few sessions to see what's being compared
      if (allSessions.indexOf(session) < 3) {
        console.log('[SyncContext] Comparing session:', {
          sessionId: session.id,
          workspaceId: session.workspaceId,
          workspacePath: session.workspacePath,
          sessionWorkspace,
          selectedProjectId,
          matches,
          sessionKeys: Object.keys(session),
        });
      }

      return matches;
    });

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
      console.log('[SyncContext] No docRef, clearing sessions');
      setAllSessions([]);
      return;
    }

    const sessionsMap = docRef.current.getMap<SessionIndexEntry>('sessions');
    console.log('[SyncContext] SessionsMap size:', sessionsMap.size);
    const sessionList: SessionIndexEntry[] = [];

    sessionsMap.forEach((entry, id) => {
      // Y.js Map values may be plain objects or Y.js types
      // Convert to plain object if needed
      const plainEntry = (entry as any)?.toJSON ? (entry as any).toJSON() : entry;
      console.log('[SyncContext] Session entry:', id, plainEntry);
      sessionList.push({ ...plainEntry, id });
    });

    // Sort by lastMessageAt descending
    sessionList.sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
    console.log('[SyncContext] Total sessions after sorting:', sessionList.length);
    console.log('[SyncContext] Session IDs:', sessionList.map(s => s.id.substring(0, 8)));
    setAllSessions(sessionList);
  }, []);

  // Update projects from ProjectsIndex Y.Doc
  const updateProjectsFromDoc = useCallback(() => {
    if (!projectsDocRef.current) {
      setProjectsFromIndex([]);
      return;
    }

    const projectsMap = projectsDocRef.current.getMap<any>('projects');
    const projectList: Project[] = [];

    projectsMap.forEach((entry, id) => {
      const plainEntry = (entry as any)?.toJSON ? (entry as any).toJSON() : entry;
      console.log('[SyncContext] Project entry:', id, plainEntry);

      projectList.push({
        id: plainEntry.id || id,
        name: plainEntry.name || 'Unknown',
        path: plainEntry.path,
        sessionCount: plainEntry.sessionCount || 0,
      });
    });

    // Sort by session count descending
    projectList.sort((a, b) => b.sessionCount - a.sessionCount);
    console.log('[SyncContext] Projects from index:', projectList);
    setProjectsFromIndex(projectList);
  }, []);

  const selectProject = useCallback((project: Project | null) => {
    const projectId = project?.id || null;
    setSelectedProjectId(projectId);
    saveSelectedProject(projectId);
  }, []);

  const refresh = useCallback(() => {
    updateSessionsFromDoc();
    updateProjectsFromDoc();
  }, [updateSessionsFromDoc, updateProjectsFromDoc]);

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

  // Connect to ProjectsIndex Y.Doc when config changes
  useEffect(() => {
    // Cleanup previous connection
    if (projectsProviderRef.current) {
      projectsProviderRef.current.disconnect();
      projectsProviderRef.current.destroy();
      projectsProviderRef.current = null;
    }
    if (projectsDocRef.current) {
      projectsDocRef.current.destroy();
      projectsDocRef.current = null;
    }

    if (!config) {
      setProjectsFromIndex([]);
      return;
    }

    // Create new Y.Doc for ProjectsIndex
    const projectsDoc = new Y.Doc();
    projectsDocRef.current = projectsDoc;

    // The document ID for projects index: {userId}:projects
    const projectsDocId = `${config.userId}:projects`;
    const wsUrl = `${config.serverUrl}/sync`;

    console.log('[SyncContext] Connecting to ProjectsIndex:', projectsDocId, 'at', wsUrl);

    const projectsProvider = new WebsocketProvider(wsUrl, projectsDocId, projectsDoc, {
      params: {
        authorization: `Bearer ${config.userId}:${config.authToken}`,
      },
      connect: true,
    });
    projectsProviderRef.current = projectsProvider;

    // Log connection status
    projectsProvider.on('status', ({ status }: { status: string }) => {
      console.log('[SyncContext] ProjectsIndex connection status:', status);
    });

    projectsProvider.on('connection-error', (error: any) => {
      console.error('[SyncContext] ProjectsIndex connection error:', error);
    });

    // Listen for sync
    projectsProvider.on('sync', (isSynced: boolean) => {
      if (isSynced) {
        console.log('[SyncContext] ProjectsIndex synced');
        updateProjectsFromDoc();
      }
    });

    // Listen for changes to the projects map
    const projectsMap = projectsDoc.getMap<any>('projects');
    projectsMap.observe(() => {
      updateProjectsFromDoc();
    });

    // Initial update
    updateProjectsFromDoc();

    // Cleanup on unmount or config change
    return () => {
      if (projectsProviderRef.current) {
        projectsProviderRef.current.disconnect();
        projectsProviderRef.current.destroy();
        projectsProviderRef.current = null;
      }
      if (projectsDocRef.current) {
        projectsDocRef.current.destroy();
        projectsDocRef.current = null;
      }
    };
  }, [config, updateProjectsFromDoc]);

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
