/**
 * Window Mode Atoms
 *
 * Manages which view is active in the project window (files, agent, settings).
 * Controlled by the navigation gutter on the left.
 *
 * @example
 * const mode = useAtomValue(windowModeAtom);
 * const setMode = useSetAtom(setWindowModeAtom);
 * setMode('agent');
 */

import { atom } from 'jotai';
import { store } from '@nimbalyst/runtime/store';
import type { ContentMode } from '../../types/WindowModeTypes';

// Re-export ContentMode for convenience (TODO: rename type to WindowMode)
export type { ContentMode };

// ============================================================
// Main Atoms
// ============================================================

/**
 * The active window mode.
 * Controls which main panel is displayed (files, agent, settings).
 */
export const windowModeAtom = atom<ContentMode>('files');

// Track workspace path for persistence
const windowModeWorkspaceAtom = atom<string | null>(null);

// ============================================================
// Debounced Persistence
// ============================================================

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(workspacePath: string, mode: ContentMode): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
  }

  persistTimer = setTimeout(async () => {
    try {
      await window.electronAPI.invoke('workspace:update-state', workspacePath, {
        activeMode: mode,
      });
    } catch (err) {
      console.error('[windowMode] Failed to persist:', err);
    }
  }, 500);
}

// ============================================================
// Setter Atoms
// ============================================================

/**
 * Set the window mode.
 * Automatically persists to workspace state (debounced).
 */
export const setWindowModeAtom = atom(
  null,
  (get, set, mode: ContentMode) => {
    set(windowModeAtom, mode);

    const workspacePath = get(windowModeWorkspaceAtom);
    if (workspacePath) {
      schedulePersist(workspacePath, mode);
    }
  }
);

// ============================================================
// Initialization
// ============================================================

/**
 * Initialize window mode from workspace state.
 * Call this when workspace path is known.
 */
export async function initWindowMode(workspacePath: string): Promise<void> {
  store.set(windowModeWorkspaceAtom, workspacePath);

  try {
    const workspaceState = await window.electronAPI.invoke(
      'workspace:get-state',
      workspacePath
    );

    if (workspaceState?.activeMode) {
      const validModes: ContentMode[] = ['files', 'agent', 'settings'];
      if (validModes.includes(workspaceState.activeMode)) {
        store.set(windowModeAtom, workspaceState.activeMode);
      }
    }
  } catch (err) {
    console.error('[windowMode] Failed to load:', err);
  }
}

/**
 * Reset window mode to defaults.
 */
export function resetWindowMode(): void {
  store.set(windowModeAtom, 'files');
  store.set(windowModeWorkspaceAtom, null);
}
