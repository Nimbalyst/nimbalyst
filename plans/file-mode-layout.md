---
planStatus:
  planId: plan-file-mode-layout
  title: Worktree File Mode Implementation
  status: in-development
  planType: feature
  priority: high
  owner: jordan
  stakeholders:
    - jordan
  tags:
    - ui
    - layout
    - worktree
    - agent-view
    - file-mode
  created: "2025-12-22"
  updated: "2025-12-22T01:00:00.000Z"
  progress: 80
  dueDate: ""
  startDate: "2025-12-22"
---

# Worktree File Mode Implementation

## Overview

Implement a "File Mode" sub-view within worktree sessions in the Agent view. This is NOT a separate top-level mode - it lives inside the existing Agent view (accessed via Cmd+K from NavigationGutter). When a user is working in a worktree session, they can toggle between "Agent" mode (full-screen chat) and "Files" mode (editor with file tabs + chat sidebar).

The mockups are:
- `agent-mode.mockup.html` - Agent sub-mode (chat-focused)
- `file-mode.mockup.html` - Files sub-mode (editor-focused with chat in right panel)
- `file-mode-tree-panel.mockup.html` - Files sub-mode with Files tab active in right panel

## Goals

1. Add Agent/Files toggle within worktree sessions
2. Files mode shows: file tabs + editor in center, Chat/Files tabbed panel on right
3. Reuse existing FileTree component for the right panel Files tab
4. Reuse existing AI chat rendering for the right panel Chat tab
5. Session sidebar on left remains consistent across both sub-modes

## Context: Where This Lives

```
App.tsx
  +-- NavigationGutter (left gutter with Files/Agent/Settings icons)
  +-- main content area
       +-- Files Mode (when gutter = Files) <-- NOT THIS
       +-- Agent Mode (when gutter = Agent) <-- THIS IS WHERE WE'RE WORKING
            +-- Session Sidebar (left, 280px)
            +-- Worktree Session Content (center + right)
                 +-- [Agent | Files] toggle header bar <-- NEW
                 +-- Agent sub-mode: Full chat area + Files panel (right)
                 +-- Files sub-mode: Editor tabs + Chat/Files panel (right) <-- NEW
       +-- Settings Mode (when gutter = Settings)
```

## Layout Description

### Agent Sub-Mode (existing, shown in agent-mode.mockup.html)

```
+-----------------------------------------------------------------------------------+
|  [close] [min] [max]          Agent Mode - Nimbalyst                              |
+-----------------------------------------------------------------------------------+
|                    [  Agent  ] [  Files  ]                                        |
|                    <--- toggle bar (Agent active) --->                            |
+-----------------------------------------------------------------------------------+
|                    |                                   |                          |
|  Agent Sessions    |                                   |  Files                   |
|  +--------------+  |  You: Can you help me implement...|  +------------------+   |
|  | New Worktree |  |                                   |  | Edited (3)       |   |
|  | New Session  |  |  Claude: I'll help you implement..|  |  oauth.config.ts |   |
|  +--------------+  |                                   |  |  oauth.routes.ts |   |
|                    |  You: Great, can you also add...  |  |  session.mid.ts  |   |
|  +---------------+ |                                   |  +------------------+   |
|  | auth-refactor | |  Claude: Absolutely! I'll add..   |  | Read (4)         |   |
|  | (+12 -3)      | |                                   |  |  package.json    |   |
|  +---------------+ |                                   |  |  auth.types.ts   |   |
|   | Implement    | |                                   |  |  env.example     |   |
|   | OAuth flow * | |                                   |  |  CLAUDE.md       |   |
|   | Fix token    | |  +---------------------------+    |  +------------------+   |
|   | refresh      | |  | [Ask AI...           ] [>]|    |                         |
|  +---------------+ |  +---------------------------+    |                         |
|                    |                                   |                         |
+--------------------+-----------------------------------+-------------------------+
     280px                      flex: 1                         280px
   (session sidebar)          (chat area)                   (files panel)
```

### Files Sub-Mode (new, shown in file-mode.mockup.html)

