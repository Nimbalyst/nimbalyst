---
planStatus:
  planId: plan-terminal-history-bootstrap
  title: Terminal History Bootstrap Cleanup
  status: in-review
  planType: bugfix
  owner: codex
  priority: medium
  stakeholders:
    - agents
  tags:
    - terminal
    - history
  created: "2026-01-02"
  updated: "2026-01-02T21:34:11.582Z"
  progress: 90
  dueDate: ""
  startDate: "2026-01-02"
---
# Terminal History Bootstrap Cleanup

1. Audit the existing history initialization flow (command injection + output buffering) to understand why filtering is brittle and confirm shell-specific requirements.
2. Design a silent bootstrap strategy per shell (bash/zsh/pwsh) that runs history commands via startup hooks (rc files, ZDOTDIR, or launch arguments) instead of echoing them into the PTY.
3. Implement the new bootstrap writers plus spawning tweaks, ensuring we still persist history files and fall back gracefully for unsupported shells.
4. Exercise the terminal flow manually/with unit coverage if feasible to ensure prompts appear instantly and no init chatter leaks through.
