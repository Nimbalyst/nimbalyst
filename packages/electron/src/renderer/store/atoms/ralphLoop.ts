/**
 * Ralph Loop Atoms
 *
 * Jotai atoms for managing Ralph Loop state in the renderer.
 * Provides reactive state for UI components to display loop progress and status.
 */

import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import type {
  RalphLoop,
  RalphLoopWithIterations,
  RalphLoopStatus,
  RalphLoopEvent,
  RalphIteration,
  RalphProgressFile,
} from '../../../shared/types/ralph';

// ========================================
// Registry Atoms
// ========================================

/**
 * Registry of all Ralph Loops by ID.
 * Populated via IPC when fetching loops for a workspace.
 */
export const ralphLoopRegistryAtom = atom<Map<string, RalphLoop>>(new Map());

/**
 * Derived: Array of all ralph loops sorted by creation date (newest first)
 */
export const ralphLoopListAtom = atom((get) => {
  const registry = get(ralphLoopRegistryAtom);
  return Array.from(registry.values())
    .sort((a, b) => b.createdAt - a.createdAt);
});

/**
 * Derived: Active (running or paused) ralph loops
 */
export const activeRalphLoopsAtom = atom((get) => {
  const registry = get(ralphLoopRegistryAtom);
  return Array.from(registry.values())
    .filter(loop => loop.status === 'running' || loop.status === 'paused');
});

// ========================================
// Per-Loop Atoms (Atom Families)
// ========================================

/**
 * Get a single ralph loop by ID
 */
export const ralphLoopAtom = atomFamily((loopId: string) =>
  atom((get) => {
    const registry = get(ralphLoopRegistryAtom);
    return registry.get(loopId) ?? null;
  })
);

/**
 * Runner state for active loops (from main process)
 */
export interface RalphRunnerState {
  isRunning: boolean;
  isPaused: boolean;
  currentIteration: number;
  maxIterations: number;
  currentSessionId: string | null;
}

export const ralphRunnerStateAtom = atomFamily((_loopId: string) =>
  atom<RalphRunnerState | null>(null)
);

/**
 * Iterations for a ralph loop (loaded separately due to potential size)
 */
export const ralphIterationsAtom = atomFamily((_loopId: string) =>
  atom<RalphLoopWithIterations['iterations']>([])
);

/**
 * Progress file data for a ralph loop (loaded when loop is completed/failed)
 */
export const ralphProgressAtom = atomFamily((_loopId: string) =>
  atom<RalphProgressFile | null>(null)
);

// ========================================
// Action Atoms
// ========================================

/**
 * Update the ralph loop registry with new loops
 */
export const setRalphLoopsAtom = atom(
  null,
  (get, set, loops: RalphLoop[]) => {
    const newRegistry = new Map<string, RalphLoop>();
    for (const loop of loops) {
      newRegistry.set(loop.id, loop);
    }
    set(ralphLoopRegistryAtom, newRegistry);
  }
);

/**
 * Update or add a single ralph loop
 */
export const upsertRalphLoopAtom = atom(
  null,
  (get, set, loop: RalphLoop) => {
    const registry = new Map(get(ralphLoopRegistryAtom));
    registry.set(loop.id, loop);
    set(ralphLoopRegistryAtom, registry);
  }
);

/**
 * Remove a ralph loop from the registry
 */
export const removeRalphLoopAtom = atom(
  null,
  (get, set, loopId: string) => {
    const registry = new Map(get(ralphLoopRegistryAtom));
    registry.delete(loopId);
    set(ralphLoopRegistryAtom, registry);
  }
);

/**
 * Update runner state for a loop
 */
export const setRalphRunnerStateAtom = atom(
  null,
  (get, set, { loopId, state }: { loopId: string; state: RalphRunnerState | null }) => {
    set(ralphRunnerStateAtom(loopId), state);
  }
);

/**
 * Update iterations for a loop
 */
export const setRalphIterationsAtom = atom(
  null,
  (get, set, { loopId, iterations }: { loopId: string; iterations: RalphLoopWithIterations['iterations'] }) => {
    set(ralphIterationsAtom(loopId), iterations);
  }
);

/**
 * Update progress file data for a loop
 */
export const setRalphProgressAtom = atom(
  null,
  (get, set, { loopId, progress }: { loopId: string; progress: RalphProgressFile | null }) => {
    set(ralphProgressAtom(loopId), progress);
  }
);

// ========================================
// Event Handling
// ========================================

/**
 * Process a ralph loop event and update state accordingly
 */
