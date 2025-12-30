---
planStatus:
  planId: plan-terminal-session-type
  title: Add Terminal Session Type to Agent View
  status: draft
  planType: feature
  priority: high
  owner: jordan
  stakeholders: []
  tags:
    - terminal
    - agent-view
    - xterm
    - sessions
  created: "2025-12-30"
  updated: "2025-12-30T00:00:00.000Z"
  progress: 0
---
# Add Terminal Session Type to Agent View

## Overview

Add integrated terminal sessions that appear alongside regular AI chat sessions in the agent view. Terminals will be first-class citizens in the session list, with full state persistence, scrollback restoration, and lifecycle management.

**Cross-platform support:** Terminals will work on macOS, Linux, and Windows with platform-specific shell detection (zsh/bash on Unix, PowerShell/cmd on Windows).

**Persistence approach:** Direct PTY processes (no tmux) with scrollback buffer persistence. This provides visual continuity across app restarts while keeping the implementation simple and cross-platform compatible.

## Reference Implementation

This plan is based on a proven implementation from Crystal app. See:
- `/Users/jordanbentley/git/crystal/worktrees/terminal-in-crystal/docs/TERMINAL_IMPLEMENTATION.md`

Key architectural patterns:
- XTerm.js on frontend with FitAddon for responsive sizing
- node-pty on backend spawning actual shell processes
- Electron IPC for bidirectional communication
- State persistence with scrollback buffer storage

## Current Architecture

### Session Management (Existing)
- **Database**: PGLite with tables: `ai_sessions`, `ai_agent_messages`, `session_files`, `queued_prompts`
- **UI Components**:
  - `AgenticPanel.tsx` - Top-level container managing sessions
  - `SessionHistory.tsx` - Session list with search/filter/archive
  - `SessionListItem.tsx` - Individual session display
  - `AISessionView.tsx` - Active session content view
- **Backend**:
  - `PGLiteSessionStore.ts` - Database operations
  - `SessionHandlers.ts` - IPC handlers
  - `AISessionsRepository.ts` - Repository facade

### Session Types
Currently supported in schema:
- `session_type` field exists with default value `"chat"`
- Types mentioned in code: `chat`, `planning`, `coding`
- **New type to add**: `terminal`

## Technical Design

### 1. Database Schema Changes

#### ai_sessions table
Add terminal-specific metadata to existing JSON fields:

```typescript
// metadata field extensions for terminal sessions
interface TerminalSessionMetadata {
  sessionType: 'terminal';
  terminal: {
    shell: string;           // e.g., "/bin/zsh"
    shellName: string;       // e.g., "zsh"
    cwd: string;             // Current working directory
    cols: number;            // Terminal dimensions
    rows: number;
    scrollbackBuffer: string; // For restoration (max 500KB)
    exitCode?: number;       // If terminal exited
    pid?: number;            // PTY process ID
  };
}
```

**No schema migration required** - uses existing JSON metadata field.

#### New table: terminal_sessions
Consider adding dedicated table for better querying:

```sql
CREATE TABLE terminal_sessions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
  shell_path TEXT NOT NULL,
  shell_name TEXT NOT NULL,
  cwd TEXT NOT NULL,
  cols INTEGER NOT NULL DEFAULT 80,
  rows INTEGER NOT NULL DEFAULT 30,
  scrollback_buffer TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  pid INTEGER,
  exit_code INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_terminal_sessions_session_id ON terminal_sessions(session_id);
```

**Decision needed**: Store in metadata JSON vs dedicated table. Recommend dedicated table for:
- Better query performance
- Proper typing in SQL
- Easier buffer size management

### 2. Backend Implementation

#### New Service: TerminalSessionManager

Location: `/packages/electron/src/main/services/TerminalSessionManager.ts`

Responsibilities:
- Create/destroy PTY processes using `@homebridge/node-pty-prebuilt-multiarch`
- Manage terminal lifecycle (spawn, write, resize, kill)
- Store scrollback buffer (limit to 500KB)
- Handle PTY output → IPC events
- Handle exit/crash → update database
- State persistence on close

