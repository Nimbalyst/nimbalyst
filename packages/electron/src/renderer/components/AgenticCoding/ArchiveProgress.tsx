import React, { useState, useEffect, useCallback } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import './ArchiveProgress.css';

interface ArchiveTask {
  worktreeId: string;
  worktreeName: string;
  status: 'queued' | 'pending' | 'removing-worktree' | 'completed' | 'failed';
  startTime: Date;
  error?: string;
}

interface ArchiveProgressProps {
  /** Called when a worktree is fully archived (for refreshing the list) */
  onWorktreeArchived?: (worktreeId: string) => void;
}

/**
 * Displays archive progress at the bottom of the session history sidebar.
 * Shows queued, in-progress, completed, and failed archive tasks.
 * Collapsed by default to save space, expandable to see details.
 * Auto-hides when there are no tasks.
 */
export const ArchiveProgress: React.FC<ArchiveProgressProps> = ({ onWorktreeArchived }) => {
  const [tasks, setTasks] = useState<ArchiveTask[]>([]);
  const [notifiedWorktrees, setNotifiedWorktrees] = useState<Set<string>>(new Set());
  const [isExpanded, setIsExpanded] = useState(false);

  // Load initial tasks and subscribe to progress updates
  useEffect(() => {
    // Guard against archive API not being available (e.g., during hot reload before preload rebuilds)
    if (!window.electronAPI?.archive) {
      return;
    }

    // Get initial tasks
    window.electronAPI.archive.getTasks().then((result: { success: boolean; tasks: ArchiveTask[] }) => {
      if (result.success) {
        setTasks(result.tasks);
      }
    });

    // Subscribe to progress updates
    const unsubscribe = window.electronAPI.archive.onProgress((newTasks: ArchiveTask[]) => {
      setTasks(newTasks);

      // Notify parent when tasks complete (only once per worktree)
      if (onWorktreeArchived) {
        newTasks.forEach((task) => {
          if (task.status === 'completed' && !notifiedWorktrees.has(task.worktreeId)) {
            setNotifiedWorktrees((prev) => new Set(prev).add(task.worktreeId));
            onWorktreeArchived(task.worktreeId);
          }
        });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [onWorktreeArchived, notifiedWorktrees]);

  const handleToggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  // Don't render anything if there are no tasks
  if (tasks.length === 0) {
    return null;
  }

  const getStatusIcon = (status: ArchiveTask['status']) => {
    switch (status) {
      case 'queued':
        return <MaterialSymbol icon="schedule" className="archive-task-icon archive-task-icon--queued" />;
      case 'pending':
      case 'removing-worktree':
        return <MaterialSymbol icon="progress_activity" className="archive-task-icon archive-task-icon--active" />;
      case 'completed':
        return <MaterialSymbol icon="check_circle" className="archive-task-icon archive-task-icon--completed" />;
      case 'failed':
        return <MaterialSymbol icon="error" className="archive-task-icon archive-task-icon--failed" />;
    }
  };

  const getStatusText = (status: ArchiveTask['status']) => {
    switch (status) {
      case 'queued':
        return 'Queued';
      case 'pending':
        return 'Starting...';
      case 'removing-worktree':
        return 'Removing worktree (this may take a while)...';
      case 'completed':
        return 'Archived';
      case 'failed':
        return 'Failed';
    }
  };

  // Count active tasks (queued, pending, or removing)
  const activeTasks = tasks.filter(
    (t) => t.status === 'queued' || t.status === 'pending' || t.status === 'removing-worktree'
  );
  const activeCount = activeTasks.length;

  return (
    <div className="archive-progress">
      <button className="archive-progress-header" onClick={handleToggleExpand}>
        <MaterialSymbol icon="archive" className="archive-progress-header-icon" />
        <span className="archive-progress-header-text">Archive Tasks</span>
        {activeCount > 0 && (
          <span className="archive-progress-header-count">{activeCount} active</span>
        )}
        <MaterialSymbol
          icon="expand_more"
          className={`archive-progress-header-chevron ${isExpanded ? 'expanded' : ''}`}
        />
      </button>
      {isExpanded && (
        <div className="archive-progress-content">
          {activeTasks.length > 0 && (
            <div className="archive-progress-warning">
              <MaterialSymbol icon="warning" className="archive-progress-warning-icon" />
              <span className="archive-progress-warning-text">
                Worktree removal can take several minutes for large repositories
              </span>
            </div>
          )}
          <div className="archive-progress-tasks">
            {tasks.map((task) => (
              <div key={task.worktreeId} className={`archive-task archive-task--${task.status}`}>
                {getStatusIcon(task.status)}
                <div className="archive-task-content">
                  <div className="archive-task-name">{task.worktreeName}</div>
                  <div className="archive-task-path">{task.worktreeId}</div>
                  <div className="archive-task-status">
                    {task.error || getStatusText(task.status)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