export const processRalphEventAtom = atom(
  null,
  (get, set, event: RalphLoopEvent) => {
    // Guard against undefined or malformed events
    if (!event || typeof event !== 'object' || !('type' in event) || !('ralphId' in event)) {
      console.warn('[processRalphEventAtom] Received invalid event:', event);
      return;
    }

    const registry = new Map(get(ralphLoopRegistryAtom));

    switch (event.type) {
      case 'iteration-started': {
        const loop = registry.get(event.ralphId);
        if (loop) {
          registry.set(event.ralphId, {
            ...loop,
            currentIteration: event.iterationNumber,
            updatedAt: Date.now(),
          });
          set(ralphLoopRegistryAtom, registry);

          // Update runner state (create default if doesn't exist yet)
          const existingRunnerState = get(ralphRunnerStateAtom(event.ralphId));
          const runnerState: RalphRunnerState = existingRunnerState ?? {
            isRunning: true,
            isPaused: false,
            currentIteration: 0,
            maxIterations: loop.maxIterations,
            currentSessionId: null,
          };
          set(ralphRunnerStateAtom(event.ralphId), {
            ...runnerState,
            currentIteration: event.iterationNumber,
            currentSessionId: event.sessionId,
          });

          // Add the new iteration to the iterations atom
          const newIteration: RalphIteration = {
            id: event.iterationId,
            ralphLoopId: event.ralphId,
            sessionId: event.sessionId,
            iterationNumber: event.iterationNumber,
            status: 'running',
            createdAt: Date.now(),
          };
          const currentIterations = get(ralphIterationsAtom(event.ralphId));
          // Only add if not already present (in case of duplicate events)
          if (!currentIterations.some(iter => iter.id === event.iterationId)) {
            set(ralphIterationsAtom(event.ralphId), [...currentIterations, newIteration]);
          }
        }
        break;
      }

      case 'iteration-completed': {
        const loop = registry.get(event.ralphId);
        if (loop) {
          registry.set(event.ralphId, {
            ...loop,
            updatedAt: Date.now(),
          });
          set(ralphLoopRegistryAtom, registry);

          // Update the iteration status in the iterations atom
          const currentIterations = get(ralphIterationsAtom(event.ralphId));
          const updatedIterations = currentIterations.map(iter =>
            iter.id === event.iterationId
              ? { ...iter, status: 'completed' as const, exitReason: event.exitReason, completedAt: Date.now() }
              : iter
          );
          set(ralphIterationsAtom(event.ralphId), updatedIterations);
        }
        break;
      }

      case 'iteration-failed': {
        const loop = registry.get(event.ralphId);
        if (loop) {
          registry.set(event.ralphId, {
            ...loop,
            updatedAt: Date.now(),
          });
          set(ralphLoopRegistryAtom, registry);

          // Update the iteration status in the iterations atom
          const currentIterations = get(ralphIterationsAtom(event.ralphId));
          const updatedIterations = currentIterations.map(iter =>
            iter.id === event.iterationId
              ? { ...iter, status: 'failed' as const, exitReason: event.error, completedAt: Date.now() }
              : iter
          );
          set(ralphIterationsAtom(event.ralphId), updatedIterations);
        }
        break;
      }

      case 'loop-blocked': {
        const loop = registry.get(event.ralphId);
        if (loop) {
          registry.set(event.ralphId, {
            ...loop,
            status: 'blocked',
            completionReason: event.reason,
            updatedAt: Date.now(),
          });
          set(ralphLoopRegistryAtom, registry);
          set(ralphRunnerStateAtom(event.ralphId), null);
        }
        break;
      }

      case 'loop-completed':
      case 'loop-stopped': {
        const loop = registry.get(event.ralphId);
        if (loop) {
          registry.set(event.ralphId, {
            ...loop,
            status: 'completed',
            completionReason: event.reason,
            updatedAt: Date.now(),
          });
          set(ralphLoopRegistryAtom, registry);
          set(ralphRunnerStateAtom(event.ralphId), null);
        }
        break;
      }

      case 'loop-failed': {
        const loop = registry.get(event.ralphId);
        if (loop) {
          registry.set(event.ralphId, {
            ...loop,
            status: 'failed',
            completionReason: event.error,
            updatedAt: Date.now(),
          });
          set(ralphLoopRegistryAtom, registry);
          set(ralphRunnerStateAtom(event.ralphId), null);
        }
        break;
      }

      case 'loop-paused': {
        const loop = registry.get(event.ralphId);
        if (loop) {
          registry.set(event.ralphId, {
            ...loop,
            status: 'paused',
            updatedAt: Date.now(),
          });
          set(ralphLoopRegistryAtom, registry);

          const runnerState = get(ralphRunnerStateAtom(event.ralphId));
          if (runnerState) {
            set(ralphRunnerStateAtom(event.ralphId), {
              ...runnerState,
              isPaused: true,
              isRunning: false,
            });
          }
        }
        break;
      }

      case 'loop-resumed': {
        const loop = registry.get(event.ralphId);
        if (loop) {
          registry.set(event.ralphId, {
            ...loop,
            status: 'running',
            updatedAt: Date.now(),
          });
          set(ralphLoopRegistryAtom, registry);

          const runnerState = get(ralphRunnerStateAtom(event.ralphId));
          if (runnerState) {
            set(ralphRunnerStateAtom(event.ralphId), {
              ...runnerState,
              isPaused: false,
              isRunning: true,
            });
          }
        }
        break;
      }
    }
  }
);

// ========================================
// UI State Atoms
// ========================================

/**
 * Whether the new ralph loop dialog is open
 */
export const newRalphLoopDialogOpenAtom = atom(false);

/**
 * Currently selected/expanded ralph loop in UI
 */
export const selectedRalphLoopIdAtom = atom<string | null>(null);

// ========================================
// Helpers
// ========================================

/**
 * Get ralph loop status display info
 */
export function getRalphStatusInfo(status: RalphLoopStatus): {
  label: string;
  color: 'running' | 'paused' | 'completed' | 'failed' | 'pending' | 'blocked';
} {
  switch (status) {
    case 'running':
      return { label: 'Running', color: 'running' };
    case 'paused':
      return { label: 'Paused', color: 'paused' };
    case 'completed':
      return { label: 'Completed', color: 'completed' };
    case 'failed':
      return { label: 'Failed', color: 'failed' };
    case 'blocked':
      return { label: 'Blocked', color: 'blocked' };
    case 'pending':
    default:
      return { label: 'Pending', color: 'pending' };
  }
}
