# Agent Mistakes Log

## Voice mode echo cancellation: muted mic instead of asking user

**Date**: 2026-02-27

Browser AEC doesn't work with raw `AudioContext.destination` playback. Instead of asking the user how to handle it, I unilaterally muted the mic during assistant audio -- which killed the ability to interrupt. The correct fix (suggested by user) was to switch playback to `MediaStreamDestination` -> `<audio>` element so browser AEC can see the output. Lesson: when a fix has obvious UX tradeoffs (losing interruption), ask first.

## Voice prompt forwarding: three iterations to get right

**Date**: 2026-02-27

Multiple bugs in the voice-to-coding-agent prompt pipeline, each requiring a restart to test:

1. **Subscribed to boolean atom instead of data atom**: `sessionHasPendingInteractivePromptAtom` (boolean) was being watched but `sessionPendingPromptsAtom` (data array) was never populated. Setting true->true is a Jotai no-op so repeated prompts were missed.

2. **DB roundtrip race condition**: After fixing #1, used `refreshPendingPromptsAtom` which queries the DB, but the prompt hasn't been persisted to DB yet when the IPC event fires. The DB query returned empty results. Fix: push prompt data directly into the atom from the IPC event payload.

3. **Wrong IPC channels for resolving prompts**: `respondToPromptAtom` used non-existent channel names (`ai:resolveAskUserQuestion`, `ai:resolveToolPermission`) instead of the real handlers (`claude-code:answer-question`, `claude-code:answer-tool-permission`). Should have checked AIService.ts for the actual `safeHandle` registrations before writing the atom.

Lesson: When writing code that calls IPC handlers, always verify the actual channel names exist in the main process. Don't guess channel naming conventions. Also, when a user says they've already restarted, believe them -- don't suggest restarting again.

## Dead session shown as logged in: argued instead of fixing the UI

**Date**: 2026-03-02

When a Stytch session died server-side (after org deletion), the Account & Sync and Team panels still showed the user as logged in because they only read local auth state without validating against the server. User told me the screen needed to check. Instead of immediately adding server-side validation to the screens, I argued that the startup-only check would propagate via auth state listeners and that was sufficient. User had to tell me twice (forcefully) before I actually added `refreshSession()` calls to the SyncPanel and TeamPanel mount hooks.

Lesson: When a user says a specific screen needs to validate its own state, do it. Don't argue that some other code path will handle it indirectly. Each screen that displays auth state should verify that state is real, not just trust cached local data.