```typescript
interface TerminalProcess {
  pty: IPty;
  sessionId: string;
  scrollbackBuffer: string;
  cwd: string;
  shell: { path: string; name: string; args: string[] };
}

class TerminalSessionManager {
  private terminals = new Map<string, TerminalProcess>();

  async createTerminal(sessionId: string, options: TerminalOptions): Promise<void>
  async getOrRestoreTerminal(sessionId: string): Promise<TerminalProcess | null>
  writeToTerminal(sessionId: string, data: string): void
  resizeTerminal(sessionId: string, cols: number, rows: number): void
  destroyTerminal(sessionId: string): Promise<void>
  saveState(sessionId: string): Promise<void>
  restoreState(sessionId: string): Promise<string | null>
}
```

#### Shell Detection

Location: `/packages/electron/src/main/services/ShellDetector.ts`

```typescript
class ShellDetector {
  static getDefaultShell(): { path: string; name: string; args: string[] }
  private static detectUnixShell(): ShellInfo
  private static detectWindowsShell(): ShellInfo
  private static findInPath(exe: string): string | null
}
```

Key behaviors:
- **macOS**: Use `dscl . -read /Users/$USER UserShell` (not just `$SHELL` env var)
- **Linux**: Check `$SHELL`, fallback to `/bin/bash`, `/bin/sh`
- **Windows**: Try `pwsh.exe`, `powershell.exe`, then `cmd.exe` in PATH
- **Unix shells**: Spawn with `-i` flag (interactive) for proper prompt
- **Windows PowerShell**: Spawn with `-NoExit` flag to keep session open

#### IPC Handlers

Location: `/packages/electron/src/main/ipc/TerminalHandlers.ts`

New handlers:
```typescript
'terminal:create'           // Create new terminal session + PTY
'terminal:initialize'       // Initialize PTY for existing session
'terminal:write'            // Send input to PTY
'terminal:resize'           // Resize PTY (cols, rows)
'terminal:destroy'          // Kill PTY and cleanup
'terminal:get-scrollback'   // Retrieve saved scrollback for restore
```

New events (main → renderer):
```typescript
'terminal:output'  // { sessionId, data }
'terminal:exited'  // { sessionId, exitCode }
```

#### Integration with SessionHandlers

Extend `sessions:create` to support terminal type:

```typescript
ipcMain.handle('sessions:create', async (event, options) => {
  const session = await sessionStore.create({
    ...options,
    sessionType: options.sessionType || 'chat'
  });

  if (options.sessionType === 'terminal') {
    await terminalSessionManager.createTerminal(session.id, {
      cwd: options.cwd || options.workspacePath,
      shell: options.shell // optional override
    });
  }

  return session;
});
```

### 3. Frontend Implementation

#### New Component: TerminalPanel

Location: `/packages/electron/src/renderer/components/Terminal/TerminalPanel.tsx`

Based on Crystal implementation with Nimbalyst adaptations:

```tsx
interface TerminalPanelProps {
  sessionId: string;
  workspacePath: string;
  isActive: boolean;  // For lazy PTY creation
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({
  sessionId,
  workspacePath,
  isActive
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    if (!isActive) return; // Lazy initialization

    let disposed = false;

    const initTerminal = async () => {
      // 1. Check if PTY exists
      const hasProcess = await window.electronAPI.invoke(
        'terminal:check-active',
        sessionId
      );

      // 2. Initialize or restore
      if (!hasProcess) {
        await window.electronAPI.invoke('terminal:initialize', sessionId, {
          cwd: workspacePath
        });
      }

      if (disposed) return;

      // 3. Create XTerm instance
      const terminal = new Terminal({ /* config */ });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);

      if (terminalRef.current && !disposed) {
        terminal.open(terminalRef.current);
        fitAddon.fit();

        // 4. Restore scrollback
        const scrollback = await window.electronAPI.invoke(
          'terminal:get-scrollback',
          sessionId
        );
        if (scrollback && !disposed) {
          terminal.write(scrollback);
        }

        // 5. Listen for output
        const unsubscribe = window.electronAPI.on(
          'terminal:output',
          (data) => {
            if (data.sessionId === sessionId && !disposed) {
              terminal.write(data.output);
            }
          }
        );

        // 6. Send input to backend
        const inputDisposable = terminal.onData((data) => {
          window.electronAPI.invoke('terminal:write', sessionId, data);
        });

        // 7. Handle resize
        const resizeObserver = new ResizeObserver(() => {
          if (fitAddon && !disposed) {
            fitAddon.fit();
            const dims = fitAddon.proposeDimensions();
            if (dims) {
              window.electronAPI.invoke(
                'terminal:resize',
                sessionId,
                dims.cols,
                dims.rows
              );
            }
          }
        });
        resizeObserver.observe(terminalRef.current);

        return () => {
          disposed = true;
          resizeObserver.disconnect();
          unsubscribe();
          inputDisposable.dispose();
        };
      }
    };

    const cleanup = initTerminal();
    return () => {
      disposed = true;
      cleanup.then(fn => fn?.());
      xtermRef.current?.dispose();
      fitAddonRef.current?.dispose();
    };
  }, [sessionId, isActive]);

  return (
    <div className="h-full w-full">
      <div ref={terminalRef} className="h-full w-full" />
      {!isInitialized && <div>Initializing terminal...</div>}
    </div>
  );
};
```

