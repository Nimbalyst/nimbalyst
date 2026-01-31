---
planStatus:
  planId: plan-git-commit-mode-walkthrough
  title: Git Commit Mode Walkthrough
  status: ready-for-development
  planType: feature
  priority: low
  owner: ghinkle
  stakeholders: []
  tags:
    - walkthroughs
    - git
  created: "2026-01-31"
  updated: "2026-01-31T02:00:00.000Z"
  progress: 0
---

# Git Commit Mode Walkthrough

## Overview

Add a walkthrough that explains the "Manual" and "Smart" commit systems in the git-operations-panel. This should only trigger when the user has uncommitted changes to commit.

## Implementation

### 1. Add data-testid to commit mode toggle

In `GitOperationsPanel.tsx`, add `data-testid="git-commit-mode-toggle"` to the container div that holds the Manual/Smart toggle buttons.

### 2. Add HelpContent entry

```typescript
'git-commit-mode-toggle': {
  title: 'Commit Modes',
  body: 'Choose how to commit your changes. Manual lets you write your own commit message. Smart uses AI to analyze your changes and propose a message.',
},
```

### 3. Create walkthrough definition

Create `git-commit-mode-intro.ts` with:
- Screen: `agent`
- Condition: Only show when git-commit-mode-toggle is visible (which means there are uncommitted changes)
- Priority: 15 (after basic onboarding but not too high)
- Single step pointing at the toggle

### 4. Register walkthrough

Add to `definitions/index.ts`
