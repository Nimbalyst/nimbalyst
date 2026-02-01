import { useEffect, useRef } from 'react';
import { useSetAtom } from 'jotai';
import type { ContentMode } from '../types/WindowModeTypes';
import type { AgentModeRef } from '../components/AgentMode';
import {
  toggleTrackerPanelAtom,
  closeTrackerPanelAtom,
} from '../store/atoms/trackers';

interface KeyboardShortcutsOptions {
  // Mode state
  activeMode: ContentMode;
  workspaceMode: boolean;

  // Mode setters
  setActiveMode: (mode: ContentMode) => void;

  // Ref for accessing current mode in callbacks
  activeModeStateRef: React.RefObject<ContentMode>;

  // EditorMode ref for file operations
  editorModeRef: React.RefObject<{
    toggleSidebarCollapsed: () => void;
    openHistoryDialog: () => void;
  } | null>;

  // AgentMode ref for worktree operations
  agentModeRef: React.RefObject<AgentModeRef | null>;

  // Terminal panel state
  terminalPanelVisible: boolean;
  setTerminalPanelVisible: React.Dispatch<React.SetStateAction<boolean>>;

  // Agent mode toggle
  toggleAgentCollapsed: () => void;
}

/**
 * Hook that manages global keyboard shortcuts for the application.
 *
 * Handles:
 * - Cmd+E: Switch to Files mode (or toggle sidebar if already in Files mode)
 * - Cmd+K: Switch to Agent mode (or toggle session history if already in Agent mode)
 * - Cmd+Y: Open history dialog (Files mode only)
 * - Cmd+Shift+T: Toggle Tracker panel (remembers last active type)
 * - Cmd+Alt+W: Create new worktree session
 * - Cmd+`: Toggle Terminal panel
 */
export function useKeyboardShortcuts({
  activeMode,
  workspaceMode,
  setActiveMode,
  activeModeStateRef,
  editorModeRef,
  agentModeRef,
  terminalPanelVisible,
  setTerminalPanelVisible,
  toggleAgentCollapsed,
}: KeyboardShortcutsOptions): void {
  // Tracker panel atoms
  const toggleTrackerPanel = useSetAtom(toggleTrackerPanelAtom);
  const closeTrackerPanel = useSetAtom(closeTrackerPanelAtom);

  // Track if worktree creation is pending after mode switch
  const pendingWorktreeCreationRef = useRef(false);

  // When agentModeRef becomes available and worktree creation is pending, execute it
  useEffect(() => {
    if (pendingWorktreeCreationRef.current && agentModeRef.current && activeMode === 'agent') {
      pendingWorktreeCreationRef.current = false;
      agentModeRef.current.createNewWorktreeSession();
    }
  }, [agentModeRef, activeMode]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      // Cmd+E for Files mode (toggle sidebar if already in files mode)
      if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
        e.preventDefault();
        e.stopPropagation();

        if (workspaceMode) {
          if (activeMode === 'files') {
            editorModeRef.current?.toggleSidebarCollapsed();
          } else {
            setActiveMode('files');
          }
        }
      }

      // Cmd+K for Agent mode (toggle session history if already in agent mode)
      // This is a global shortcut, but should be preempted if another component handles it
      if ((e.metaKey || e.ctrlKey) && e.key === 'k' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();

        if (workspaceMode) {
          if (activeMode === 'agent') {
            toggleAgentCollapsed();
          } else {
            setActiveMode('agent');
          }
        }
      }

      // Cmd+Y for history dialog (Files mode only)
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        e.preventDefault();
        // Only open history dialog when in files mode
        if (workspaceMode && activeModeStateRef.current === 'files' && editorModeRef.current) {
          editorModeRef.current.openHistoryDialog();
        }
      }

      // Cmd+Shift+T to toggle tracker panel (remembers last active type)
      if (workspaceMode && (e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 't') {
        e.preventDefault();
        toggleTrackerPanel();
        setTerminalPanelVisible(false);
      }
      // Cmd+` (macOS) or Ctrl+` (Windows/Linux) for Terminal panel
      if (workspaceMode && e.code === 'Backquote' && !e.shiftKey && !e.altKey &&
          (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        setTerminalPanelVisible(prev => {
          if (!prev) closeTrackerPanel(); // Close tracker when opening terminal
          return !prev;
        });
      }

      // Cmd+Alt+W (Mac) or Ctrl+Alt+W (Windows) to create new worktree session
      if (workspaceMode && (e.metaKey || e.ctrlKey) && e.altKey && e.key === 'w') {
        e.preventDefault();
        e.stopPropagation();

        // If in agent mode and ref is available, create worktree directly
        if (activeMode === 'agent' && agentModeRef.current) {
          agentModeRef.current.createNewWorktreeSession();
        } else {
          // Switch to agent mode first, then create worktree when ref becomes available
          pendingWorktreeCreationRef.current = true;
          setActiveMode('agent');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [
    activeMode,
    workspaceMode,
    setActiveMode,
    activeModeStateRef,
    editorModeRef,
    agentModeRef,
    terminalPanelVisible,
    setTerminalPanelVisible,
    toggleAgentCollapsed,
    toggleTrackerPanel,
    closeTrackerPanel,
  ]);
}