**Critical patterns from Crystal:**
- **disposed flag**: Prevent operations after unmount during async operations
- **Lazy initialization**: Only create PTY when terminal is viewed (`isActive`)
- **CSS import required**: `import '@xterm/xterm/css/xterm.css'`
- **FitAddon timing**: Call fit() with small delay (50ms) when visibility changes
- **Unsubscribe functions**: Always return cleanup from event listeners

#### Integration with AgenticPanel

Extend `AgenticPanel.tsx` to render TerminalPanel when session type is terminal:

```tsx
// In AgenticPanel.tsx
const renderSessionContent = (session: SessionData) => {
  if (session.sessionType === 'terminal') {
    return (
      <TerminalPanel
        sessionId={session.id}
        workspacePath={session.workspacePath}
        isActive={session.id === activeSessionId}
      />
    );
  }

  return (
    <AISessionView
      session={session}
      // ... other props
    />
  );
};
```

#### SessionListItem Changes

Update `SessionListItem.tsx` to display terminal sessions differently:

```tsx
// Show terminal icon and shell name
if (session.sessionType === 'terminal') {
  return (
    <div className="session-item terminal">
      <Terminal className="icon" />
      <div className="title">{session.title}</div>
      <div className="subtitle">{session.metadata?.terminal?.shellName}</div>
      <div className="timestamp">{formatTime(session.updatedAt)}</div>
    </div>
  );
}
```

Visual indicators:
- Terminal icon instead of AI provider icon
- Shell name (zsh, bash, etc.) as subtitle
- CWD could be shown on hover or in expanded state

#### SessionHistory Changes

No changes needed - terminal sessions will appear in the unified list, filtered/searched alongside chat sessions.

Consider:
- Add filter option for "Terminals only"
- Terminal sessions might not have meaningful search results (since ai_agent_messages is empty)
- Might want to search terminal scrollback buffer separately

### 4. Dependencies

#### New npm packages required

**Frontend** (`packages/electron/package.json`):
```json
{
  "dependencies": {
    "@xterm/xterm": "^5.5.0",
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/addon-search": "^0.15.0",
    "@xterm/addon-web-links": "^0.11.0"
  }
}
```

**Backend** (`packages/electron/package.json`):
```json
{
  "dependencies": {
    "@homebridge/node-pty-prebuilt-multiarch": "^0.12.0"
  }
}
```

**Build configuration**:
- Must rebuild native modules after install: `npx electron-rebuild -f -w @homebridge/node-pty-prebuilt-multiarch`
- Add to `electron-builder.yml` config for packaging

#### Why @homebridge/node-pty-prebuilt-multiarch?

From Crystal docs:
> Use `@homebridge/node-pty-prebuilt-multiarch` instead of original `node-pty`. It provides prebuilt binaries for multiple platforms, avoiding build failures during installation.

### 5. User Experience Flow

#### Creating a Terminal Session

**Option A: From Session History**
1. User clicks "+ New Terminal" button in SessionHistory
2. IPC call to create session with `sessionType: 'terminal'`
3. Backend creates database entry and spawns PTY
4. UI adds session to list and switches to it
5. TerminalPanel initializes XTerm and connects to PTY

**Option B: From Command Palette**
1. User opens command palette
2. Selects "New Terminal Session"
3. Same flow as Option A

