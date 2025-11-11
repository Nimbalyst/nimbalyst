---
planStatus:
  planId: plan-floating-doc-ai-sessions-button
  title: Floating Document Button for AI Session History
  status: in-review
  planType: feature
  priority: medium
  owner: developer
  stakeholders:
    - developer
    - users
  tags:
    - ui
    - ai-integration
    - document-context
    - session-management
  created: "2025-11-10"
  updated: "2025-11-11T15:10:00.000Z"
  progress: 100
  startDate: "2025-11-11"
---
# Floating Document Button for AI Session History

## Goals

- Provide quick access to AI sessions that have interacted with the current document
- Help users understand which AI conversations have read or edited the document
- Enable easy navigation to relevant AI sessions from within the document view
- Allow users to start new agent mode sessions with the current document @ mentioned in the prompt
- Improve discoverability of document-related AI history

## Problem Description

Currently, users cannot easily discover which AI sessions have interacted with a specific document. When working on a document, users may want to:

- Review past AI conversations that edited this document
- Continue a previous AI conversation about this document
- Start a new agent mode session with this document @ mentioned
- Understand the AI editing history for the current file

This feature addresses this gap by adding a floating button that shows all AI sessions related to the current document.

## System Overview

The feature consists of:

1. A floating button component in the document header area
2. A dropdown menu that lists AI sessions with document interaction
3. Action to start a new agent mode session with the document pre-referenced
4. Integration with the existing AI session storage system
5. Tracking of document reads and writes in AI session metadata

## High-Level Approach

### UI Component

Add a new floating button to the document header toolbar (alongside existing buttons like history). The button will:

- Display an icon indicating AI session history (e.g., chat bubble with document icon)
- Show a badge count of sessions that have interacted with this document
- Open a dropdown menu on click

### Dropdown Menu

The dropdown will display:

- Primary action: "Start Agent Session" button to create a new agent mode session with the document @ mentioned
- Divider
- List of AI sessions that have read or edited the document
- Each item showing: session name/title, last interaction time, interaction type (read/edit)
- Click to switch to agent mode and load that session
- Empty state when no sessions have interacted with the document (still shows "Start Agent Session" action)

### Start Agent Session Action

The primary action in the dropdown:

- Switches the current window to agent mode (not opening a new window)
- Creates a new agent session using `createNewSession` flow from AgenticPanel
- Pre-populates the input field with the document referenced using @ mention syntax (e.g., `@filename.md`)
- Allows users to immediately start working with AI on the current document

Implementation notes:
- Switch to agent mode in the current window (no new window creation)
- Pass the document file path to AgenticPanel via the existing `planDocumentPath` prop
- AgenticPanel already has logic (lines 650-666) that converts `planDocumentPath` to `@relativePath` and sets it as draft input
- This means we can reuse the existing mechanism - just pass the file path!

### Data Integration

Leverage existing systems:

- Query the PGLite database `ai_sessions` table for sessions with document context
- Filter sessions by document file path
- Track both read operations (document sent as context) and write operations (edits applied)
- Use existing FileLink tracking system (FileLinkType: 'edited', 'referenced', 'read')

## Key Components

### Files to Create

- New floating button component (similar to existing floating document action buttons)
- AI session dropdown menu component
- Service method to query sessions by document path

### Files to Modify

- Document header/toolbar component to add the new button
- AI session service to add query method for document-related sessions
- AI session metadata structure (if needed) to ensure document paths are tracked
- Mode switching logic to switch from editor mode to agent mode (pass `planDocumentPath` when switching)
- No changes needed to AgenticPanel - it already supports this via `planDocumentPath` prop!

## Acceptance Criteria

- Button appears in document header when a document is open
- Button shows accurate count of sessions that have interacted with the document
- Dropdown lists all relevant sessions with timestamps
- "Start Agent Session" button switches to agent mode, creates a new session, and pre-populates input with `@filename.md`
- Clicking a session item switches to agent mode and loads that session
- Button is hidden or disabled when no document is open
- Performance: query executes quickly (< 100ms) even with many sessions
- Agent mode stays in the same window (no new window creation)

## Open Questions

- Should the button only count recent sessions (e.g., last 30 days)?
- Should we distinguish visually between sessions that read vs edited?
- Should we show a preview of what the AI did in each session?
- What icon and visual style fits best with existing document buttons?
- Should the cursor be positioned after the @ mention or at the end of the line?

## Related Features and Code References

- Existing AI session manager (Cmd+Alt+S)
- Document history dialog (Cmd+Y)
- Floating document action buttons architecture
- NewSessionButton component (packages/electron/src/renderer/components/AIChat/NewSessionButton.tsx) - Shows how to create sessions with model selection
- AgenticPanel.createNewSession (packages/electron/src/renderer/components/UnifiedAI/AgenticPanel.tsx:447) - Session creation logic
- **AgenticPanel planDocumentPath handling (AgenticPanel.tsx:650-666)** - Already converts file path to @ mention and sets draft input!
- FileLink tracking system (packages/runtime/src/ai/server/types.ts) - Already tracks file interactions with sessions
- Mode switching in App.tsx - How to switch between editor and agent modes

## Implementation Progress

- [x] Create service method to query sessions by document path
- [x] Create floating button component
- [x] Create AI session dropdown menu component
- [x] Add button to document header/toolbar
- [x] Implement "Start Agent Session" action (mode switch + planDocumentPath)
- [x] Implement session item click (mode switch + load session)
- [x] Show accurate session count badge
- [x] Hide/disable button when no document is open
- [x] Test performance of session queries
- [x] Verify agent mode stays in same window
