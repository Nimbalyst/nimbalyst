import React, { useCallback, useEffect } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { MaterialSymbol, ProviderIcon } from '@nimbalyst/runtime';
import { HelpTooltip } from '../../help';
import { FloatingPortal, useFloatingMenu } from '../../hooks/useFloatingMenu';
import {
  backgroundTaskCountAtom,
  backgroundTaskHasErrorAtom,
  backgroundTasksByCategoryAtom,
  backgroundTaskSyncStatusAtom,
  type BackgroundTask,
  type BackgroundTaskSyncState,
} from '../../store/atoms/backgroundTasks';
import { syncStatusUpdateAtom } from '../../store/atoms/syncStatus';

interface BackgroundTaskIndicatorProps {
  workspacePath?: string;
  onOpenSession?: (sessionId: string) => void;
}

function formatDuration(startedAt?: number, now: number = Date.now()): string {
  if (!startedAt) {
    return '';
  }

  const diffMs = Math.max(0, now - startedAt);
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);

  if (diffHours > 0) {
    return `${diffHours}h ${diffMinutes % 60}m`;
  }

  if (diffMinutes > 0) {
    return `${diffMinutes}m`;
  }

  return `${Math.max(1, diffSeconds)}s`;
}

function formatLastSync(lastSyncedAt: number | null): string {
  if (!lastSyncedAt) {
    return 'Never';
  }

  return formatDuration(lastSyncedAt);
}

function getTaskIcon(task: BackgroundTask): string {
  if (task.status === 'error') {
    return 'cloud_off';
  }

  if (task.status === 'running') {
    return 'sync';
  }

  if (task.status === 'connected') {
    return 'cloud_done';
  }

  return 'cloud';
}

const SessionRunningIndicator: React.FC = () => (
  <div className="session-list-item-status processing flex h-5 w-5 items-center justify-center text-[var(--nim-primary)] opacity-80" title="Processing...">
    <MaterialSymbol icon="progress_activity" size={14} className="animate-spin" />
  </div>
);

function getTaskStatusLabel(task: BackgroundTask): string {
  switch (task.status) {
    case 'running':
      return 'Running';
    case 'connected':
      return 'Connected';
    case 'error':
      return 'Error';
    default:
      return 'Idle';
  }
}

function getTaskStatusClasses(task: BackgroundTask): string {
  switch (task.status) {
    case 'running':
      return 'bg-[rgba(59,130,246,0.12)] text-[#3b82f6]';
    case 'connected':
      return 'bg-[rgba(34,197,94,0.12)] text-[#22c55e]';
    case 'error':
      return 'bg-[rgba(239,68,68,0.12)] text-[#ef4444]';
    default:
      return 'bg-nim-tertiary text-nim-muted';
  }
}

