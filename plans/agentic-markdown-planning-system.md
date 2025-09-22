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
  updated: "2025-09-20T12:54:45.581Z"
  progress: 90
  dueDate: "2025-09-24"
  startDate: "2025-09-18"
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
- **__Frontmatter (YAML)__**: core metadata for quick parsing by agents and tooling.
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
  ---
```