---
planStatus:
  planId: plan-1
  title: Agentic Markdown Planning System
  status: in-development
  planType: feature
  priority: medium
  owner: ghinkle
  stakeholders:
    - agents
    - humans
  tags:
    - agentic-planning
    - markdown
    - lexical
    - preditor
  created: "2025-09-18"
  updated: "2025-10-09T20:53:29.349Z"
  progress: 90
  dueDate: "2025-09-24"
  startDate: "2025-09-18"
  agentSessions:
    - id: d36681ec-898e-481c-a0b6-883ecfcf086e
      createdAt: "2025-10-09T20:53:29.349Z"
      status: active
---
# Agentic Markdown Planning System
<!-- plan-status -->

## Goals
- Treat markdown plans as the single source of truth for agent-led workstreams.
- Enable users and agents to co-author, iterate, and track plan status without leaving the repo.
- Provide structured metadata so agents can parse intent while keeping files human-readable.
- Surface a portfolio view of all plans via a Lexical table component powered by plan metadata.

## System Overview
- Plans live under `plans/` and follow a consistent markdown + metadata format.
- The coding agent (Preditor) can create, update, and interpret these plans to drive development tasks.
- Users can edit plans manually; agents must respect user edits and append deltas instead of overwriting.
- A frontmatter control block captures plan metadata; optional inline control nodes allow richer states.

## Plan Document Structure
- **Frontmatter (YAML)**: core metadata for quick parsing by agents and tooling.
```yaml
  ---
  planStatus:
    planId: plan-agentic-markdown-system
    title: Agentic Markdown Planning System
    status: draft | ready-for-development | in-development | in-review | completed | rejected | blocked
    planType: feature | bug-fix | refactor | system-design | research | documentation
    owner: ghinkle
    stakeholders: [agents, humans]
    tags: [agentic-planning, markdown, lexical]
    created: 2025-09-18
    updated: 2025-09-18T00:00:00.000Z
    priority: low | medium | high | critical
    progress: 0-100
    dueDate: "2025-09-24"
    startDate: "2025-09-18"
    agentSessions:
      - id: session-id-1
        createdAt: "2025-09-18T10:30:00.000Z"
        name: "Initial Implementation"
        status: active | closed
  ---
```

### Agent Session Integration
Plans can now track associated Agent Coding Sessions directly in the frontmatter. The plan status component displays a "Launch Agent" button that:
- Opens an Agentic Coding Window attached to the plan document
- Tracks session IDs in the `agentSessions` array
- Allows jumping back to active sessions or launching additional ones via dropdown
- Automatically updates when sessions are created or closed