```
+-----------------------------------------------------------------------------------+
|  [close] [min] [max]          oauth.ts - auth-refactor - Nimbalyst                |
+-----------------------------------------------------------------------------------+
|                    [  Agent  ] [  Files  ]                                        |
|                    <--- toggle bar (Files active) --->                            |
+-----------------------------------------------------------------------------------+
|                    |                                   |                          |
|  Agent Sessions    |  [oauth.ts] [auth.md] [session.ts]|   [Chat] [Files]    [>]  |
|  +--------------+  |  <--- file tabs --->              |   <-- panel tabs -->     |
|  | New Worktree |  |                                   +-------------------------+|
|  | New Session  |  |                                   |  Session: Implement...  ||
|  +--------------+  |  +---------------------------+    |  auth-refactor          ||
|                    |  |                           |    +-------------------------+|
|  +---------------+ |  |    # Authentication       |    |                         ||
|  | auth-refactor | |  |                           |    |  You: Can you add...    ||
|  | (+12 -3)      | |  |    ## Overview            |    |                         ||
|  +---------------+ |  |    This document...       |    |  Claude: I'll add...    ||
|   | Implement    | |  |                           |    |                         ||
|   | OAuth flow * | |  |    ## Configuration       |    |                         ||
|   | Fix token    | |  |    Set up your OAuth...  |    |                         ||
|   | refresh      | |  |                           |    |                         ||
|  +---------------+ |  |                           |    +-------------------------+|
|                    |  +---------------------------+    |  [Ask AI...        ] [>]||
|  --- Sessions ---  |                                   +-------------------------+|
|  | Dark mode     | |                                   |                          |
+--------------------+-----------------------------------+--------------------------+
     280px                        flex: 1                         320px
   (session sidebar)            (editor area)               (right panel)
```

### Files Sub-Mode with Files Tab Active (file-mode-tree-panel.mockup.html)

```
+-----------------------------------------------------------------------------------+
|                    |                                   |                          |
|  Agent Sessions    |  [oauth.ts] [session.ts]          |   [Chat] [Files]    [>]  |
|                    |                                   +-------------------------+|
|  (same as above)   |  +---------------------------+    |  FILES         [+][S][F] |
|                    |  |  import { OAuth2Client }  |    +-------------------------+|
|                    |  |  from 'google-auth-lib';  |    |  nimbalyst-local        ||
|                    |  |                           |    |   mockups               ||
|                    |  |  export interface OAuth...|    |    worktrees-mockups    ||
|                    |  |    clientId: string;      |    |     agent-mode.html [M] ||
|                    |  |    clientSecret: string;  |    |     file-mode.html  [M] ||
|                    |  |  }                        |    |   plans                 ||
|                    |  |                           |    |  PUBLIC_RELEASE.md  [A] ||
|                    |  +---------------------------+    |                         ||
|                    |                                   +-------------------------+|
+--------------------+-----------------------------------+--------------------------+
```

## Component Breakdown

### Mode Toggle Header (48px)
- Positioned below title bar, above content
- Centered toggle: [Agent] [Files]
- Agent button: clock/timer icon
- Files button: document/lines icon
- Active state: blue background, white text
- Only visible when inside a worktree session

### Left Sidebar (280px) - Session Sidebar
- **Unchanged** from current AgenticPanel implementation
- Header: "Agent Sessions" with New Worktree and New Session buttons
- Search input
- Worktree groups (expandable)
- Single-session worktrees (AI icon with badge)
- Standalone sessions section

### Center Area - Agent Sub-Mode
- Full-width chat conversation
- Message history
- Input area at bottom
- **Reuse existing AgenticPanel chat rendering**

### Center Area - Files Sub-Mode
- File tabs at top (reuse existing TabManager)
- Editor content below (reuse existing TabContent/editor instances)
- Opens files from worktree directory

### Right Panel - Agent Sub-Mode (280px)
- "Files" panel showing Edited/Read files from session
- **Existing behavior in AgenticPanel**

### Right Panel - Files Sub-Mode (320px)
- Tabbed interface: [Chat] [Files]
- Collapse button on right
- **Chat Tab**:
  - Session context bar (session name + worktree)
  - Condensed chat view (smaller messages)
  - Input area at bottom
