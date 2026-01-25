/**
 * TerminalBottomPanel - Slide-up bottom panel for terminal tabs
 *
 * Similar to TrackerBottomPanel but contains multiple terminal instances
 * in a tabbed interface. Terminals are stored in a dedicated terminal store
 * separate from AI sessions.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import { TerminalPanel } from '../Terminal/TerminalPanel';
import { TerminalTab } from './TerminalTab';
import { usePostHog } from 'posthog-js/react';

// Type for terminal instance from electron API
interface TerminalInstance {
  id: string;
  title: string;
  shellName: string;
  shellPath: string;
  cwd: string;
  worktreeId?: string;
  createdAt: number;
  lastActiveAt: number;
  historyFile?: string;
}

interface TerminalBottomPanelProps {
  workspacePath: string;
  visible: boolean;
  onVisibilityChange: (visible: boolean) => void;
  height: number;
  onHeightChange: (height: number) => void;
  minHeight?: number;
  maxHeight?: number;
}

export const TerminalBottomPanel: React.FC<TerminalBottomPanelProps> = ({
  workspacePath,
  visible,
  onVisibilityChange,
  height,
  onHeightChange,
  minHeight = 150,
  maxHeight = 600,
}) => {
  const [terminals, setTerminals] = useState<TerminalInstance[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | undefined>();
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartY = useRef<number>(0);
  const resizeStartHeight = useRef<number>(0);
  const posthog = usePostHog();

  // Load terminals from store on mount and when workspace changes
  useEffect(() => {
    let mounted = true;

    const loadTerminals = async () => {
      try {
        const state = await window.electronAPI.terminal.getWorkspaceState(workspacePath);
        if (mounted) {
          // Convert terminals record to array in tab order
          const terminalList = state.tabOrder
            .map(id => state.terminals[id])
            .filter((t): t is TerminalInstance => t !== undefined);
          setTerminals(terminalList);
          setActiveTerminalId(state.activeTerminalId);
        }
      } catch (error) {
        console.error('[TerminalBottomPanel] Failed to load terminals:', error);
      }
    };

    loadTerminals();

    // Listen for external terminal creation (e.g., from worktree button)
    const handleTerminalCreated = (event: Event) => {
      const customEvent = event as CustomEvent<{ terminalId: string }>;
      if (customEvent.detail?.terminalId) {
        // Reload terminals to get the new one
        loadTerminals();
      }
    };

    window.addEventListener('terminal:created', handleTerminalCreated);

    return () => {
      mounted = false;
      window.removeEventListener('terminal:created', handleTerminalCreated);
    };
  }, [workspacePath]);

  // Load panel height on mount (visibility is managed by App.tsx)
  useEffect(() => {
    let mounted = true;

    const loadPanelState = async () => {
      try {
        const state = await window.electronAPI.terminal.getPanelState();
        if (mounted && state.panelHeight) {
          onHeightChange(state.panelHeight);
        }
      } catch (error) {
        console.error('[TerminalBottomPanel] Failed to load panel state:', error);
      }
    };

    loadPanelState();

    return () => {
      mounted = false;
    };
  }, [onHeightChange]);

  // Track analytics and persist visibility when panel visibility changes
  useEffect(() => {
    if (visible && posthog) {
      posthog.capture('terminal_panel_opened', {
        terminalCount: terminals.length,
      });
    }
    // Persist visibility state
    window.electronAPI.terminal.setPanelVisible(visible);
  }, [visible, posthog, terminals.length]);

  // Create new terminal
  const handleCreateTerminal = useCallback(async () => {
    try {
      const result = await window.electronAPI.terminal.create(workspacePath, {
        cwd: workspacePath,
        title: `Terminal ${terminals.length + 1}`,
      });

      if (result.success && result.instance) {
        setTerminals(prev => [...prev, result.instance!]);
        setActiveTerminalId(result.terminalId);

        // Persist active terminal
        await window.electronAPI.terminal.setActive(workspacePath, result.terminalId);
      }
    } catch (error) {
      console.error('[TerminalBottomPanel] Failed to create terminal:', error);
    }
  }, [workspacePath, terminals.length]);

  // Switch to terminal tab
  const handleSelectTerminal = useCallback(async (terminalId: string) => {
    setActiveTerminalId(terminalId);
    await window.electronAPI.terminal.setActive(workspacePath, terminalId);
  }, [workspacePath]);

  // Close terminal tab
  const handleCloseTerminal = useCallback(async (terminalId: string) => {
    try {
      await window.electronAPI.terminal.delete(workspacePath, terminalId);

      setTerminals(prev => {
        const filtered = prev.filter(t => t.id !== terminalId);
        // If closing active terminal, switch to another one
        if (activeTerminalId === terminalId) {
          const newActive = filtered[0]?.id;
          setActiveTerminalId(newActive);
          window.electronAPI.terminal.setActive(workspacePath, newActive);
        }
        return filtered;
      });
    } catch (error) {
      console.error('[TerminalBottomPanel] Failed to close terminal:', error);
    }
  }, [workspacePath, activeTerminalId]);

  // Close panel
  const handleClose = useCallback(() => {
    onVisibilityChange(false);
    window.electronAPI.terminal.setPanelVisible(false);
  }, [onVisibilityChange]);

  // Resize handling
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeStartY.current = e.clientY;
    resizeStartHeight.current = height;
  }, [height]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;

    const deltaY = resizeStartY.current - e.clientY;
    const newHeight = Math.min(
      Math.max(resizeStartHeight.current + deltaY, minHeight),
      maxHeight
    );
    onHeightChange(newHeight);
  }, [isResizing, minHeight, maxHeight, onHeightChange]);

  const handleMouseUp = useCallback(() => {
    if (isResizing) {
      setIsResizing(false);
      // Persist height
      window.electronAPI.terminal.setPanelHeight(height);
    }
  }, [isResizing, height]);

  // Add/remove resize listeners
  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
    }
    return undefined;
  }, [isResizing, handleMouseMove, handleMouseUp]);

  // Handle terminal exit
  const handleTerminalExit = useCallback((terminalId: string, exitCode: number) => {
    // Update terminal metadata or show indicator
    console.log(`[TerminalBottomPanel] Terminal ${terminalId} exited with code ${exitCode}`);
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <div
      className="terminal-bottom-panel-container relative shrink-0 flex flex-col border-t-2 border-[var(--nim-border)]"
      style={{ height: `${height}px` }}
    >
      <div
        className="terminal-bottom-panel-resize-handle absolute top-0 left-0 right-0 h-1 cursor-ns-resize z-10 bg-transparent hover:bg-[var(--nim-primary)]"
        onMouseDown={handleMouseDown}
      />
      <div className="terminal-bottom-panel flex flex-col h-full bg-[var(--nim-bg)] overflow-hidden">
        <div className="terminal-bottom-panel-header flex items-center justify-between h-8 px-1.5 bg-[var(--nim-bg-secondary)] border-b border-[var(--nim-border)] shrink-0">
          <div className="terminal-bottom-panel-tabs flex gap-0.5 items-center overflow-x-auto flex-1 min-w-0 [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:bg-[var(--nim-bg-tertiary)] [&::-webkit-scrollbar-thumb]:rounded-sm">
            {terminals.map((terminal) => (
              <TerminalTab
                key={terminal.id}
                terminal={terminal}
                isActive={activeTerminalId === terminal.id}
                onSelect={() => handleSelectTerminal(terminal.id)}
                onClose={() => handleCloseTerminal(terminal.id)}
              />
            ))}
            <button
              className="terminal-bottom-panel-new-tab flex items-center justify-center w-6 h-6 p-0 bg-transparent border-none text-[var(--nim-text-muted)] cursor-pointer rounded shrink-0 transition-colors duration-150 hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)]"
              onClick={handleCreateTerminal}
              title="New Terminal"
            >
              <MaterialSymbol icon="add" size={16} />
            </button>
          </div>
          <button
            className="terminal-bottom-panel-close flex items-center justify-center w-6 h-6 p-0 bg-transparent border-none text-[var(--nim-text-muted)] cursor-pointer rounded ml-2 shrink-0 transition-colors duration-150 hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)]"
            onClick={handleClose}
            title="Close panel"
          >
            <MaterialSymbol icon="close" size={18} />
          </button>
        </div>
        <div className="terminal-bottom-panel-content flex-1 overflow-hidden flex flex-col min-h-0">
          {terminals.map((terminal) => (
            <div
              key={terminal.id}
              className="terminal-bottom-panel-terminal flex-1 flex flex-col min-h-0"
              style={{ display: activeTerminalId === terminal.id ? 'flex' : 'none' }}
            >
              <TerminalPanel
                terminalId={terminal.id}
                workspacePath={workspacePath}
                isActive={activeTerminalId === terminal.id}
                onExit={(exitCode) => handleTerminalExit(terminal.id, exitCode)}
              />
            </div>
          ))}
          {terminals.length === 0 && (
            <div className="terminal-bottom-panel-empty flex-1 flex flex-col items-center justify-center gap-3 text-[var(--nim-text-muted)] text-sm">
              <p>No terminals open</p>
              <button
                className="flex items-center gap-1.5 px-4 py-2 bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded-md text-[var(--nim-text)] text-[13px] cursor-pointer transition-colors duration-150 hover:bg-[var(--nim-bg-tertiary)] hover:border-[var(--nim-primary)]"
                onClick={handleCreateTerminal}
              >
                <MaterialSymbol icon="terminal" size={16} />
                New Terminal
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TerminalBottomPanel;
