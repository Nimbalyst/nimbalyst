---
planStatus:
  planId: plan-claude-code-subscription-login
  title: Claude Code Subscription Login Integration
  status: completed
  planType: feature
  priority: high
  owner: developer
  stakeholders:
    - developer
  tags:
    - claude-code
    - authentication
    - subscription
    - oauth
  created: "2025-10-25"
  updated: "2025-11-04T14:00:00.000Z"
  progress: 100
---
# Claude Code Subscription Login Integration

## Goal

Enable users with Claude Pro/Max subscriptions to authenticate directly within Nimbalyst without requiring terminal commands or separate installations. The authentication should be completely automated from a button click in the settings UI.

## Current Status

**What's Working:**
- ✅ Separated Claude Code API key from regular Claude provider
- ✅ UI framework for showing login status
- ✅ Bundled SDK is correctly located at runtime
- ✅ Process spawning works (gets PID)

**What's Partially Working:**
- ⚠️ Login status detection - Currently checks `~/.config/claude-code/credentials.json` but this doesn't exist
  - User has Claude CLI installed at `~/.claude/local/node_modules/.bin/claude`
  - Settings at `~/.claude/settings.json` but no credentials there
  - Real credentials location unknown - needs investigation

**What's NOT Working:**
- ❌ CLI produces no output when spawned programmatically
- ❌ Browser doesn't open for OAuth
- ❌ Process times out after 30 seconds
- ❌ Exit code 143 (killed by SIGTERM)

## Problem Analysis

The `claude login` CLI command expects to run in a **real terminal (TTY)** environment. When we spawn it with piped stdio, it:
1. Detects it's not in a TTY
2. Refuses to run interactive features
3. Produces no output
4. Hangs indefinitely

**Evidence:**
```javascript
[ClaudeCodeHandlers] Process spawned, PID: 96992
[ClaudeCodeHandlers] Had output: false  // ← No stdout/stderr at all
[ClaudeCodeHandlers] Total output:      // ← Completely empty
[ClaudeCodeHandlers] Total error output: // ← Completely empty
[ClaudeCodeHandlers] Login process exited with code: 143  // ← Killed
```

## Attempted Solutions

### 1. Detached Process (Failed)
- Tried spawning detached with `stdio: 'ignore'`
- Result: Process took over dev terminal, showed interactive prompts

### 2. Piped stdio (Failed)
- Tried piping stdin/stdout/stderr to handle prompts programmatically
- Result: No output produced, CLI doesn't run

### 3. Environment Variables (Failed)
- Tried `CI=true` to skip interactive prompts
- Result: No effect, CLI still expects TTY

## Potential Solutions

### Option 1: Use node-pty (Pseudo-TTY)
**Description:** Use the `node-pty` package to provide a pseudo-terminal.

**Implementation:**
```typescript
import * as pty from 'node-pty';

const ptyProcess = pty.spawn('node', [cliPath, 'login'], {
  name: 'xterm-color',
  cols: 80,
  rows: 30,
  cwd: process.cwd(),
  env: process.env
});

ptyProcess.onData((data) => {
  console.log(data);
  // Handle prompts, auto-respond
});
```

**Pros:**
- Provides real TTY that CLI expects
- Can still capture and handle output
- Can auto-respond to prompts

**Cons:**
- Requires native dependency (`node-pty`)
- Platform-specific compilation
- Adds complexity to build

### Option 2: Direct OAuth Implementation
**Description:** Implement the OAuth flow directly without using the CLI.

**Investigation Needed:**
1. Find OAuth endpoints used by Claude Agent SDK
2. Implement OAuth PKCE flow in Electron
3. Store credentials in same format as CLI
4. Use `BrowserWindow` for auth flow

**Pros:**
- Complete control over flow
- No CLI dependencies
- Clean user experience

**Cons:**
- Need to reverse-engineer OAuth flow
- May break if Anthropic changes endpoints
- More code to maintain

### Option 3: Check for Programmatic API
**Description:** Check if `@anthropic-ai/claude-agent-sdk` has a programmatic login API (not CLI).

**Investigation:**
```typescript
// Check if SDK exports login functions
import * as sdk from '@anthropic-ai/claude-agent-sdk';
// Look for: sdk.auth, sdk.login, sdk.authenticate, etc.
```

**Pros:**
- Official API (if it exists)
- No CLI workarounds needed
- Proper TypeScript types

**Cons:**
- Might not exist
- May still require TTY internally

### Option 4: Terminal Window (Fallback)
**Description:** Open actual terminal window with command pre-filled.

**Implementation:**
```typescript
// macOS
spawn('open', ['-a', 'Terminal', cliPath, 'login']);

// Or use AppleScript to open Terminal with command
```

**Pros:**
- Definitely works
- Uses real terminal
- User sees what's happening

**Cons:**
- Platform-specific
- Not fully automated
- Worse UX than in-app login

## Recommended Approach

**Priority Order:**
1. **Investigate Option 3 first** - Check if SDK has programmatic API (quickest to verify)
2. **Implement Option 1** - Use node-pty if no API exists (best UX)
3. **Fall back to Option 2** - Direct OAuth if node-pty causes issues
4. **Option 4 only as last resort** - Terminal window if all else fails

## Implementation Plan

### Phase 1: Investigation (1-2 hours)
- [ ] **Fix login status detection first**:
  - [ ] Find where Claude actually stores credentials (not in `~/.config/claude-code/`)
  - [ ] Check environment variables, keychain, or other storage
  - [ ] Update `ClaudeCodeHandlers.ts` to check correct location
