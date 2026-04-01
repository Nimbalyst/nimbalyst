import { atom } from 'jotai';
import { sessionListFromRegistryAtom, sessionProcessingAtom } from './sessions';

export type BackgroundTaskCategory = 'ai-session' | 'sync';
export type BackgroundTaskStatus = 'running' | 'connected' | 'idle' | 'error';

export interface BackgroundTaskSyncState {
  appConfigured: boolean;
  projectEnabled: boolean;
  connected: boolean;
  syncing: boolean;
  error: string | null;
  stats: {
    sessionCount: number;
    lastSyncedAt: number | null;
  };
  docSyncStats?: {
    projectCount: number;
    fileCount: number;
    connected: boolean;
  };
  userEmail?: string | null;
  lastUpdatedAt: number;
}

export interface BackgroundTask {
  id: string;
  category: BackgroundTaskCategory;
  label: string;
  detail: string;
  status: BackgroundTaskStatus;
  startedAt?: number;
  sessionId?: string;
  provider?: string | null;
}

const defaultSyncState: BackgroundTaskSyncState = {
  appConfigured: false,
  projectEnabled: false,
  connected: false,
  syncing: false,
  error: null,
  stats: {
    sessionCount: 0,
    lastSyncedAt: null,
  },
  lastUpdatedAt: 0,
};

export const backgroundTaskSyncStatusAtom = atom<BackgroundTaskSyncState>(defaultSyncState);

export const backgroundTaskAiTasksAtom = atom<BackgroundTask[]>((get) => {
  const sessions = get(sessionListFromRegistryAtom);

  return sessions
    .filter((session) => get(sessionProcessingAtom(session.id)))
    .map((session) => ({
      id: `ai-session:${session.id}`,
      category: 'ai-session' as const,
      label: session.title?.trim() || 'Untitled Session',
      detail: session.parentSessionId ? 'Child session is running' : 'AI session is running',
      status: 'running' as const,
      startedAt: session.updatedAt,
      sessionId: session.id,
      provider: session.provider,
    }));
});

export const backgroundTaskSyncTaskAtom = atom<BackgroundTask>((get) => {
  const sync = get(backgroundTaskSyncStatusAtom);

  if (!sync.appConfigured) {
    return {
      id: 'sync:status',
      category: 'sync',
      label: 'Sync',
      detail: 'Not configured',
      status: 'idle',
    };
  }

  if (!sync.projectEnabled) {
    return {
      id: 'sync:status',
      category: 'sync',
      label: 'Sync',
      detail: 'Disabled for this project',
      status: 'idle',
    };
  }

  if (sync.error) {
    return {
      id: 'sync:status',
      category: 'sync',
      label: 'Sync',
      detail: sync.error,
      status: 'error',
      startedAt: sync.lastUpdatedAt || undefined,
    };
  }

  if (sync.syncing) {
    const fileCount = sync.docSyncStats?.fileCount;
    const projectCount = sync.docSyncStats?.projectCount;
    const parts = [];

    if (typeof fileCount === 'number') {
      parts.push(`${fileCount} file${fileCount === 1 ? '' : 's'}`);
    }
    if (typeof projectCount === 'number') {
      parts.push(`${projectCount} project${projectCount === 1 ? '' : 's'}`);
    }

    return {
      id: 'sync:status',
      category: 'sync',
      label: 'Sync',
      detail: parts.length > 0 ? `Syncing ${parts.join(' across ')}` : 'Syncing now',
      status: 'running',
      startedAt: sync.lastUpdatedAt || undefined,
    };
  }

  if (sync.connected) {
    return {
      id: 'sync:status',
      category: 'sync',
      label: 'Sync',
      detail: 'Connected',
      status: 'connected',
      startedAt: sync.lastUpdatedAt || undefined,
    };
  }

  return {
    id: 'sync:status',
    category: 'sync',
    label: 'Sync',
    detail: 'Disconnected',
    status: 'idle',
    startedAt: sync.lastUpdatedAt || undefined,
  };
});

export const backgroundTasksAtom = atom<BackgroundTask[]>((get) => {
  const aiTasks = get(backgroundTaskAiTasksAtom);
  const syncTask = get(backgroundTaskSyncTaskAtom);

  return [...aiTasks, syncTask];
});

export const backgroundTasksByCategoryAtom = atom((get) => {
  const tasks = get(backgroundTasksAtom);

  return {
    aiSessions: tasks.filter((task) => task.category === 'ai-session'),
    sync: tasks.filter((task) => task.category === 'sync'),
  };
});

export const backgroundTaskCountAtom = atom((get) =>
  get(backgroundTasksAtom).filter((task) => task.status === 'running').length
);

export const backgroundTaskHasErrorAtom = atom((get) =>
  get(backgroundTasksAtom).some((task) => task.status === 'error')
);
