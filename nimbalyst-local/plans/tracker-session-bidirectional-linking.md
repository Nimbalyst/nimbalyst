---
planStatus:
  title: Tracker-Session Bidirectional Linking
  status: in-review
  priority: high
  tags:
    - tracker
    - ai-sessions
    - navigation
    - ux
  startDate: 2026-03-25
  updated: 2026-03-25
  progress: 100
---
# Tracker-Session Bidirectional Linking

## Implementation Progress

- [x] Phase 1: Display linked sessions in TrackerItemDetail
- [x] Phase 2: "Launch Session" from tracker item
- [x] Phase 3: Reverse lookup -- session to tracker items (JSONB on ai_sessions)
- [x] Phase 4: Display linked tracker items in session UI
- [x] Phase 5: Auto-linking on all tracker mutations

## Problem

Tracker items (bugs, tasks, plans) and AI sessions are the two main work artifacts in Nimbalyst, but they exist in silos. When a user creates a plan in the tracker and then works on it across multiple sessions, there's no way to:

1. See which sessions worked on a tracker item
2. See which tracker item a session was working on
3. Jump between them
4. Automatically track the relationship

The `tracker_link_session` MCP tool exists and stores `linkedSessions` in the tracker item's JSONB data column, but the agent has to call it manually and there's zero UI for displaying or navigating these links.

## Goals

- **Automatic linking**: Sessions get linked to tracker items without manual effort
- **Bidirectional navigation**: Click from tracker item to session, click from session to tracker item
- **Launch from tracker**: Start a new session directly from a tracker item, pre-seeded with its context
- **Visibility**: Both surfaces show the relationship at a glance

## Current State

### What exists

| Component | Status |
| --- | --- |
| `tracker_link_session` MCP tool | Implemented -- stores session ID in `data.linkedSessions[]` |
| `linkedSessions` field on TrackerItem type | Defined in `DocumentService.ts` line 100 |
| TrackerToolWidget for transcript display | Shows link confirmation in chat |
| `tracker-items-changed` IPC broadcast | Notifies renderer after link |

### What's missing

| Component | Status |
| --- | --- |
| Linked sessions display in TrackerItemDetail | Not built |
| Linked tracker items display in session UI | Not built |
| Reverse lookup (session -> tracker items) | Not stored |
| "Launch session from tracker item" button | Not built |
| Auto-linking when agent uses tracker tools | Not built |
| Navigation handlers (mode switching) | Not built |

## Design

### 1. Linked Sessions in TrackerItemDetail

Add a "Sessions" section in TrackerItemDetail below custom fields, above the metadata footer.

```
+------------------------------------------+
| [Bug] Fix null pointer in auth handler   |
+------------------------------------------+
| Status: In Progress  | Priority: High    |
+------------------------------------------+
| [Rich content editor]                    |
|                                          |
+------------------------------------------+
| Sessions (2)                             |
|  > "Auth handler null check fix"  2h ago |
|  > "Investigating auth crash"    1d ago  |
|  [+ Launch Session]                      |
+------------------------------------------+
| Created: Mar 20  |  Updated: Mar 24     |
+------------------------------------------+
```

Each session row shows:
- Session title (from `sessionRegistryAtom` lookup)
- Relative timestamp
- Provider icon (Claude, etc.)
- Status indicator (processing/complete)
- Click -> switches to Agent mode and activates that session

The **"Launch Session"** button:
- Creates a new Claude Code session
- Auto-links it to the tracker item (both directions)
- Does NOT pre-seed a prompt -- the user types their own instruction
- Switches to Agent mode with the new session active

### 2. Linked Tracker Items in Session UI

Two places to show the link:

**a) SessionListItem** -- Add a small tracker badge/tag next to the session title showing the linked tracker item type + short title. Clicking it navigates to the tracker item.

```
+-------------------------------------------+
| [Claude icon] Auth handler null check fix |
|  2h ago  |  claude-4  |  [Bug: #auth-fix] |
+-------------------------------------------+
```

**b) Session transcript header** -- At the top of the transcript, show a linked tracker item banner that can be clicked to navigate.

```
+-------------------------------------------+
| Working on: Bug - Fix null pointer in...  |
|                              [View in Tracker]
+-------------------------------------------+
| [transcript messages...]                  |
```

### 3. Reverse Lookup Storage

Currently only the tracker item stores linked session IDs. We also need the reverse: given a session, find its linked tracker items.

**Decision: Session metadata JSONB** -- Add `linkedTrackerItemIds: string[]` to the session's metadata in the database. Updated when `tracker_link_session` is called. Simplest approach, matches the existing pattern. The handler already has the session ID; it just needs to also write to the session record.