const TaskRow: React.FC<{
  task: BackgroundTask;
  now: number;
  onOpenSession?: (sessionId: string) => void;
}> = ({ task, now, onOpenSession }) => {
  const canOpenSession = Boolean(task.sessionId && onOpenSession);

  return (
    <div className="flex items-start gap-3 rounded-md border border-nim bg-nim-tertiary px-3 py-2">
      <div className={`mt-0.5 flex h-7 w-7 items-center justify-center rounded-md bg-nim-tertiary text-nim-muted ${task.status === 'running' ? 'text-[#3b82f6]' : ''} ${task.status === 'error' ? 'text-[#ef4444]' : ''}`}>
        {task.category === 'ai-session' ? (
          <ProviderIcon provider={task.provider || 'claude-code'} size={16} />
        ) : (
          <MaterialSymbol icon={getTaskIcon(task)} size={16} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-nim">{task.label}</div>
            <div className="mt-0.5 text-[11px] text-nim-muted">{task.detail}</div>
          </div>
          {task.category === 'ai-session' && task.status === 'running' ? (
            <SessionRunningIndicator />
          ) : (
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${getTaskStatusClasses(task)}`}>
              {getTaskStatusLabel(task)}
            </span>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-[10px] text-nim-faint">
            {task.startedAt ? `Active ${formatDuration(task.startedAt, now)}` : 'Standing by'}
          </span>
          {canOpenSession && task.sessionId ? (
            <button
              type="button"
              className="text-[11px] font-medium text-[var(--nim-primary)] transition-colors hover:text-[var(--nim-primary-hover)]"
              onClick={() => {
                if (task.sessionId) {
                  onOpenSession?.(task.sessionId);
                }
              }}
            >
              View
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

const EmptyState: React.FC<{ label: string }> = ({ label }) => (
  <div className="rounded-md border border-dashed border-nim px-3 py-2 text-[12px] text-nim-muted">
    {label}
  </div>
);

export const BackgroundTaskIndicator: React.FC<BackgroundTaskIndicatorProps> = ({
  workspacePath,
  onOpenSession,
}) => {
  const isDevMode = import.meta.env.DEV || window.IS_DEV_MODE;
  const activeTaskCount = useAtomValue(backgroundTaskCountAtom);
  const hasError = useAtomValue(backgroundTaskHasErrorAtom);
  const tasksByCategory = useAtomValue(backgroundTasksByCategoryAtom);
  const syncStatus = useAtomValue(backgroundTaskSyncStatusAtom);
  const setSyncStatus = useSetAtom(backgroundTaskSyncStatusAtom);
  const [now, setNow] = React.useState(Date.now());
  const menu = useFloatingMenu({
    placement: 'right-end',
  });

  const fetchSyncStatus = useCallback(async () => {
    try {
      const result = await window.electronAPI.invoke('sync:get-status', workspacePath);
      const nextState: BackgroundTaskSyncState = {
        appConfigured: Boolean(result?.appConfigured),
        projectEnabled: Boolean(result?.projectEnabled),
        connected: Boolean(result?.connected),
        syncing: Boolean(result?.syncing),
        error: result?.error ?? null,
        stats: result?.stats ?? { sessionCount: 0, lastSyncedAt: null },
        docSyncStats: result?.docSyncStats,
        userEmail: result?.userEmail ?? null,
        lastUpdatedAt: Date.now(),
      };
      setSyncStatus(nextState);
    } catch (error) {
      console.error('[BackgroundTaskIndicator] Failed to fetch sync status:', error);
      setSyncStatus((prev) => ({
        ...prev,
        error: prev.error ?? 'Failed to fetch sync status',
        lastUpdatedAt: Date.now(),
      }));
    }
  }, [setSyncStatus, workspacePath]);

  useEffect(() => {
    if (!isDevMode) {
      return;
    }

    fetchSyncStatus();
    window.electronAPI.invoke('sync:subscribe-status').catch(() => undefined);
  }, [fetchSyncStatus, isDevMode]);

  // Apply incremental sync status updates from the central listener
  // (store/listeners/syncListeners.ts).
  const syncStatusUpdate = useAtomValue(syncStatusUpdateAtom);
  useEffect(() => {
    if (!isDevMode || !syncStatusUpdate) return;
    setSyncStatus((prev) => ({
      ...prev,
      connected: syncStatusUpdate.connected,
      syncing: syncStatusUpdate.syncing,
      error: syncStatusUpdate.error,
      lastUpdatedAt: Date.now(),
    }));
  }, [syncStatusUpdate, isDevMode, setSyncStatus]);

  useEffect(() => {
    if (!menu.isOpen) {
      return;
    }

    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [menu.isOpen]);

  if (!isDevMode) {
    return null;
  }

  const syncTask = tasksByCategory.sync[0];
  const buttonIcon = hasError ? 'error' : activeTaskCount > 0 ? 'progress_activity' : 'check_circle';
  const buttonLabel = hasError
    ? 'Background tasks have an error'
    : activeTaskCount > 0
      ? `${activeTaskCount} background task${activeTaskCount === 1 ? '' : 's'} running`
      : 'No active background tasks';

  return (
    <div className="background-task-indicator relative">
      <HelpTooltip testId="gutter-background-tasks-button" placement="right">
        <button
          ref={menu.refs.setReference}
          {...menu.getReferenceProps()}
          type="button"
          className={`nav-button relative flex h-9 w-9 items-center justify-center rounded-md border-none bg-transparent p-0 text-nim-muted transition-all duration-150 hover:bg-nim-tertiary hover:text-nim active:scale-95 focus-visible:outline-2 focus-visible:outline-[var(--nim-primary)] focus-visible:outline-offset-2 ${hasError ? 'text-[#ef4444]' : ''}`}
          onClick={() => menu.setIsOpen(!menu.isOpen)}
          aria-label={buttonLabel}
          aria-expanded={menu.isOpen}
          aria-haspopup="menu"
          data-testid="gutter-background-tasks-button"
        >
          <MaterialSymbol
            icon={buttonIcon}
            size={20}
          />
          {activeTaskCount > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex min-h-[16px] min-w-[16px] items-center justify-center rounded-full bg-[var(--nim-primary)] px-1 text-[10px] font-semibold text-white">
              {activeTaskCount > 9 ? '9+' : activeTaskCount}
            </span>
          ) : null}
          {hasError ? (
            <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-[#ef4444]" />
          ) : null}
        </button>
      </HelpTooltip>

      {menu.isOpen ? (
        <FloatingPortal>
          <div
            ref={menu.refs.setFloating}
            style={menu.floatingStyles}
            {...menu.getFloatingProps()}
            className="z-50 w-80 overflow-y-auto rounded-lg border border-nim bg-nim-secondary shadow-lg"
            data-testid="background-tasks-popover"
          >
            <div className="flex items-center justify-between border-b border-nim px-4 py-3">
              <div>
                <div className="text-[14px] font-semibold text-nim">Background Tasks</div>
                <div className="mt-0.5 text-[11px] text-nim-muted">
                  Dev mode only. {activeTaskCount > 0 ? `${activeTaskCount} active` : 'No active work'}.
                </div>
              </div>
              <button
                type="button"
                className="rounded p-1 text-nim-muted transition-colors hover:bg-nim-tertiary hover:text-nim"
                onClick={() => menu.setIsOpen(false)}
                aria-label="Close background tasks"
              >
                <MaterialSymbol icon="close" size={14} />
              </button>
            </div>

            <div className="space-y-4 px-4 py-3">
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-nim-muted">
                    AI Sessions
                  </h3>
                  <span className="text-[11px] text-nim-faint">
                    {tasksByCategory.aiSessions.length} running
                  </span>
                </div>
                <div className="space-y-2">
                  {tasksByCategory.aiSessions.length > 0 ? (
                    tasksByCategory.aiSessions.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        now={now}
                        onOpenSession={(sessionId) => {
                          onOpenSession?.(sessionId);
                          menu.setIsOpen(false);
                        }}
                      />
                    ))
                  ) : (
                    <EmptyState label="No AI sessions are currently running." />
                  )}
                </div>
              </section>

              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-nim-muted">
                    Sync
                  </h3>
                  <span className="text-[11px] text-nim-faint">
                    Last sync {formatLastSync(syncStatus.stats.lastSyncedAt)}
                  </span>
                </div>
                <div className="space-y-2">
                  {syncTask ? (
                    <TaskRow task={syncTask} now={now} />
                  ) : (
                    <EmptyState label="Sync status is unavailable." />
                  )}
                </div>
              </section>
            </div>
          </div>
        </FloatingPortal>
      ) : null}
    </div>
  );
};
