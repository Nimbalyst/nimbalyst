/**
 * Terminal Atoms
 *
 * State management for terminal instances using Jotai.
 * Provides reactive updates when terminals are created, deleted, or modified.
 *
 * Key principle: Backend emits IPC events, atoms update, UI re-renders.
 */

import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import { store } from '@nimbalyst/runtime/store';

/**
 * Terminal instance metadata
 */
export interface TerminalInstance {
  id: string;
  title: string;
  shellName: string;
  shellPath: string;
  cwd: string;
  worktreeId?: string;
  worktreeName?: string;
  createdAt: number;
  lastActiveAt: number;
  historyFile?: string;
}

/**
 * Terminal workspace state
 */
export interface TerminalWorkspaceState {
  terminals: Record<string, TerminalInstance>;
  activeTerminalId?: string;
  tabOrder: string[];
}

/**
 * Main atom for terminal list (sorted by tab order)
 */
export const terminalListAtom = atom<TerminalInstance[]>([]);

/**
 * Active terminal ID atom
 */
export const activeTerminalIdAtom = atom<string | undefined>(undefined);

/**
 * Atom family for tracking command running state per terminal
 * Each terminal has its own atom to avoid unnecessary re-renders
 */
export const terminalCommandRunningAtom = atomFamily((terminalId: string) =>
  atom(false)
);

/**
 * Update command running state for a terminal
 */
export function setTerminalCommandRunning(terminalId: string, isRunning: boolean): void {
  store.set(terminalCommandRunningAtom(terminalId), isRunning);
}

/**
 * Load terminals from backend and update atoms
 */
export async function loadTerminals(workspacePath: string): Promise<void> {
  try {
    const state = await window.electronAPI.terminal.getWorkspaceState(workspacePath);
    const terminalList = state.tabOrder
      .map((id: string) => state.terminals[id])
      .filter((t: TerminalInstance | undefined): t is TerminalInstance => t !== undefined);

    store.set(terminalListAtom, terminalList);
    store.set(activeTerminalIdAtom, state.activeTerminalId);
  } catch (error) {
    console.error('[terminals] Failed to load terminals:', error);
  }
}

/**
 * Remove a terminal from the list (optimistic update)
 */
export function removeTerminalFromList(terminalId: string): void {
  store.set(terminalListAtom, (prev) => prev.filter((t) => t.id !== terminalId));

  // Update active terminal if the removed one was active
  const activeId = store.get(activeTerminalIdAtom);
  if (activeId === terminalId) {
    const remaining = store.get(terminalListAtom);
    store.set(activeTerminalIdAtom, remaining[0]?.id);
  }
}

/**
 * Add a terminal to the list (optimistic update)
 */
export function addTerminalToList(terminal: TerminalInstance): void {
  store.set(terminalListAtom, (prev) => [...prev, terminal]);
}

/**
 * Set the active terminal
 */
export function setActiveTerminal(terminalId: string | undefined): void {
  store.set(activeTerminalIdAtom, terminalId);
}

/**
 * Initialize terminal IPC listeners
 * Call this once at app startup to listen for backend events
 */
export function initTerminalListeners(workspacePath: string): () => void {
  // Listen for terminal list changes (e.g., when worktree is archived)
  // Note: electronAPI.on strips the event object, so data is the first arg
  const handleTerminalListChanged = (data: { workspacePath: string }) => {
    if (data.workspacePath === workspacePath) {
      loadTerminals(workspacePath).catch((err: unknown) => {
        console.error('[terminals] Failed to reload terminals after list change:', err);
      });
    }
  };

  window.electronAPI.on('terminal:list-changed', handleTerminalListChanged);

  // Return cleanup function
  return () => {
    window.electronAPI.off?.('terminal:list-changed', handleTerminalListChanged);
  };
}
