---
planStatus:
  planId: plan-terminal-scrollback
  title: Persist terminal scrollback and history
  status: in-development
  planType: feature
  priority: medium
  owner: codex
  stakeholders:
    - agents
  tags:
    - agentic-planning
    - terminal
  created: "2026-01-01"
  updated: "2026-01-01T21:45:39Z"
  progress: 85
  dueDate: ""
  startDate: "2026-01-01"
---
# Persist terminal scrollback and history

## Background
Terminal sessions introduced in commit 1b661eb expect in-memory scrollback and rely on the default shell history file. Once the app restarts we lose both the buffer and the per-session command history, so re-opened terminals start fresh.

## Tasks
1. [x] Inspect TerminalSessionManager, IPC handlers, and AISessionsRepository usage to understand where scrollback and metadata can persist safely without regressing other providers.
2. [x] Implement backend persistence: generate per-session HISTFILEs stored under userData, persist their paths plus scrollback payloads in the ai_sessions metadata JSON, throttle writes from the PTY output handler, and make `terminal:get-scrollback` fall back to the stored buffer when no PTY is alive.
3. [ ] Update renderer/session creation flows if needed to pass along workspace context, and manually verify (or write targeted tests) that closing/reopening the app retains both scrollback and shell up-arrow history for each terminal tab.
