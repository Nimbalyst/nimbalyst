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