**Option C: Default terminal for workspace**
1. User opens workspace
2. If no terminal session exists for workspace, auto-create one
3. Pin it to top of session list

#### Interacting with Terminal

1. Type in terminal → Input sent via IPC → Written to PTY
2. PTY outputs data → IPC event → XTerm displays
3. Resize window → FitAddon calculates new dimensions → Resize PTY
4. Close tab → Terminal stays alive in background
5. Reopen tab → Scrollback restored from database

#### Persistence Behavior

**Active terminal:**
- PTY process runs continuously
- Scrollback buffer updated on every output (trimmed to 500KB)
- When user closes Nimbalyst, scrollback saved to database
- PTY killed on app quit

**Restored terminal:**
- User reopens Nimbalyst
- Session list shows terminal session
- PTY not spawned until user clicks on terminal
- When clicked, scrollback loaded from DB and written to XTerm
- New PTY spawned with original CWD

**Edge case: Terminal exits**
- Process exits (user typed `exit`)
- PTY sends exit event
- UI shows "Process exited with code 0. Press Enter to restart."
- User presses Enter → New PTY spawned in same session

### 6. Theme Integration

Terminal colors must match Nimbalyst theme. XTerm requires hex colors.

```typescript
// In TerminalPanel.tsx
const getTerminalTheme = () => {
  const getCSSVar = (name: string) => {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue(name).trim();
    return rgbToHex(value) || '#ffffff';
  };

  return {
    background: getCSSVar('--terminal-bg'),
    foreground: getCSSVar('--terminal-fg'),
    cursor: getCSSVar('--terminal-cursor'),
    black: getCSSVar('--terminal-ansi-black'),
    red: getCSSVar('--terminal-ansi-red'),
    green: getCSSVar('--terminal-ansi-green'),
    yellow: getCSSVar('--terminal-ansi-yellow'),
    blue: getCSSVar('--terminal-ansi-blue'),
    magenta: getCSSVar('--terminal-ansi-magenta'),
    cyan: getCSSVar('--terminal-ansi-cyan'),
    white: getCSSVar('--terminal-ansi-white'),
    brightBlack: getCSSVar('--terminal-ansi-bright-black'),
    // ... other colors
  };
};
```

Theme updates:
- Listen for theme change events
- Call `terminal.options.theme = getTerminalTheme()`
- Call `terminal.refresh(0, terminal.rows - 1)` to redraw

Nimbalyst may need to add terminal-specific CSS variables if not present.

### 7. Performance Considerations

1. **Lazy PTY Creation**: Don't spawn PTY until terminal viewed
2. **Debounce Resize**: Resize events fire rapidly - debounce to 100ms
3. **Scrollback Limits**:
  - XTerm: 50,000 lines
  - Backend buffer: 500KB (trim from start)
4. **React.memo**: Wrap TerminalPanel to prevent unnecessary re-renders
5. **Multiple Terminals**: Each terminal is independent PTY process
6. **Memory**: ~10-20MB per terminal (XTerm instance + scrollback)

### 8. Known Gotchas (from Crystal Implementation)

| # | Issue | Solution |
| --- | --- | --- |
| 1 | node-pty build failures | Use `@homebridge/node-pty-prebuilt-multiarch` |
| 2 | Native module crashes | Run `electron-rebuild` after install |
| 3 | Operations on unmounted component | Track `disposed` flag, check after await |
| 4 | Terminal renders blank | Import `@xterm/xterm/css/xterm.css` |
| 5 | Terminal doesn't fit container | Delay `fit()` call by ~50ms after visibility |
| 6 | No shell prompt | Spawn with `-i` (interactive) flag |
| 7 | No colors in CLI tools | Set `TERM: 'xterm-256color'` |
| 8 | Wrong terminal capabilities | Use `name: 'xterm-256color'` in spawn |
| 9 | Memory leaks | Return unsubscribe from event listeners |
| 10 | Wrong shell on macOS | Use `dscl` for shell detection |
| 11 | Theme changes don't apply | Call `terminal.refresh()` after theme update |
| 12 | Slow save/restore | Limit scrollback buffer size |
| 13 | CWD tracking fails on macOS | Accept limitations or use `lsof` |

