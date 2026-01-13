import { EventEmitter } from 'events';
import { BrowserWindow } from 'electron';
import log from 'electron-log';

const logger = log.scope('ArchiveProgressManager');

export interface ArchiveTask {
  worktreeId: string;
  worktreeName: string;
  status: 'queued' | 'pending' | 'removing-worktree' | 'completed' | 'failed';
  startTime: Date;
  error?: string;
  executeCallback?: () => Promise<void>;
}

/**
 * Manages a queue of worktree archive tasks, processing them one at a time.
 * This prevents overwhelming git when archiving multiple worktrees at once.
 *
 * Flow:
 * 1. User archives a worktree -> Session archived immediately in DB (fast feedback)
 * 2. Cleanup task queued here -> Worktree removal processed serially
 * 3. Progress emitted to frontend -> UI shows what's happening
 */
export class ArchiveProgressManager extends EventEmitter {
  private tasks: Map<string, ArchiveTask> = new Map();
  private taskQueue: string[] = [];
  private isProcessing = false;

  /**
   * Add a new archive task to the queue.
   * The task will be processed when it reaches the front of the queue.
   */
  addTask(
    worktreeId: string,
    worktreeName: string,
    executeCallback: () => Promise<void>
  ): void {
    const task: ArchiveTask = {
      worktreeId,
      worktreeName,
      status: 'queued',
      startTime: new Date(),
      executeCallback,
    };

    this.tasks.set(worktreeId, task);
    this.taskQueue.push(worktreeId);
    this.emitProgress();
    this.processQueue();
  }

  /**
   * Update the status of a task (called by the execute callback to report progress).
   */
  updateTaskStatus(
    worktreeId: string,
    status: ArchiveTask['status'],
    error?: string
  ): void {
    const task = this.tasks.get(worktreeId);
    if (task) {
      task.status = status;
      if (error) {
        task.error = error;
      }
      this.emitProgress();
    }
  }

  /**
   * Get all current tasks (for initial load when component mounts).
   */
  getTasks(): ArchiveTask[] {
    return Array.from(this.tasks.values()).map((task) => ({
      worktreeId: task.worktreeId,
      worktreeName: task.worktreeName,
      status: task.status,
      startTime: task.startTime,
      error: task.error,
    }));
  }

  /**
   * Process the queue one task at a time.
   */
  private async processQueue(): Promise<void> {
    // Only process one at a time
    if (this.isProcessing || this.taskQueue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const worktreeId = this.taskQueue.shift()!;
    const task = this.tasks.get(worktreeId);

    if (task?.executeCallback) {
      try {
        task.status = 'pending';
        this.emitProgress();

        await task.executeCallback();

        task.status = 'completed';
      } catch (error) {
        task.status = 'failed';
        task.error = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Archive task failed', { worktreeId, error });
      }

      this.emitProgress();

      // Auto-remove completed/failed tasks after 10 seconds
      // (gives users time to see the completion status, even for long-running tasks)
      setTimeout(() => {
        this.tasks.delete(worktreeId);
        this.emitProgress();
      }, 10000);
    }

    this.isProcessing = false;
    // Process next task in queue
    this.processQueue();
  }

  /**
   * Emit progress to all listeners and broadcast to all renderer windows.
   */
  private emitProgress(): void {
    const tasks = this.getTasks();
    this.emit('archive-progress', tasks);

    // Broadcast to all browser windows
    const windows = BrowserWindow.getAllWindows();
    for (const window of windows) {
      if (!window.isDestroyed()) {
        window.webContents.send('archive:progress', tasks);
      }
    }
  }
}

// Singleton instance
export const archiveProgressManager = new ArchiveProgressManager();
