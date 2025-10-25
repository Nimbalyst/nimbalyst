---
planStatus:
  planId: plan-claude-code-subscription-login
  title: Claude Code Subscription Login Integration
  status: in-development
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
  updated: "2025-10-25T21:10:00.000Z"
  progress: 40
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
```
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

- Credentials stored in: `~/.config/claude-code/credentials.json`
- Format: `{ sessionToken: "...", apiKey: "..." }`
- CLI location: `node_modules/@anthropic-ai/claude-agent-sdk/cli.js`
- Exit code 143 = killed by SIGTERM (our timeout)

## Next Steps

1. Investigate SDK for programmatic API
2. If none exists, implement node-pty solution
3. Test thoroughly in development
4. Test in packaged build
5. Document final approach for users
