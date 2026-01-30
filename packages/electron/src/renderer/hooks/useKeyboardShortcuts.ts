import { useEffect, useRef } from 'react';
import type { ContentMode } from '../types/WindowModeTypes';
import type { TrackerBottomPanelType } from '../components/TrackerBottomPanel/TrackerBottomPanel';
import type { AgentModeRef } from '../components/AgentMode';

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

  // Bottom panel state
  bottomPanel: TrackerBottomPanelType | null;
  setBottomPanel: React.Dispatch<React.SetStateAction<TrackerBottomPanelType | null>>;

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
 * - Cmd+Shift+P: Toggle Plans panel
 * - Cmd+Shift+B: Toggle Bugs panel
 * - Cmd+Shift+K: Toggle Tasks panel
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
  bottomPanel,
  setBottomPanel,
  terminalPanelVisible,
  setTerminalPanelVisible,
  toggleAgentCollapsed,
}: KeyboardShortcutsOptions): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      // Cmd+E for Files mode (toggle sidebar if already in files mode)
      if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (activeMode === 'files') {
          editorModeRef.current?.toggleSidebarCollapsed();
        } else {
          setActiveMode('files');
        }
        return;
      }
      // Cmd+K for Agent mode (toggle session history if already in agent mode)
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (activeMode === 'agent') {
          toggleAgentCollapsed();
        } else {
          setActiveMode('agent');
        }
        return;
      }
      // NOTE: Cmd+O, Cmd+L, Cmd+Shift+L are handled by NavigationDialogKeyboardHandler
      // NOTE: Cmd+Shift+A for AI Chat is handled by the menu accelerator + IPC listener
      // NOTE: Cmd+Shift+T handled by menu system (reopen-last-closed-tab IPC event)

      // Cmd+Alt+W for new worktree session
      // Note: On Mac, Alt+W produces '∑', so we need to check e.code instead of e.key
      if (workspaceMode && (e.metaKey || e.ctrlKey) && e.altKey && e.code === 'KeyW') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        // Switch to agent mode if not already there
        if (activeMode !== 'agent') {
          setActiveMode('agent');
          // Need to wait for mode switch and component mount
          setTimeout(() => {
            agentModeRef.current?.createNewWorktreeSession();
          }, 100);
        } else {
          // Already in agent mode, create worktree directly
          agentModeRef.current?.createNewWorktreeSession();
        }
        return;
      }

      // Cmd+Y (Mac) or Ctrl+Y (Windows/Linux) for History - only in files mode
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        e.preventDefault();
        // Only open history dialog when in files mode
        if (workspaceMode && activeModeStateRef.current === 'files' && editorModeRef.current) {
          editorModeRef.current.openHistoryDialog();
        }
      }

      // Bottom panel keyboard shortcuts (mutually exclusive)
      // Cmd+Shift+P for Plans panel
      if (workspaceMode && (e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'p') {
        e.preventDefault();
        setBottomPanel(prev => prev === 'plan' ? null : 'plan');
        setTerminalPanelVisible(false);
      }
      // Cmd+Shift+B for Bugs panel
      if (workspaceMode && (e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'b') {
        e.preventDefault();
        setBottomPanel(prev => prev === 'bug' ? null : 'bug');
        setTerminalPanelVisible(false);
      }
      // Cmd+Shift+K for Tasks panel
      if (workspaceMode && (e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'k') {
        e.preventDefault();
        setBottomPanel(prev => prev === 'task' ? null : 'task');
        setTerminalPanelVisible(false);
      }
      // Cmd+` (macOS) or Ctrl+` (Windows/Linux) for Terminal panel
      if (workspaceMode && e.code === 'Backquote' && !e.shiftKey && !e.altKey &&
          (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        setTerminalPanelVisible(prev => {
          if (!prev) setBottomPanel(null); // Close tracker when opening terminal
          return !prev;
        });
      }
    };

    // Use capture phase to intercept before any other handlers (like Lexical's)
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [
    workspaceMode,
    activeMode,
    setActiveMode,
    activeModeStateRef,
    editorModeRef,
    agentModeRef,
    setBottomPanel,
    setTerminalPanelVisible,
    toggleAgentCollapsed,
  ]);
}
