/**
 * TerminalPanel - Ghostty-web based terminal component
 *
 * Connects to a PTY process via IPC and renders terminal output using Ghostty-web.
 * Handles input, resize, scrollback restoration, and cleanup.
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { init, Terminal, FitAddon, type ITheme } from 'ghostty-web';
import { TerminalContextMenu } from './TerminalContextMenu';

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

/**
 * Strip escape sequences that can corrupt terminal state when replayed.
 *
 * When scrollback contains certain escape sequences and is written back to a fresh
 * terminal instance, these sequences can leave the terminal in a corrupted state
 * where old content appears mixed with new output.
 *
 * Problematic sequences include:
 * - Cursor save/restore (ESC 7, ESC 8, CSI s, CSI u)
 * - Scroll region settings (CSI r, CSI Ps;Ps r)
 * - Cursor position (CSI H, CSI Ps;Ps H, CSI f)
 * - Alternate screen buffer (CSI ?1049h/l, CSI ?47h/l, CSI ?1047h/l)
 * - Various DEC private modes that affect display
 */
function stripProblematicEscapeSequences(raw: string): string {
  // Remove cursor save/restore sequences
  // ESC 7 (save) and ESC 8 (restore) - DEC sequences
  let result = raw.replace(/\x1b[78]/g, '');

  // Remove CSI cursor save/restore: CSI s and CSI u
  result = result.replace(/\x1b\[s/g, '');
  result = result.replace(/\x1b\[u/g, '');

  // Remove scroll region settings: CSI r or CSI Ps;Ps r
  // This matches ESC [ followed by optional numbers and semicolons, ending with 'r'
  result = result.replace(/\x1b\[\d*;?\d*r/g, '');

  // Remove absolute cursor positioning: CSI H, CSI f, CSI Ps;Ps H, CSI Ps;Ps f
  // These position the cursor at specific row/col which can cause issues
  result = result.replace(/\x1b\[\d*;?\d*[Hf]/g, '');

  // Remove alternate screen buffer switches
  // CSI ?1049h/l (alternate screen with save/restore cursor)
  // CSI ?47h/l (alternate screen)
  // CSI ?1047h/l (alternate screen, different variant)
  result = result.replace(/\x1b\[\?(1049|47|1047)[hl]/g, '');

  // Remove other problematic DEC private modes
  // CSI ?1h/l (cursor keys mode)
  // CSI ?25h/l (cursor visibility) - keep these as they're harmless
  // CSI ?7h/l (autowrap) - can cause issues
  result = result.replace(/\x1b\[\?7[hl]/g, '');

  return result;
}

/**
 * Clean up scrollback content before restoring to terminal.
 *
 * The raw PTY output often contains excessive whitespace from terminal width
 * padding (e.g., zsh's PROMPT_SP feature fills the rest of the line with spaces
 * then uses carriage return to go back). When restoring scrollback to a terminal
 * with a different width, these sequences cause visual issues.
 *
 * This function removes runs of whitespace that precede carriage returns,
 * as these are used by shells to "clear" the rest of a line by overwriting.
 */
function cleanScrollback(raw: string): string {
  // Pattern explanation:
  // [ \t]+  - One or more spaces or tabs
  // \r      - Followed by carriage return (which moves cursor to line start)
  // (?!\n)  - Negative lookahead: NOT followed by newline (preserve \r\n)
  //
  // This specifically targets the pattern: "text... <spaces> \r <more content>"
  // which is zsh's technique for partial line markers
  return raw.replace(/[ \t]+\r(?!\n)/g, '\r');
}

/**
 * Sanitize scrollback data to remove invalid code points that could crash the terminal.
 *
 * When scrollback data gets corrupted (e.g., WASM memory issues, incomplete writes),
 * it may contain invalid code points outside the valid Unicode range (0x0 - 0x10FFFF).
 * The terminal's render loop will crash with "Invalid code point" errors when trying
 * to render these. This function validates each character and replaces invalid ones.
 *
 * Also detects null bytes and other binary corruption that can cause WASM memory
 * access errors in Ghostty's parser.
 *
 * Returns null if the data is severely corrupted (>1% invalid characters or contains
 * null bytes), indicating the scrollback should be discarded entirely.
 */
function sanitizeScrollback(raw: string): string | null {
  // Quick check for null bytes - indicates binary corruption
  // Null bytes should never appear in terminal output and cause WASM memory errors
  if (raw.includes('\x00')) {
    console.warn('[TerminalPanel] Scrollback contains null bytes, discarding corrupted data');
    return null;
  }

  // Check for excessive unexpected control characters (outside of ESC sequences)
  // Control chars 0x01-0x06, 0x0E-0x1A (excluding common ones like \t, \n, \r, \x1b)
  // High density of these indicates binary corruption
  let suspiciousControlCount = 0;
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    // Count control chars that shouldn't appear frequently in terminal output
    // 0x01-0x06 (SOH, STX, ETX, EOT, ENQ, ACK) and 0x0E-0x1A (SO, SI, DLE, etc.)
    // Exclude: 0x07 (BEL - used in escape sequences), 0x08 (BS), 0x09 (TAB),
    // 0x0A (LF), 0x0B (VT), 0x0C (FF), 0x0D (CR), 0x1B (ESC)
    if ((code >= 0x01 && code <= 0x06) || (code >= 0x0E && code <= 0x1A)) {
      suspiciousControlCount++;
    }
  }

  // If more than 0.5% are suspicious control characters, likely binary corruption
  const suspiciousRatio = suspiciousControlCount / raw.length;
  if (suspiciousRatio > 0.005) {
    console.warn(
      `[TerminalPanel] Scrollback contains excessive control characters (${suspiciousControlCount}/${raw.length}, ${(suspiciousRatio * 100).toFixed(2)}%), discarding`
    );
    return null;
  }

  const MAX_VALID_CODE_POINT = 0x10FFFF;
  let invalidCount = 0;
  let result = '';

  for (let i = 0; i < raw.length; i++) {
    const codePoint = raw.codePointAt(i);

    // Handle undefined (shouldn't happen but be safe)
    if (codePoint === undefined) {
      invalidCount++;
      continue;
    }

    // Check if code point is valid Unicode
    if (codePoint > MAX_VALID_CODE_POINT || codePoint < 0) {
      invalidCount++;
      // Replace invalid code point with Unicode replacement character
      result += '\uFFFD';
      continue;
    }

    // For surrogate pairs (code points > 0xFFFF), we need to handle both chars
    if (codePoint > 0xFFFF) {
      result += String.fromCodePoint(codePoint);
      i++; // Skip the low surrogate
    } else {
      result += raw[i];
    }
  }

  // If more than 1% of characters are invalid, the data is severely corrupted
  const invalidRatio = invalidCount / raw.length;
  if (invalidRatio > 0.01) {
    console.warn(
      `[TerminalPanel] Scrollback severely corrupted: ${invalidCount}/${raw.length} invalid characters (${(invalidRatio * 100).toFixed(1)}%)`
    );
    return null;
  }

  if (invalidCount > 0) {
    console.warn(`[TerminalPanel] Sanitized ${invalidCount} invalid code points from scrollback`);
  }

  return result;
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
  const hasExitedRef = useRef(false); // Ref to track exit state for callbacks
  const hasAutoRestartedRef = useRef(false); // Track if we've already auto-restarted (prevent loops)
  const initStartTimeRef = useRef<number>(0); // Track when initialization started
  const disposedRef = useRef(false); // Ref to track disposed state for async callbacks
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  // Use a ref for onExit to avoid effect re-runs when parent passes new callback references
  const onExitRef = useRef(onExit);
  useEffect(() => {
    onExitRef.current = onExit;
  }, [onExit]);

  // Handle context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleClearTerminal = useCallback(() => {
    // Clear the visual terminal (ANSI escape: clear screen + move cursor home)
    if (terminalInstanceRef.current) {
      terminalInstanceRef.current.write('\x1B[2J\x1B[H');
    }
    // Clear the persisted scrollback
    window.electronAPI.terminal.clearScrollback(sessionId);
  }, [sessionId]);

  // Handle terminal restart after exit
  // Use a ref to store the restart function to avoid effect re-runs
  const handleRestartRef = useRef<() => Promise<void>>();
  handleRestartRef.current = async () => {
    hasExitedRef.current = false; // Reset ref for callbacks
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
  };

  // Stable callback that delegates to the ref
  const handleRestart = useCallback(() => {
    return handleRestartRef.current?.() ?? Promise.resolve();
  }, []);

  // Track if terminal has been initialized (separate from isInitialized state)
  // This ref persists across renders and prevents re-initialization on tab switches
  const hasInitializedRef = useRef(false);

  // Track whether this terminal should initialize. Set to true when the terminal
  // first becomes active, and stays true forever after. This allows us to:
  // 1. Defer initialization until the terminal is visible (so we get valid dimensions)
  // 2. Keep the terminal alive when switching tabs (no dispose/recreate cycle)
  const [shouldInit, setShouldInit] = useState(isActive);

  // When isActive becomes true for the first time, enable initialization
  useEffect(() => {
    if (isActive && !shouldInit) {
      setShouldInit(true);
    }
  }, [isActive, shouldInit]);

  // Initialize terminal - runs once per terminalId when shouldInit becomes true
  // After initialization, the terminal stays alive in the background when switching tabs
  useEffect(() => {
    // Only initialize once shouldInit is true (terminal has been activated at least once)
    if (!shouldInit) return;

    // Only initialize once the DOM ref is available
    if (!terminalRef.current) return;

    // Skip if already initialized for this terminal
    if (hasInitializedRef.current) return;

    disposedRef.current = false;
    let disposed = false;
    let terminal: Terminal | null = null;
    let fitAddon: FitAddon | null = null;
    let unsubscribeOutput: (() => void) | null = null;
    let unsubscribeExited: (() => void) | null = null;
    let inputDisposable: { dispose: () => void } | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let focusInHandler: (() => void) | null = null;
    let focusOutHandler: (() => void) | null = null;

    const initTerminal = async () => {
      try {
        // Track when initialization started for quick-exit detection
        initStartTimeRef.current = Date.now();

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
          cursorBlink: false,
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

          // Enable cursor blinking only when the terminal has focus
          focusInHandler = () => {
            if (terminal && !disposed) {
              terminal.options.cursorBlink = true;
            }
          };
          focusOutHandler = () => {
            if (terminal && !disposed) {
              terminal.options.cursorBlink = false;
            }
          };
          terminalRef.current.addEventListener('focusin', focusInHandler);
          terminalRef.current.addEventListener('focusout', focusOutHandler);

          // CRITICAL: Set up PTY output listener BEFORE scrollback restoration,
          // but queue the output to prevent race conditions.
          // This ensures we don't lose output that arrives during scrollback restoration,
          // while also preventing interleaved writes that cause display corruption.
          let scrollbackRestoreComplete = false;
          const pendingOutput: string[] = [];

          unsubscribeOutput = window.electronAPI.terminal.onOutput((data) => {
            if (data.sessionId === sessionId && terminal && !disposed) {
              if (scrollbackRestoreComplete) {
                // Normal path: write directly to terminal
                terminal.write(data.data);
              } else {
                // Queue output during scrollback restoration to prevent interleaving
                pendingOutput.push(data.data);
              }
            }
          });

          // Restore scrollback if available
          const scrollback = await window.electronAPI.terminal.getScrollback(sessionId);
          if (scrollback && !disposed) {
            // Sanitize the scrollback to remove invalid code points that could crash
            // the terminal's render loop. This must happen BEFORE any write attempts.
            const sanitized = sanitizeScrollback(scrollback);

            if (sanitized === null) {
              // Data is severely corrupted, discard it entirely
              console.warn('[TerminalPanel] Discarding severely corrupted scrollback data');
              window.electronAPI.terminal.clearScrollback?.(sessionId);
            } else {
              // Strip escape sequences that can corrupt terminal state when replayed
              const stripped = stripProblematicEscapeSequences(sanitized);
              // Clean up the scrollback to remove trailing whitespace that was
              // added for a potentially different terminal width
              const cleaned = cleanScrollback(stripped);

              // Write scrollback in chunks to avoid WASM memory issues.
              // Use smaller chunks and yield between them to keep UI responsive.
              // If writing takes too long or fails, clear the corrupted data.
              const CHUNK_SIZE = 8192; // 8KB chunks (smaller for smoother UI)
              const MAX_RESTORE_TIME_MS = 2000; // Abort if restoration takes too long
              const startTime = Date.now();
              let writeError: Error | null = null;

              const writeChunks = async () => {
                for (let i = 0; i < cleaned.length; i += CHUNK_SIZE) {
                  if (disposed || !terminal) return;

                  // Check timeout
                  if (Date.now() - startTime > MAX_RESTORE_TIME_MS) {
                    console.warn('[TerminalPanel] Scrollback restoration timeout, clearing data');
                    window.electronAPI.terminal.clearScrollback?.(sessionId);
                    return;
                  }

                  try {
                    terminal.write(cleaned.slice(i, i + CHUNK_SIZE));
                  } catch (err) {
                    writeError = err instanceof Error ? err : new Error(String(err));
                    break;
                  }

                  // Yield to the event loop every few chunks to keep UI responsive
                  if ((i / CHUNK_SIZE) % 4 === 3) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                  }
                }
              };

              try {
                await writeChunks();
              } catch (err) {
                writeError = err instanceof Error ? err : new Error(String(err));
              }

              if (writeError) {
                console.warn('[TerminalPanel] Failed to restore scrollback, clearing corrupted data:', writeError);
                // Clear the corrupted scrollback file to prevent future crashes
                window.electronAPI.terminal.clearScrollback?.(sessionId);
              } else if (terminal && !disposed) {
                // Send a soft terminal reset to clear any stale state from scrollback
                // This resets scroll regions, cursor attributes, and other state that
                // might have been left in a bad state by the scrollback content.
                // CSI ! p = Soft Terminal Reset (DECSTR)
                terminal.write('\x1b[!p');
                // Also reset scroll margins to full screen
                // CSI r = Set scroll region to entire screen
                terminal.write('\x1b[r');
              }
            }
          }

          // Mark scrollback restoration as complete and flush any queued output
          scrollbackRestoreComplete = true;
          if (pendingOutput.length > 0 && terminal && !disposed) {
            // Write all queued output in one batch to avoid further interleaving
            terminal.write(pendingOutput.join(''));
          }

          // Listen for PTY exit
          unsubscribeExited = window.electronAPI.terminal.onExited((data) => {
            if (data.sessionId === terminalId && !disposed) {
              hasExitedRef.current = true; // Update ref immediately for callbacks

              // Auto-restart if terminal exits very quickly after init (likely a stale/broken session)
              // Only do this once to prevent infinite restart loops
              const timeSinceInit = Date.now() - initStartTimeRef.current;
              const QUICK_EXIT_THRESHOLD_MS = 2000;

              if (timeSinceInit < QUICK_EXIT_THRESHOLD_MS && !hasAutoRestartedRef.current) {
                hasAutoRestartedRef.current = true;
                hasExitedRef.current = false;
                // Restart after a brief delay to let things settle
                // Use ref to check disposed state at time of execution (not closure)
                setTimeout(() => {
                  if (!disposedRef.current) {
                    handleRestart();
                  }
                }, 100);
                return; // Don't show exit UI, we're restarting
              }

              setHasExited(true);
              setExitCode(data.exitCode);
              onExitRef.current?.(data.exitCode);
            }
          });

          // Send input to PTY
          // Use ref instead of state to avoid stale closure issues
          inputDisposable = terminal.onData((data) => {
            if (!disposed) {
              // If terminal has exited and user presses Enter, restart it
              if (hasExitedRef.current && data === '\r') {
                handleRestart();
              } else if (!hasExitedRef.current) {
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
          hasInitializedRef.current = true;
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
      disposedRef.current = true;
      hasInitializedRef.current = false;
      resizeObserver?.disconnect();
      if (focusInHandler && terminalRef.current) {
        terminalRef.current.removeEventListener('focusin', focusInHandler);
      }
      if (focusOutHandler && terminalRef.current) {
        terminalRef.current.removeEventListener('focusout', focusOutHandler);
      }
      unsubscribeOutput?.();
      unsubscribeExited?.();
      inputDisposable?.dispose();
      terminal?.dispose();
      fitAddon?.dispose();
      terminalInstanceRef.current = null;
      fitAddonRef.current = null;
    };
  // Note: shouldInit triggers this effect when the terminal first becomes active.
  // After initialization, shouldInit stays true, so the terminal persists in the background.
  // Note: isActive is NOT in deps - we don't want to dispose/recreate terminal on tab switches.
  // Note: hasExited is NOT in deps - we use hasExitedRef instead to avoid
  // effect re-runs when terminal exits (which would dispose and recreate it)
  // Note: onExit and handleRestart are NOT in deps - we use refs for both to avoid
  // effect re-runs when callbacks change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId, workspacePath, shouldInit]);

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
        onContextMenu={handleContextMenu}
      />

      {contextMenu && (
        <TerminalContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={handleCloseContextMenu}
          onClear={handleClearTerminal}
        />
      )}

      {!isInitialized && !hasExited && !initError && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--nim-text-faint)',
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
              backgroundColor: 'var(--nim-bg-tertiary)',
              border: 'none',
              borderRadius: '4px',
              color: 'var(--nim-text)',
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
            backgroundColor: 'var(--nim-bg-secondary)',
            borderRadius: '4px',
            color: 'var(--nim-text-muted)',
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
              backgroundColor: 'var(--nim-bg-tertiary)',
              border: 'none',
              borderRadius: '4px',
              color: 'var(--nim-text)',
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