## Implementation Plan

### Phase 1: Backend Foundation
1. Install `@homebridge/node-pty-prebuilt-multiarch` dependency
2. Configure electron-rebuild for native module
3. Implement `ShellDetector.ts` service
4. Implement `TerminalSessionManager.ts` service
5. Add IPC handlers in `TerminalHandlers.ts`
6. Add database table for terminal_sessions (or decide on metadata approach)
7. Write unit tests for shell detection and manager

### Phase 2: Frontend Components
1. Install XTerm dependencies
2. Create `TerminalPanel.tsx` component
3. Add CSS imports and theme integration
4. Implement lazy initialization with disposed flag pattern
5. Handle resize with FitAddon
6. Write unit tests for component lifecycle

### Phase 3: UI Integration
1. Update `AgenticPanel.tsx` to render TerminalPanel
2. Update `SessionListItem.tsx` for terminal display
3. Add "New Terminal" button to SessionHistory
4. Add terminal icon asset
5. Test session switching between chat and terminal

### Phase 4: Persistence
1. Implement scrollback buffer storage in backend
2. Implement restore on terminal reopen
3. Handle terminal exit/restart flow
4. Test persistence across app restarts
5. Test with multiple terminal sessions

### Phase 5: Polish
1. Add keyboard shortcuts (Cmd+T for new terminal)
2. Add context menu actions (New Terminal, Restart Terminal)
3. Add terminal search functionality (Cmd+F in terminal)
4. Optimize performance (debounce, lazy loading)
5. Add analytics events
6. Write E2E tests

### Phase 6: Documentation
1. Update user documentation
2. Add terminal keyboard shortcuts to help
3. Document terminal settings (shell override, theme)
4. Add to release notes

## Testing Strategy

### Unit Tests
- ShellDetector: Shell detection on macOS, Linux, Windows
- TerminalSessionManager: PTY lifecycle, buffer trimming, state save/restore
- TerminalPanel: Component mounting/unmounting, resize handling, cleanup

### Integration Tests
- Session creation with terminal type
- IPC communication (input → PTY → output)
- Database persistence (scrollback save/restore)
- Theme synchronization

### E2E Tests (Playwright)
- Create terminal session from UI
- Type commands and verify output
- Switch between terminal and chat sessions
- Close and reopen terminal, verify scrollback restored
- Multiple terminals in workspace
- Terminal exit and restart

### Manual Testing Checklist

**macOS:**
- [ ] Create terminal session
- [ ] Verify zsh/bash prompt appears
- [ ] Type commands (ls, cd, echo, git status)
- [ ] Test colors and formatting (ANSI colors)
- [ ] Resize window, verify terminal adapts
- [ ] Close tab, reopen, verify scrollback restored
- [ ] Restart Nimbalyst, verify scrollback persists
- [ ] Multiple terminals simultaneously
- [ ] Type `exit`, verify restart flow
- [ ] Search in terminal (Cmd+F)
- [ ] Theme switching updates terminal colors

**Linux:**
- [ ] Create terminal session
- [ ] Verify bash/zsh prompt appears
- [ ] Type commands (ls, cd, echo, apt/dnf)
- [ ] Test colors and formatting
- [ ] Resize window, verify terminal adapts
- [ ] Close tab, reopen, verify scrollback restored
- [ ] Restart Nimbalyst, verify scrollback persists
- [ ] Multiple terminals simultaneously

**Windows:**
- [ ] Create terminal session
- [ ] Verify PowerShell/cmd prompt appears
- [ ] Type commands (dir, cd, echo)
- [ ] Test colors (PowerShell colors, cmd limited colors)
- [ ] Resize window, verify terminal adapts
- [ ] Close tab, reopen, verify scrollback restored
- [ ] Restart Nimbalyst, verify scrollback persists
- [ ] Multiple terminals simultaneously
- [ ] Type `exit`, verify restart flow

## Design Decisions

### 1. Database Storage Strategy ✓ DECIDED
**Decision**: Use dedicated `terminal_sessions` table.

**Rationale**: Better query performance, proper SQL typing, easier buffer size management.

### 2. Multiple Terminals per Workspace ✓ DECIDED
**Decision**: Users can create unlimited terminal sessions.

**Implementation**: Add "New Terminal" button to session list.

