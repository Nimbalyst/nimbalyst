---
planStatus:
  planId: plan-file-mode-layout
  title: File Mode Layout Implementation
  status: draft
  planType: feature
  priority: high
  owner: jordan
  stakeholders:
    - jordan
  tags:
    - ui
    - layout
    - file-mode
    - agent-sessions
  created: "2025-12-22"
  updated: "2025-12-22T00:00:00.000Z"
  progress: 0
---

# File Mode Layout Implementation

## Overview

Implement the new Files Mode layout as shown in the `file-mode.mockup.html` and `file-mode-tree-panel.mockup.html` mockups. This layout introduces a unified interface where the Agent Sessions sidebar is always visible on the left, and a tabbed right panel provides access to both AI Chat and file browsing.

## Goals

1. Create a unified layout where Agent Sessions are accessible from Files mode
2. Add a tabbed right panel with Chat and Files tabs
3. Reuse existing FileTree component for the right panel Files tab
4. Reuse existing AI chat components for the right panel Chat tab
5. Maintain the existing file tabs + editor in the center area

## Layout Description

### ASCII Diagram

```
+-----------------------------------------------------------------------------------+
|  [close] [min] [max]          filename.md - project - Nimbalyst                   |
+-----------------------------------------------------------------------------------+
|                    [   Agent   ] [  Files  ]                                      |
|                    <--- mode toggle header bar --->                               |
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
|   | OAuth flow   | |  |    ## Configuration       |    |                         ||
|   | Fix token    | |  |    Set up your OAuth...  |    |                         ||
|   | refresh      | |  |                           |    |                         ||
|  +---------------+ |  |                           |    |                         ||
|                    |  |                           |    |                         ||
|  +---------------+ |  |                           |    +-------------------------+|
|  | db-migration  | |  |                           |    |  [Ask AI...        ] [>]||
|  | (3 ahead)     | |  |                           |    +-------------------------+|
|  +---------------+ |  +---------------------------+    |                          |
|                    |                                   |                          |
|  --- Sessions ---  |                                   |                          |
|  | Dark mode     | |                                   |                          |
|  | API docs      | |                                   |                          |
|                    |                                   |                          |
+--------------------+-----------------------------------+--------------------------+
     280px                        flex: 1                         320px
     (left sidebar)               (center)                   (right panel)
```

### When Files Tab is Active in Right Panel

