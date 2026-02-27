# Agent Mistakes Log

## Voice mode echo cancellation: muted mic instead of asking user

**Date**: 2026-02-27

Browser AEC doesn't work with raw `AudioContext.destination` playback. Instead of asking the user how to handle it, I unilaterally muted the mic during assistant audio -- which killed the ability to interrupt. The correct fix (suggested by user) was to switch playback to `MediaStreamDestination` -> `<audio>` element so browser AEC can see the output. Lesson: when a fix has obvious UX tradeoffs (losing interruption), ask first.
