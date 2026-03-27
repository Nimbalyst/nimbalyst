import { useState, useCallback, useRef } from 'react';

export interface OperationLogEntry {
  id: string;
  timestamp: Date;
  command: string;
  status: 'running' | 'success' | 'error';
  output?: string;
  error?: string;
  suggestion?: string;
  durationMs?: number;
}

/**
 * Hook for managing a persistent (in-memory) log of git operations.
 * Shared across tabs so the Output tab always has the full history.
 */
export function useOperationLog() {
  const [entries, setEntries] = useState<OperationLogEntry[]>([]);
  const nextId = useRef(0);

  const addEntry = useCallback((command: string): string => {
    const id = `op-${nextId.current++}`;
    const entry: OperationLogEntry = {
      id,
      timestamp: new Date(),
      command,
      status: 'running',
    };
    setEntries(prev => [...prev, entry]);
    return id;
  }, []);

  const updateEntry = useCallback((id: string, update: Partial<OperationLogEntry>) => {
    setEntries(prev =>
      prev.map(e => e.id === id ? { ...e, ...update } : e)
    );
  }, []);

  const clearLog = useCallback(() => {
    setEntries([]);
  }, []);

  /**
   * Wraps an async git operation with logging.
   * Returns the result of the operation.
   */
  const withLog = useCallback(async <T>(
    command: string,
    operation: () => Promise<T>,
    opts?: {
      /** Extract a user-friendly output string from the result */
      formatOutput?: (result: T) => string | undefined;
      /** Extract error suggestion from a failed result */
      formatSuggestion?: (result: T) => string | undefined;
      /** Check if the result represents an error (for { success, error } patterns) */
      isError?: (result: T) => boolean;
      /** Extract error message from the result */
      getError?: (result: T) => string | undefined;
    }
  ): Promise<T> => {
    const id = addEntry(command);
    const startTime = Date.now();

    try {
      const result = await operation();
      const durationMs = Date.now() - startTime;

      // Check if the result itself indicates an error (e.g. { success: false, error: '...' })
      if (opts?.isError?.(result)) {
        updateEntry(id, {
          status: 'error',
          error: opts.getError?.(result) ?? 'Operation failed',
          suggestion: opts.formatSuggestion?.(result),
          durationMs,
        });
      } else {
        updateEntry(id, {
          status: 'success',
          output: opts?.formatOutput?.(result),
          durationMs,
        });
      }

      return result;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      updateEntry(id, {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        durationMs,
      });
      throw err;
    }
  }, [addEntry, updateEntry]);

  return { entries, addEntry, updateEntry, clearLog, withLog };
}

/** Map common git errors to actionable suggestions */
export function getSuggestionForError(error: string): string | undefined {
  const lower = error.toLowerCase();

  if (lower.includes('non-fast-forward') || lower.includes('rejected')) {
    return 'Pull changes first, then push again.';
  }
  if (lower.includes('uncommitted changes') || lower.includes('your local changes')) {
    return 'Commit or stash your changes first.';
  }
  if (lower.includes('authentication') || lower.includes('permission denied') || lower.includes('could not read from remote')) {
    return 'Check your credentials or SSH key configuration.';
  }
  if (lower.includes('lock') || lower.includes('index.lock')) {
    return 'Another git process may be running. If not, remove the lock file.';
  }
  if (lower.includes('conflict')) {
    return 'Resolve the conflicts, then continue or abort the operation.';
  }
  if (lower.includes('detached head')) {
    return 'Create a branch to save your work.';
  }
  return undefined;
}