### 3. Default Terminal Behavior
**Question**: Should Nimbalyst auto-create a terminal session on workspace open?

**Options:**
- Auto-create: Convenient, but wastes resources if unused
- Manual creation: User control, cleaner startup

**Status**: Needs decision - clarification requested.

### 4. Terminal in Chat Mode vs Agent Mode ✓ DECIDED
**Decision**: Terminals only in agent mode (full window).

**Rationale**: Chat mode sidebar has limited horizontal space; terminals need 80+ columns to be usable.

### 5. Integration with AI ✓ DECIDED
**Decision**: No AI integration in initial implementation.

**Future**: May add later if valuable (AI reading output, sending commands, using transcript as context).

### 6. Terminal Session Titles ✓ DECIDED
**Decision**: Auto-name as "Terminal", "Terminal 2", "Terminal 3", etc.

**Implementation**: Simple counter-based naming. Users can rename manually later if desired.

### 7. Persistence Approach ✓ DECIDED
**Decision**: Direct PTY processes (no tmux integration).

**Rationale**:
- Simpler implementation
- Cross-platform (works on Windows)
- No external dependencies
- Proven pattern from Crystal

**Trade-off accepted**: Shell state doesn't persist across restarts (environment variables, running processes). Only scrollback buffer and CWD persist.

**Future enhancement**: Could add opt-in tmux mode for power users on macOS/Linux.

## Success Criteria

1. **Core Functionality**
  - [ ] Users can create terminal sessions from UI
  - [ ] Terminal sessions appear in unified session list
  - [ ] Input/output works bidirectionally
  - [ ] Terminal resizes responsively
  - [ ] Scrollback persists across sessions

2. **Persistence**
  - [ ] Terminal scrollback saved to database
  - [ ] Scrollback restored when reopening terminal
  - [ ] Works across app restarts
  - [ ] CWD preserved on restore

3. **UX Polish**
  - [ ] Terminal matches Nimbalyst theme
  - [ ] Smooth transitions between sessions
  - [ ] Handles terminal exit gracefully
  - [ ] Loading states and error handling

4. **Performance**
  - [ ] Terminal responsive with 50k lines scrollback
  - [ ] No memory leaks with long-running terminals
  - [ ] Multiple terminals don't slow down app

5. **Cross-Platform**
  - [ ] Works on macOS (zsh/bash detection)
  - [ ] Works on Linux (bash/zsh/fish)
  - [ ] Works on Windows (PowerShell/cmd)

## Future Enhancements

Beyond initial implementation:

1. **Terminal Settings**
  - Shell override per workspace
  - Font size, font family customization
  - Color scheme customization independent of theme
  - Scrollback buffer size configuration

2. **Advanced Features**
  - Split terminals (side-by-side)
  - Terminal tabs within a single session
  - Terminal profiles (dev, prod, ssh)
  - AI integration (read output, suggest commands)

3. **Developer Experience**
  - Workspace-specific shell initialization scripts
  - Auto-run commands on terminal creation
  - Terminal history search
  - Export scrollback to file

4. **Collaboration**
  - Share terminal sessions with team
  - View-only terminal sharing
  - Terminal playback (tmux-like)

## References

- Crystal Terminal Implementation: `/Users/jordanbentley/git/crystal/worktrees/terminal-in-crystal/docs/TERMINAL_IMPLEMENTATION.md`
- XTerm.js Documentation: https://xtermjs.org/
- node-pty Documentation: https://github.com/microsoft/node-pty
- Electron IPC Best Practices: https://www.electronjs.org/docs/latest/tutorial/ipc

## File Structure

```
packages/electron/
├── src/
│   ├── main/
│   │   ├── services/
│   │   │   ├── TerminalSessionManager.ts     (NEW)
│   │   │   └── ShellDetector.ts              (NEW)
│   │   ├── ipc/
│   │   │   └── TerminalHandlers.ts           (NEW)
│   │   └── database/
│   │       └── initialize.ts                 (UPDATE - add table)
│   └── renderer/
│       └── components/
│           └── Terminal/
│               ├── TerminalPanel.tsx         (NEW)
│               └── TerminalTheme.ts          (NEW)
└── package.json                              (UPDATE - add deps)
```
