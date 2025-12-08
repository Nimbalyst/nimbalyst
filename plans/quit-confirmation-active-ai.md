---
planStatus:
  planId: plan-quit-confirmation-active-ai
  title: Quit Confirmation for Active AI Sessions
  status: in-review
  planType: feature
  priority: medium
  owner: claude
  stakeholders:
    - ghinkle
  tags:
    - ai
    - quit
    - confirmation
    - ux
  created: "2025-12-08"
  updated: "2025-12-08T19:45:00.000Z"
  progress: 100
  startDate: "2025-12-08"
---
# Quit Confirmation for Active AI Sessions

## Implementation Progress

- [x] Add hasActiveStreamingSessions() helper function to SessionStateHandlers.ts
- [x] Modify before-quit handler with confirmation dialog and analytics
- [x] Update POSTHOG_EVENTS.md documentation

## Goal

Add a confirmation dialog when the user attempts to quit the app while any AI session is actively running (streaming a response). This prevents accidentally losing an in-progress AI response.

## Current Architecture

### Session State Tracking

The app already has robust session state tracking via `SessionStateManager`:

- **Location**: `packages/runtime/src/ai/server/SessionStateManager.ts`
- **State properties**:
  - `status`: 'idle' | 'running' | 'waiting_for_input' | 'error' | 'interrupted'
  - `isStreaming`: boolean indicating if data is actively being streamed
- **Key methods**:
  - `getActiveSessionIds()`: Returns all sessions currently being tracked
  - `getSessionState(sessionId)`: Returns full state for a session
  - `isSessionActive(sessionId)`: Checks if session exists in active map

### Quit Handling

The quit flow is in `packages/electron/src/main/index.ts`:

1. `before-quit` event fires (line 738)
2. If `isAppQuitting` is already true, allow quit to proceed
3. Otherwise, `event.preventDefault()` and set `isAppQuitting = true`
4. Run cleanup sequence (analytics, auth, intervals, watchers, AI service, etc.)
5. Eventually call `app.quit()` to complete

The `isQuitting` flag in `WindowManager.ts` (line 72-75) tracks quit state for window close operations.

### Existing Dialog Patterns

The codebase uses `dialog.showMessageBox()` for confirmations (see `PGLiteDatabaseWorker.ts` lines 140-145, 202-207):

```typescript
const response = await dialog.showMessageBox({
  type: 'warning',
  title: 'Title',
  message: 'Question?',
  detail: 'Additional info',
  buttons: ['Action', 'Cancel'],
  defaultId: 1,
  cancelId: 1
});
// response.response === 0 means first button clicked
```

## Implementation Plan

### 1. Add Helper Function to Check Active Sessions

**File**: `packages/electron/src/main/ipc/SessionStateHandlers.ts`

Add a new exported function:

```typescript
export function hasActiveStreamingSessions(): boolean {
  const stateManager = getSessionStateManager();
  const activeIds = stateManager.getActiveSessionIds();

  for (const sessionId of activeIds) {
    const state = stateManager.getSessionState(sessionId);
    if (state && (state.status === 'running' || state.isStreaming)) {
      return true;
    }
  }
  return false;
}
```

### 2. Modify before-quit Handler

**File**: `packages/electron/src/main/index.ts`

At the beginning of the `before-quit` handler (around line 738), before any cleanup:

```typescript
app.on('before-quit', async (event) => {
    console.log('[QUIT] before-quit event triggered');

    // If auto-updater is updating, don't prevent quit
    if (AutoUpdaterService.isUpdatingApp()) {
        console.log('[QUIT] Auto-updater is updating, allowing quit');
        return;
    }

    // If we're already quitting, don't prevent default to avoid infinite loop
    if (isAppQuitting) {
        console.log('[QUIT] Already quitting, allowing default behavior');
        return;
    }

    // NEW: Check for active AI sessions before proceeding
    if (hasActiveStreamingSessions()) {
        event.preventDefault();

        const response = await dialog.showMessageBox({
            type: 'warning',
            title: 'AI Session in Progress',
            message: 'An AI session is currently running.',
            detail: 'If you quit now, the current AI response will be lost. Are you sure you want to quit?',
            buttons: ['Quit Anyway', 'Cancel'],
            defaultId: 1,
            cancelId: 1
        });

        if (response.response === 0) {
            // User clicked "Quit Anyway" - proceed with quit
            console.log('[QUIT] User confirmed quit with active AI session');
            app.quit(); // This will trigger before-quit again, but isAppQuitting will be set
        } else {
            // User cancelled
            console.log('[QUIT] User cancelled quit due to active AI session');
            return;
        }
    }

    // Prevent default to do async cleanup
    event.preventDefault();

    // Mark app as quitting...
    isAppQuitting = true;
    // ... rest of existing cleanup code
});
```

### 3. Add Analytics Event

**File**: `packages/electron/src/main/index.ts`

Track when users see and respond to the confirmation:

```typescript
if (hasActiveStreamingSessions()) {
    event.preventDefault();

    analytics.sendEvent('quit_confirmation_shown', {
        reason: 'active_ai_session'
    });

    const response = await dialog.showMessageBox({...});

    if (response.response === 0) {
        analytics.sendEvent('quit_confirmation_result', {
            result: 'quit_anyway'
        });
        app.quit();
    } else {
        analytics.sendEvent('quit_confirmation_result', {
            result: 'cancelled'
        });
        return;
    }
}
```

### 4. Update Analytics Documentation

**File**: `docs/POSTHOG_EVENTS.md`

Add new events:

| Event Name | File(s) | Trigger | Properties |
| --- | --- | --- | --- |
| `quit_confirmation_shown` | `index.ts` | User attempts quit with active AI | `reason` (active_ai_session) |
| `quit_confirmation_result` | `index.ts` | User responds to quit confirmation | `result` (quit_anyway/cancelled) |

### 5. Import Requirements

In `packages/electron/src/main/index.ts`, add:

```typescript
import { hasActiveStreamingSessions } from './ipc/SessionStateHandlers';
```

## Edge Cases

1. **Multiple active sessions**: The check finds any active session - we don't need to count or list them. The message is intentionally vague ("an AI session") to cover both single and multiple cases.

2. **Auto-updater quit**: Existing code already bypasses custom quit handling when auto-updater is running. The new check comes after this, so auto-updates won't be blocked.

3. **Force quit (Cmd+Q twice, or from Activity Monitor)**: The force quit timer already handles this - if cleanup takes too long (10s packaged, 8s dev), the app force quits anyway.

4. **Window close vs app quit**: This only affects app quit. Individual window closes already have their own unsaved changes handling and don't need this AI session check.

5. **Session completes during dialog**: If the AI session completes while the dialog is showing and the user clicks "Quit Anyway", we proceed with quit normally. No harm done.

## Testing Approach

1. Start an AI chat with a long prompt (or use a slow model)
2. While streaming, press Cmd+Q
3. Verify dialog appears with correct message
4. Click "Cancel" - verify app doesn't quit
5. Try Cmd+Q again while still streaming
6. Click "Quit Anyway" - verify app quits
7. Verify no dialog appears when quitting with no active AI session
8. Verify auto-update quits still work without dialog

## Files Changed

1. `packages/electron/src/main/ipc/SessionStateHandlers.ts` - Add `hasActiveStreamingSessions()`
2. `packages/electron/src/main/index.ts` - Add confirmation check in before-quit
3. `docs/POSTHOG_EVENTS.md` - Document new analytics events