### 4. Auto-Linking

The agent shouldn't need to manually call `tracker_link_session`. Three strategies:

**a) System prompt injection**: When a session is launched from a tracker item (via the "Launch Session" button), the link is created at session creation time -- no agent action needed.

**b) \****`tracker_link_session`**\*\* in system prompt**: The MCP tool description already tells the agent to link sessions. This works for manually-started sessions where the agent discovers a tracker item via `tracker_list`/`tracker_get`. The current system prompt instruction in the tool description handles this.

**c) Auto-link on any tracker mutation**: When an agent calls `tracker_update` or `tracker_create`, automatically create a bidirectional link if one doesn't exist. This catches every case where the agent interacts with a tracker item.

**Decision**: Implement all three. (a) covers launch-from-tracker, (b) is already working, (c) catches the gaps automatically.

### 5. Navigation

Navigation requires mode switching. The patterns already exist:

- `TrackerItemDetail` has `onSwitchToFilesMode` callback -- we add `onSwitchToAgentMode(sessionId)`
- From session UI, we need `onSwitchToTrackerMode(trackerItemId)` -- similar pattern

Both need to:
1. Switch the app's active mode (Files/Agent/Tracker)
2. Select the target item (activate session / select tracker item in detail panel)

## Implementation Phases

### Phase 1: Display linked sessions in TrackerItemDetail

- [ ] Add "Sessions" section to TrackerItemDetail
- [ ] Look up session titles from `sessionRegistryAtom` (or IPC query for sessions not in registry)
- [ ] Render clickable session rows with title, timestamp, provider icon
- [ ] Wire click handler to switch to Agent mode and activate session

### Phase 2: "Launch Session" from tracker item

- [ ] Add "Launch Session" button in TrackerItemDetail sessions section
- [ ] Create session via `aiCreateSession` with Claude Code provider
- [ ] Auto-link new session to tracker item (both directions)
- [ ] Switch to Agent mode after creation (no pre-seeded prompt -- user types their own)

### Phase 3: Reverse lookup -- session to tracker items

- [ ] Add `linked_tracker_ids` JSONB field or column to `ai_sessions` table
- [ ] Update `tracker_link_session` handler to also write to the session record
- [ ] Expose via IPC so renderer can read linked tracker items for a session
- [ ] Update session load to include linked tracker item IDs

### Phase 4: Display linked tracker items in session UI

- [ ] Add tracker item badge to SessionListItem (type icon + short title)
- [ ] Add "Working on" banner at top of SessionTranscript
- [ ] Wire click handlers to switch to Tracker mode and select item
- [ ] Look up tracker item title/type/status for display

### Phase 5: Auto-linking on all tracker mutations

- [ ] When `tracker_update` is called and the session isn't already linked, auto-link
- [ ] When `tracker_create` is called, auto-link the creating session
- [ ] Same bidirectional write (tracker item + session record)
- [ ] Notify renderer of both changes

## Decisions

1. **Many-to-many cardinality**: A session can link to multiple tracker items and vice versa. Both sides store arrays. UI handles multiple gracefully.
2. **No pre-seeded prompt on launch**: When launching from a tracker item, the link is created but the user types their own prompt. Less opinionated.
3. **Session metadata JSONB for reverse lookup**: Store `linkedTrackerItemIds: string[]` on the session record. No junction table.
4. **Auto-link on all tracker mutations**: `tracker_update` and `tracker_create` both auto-link the calling session. Combined with launch-from-tracker and explicit `tracker_link_session`, this covers all cases.

2. **Launch Session uses default provider**: Respect the user's configured default provider rather than hardcoding Claude Code. If their default can't use tracker MCP tools, that's fine -- the link still exists.
3. **Silently filter deleted sessions**: When rendering linked sessions in TrackerItemDetail, skip any session IDs that no longer exist in the database. No "Session deleted" placeholder -- just don't show them.

## Key Files

| File | Role |
| --- | --- |
| `packages/electron/src/main/mcp/tools/trackerToolHandlers.ts` | `tracker_link_session` handler |
| `packages/electron/src/renderer/components/TrackerMode/TrackerItemDetail.tsx` | Tracker detail panel |
| `packages/electron/src/renderer/components/AgenticCoding/SessionListItem.tsx` | Session list row |
| `packages/electron/src/renderer/components/AgentMode/AgentSessionPanel.tsx` | Full session view |
| `packages/runtime/src/core/DocumentService.ts` | TrackerItem type (line 100: `linkedSessions`) |
| `packages/electron/src/main/database/worker.js` | Database schema |
| `packages/electron/src/main/mcp/httpServer.ts` | MCP tool routing |
