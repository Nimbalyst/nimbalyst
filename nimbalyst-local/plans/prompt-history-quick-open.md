---
planStatus:
  planId: plan-prompt-history-quick-open
  title: Prompt History Quick Open Dialog
  status: in-review
  planType: feature
  priority: medium
  owner: ghinkle
  stakeholders: []
  tags:
    - ui
    - search
    - navigation
    - productivity
  created: "2026-01-21"
  updated: "2026-01-21T10:00:00.000Z"
  progress: 100
  startDate: "2026-01-21"
---
# Prompt History Quick Open Dialog

## Implementation Progress

- [x] Add `messages:list-user-prompts` IPC handler
- [x] Implement database query with JOIN to get session metadata
- [x] Create `PromptQuickOpen.tsx` component based on SessionQuickOpen
- [x] Update component interface for prompt data structure
- [x] Adjust UI layout for prompt text display
- [x] Add session title as secondary info
- [x] Implement in-memory search filtering
- [x] Register Cmd+Shift+L keyboard shortcut
- [x] Integrate component into App.tsx
- [x] Wire up session selection callback
- [x] Create `PromptQuickOpen.css` with styling
- [x] Test with various prompt counts and edge cases

## Overview

Add a searchable quick-open dialog that displays recent user prompts across all AI sessions, allowing users to quickly find and jump to sessions where they made specific requests. This complements the existing session quick-open (Cmd+Shift+S) by providing prompt-level navigation.

## Motivation

Users often remember what they asked an AI agent but not which session it was in. Instead of browsing through session titles or manually searching, they should be able to search their prompt history directly and jump to the relevant session.

## User Experience

### Keyboard Shortcut
- **Cmd+Shift+L** - Opens the prompt history quick-open dialog
- Mnemonic: "L" for "Look up" or "Locate" prompts

### Dialog Behavior
- Modal dialog similar to `SessionQuickOpen.tsx`
- Shows last ~2000 user prompts (configurable limit)
- Real-time search filtering as user types
- Keyboard navigation (up/down arrows, enter to select, escape to close)
- Mouse interaction support (hover highlights, click to select)

### Display Information
Each prompt entry shows:
- **Prompt text** (truncated to ~120 characters with ellipsis)
- **Session title** (with badge if in workstream)
- **Timestamp** (relative time: "2 hours ago", "yesterday", etc.)
- **Status indicators** (processing, pending, unread - reuse atoms from SessionQuickOpen)
- **Provider icon** (Claude, OpenAI, etc.)

### Selection Behavior
When user selects a prompt:
1. Close the dialog
2. Open the session containing that prompt
3. Scroll to the selected prompt in the chat view

## Technical Design

### Database Query
Query `ai_agent_messages` table:
```sql
SELECT
  m.id,
  m.session_id,
  m.content,
  m.created_at,
  s.title as session_title,
  s.provider,
  s.parent_session_id
FROM ai_agent_messages m
JOIN ai_sessions s ON m.session_id = s.id
WHERE m.role = 'user'
  AND s.workspace_path = ?
ORDER BY m.created_at DESC
LIMIT 2000
```

### Component Structure
Create new component: `packages/electron/src/renderer/components/PromptQuickOpen.tsx`

Reuse patterns from `SessionQuickOpen.tsx`:
- Backdrop + modal structure
- Search input with ref for auto-focus
- Results list with keyboard navigation
- Mouse movement tracking for hover vs keyboard distinction
- Status indicators via Jotai atoms

### New IPC Channel
Add to main process:
- **Channel**: `messages:list-user-prompts`
- **Handler**: Query database for recent user messages
- **Return**: Array of prompt entries with metadata

### State Management
Reuse existing Jotai atoms:
- `sessionOrChildProcessingAtom` - Show processing indicator
- `sessionPendingPromptAtom` - Show pending prompt indicator
- `sessionUnreadAtom` - Show unread indicator

### Integration Points

1. **Keyboard shortcut registration**
  - Add to keyboard shortcut system (Cmd+Shift+L)
  - Render `<PromptQuickOpen>` in `AgentMode.tsx` or parent component

2. **Navigation to session**
  - Reuse existing `onSessionSelect` callback pattern
  - Pass session ID to open/switch to that session
  - Optional: Pass message ID to scroll to specific prompt

3. **CSS styling**
  - Create `PromptQuickOpen.css`
  - Reuse design tokens from `SessionQuickOpen.css`
  - Adapt layout for longer text content (prompts vs session titles)

## Implementation Steps

1. **Database/IPC layer**
  - Add `messages:list-user-prompts` IPC handler
  - Implement query with JOIN to get session metadata
  - Test query performance with large message counts

2. **Component scaffolding**
  - Copy `SessionQuickOpen.tsx` as starting point
  - Rename to `PromptQuickOpen.tsx`
  - Update interface to use prompt data structure

3. **UI adaptation**
  - Adjust layout for prompt text (longer content)
  - Add session title as secondary info
  - Reuse status indicators and provider icons
  - Style prompt text (truncation, highlighting)

4. **Search implementation**
  - In-memory filtering by prompt content
  - Case-insensitive search
  - Consider highlighting matched text (optional enhancement)

5. **Keyboard shortcut**
  - Register Cmd+Shift+L in keyboard system
  - Add state management for dialog open/close
  - Integrate into AgentMode or App component

6. **Navigation behavior**
  - Wire up session selection callback
  - Test jumping to sessions from different workspaces
  - Test jumping to child sessions (workstreams)

7. **Testing**
  - Manual testing with various prompt counts
  - Edge cases: empty results, single result, long prompts
  - Performance with 2000+ prompts

## Open Questions

1. **Scroll to prompt**: Should we scroll to the specific prompt in the session after opening?
  - Pros: Provides exact context, better UX
  - Cons: More complex, requires message ID tracking in chat view
  - Decision: Start without scrolling, add as enhancement if needed

2. **Prompt limit**: Is 2000 the right number?
  - Could make configurable
  - Consider pagination or virtual scrolling for very large histories
  - Decision: Start with 2000, monitor performance

3. **Search scope**: Should search include AI responses too?
  - Current plan: User prompts only (simpler, clearer intent)
  - Alternative: Include AI responses, mark them differently
  - Decision: User prompts only for v1

4. **Multi-workspace**: Should this search across all workspaces or just current?
  - Current plan: Current workspace only (consistent with SessionQuickOpen)
  - Alternative: Global search across all projects
  - Decision: Current workspace only for v1

## Success Criteria

- [ ] Dialog opens with Cmd+Shift+L
- [ ] Shows last 2000 user prompts with metadata
- [ ] Real-time search filtering works
- [ ] Keyboard navigation (arrows, enter, escape) works
- [ ] Mouse interaction works (hover, click)
- [ ] Selecting a prompt opens the correct session
- [ ] Status indicators show correct state
- [ ] Performance is acceptable with large prompt histories
- [ ] UI is consistent with SessionQuickOpen design

## Future Enhancements

- Scroll to selected prompt after opening session
- Highlight search matches in prompt text
- Global search across all workspaces
- Filter by date range or provider
- Group by session or date
- Include AI responses in search results
- Export prompt history
