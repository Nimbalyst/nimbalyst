/**
 * TerminalPanel - Ghostty-web based terminal component
 *
 * Connects to a PTY process via IPC and renders terminal output using Ghostty-web.
 * Handles input, resize, scrollback restoration, and cleanup.
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { init, Terminal, FitAddon, type ITheme } from 'ghostty-web';

// Type for terminal API is defined in electron.d.ts

export interface TerminalPanelProps {
  /** Terminal ID (ULID) */
  terminalId: string;
  /** Workspace path for store lookups */
  workspacePath: string;
  /** Whether this terminal tab is currently active/visible */
  isActive: boolean;
  /** Optional callback when terminal exits */
  onExit?: (exitCode: number) => void;
}

// Track if ghostty WASM has been initialized
let ghosttyInitialized = false;
let ghosttyInitPromise: Promise<void> | null = null;

async function ensureGhosttyInit(): Promise<void> {
  if (ghosttyInitialized) return;
  if (ghosttyInitPromise) return ghosttyInitPromise;

  ghosttyInitPromise = init().then(() => {
    ghosttyInitialized = true;
  });

  return ghosttyInitPromise;
}

// Get terminal theme colors from CSS variables
function getTerminalTheme(): ITheme {
  const getCSSVar = (name: string, fallback: string): string => {
    if (typeof document === 'undefined') return fallback;
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  };

  return {
    background: getCSSVar('--terminal-bg', '#0d0d0d'),
    foreground: getCSSVar('--terminal-fg', '#ffffff'),
    cursor: getCSSVar('--terminal-cursor', '#60a5fa'),
    cursorAccent: getCSSVar('--terminal-cursor-accent', '#0d0d0d'),
    selectionBackground: getCSSVar('--terminal-selection', 'rgba(255, 255, 255, 0.3)'),
    black: getCSSVar('--terminal-ansi-black', '#000000'),
    red: getCSSVar('--terminal-ansi-red', '#ef4444'),
    green: getCSSVar('--terminal-ansi-green', '#22c55e'),
    yellow: getCSSVar('--terminal-ansi-yellow', '#eab308'),
    blue: getCSSVar('--terminal-ansi-blue', '#3b82f6'),
    magenta: getCSSVar('--terminal-ansi-magenta', '#a855f7'),
    cyan: getCSSVar('--terminal-ansi-cyan', '#06b6d4'),
    white: getCSSVar('--terminal-ansi-white', '#ffffff'),
    brightBlack: getCSSVar('--terminal-ansi-bright-black', '#6b7280'),
    brightRed: getCSSVar('--terminal-ansi-bright-red', '#f87171'),
    brightGreen: getCSSVar('--terminal-ansi-bright-green', '#4ade80'),
    brightYellow: getCSSVar('--terminal-ansi-bright-yellow', '#facc15'),
    brightBlue: getCSSVar('--terminal-ansi-bright-blue', '#60a5fa'),
    brightMagenta: getCSSVar('--terminal-ansi-bright-magenta', '#c084fc'),
    brightCyan: getCSSVar('--terminal-ansi-bright-cyan', '#22d3ee'),
    brightWhite: getCSSVar('--terminal-ansi-bright-white', '#ffffff'),
  };
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({
  terminalId,
  workspacePath,
  isActive,
  onExit,
}) => {
  // Support legacy sessionId prop name
  const sessionId = terminalId;
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [hasExited, setHasExited] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  // Handle terminal restart after exit
  const handleRestart = useCallback(async () => {
    setHasExited(false);
    setExitCode(null);
    setInitError(null);

    try {
      await window.electronAPI.terminal.initialize(terminalId, {
        workspacePath,
        cwd: workspacePath,
      });
    } catch (error) {
      console.error('[TerminalPanel] Failed to restart terminal:', error);
      setInitError(error instanceof Error ? error.message : 'Failed to restart terminal');
    }
  }, [terminalId, workspacePath]);

  // Initialize terminal
  useEffect(() => {
    if (!isActive || !terminalRef.current) return;

    let disposed = false;
    let terminal: Terminal | null = null;
    let fitAddon: FitAddon | null = null;
    let unsubscribeOutput: (() => void) | null = null;
    let unsubscribeExited: (() => void) | null = null;
    let inputDisposable: { dispose: () => void } | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const initTerminal = async () => {
      try {
        // Initialize ghostty WASM first
        await ensureGhosttyInit();

        if (disposed) return;

        // Initialize PTY if not already active (with timeout)
        const initPromise = window.electronAPI.terminal.initialize(terminalId, {
          workspacePath,
          cwd: workspacePath,
        });

        const timeoutPromise = new Promise<{ success: false; error: string }>((resolve) => {
          setTimeout(() => {
            resolve({ success: false, error: 'Terminal initialization timed out after 10 seconds' });
          }, 10000);
        });

        const result = await Promise.race([initPromise, timeoutPromise]);

        if (disposed) return;

        if (!result.success && !('alreadyActive' in result && result.alreadyActive)) {
          const errorMessage = result.error || 'Failed to initialize PTY';
          console.error('[TerminalPanel] Failed to initialize PTY:', errorMessage);
          setInitError(errorMessage);
          return;
        }

        // Create Ghostty Terminal instance
        terminal = new Terminal({
          fontSize: 13,
          fontFamily: '"SF Mono", Monaco, "Courier New", monospace',
          scrollback: 50000,
          cursorBlink: true,
          cursorStyle: 'block',
          theme: getTerminalTheme(),
        });

        fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);

        if (terminalRef.current && !disposed) {
          terminal.open(terminalRef.current);

          // Delay fit to ensure DOM is ready
          setTimeout(() => {
            if (fitAddon && !disposed) {
              try {
                fitAddon.fit();
                const dims = fitAddon.proposeDimensions();
                if (dims && dims.cols > 0 && dims.rows > 0) {
                  window.electronAPI.terminal.resize(sessionId, dims.cols, dims.rows);
                }
              } catch (e) {
                console.warn('[TerminalPanel] Initial fit failed:', e);
              }
            }
          }, 50);

          terminalInstanceRef.current = terminal;
          fitAddonRef.current = fitAddon;

          // Restore scrollback if available
          const scrollback = await window.electronAPI.terminal.getScrollback(sessionId);
          if (scrollback && !disposed) {
            terminal.write(scrollback);
          }

          // Listen for output from PTY
          unsubscribeOutput = window.electronAPI.terminal.onOutput((data) => {
            if (data.sessionId === sessionId && terminal && !disposed) {
              terminal.write(data.data);
            }
          });

          // Listen for PTY exit
          unsubscribeExited = window.electronAPI.terminal.onExited((data) => {
            if (data.sessionId === terminalId && !disposed) {
              setHasExited(true);
              setExitCode(data.exitCode);
              onExit?.(data.exitCode);
            }
          });

          // Send input to PTY
          inputDisposable = terminal.onData((data) => {
            if (!disposed) {
              // If terminal has exited and user presses Enter, restart it
              if (hasExited && data === '\r') {
                handleRestart();
              } else if (!hasExited) {
                window.electronAPI.terminal.write(sessionId, data);
              }
            }
          });

          // Handle resize
          resizeObserver = new ResizeObserver(() => {
            if (fitAddon && !disposed) {
              try {
                fitAddon.fit();
                const dims = fitAddon.proposeDimensions();
                if (dims && dims.cols > 0 && dims.rows > 0) {
                  window.electronAPI.terminal.resize(sessionId, dims.cols, dims.rows);
                }
              } catch (e) {
                // Ignore resize errors during cleanup
              }
            }
          });
          resizeObserver.observe(terminalRef.current);

          setIsInitialized(true);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('[TerminalPanel] Error initializing terminal:', error);
        setInitError(errorMessage);
      }
    };

    initTerminal();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      unsubscribeOutput?.();
      unsubscribeExited?.();
      inputDisposable?.dispose();
      terminal?.dispose();
      fitAddon?.dispose();
      terminalInstanceRef.current = null;
      fitAddonRef.current = null;
    };
  }, [terminalId, workspacePath, isActive, hasExited, handleRestart, onExit]);

  // Focus terminal when becoming active
  useEffect(() => {
    if (isActive && terminalInstanceRef.current) {
      terminalInstanceRef.current.focus();
    }
  }, [isActive]);

  // Re-fit when becoming active (in case size changed while hidden)
  useEffect(() => {
    if (isActive && fitAddonRef.current) {
      setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
          const dims = fitAddonRef.current?.proposeDimensions();
          if (dims && dims.cols > 0 && dims.rows > 0) {
            window.electronAPI.terminal.resize(sessionId, dims.cols, dims.rows);
          }
        } catch (e) {
          // Ignore
        }
      }, 50);
    }
  }, [isActive, sessionId]);

  // Listen for theme changes and update terminal colors
  useEffect(() => {
    if (!window.electronAPI?.on) return;

    const handleThemeChange = () => {
      if (terminalInstanceRef.current) {
        // Re-read CSS variables and apply new theme to terminal
        terminalInstanceRef.current.options.theme = getTerminalTheme();
      }
    };

    window.electronAPI.on('theme-change', handleThemeChange);

    return () => {
      window.electronAPI.off?.('theme-change', handleThemeChange);
    };
  }, []);

  return (
    <div
      className="terminal-panel"
      style={{
        height: '100%',
        width: '100%',
        position: 'relative',
        backgroundColor: 'var(--terminal-bg)',
        display: 'flex',
        flexDirection: 'column',
        padding: '8px',
      }}
    >
      <div
        ref={terminalRef}
        className="terminal-container"
        style={{
          flex: 1,
          overflow: 'hidden',
        }}
        data-testid="terminal-container"
      />

      {!isInitialized && !hasExited && !initError && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-tertiary)',
            fontSize: '14px',
          }}
        >
          Initializing terminal...
        </div>
      )}

      {initError && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--error-color)',
            fontSize: '14px',
            padding: '20px',
            textAlign: 'center',
          }}
        >
          <div style={{ marginBottom: '12px' }}>
            Failed to initialize terminal: {initError}
          </div>
          <button
            onClick={handleRestart}
            style={{
              padding: '6px 12px',
              backgroundColor: 'var(--surface-tertiary)',
              border: 'none',
              borderRadius: '4px',
              color: 'var(--text-primary)',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      )}

      {hasExited && (
        <div
          style={{
            position: 'absolute',
            bottom: '8px',
            left: '8px',
            right: '8px',
            padding: '8px 12px',
            backgroundColor: 'var(--surface-secondary)',
            borderRadius: '4px',
            color: 'var(--text-secondary)',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span>
            Process exited with code {exitCode ?? 0}.
          </span>
          <button
            onClick={handleRestart}
            style={{
              padding: '4px 8px',
              backgroundColor: 'var(--surface-tertiary)',
              border: 'none',
              borderRadius: '4px',
              color: 'var(--text-primary)',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            Restart
          </button>
        </div>
      )}
    </div>
  );
};

export default TerminalPanel;