```
+-----------------------------------------------------------------------------------+
|                    |                                   |                          |
|  Agent Sessions    |  [oauth.ts] [session.ts]          |   [Chat] [Files]    [>]  |
|                    |                                   +-------------------------+|
|  (same as above)   |  +---------------------------+    |  FILES         [+][S][F] ||
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

### Component Breakdown

**Left Sidebar (280px) - Agent Sessions**
- Header: "Agent Sessions" with New Worktree and New Session buttons
- Search input for filtering sessions
- Worktree groups (expandable with chevron)
  - Worktree name + git status badge (+12 -3, 3 ahead, merged)
  - Nested session items
- Single-session worktrees (AI icon with worktree badge overlay)
- Standalone sessions section with divider

**Center Area (flex: 1) - Editor**
- File tabs at top
- Editor content below (reuse existing TabManager + TabContent)

**Right Panel (320px) - Chat/Files Toggle**
- Panel header with tabs: [Chat] [Files] and collapse button
- **Chat Tab**: Session context bar + AI chat messages + input (reuse AgenticPanel in chat mode)
- **Files Tab**: File panel header with toolbar + FileTree (reuse existing FileTree component)

**Mode Header Bar (48px)**
- Centered toggle: [Agent] [Files]
- Agent button shows AI icon
- Files button shows document icon
- Active state has blue background

## Reuse Existing Components

### FileTree Component
Location: `packages/electron/src/renderer/components/FileTree.tsx`

The existing FileTree component should be reused for the right panel's Files tab. It already supports:
- Hierarchical file display
- Git status indicators (M for modified, A for added)
- File icons
- Expand/collapse folders
- Click to open files

### AI Chat Components
Location: `packages/electron/src/renderer/components/UnifiedAI/AgenticPanel.tsx`

The existing AgenticPanel in "chat" mode should be reused for the right panel's Chat tab. It already supports:
- Session management
- Message history
- AI response streaming
- File mentions

### Session List Rendering
The existing session list rendering from AgenticPanel should be extracted or adapted for the left sidebar. Key elements:
- WorktreeGroup component (already exists)
- WorktreeSingle component (already exists)
- Session item rendering
- Standalone sessions section

### WorkspaceSidebar Features
Location: `packages/electron/src/renderer/components/WorkspaceSidebar.tsx`

Features to reuse for the right panel Files tab:
- FileTreeFilterMenu (filter dropdown)
- NewFileMenu (new file/folder creation)
- Icon toggle functionality

## Implementation Plan

### Phase 1: Layout Structure

1.1. Create new `FileModeLayout.tsx` component
- Three-column layout: sidebar | center | right-panel
- CSS Grid or Flexbox for responsive sizing
- Resize handles between columns (reuse existing resize logic from EditorMode)

1.2. Create `ModeToggleHeader.tsx` component
- Horizontal bar below title bar
- Centered toggle with Agent/Files buttons
- Communicate mode changes to parent via callback

1.3. Create `RightPanel.tsx` component
- Tabbed interface: Chat | Files
- Panel collapse button
- State for active tab
- Render Chat or Files content based on active tab

### Phase 2: Left Sidebar - Sessions

2.1. Extract session list from AgenticPanel
- Create `SessionSidebar.tsx` component
- Reuse existing WorktreeGroup, WorktreeSingle components
- Add sidebar header with New Worktree and New Session buttons
- Add search input for filtering sessions

2.2. Wire up session selection
- Clicking a session should update the active session
- Active session drives what shows in Chat tab on right panel

### Phase 3: Right Panel - Chat Tab

3.1. Integrate AgenticPanel in chat mode
- Pass `mode="chat"` prop
- Add session context bar showing current session name + worktree
- Wire up to session selected in left sidebar

### Phase 4: Right Panel - Files Tab

4.1. Create `FilesPanelContent.tsx` component
- Header with title "FILES" and toolbar buttons (edit, new file, search, filter)
- Integrate existing FileTree component
- Add filter dropdown (reuse FileTreeFilterMenu or adapt)

4.2. Wire up file selection
- Clicking a file should open it in center editor
- Maintain file tree state (expanded folders, scroll position)

### Phase 5: Center Area - Editor

5.1. Integrate existing TabManager and TabContent
- Keep existing file tabs functionality
- Keep existing editor instances
- Wire up file opens from both left sidebar (session files) and right panel (file tree)

### Phase 6: State Management

6.1. Determine state structure
- Active mode (Agent/Files)
- Active session ID
- Right panel active tab (Chat/Files)
- Right panel collapsed state
- Panel widths (for resize)

6.2. Persist layout state
- Save panel widths
- Save collapsed state
- Save active tab preference

## File Structure

```
packages/electron/src/renderer/components/
  FileModeLayout/
    FileModeLayout.tsx      # Main layout container
    FileModeLayout.css
    ModeToggleHeader.tsx    # Agent/Files toggle bar
    ModeToggleHeader.css
    RightPanel.tsx          # Chat/Files tabbed panel
    RightPanel.css
    FilesPanelContent.tsx   # Files tab content (wraps FileTree)
    FilesPanelContent.css
  SessionSidebar/
    SessionSidebar.tsx      # Left sidebar with sessions
    SessionSidebar.css
```

## Acceptance Criteria

1. Files mode shows three-column layout: Sessions | Editor | Right Panel
2. Mode toggle switches between Agent and Files modes
3. Left sidebar shows agent sessions grouped by worktree
4. Right panel has Chat and Files tabs
5. Chat tab shows AI conversation for selected session
6. Files tab shows file tree with git status badges
7. Clicking files in right panel opens them in center editor
8. Panel widths are resizable and persistent
9. Right panel can be collapsed
10. Existing FileTree and AgenticPanel components are reused, not duplicated