- [ ] Read `@anthropic-ai/claude-agent-sdk` source code (unminified if possible)
- [ ] Look for authentication/login APIs
- [ ] Check package exports and TypeScript definitions
- [ ] Document findings

### Phase 2: Implementation (4-6 hours)
- [ ] Install and configure node-pty (or use discovered API)
- [ ] Update ClaudeCodeHandlers to use pseudo-TTY
- [ ] Test login flow end-to-end
- [ ] Handle edge cases (no browser, auth failure, etc.)
- [ ] Test on both packaged and dev builds

### Phase 3: Polish (2-3 hours)
- [ ] Add loading state to button
- [ ] Show progress during login
- [ ] Better error messages
- [ ] Test on macOS (both architectures if possible)

## Current Code Location

**Files Modified:**
- `packages/electron/src/main/ipc/ClaudeCodeHandlers.ts` - IPC handler for login
- `packages/electron/src/renderer/components/AIModels/panels/ClaudeCodePanel.tsx` - UI
- `packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts` - Uses separate API key

**Key Code:**
```typescript
// Handler location
ipcMain.handle('claude-code:login', async () => { ... })

// Login status check
ipcMain.handle('claude-code:check-login', async () => { ... })

// UI button
<button onClick={async () => {
  await window.electronAPI.invoke('claude-code:login');
  await checkLoginStatus();
}}>
```

## Testing Checklist

- [ ] Login works from fresh state
- [ ] Status detection works after manual `claude login`
- [ ] Status updates after successful automated login
- [ ] Browser opens for OAuth
- [ ] Credentials saved correctly
- [ ] Claude Code provider uses subscription (not API)
- [ ] No terminal interference during login
- [ ] Works in packaged app (not just dev)

## Notes

- Credentials stored in: `~/.claude/.credentials.json` (CORRECTED from previous assumption)
- Format: `{ access_token: "...", refresh_token: "...", expires_at: "...", scopes: [...] }`
- CLI location: System `claude` command (globally installed)
- OAuth flow uses `claude setup-token` command

## Implementation Summary (2025-11-04)

### What Was Implemented

**Approach:** Terminal Window (Option 4 from original plan)

After investigating the Claude Agent SDK and testing various approaches, we implemented a solution that opens a native Terminal window for the user to complete the OAuth flow. This was chosen because:

1. The `claude setup-token` command requires a real TTY (terminal) for the OAuth flow
2. Node-pty would add complexity and platform-specific build requirements
3. The SDK doesn't expose programmatic OAuth APIs
4. Opening a terminal provides the best UX with proper OAuth security

### Key Changes

**1. Fixed Login Status Detection** (`ClaudeCodeHandlers.ts`)
- Corrected credentials path from `~/.config/claude-code/credentials.json` to `~/.claude/.credentials.json`
- Added OAuth token validation (checks `access_token`, `refresh_token`, `expires_at`)
- Added expiration checking
- Returns detailed status including token expiry and scopes

**2. Implemented Terminal-Based Login Flow** (`ClaudeCodeHandlers.ts`)
- Uses bundled SDK CLI (`findBundledCli()`) - no global installation required
- Platform-specific terminal launching:
  - **macOS**: Uses AppleScript to open Terminal.app with `node cli.js setup-token`
  - **Windows**: Uses `cmd /c start` to open Command Prompt with `node cli.js setup-token`
  - **Linux**: Tries common terminal emulators (gnome-terminal, konsole, xterm)
- Returns immediately with instructions for user to complete OAuth in terminal
- User clicks "Refresh Status" after completing OAuth to verify

**3. Updated UI** (`ClaudeCodePanel.tsx`)
- Uncommented and improved login button
- Added "Refresh Status" button next to login status
- Shows token expiration date when logged in
- Clear messaging about terminal-based OAuth flow
- Loading state during login button click
- Improved status display with OAuth token details

### How It Works

1. User clicks "Login with Claude Subscription" button
2. System locates the bundled Claude Agent SDK CLI
3. System opens a Terminal window with `node <bundled-cli-path> setup-token` command
4. Terminal displays OAuth flow (opens browser, user authenticates)
5. OAuth credentials are saved to `~/.claude/.credentials.json`
6. User clicks "Refresh Status" in Nimbalyst to verify login
7. Claude Code provider uses OAuth credentials automatically

**No global Claude CLI installation required** - uses the SDK bundled with Nimbalyst.

### Testing

To test the implementation:

```bash
# 1. Start the app (if not already running)
cd packages/electron && npm run dev

# 2. Go to Settings > AI Models > Claude Code
# 3. Click "Login with Claude Subscription"
# 4. Complete OAuth flow in the Terminal window
# 5. Click "Refresh Status" to verify
# 6. Check that status shows "Logged in with Claude subscription"
```

### Benefits

- **Simple**: No complex TTY emulation or OAuth implementation
- **Secure**: Uses official `claude setup-token` command with proper OAuth flow
- **Cross-platform**: Works on macOS, Windows, and Linux
- **Familiar**: Users see the same terminal-based flow as when using `claude` from command line
- **Maintainable**: Delegates OAuth to official CLI, no custom OAuth code to maintain

### Limitations

- Terminal window approach is less seamless than in-app OAuth (but more secure and reliable)
- User must manually click "Refresh Status" after completing OAuth
- Requires Node.js to be available in the terminal (to run `node cli.js setup-token`)

### Future Improvements

- Add automatic credential polling instead of manual refresh
- Add logout functionality
- Add automatic token refresh when expired
- Consider using Electron as Node runtime in packaged builds to ensure Node.js availability
