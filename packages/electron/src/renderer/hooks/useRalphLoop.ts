/**
 * useRalphLoop - Hooks for managing Ralph Loop state
 *
 * IPC event listeners are centralized in store/listeners/ralphLoopListeners.ts.
 * This file provides hooks for initial data loading and UI utilities.
 */

import { useEffect, useCallback } from 'react';
import { useSetAtom, useAtomValue } from 'jotai';
import {
  setRalphLoopsAtom,
  ralphLoopListAtom,
  activeRalphLoopsAtom,
  newRalphLoopDialogOpenAtom,
} from '../store/atoms/ralphLoop';

/**
 * Load Ralph Loop data for a workspace on mount.
 * IPC event listeners are handled by centralized listeners (initRalphLoopListeners).
 */
export function useRalphLoopInit(workspacePath: string | null, enabled = true) {
  const setRalphLoops = useSetAtom(setRalphLoopsAtom);

  useEffect(() => {
    if (!enabled || !workspacePath) return;

    const loadLoops = async () => {
      try {
        const result = await window.electronAPI.invoke('ralph:list', workspacePath);
        if (result.success && result.loops) {
          setRalphLoops(result.loops);
        }
      } catch (err) {
        console.error('[useRalphLoopInit] Failed to load ralph loops:', err);
      }
    };

    loadLoops();
  }, [enabled, workspacePath, setRalphLoops]);
}

/**
 * Hook for Ralph Loop dialog management
 *
 * Ralph Loops automatically create their own dedicated worktree,
 * so no worktree selection is needed.
 */
export function useRalphLoopDialog() {
  const setDialogOpen = useSetAtom(newRalphLoopDialogOpenAtom);

  const openDialog = useCallback(() => {
    setDialogOpen(true);
  }, [setDialogOpen]);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
  }, [setDialogOpen]);

  return { openDialog, closeDialog };
}

/**
 * Hook to get Ralph Loop for a specific worktree
 */
export function useRalphLoopForWorktree(worktreeId: string | null) {
  const loops = useAtomValue(ralphLoopListAtom);

  return loops.find(loop => loop.worktreeId === worktreeId) ?? null;
}

/**
 * Hook to control a Ralph Loop
 */
export function useRalphLoopControls(loopId: string) {
  const start = useCallback(async () => {
    const result = await window.electronAPI.invoke('ralph:start', loopId);
    return result.success;
  }, [loopId]);

  const pause = useCallback(async () => {
    const result = await window.electronAPI.invoke('ralph:pause', loopId);
    return result.success;
  }, [loopId]);

  const stop = useCallback(async (reason?: string) => {
    const result = await window.electronAPI.invoke('ralph:stop', loopId, reason);
    return result.success;
  }, [loopId]);

  const deleteLoop = useCallback(async () => {
    const result = await window.electronAPI.invoke('ralph:delete', loopId);
    return result.success;
  }, [loopId]);

  const forceResume = useCallback(async (options?: { bumpMaxIterations?: number; resetCompletionSignal?: boolean }) => {
    const result = await window.electronAPI.invoke('ralph:force-resume', loopId, options);
    return result.success;
  }, [loopId]);

  return { start, pause, stop, delete: deleteLoop, forceResume };
}

/**
 * Get active Ralph Loops count (for badges etc)
 */
export function useActiveRalphLoopsCount(): number {
  const activeLoops = useAtomValue(activeRalphLoopsAtom);
  return activeLoops.length;
}