- **Files Tab**:
  - Header with toolbar: title + [edit][new][search][filter] buttons
  - Filter dropdown (All Files, Markdown Only, Known Files, Uncommitted, Worktree Changes)
  - File tree with git status badges (M/A)
  - **Reuse existing FileTree component**

## Reuse Existing Components

### FileTree Component
Location: `packages/electron/src/renderer/components/FileTree.tsx`

Reuse for right panel Files tab:
- Pass worktree directory as root
- Enable git status badges
- Handle file selection to open in center editor

### FileTreeFilterMenu
Location: `packages/electron/src/renderer/components/FileTreeFilterMenu.tsx`

Reuse for filter dropdown in Files tab.

### TabManager + TabContent
Location: `packages/electron/src/renderer/components/TabManager/` and `TabContent/`

Reuse for center editor area in Files sub-mode:
- File tabs
- Editor instances
- Tab state management

### AgenticPanel Chat Components
Location: `packages/electron/src/renderer/components/UnifiedAI/`

Extract or adapt for right panel Chat tab:
- Message rendering
- Input area
- Session context

### Session Sidebar
The existing session list in AgenticPanel should be extracted into a reusable component if not already.

## Implementation Plan

### Phase 1: Mode Toggle

1.1. Create `WorktreeModeToggle.tsx` component
- Horizontal bar with Agent/Files buttons
- State: 'agent' | 'files'
- Pass mode to parent via callback

1.2. Add mode state to worktree session management
- Track current mode per session
- Persist mode preference

### Phase 2: Files Sub-Mode Layout

2.1. Create `WorktreeFilesMode.tsx` component
- Three-column layout: sidebar | editor | right-panel
- Integrate existing TabManager + TabContent for center
- Set worktree directory as working directory

2.2. Create `WorktreeRightPanel.tsx` component
- Tab bar: Chat | Files
- Panel collapse button
- Render Chat or Files content based on active tab

### Phase 3: Right Panel - Chat Tab

3.1. Create `WorktreeChatTab.tsx` component
- Session context bar
- Condensed chat message display
- Input area
- Wire up to current session

### Phase 4: Right Panel - Files Tab

4.1. Create `WorktreeFilesTab.tsx` component
- Header with title and toolbar
- Filter dropdown (adapt FileTreeFilterMenu)
- FileTree component configured for worktree directory
- Handle file selection to open in editor

### Phase 5: Integration

5.1. Integrate mode toggle into AgenticPanel
- Show toggle when session has worktree
- Render Agent or Files sub-mode based on state

5.2. Wire up cross-component communication
- File opens from Files tab update center editor
- Chat messages work in both modes
- Session changes update all areas

## File Structure

```
packages/electron/src/renderer/components/
  WorktreeMode/
    WorktreeModeToggle.tsx      # Agent/Files toggle bar
    WorktreeModeToggle.css
    WorktreeFilesMode.tsx       # Files sub-mode container
    WorktreeFilesMode.css
    WorktreeRightPanel.tsx      # Right panel with Chat/Files tabs
    WorktreeRightPanel.css
    WorktreeChatTab.tsx         # Chat tab content
    WorktreeChatTab.css
    WorktreeFilesTab.tsx        # Files tab content (wraps FileTree)
    WorktreeFilesTab.css
```

## State Management

- **Mode state**: 'agent' | 'files' - per session, persisted
- **Right panel tab**: 'chat' | 'files' - per session
- **Right panel collapsed**: boolean - per session
- **Panel widths**: number - persisted globally or per session

## Acceptance Criteria

1. Worktree sessions show Agent/Files toggle in header
2. Agent mode shows full-width chat (existing behavior)
3. Files mode shows editor in center with file tabs
4. Files mode right panel has Chat and Files tabs
5. Chat tab shows condensed conversation for current session
6. Files tab shows worktree file tree with git status
7. Clicking files in right panel opens them in center editor
8. Session sidebar remains visible and functional in both modes
9. Mode preference persists per session
10. Existing FileTree and chat components are reused, not duplicated
