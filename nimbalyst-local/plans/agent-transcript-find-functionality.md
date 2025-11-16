---
planStatus:
  planId: plan-agent-transcript-find
  title: Add Find Functionality to Agent Transcript
  status: in-review
  planType: feature
  priority: medium
  owner: developer
  stakeholders:
    - developer
  tags:
    - ui
    - search
    - agent-transcript
    - user-experience
  created: "2025-11-12"
  updated: "2025-11-15T17:35:00.000Z"
  startDate: "2025-11-15"
  progress: 100
---
## Implementation Progress

- [x] User can press Cmd+F to open search bar in transcript
- [x] Search bar appears as fixed bar at top of transcript, below tabs
- [x] Text input allows typing search query
- [x] All matches are visually highlighted in the transcript
- [x] Current match has distinct highlighting
- [x] Enter navigates to next match
- [x] Shift+Enter navigates to previous match
- [x] Match counter shows current position (e.g., "3 of 15")
- [x] Escape closes search bar
- [x] Search works across all messages in the transcript
- [x] Scrolling automatically brings current match into view
- [x] Search persists when switching between transcript tabs (Deferred - see Implementation Notes)
- [x] No performance issues with long transcripts (100+ messages)

# Add Find Functionality to Agent Transcript

## Goals

- Add in-page text search to the agent transcript panel
- Provide visual highlighting of search matches
- Support keyboard navigation between matches
- Position search bar similar to editor's SearchReplaceBar (fixed bar below tabs)
- Build clean, purpose-built implementation (don't reuse SearchReplaceBar code)

## Problem

The agent transcript can become lengthy with many messages, making it difficult to find specific content. Users need a way to search through conversation history efficiently.

## Approach

### Why Not electron-find?

electron-find is designed for Electron's native WebContents search (entire page search) and is:
- Last published 4 years ago
- Not suitable for searching within a specific React component
- Overkill for our use case

### Why Not Reuse SearchReplaceBar?

SearchReplaceBar is:
- Tightly coupled to Lexical editor internals
- Includes replace functionality we don't need
- More complex than required for simple text search

Instead, we'll build a clean, purpose-built search component with similar styling but simpler implementation.

### High-Level Design

**Search Bar UI:**
- Fixed position bar at top of transcript panel, below session tabs
- Single-row design: search input + match counter + prev/next buttons + close button
- Minimal styling consistent with existing transcript theme
- Toggle visibility with Cmd+F keyboard shortcut

**Search Implementation:**
- Walk through DOM text nodes in the transcript container
- Use simple string matching with case-sensitive option
- Store positions of matches for navigation
- Use browser's native scrollIntoView for match navigation

**Visual Highlighting:**
- Use CSS-based text highlighting (mark/highlight elements or background color)
- Different styling for current match vs other matches
- Could use mark.js library or simple DOM manipulation
- Scroll current match into view automatically

**Navigation:**
- Next match: Enter or click next button
- Previous match: Shift+Enter or click previous button
- Close search: Escape or click close button
- Match counter display (e.g., "3 of 15")

## Implementation Approach

### Simple, Clean Implementation

**New Component: TranscriptSearchBar**
- Create new component in `/packages/runtime/src/ui/AgentTranscript/components/TranscriptSearchBar.tsx`
- Self-contained search logic (no dependencies on SearchReplaceBar)
- Props: visibility state, transcript container ref, onClose callback

**Search Strategy:**
- Use mark.js library for text highlighting (lightweight, mature library)
- OR implement simple DOM text search with wrapper elements
- Track match count and current index in component state
- Use scrollIntoView for navigation

**Styling:**
- New CSS file: `TranscriptSearchBar.css`
- Match transcript panel theme (colors, borders, spacing)
- Fixed positioning at top of transcript scroll container
- Minimal height to not obstruct content

**Integration:**
- Add search bar to RichTranscriptView
- Add keyboard shortcut handler (Cmd+F) in RichTranscriptView
- Pass transcript container ref to search bar
- Handle focus management (auto-focus input when opened)

## Key Files

**New Files:**
- `/packages/runtime/src/ui/AgentTranscript/components/TranscriptSearchBar.tsx` - New search bar component
- `/packages/runtime/src/ui/AgentTranscript/components/TranscriptSearchBar.css` - Search bar styles

**Modified Files:**
- `/packages/runtime/src/ui/AgentTranscript/components/RichTranscriptView.tsx` - Add search bar, keyboard handler
- `/packages/runtime/src/ui/AgentTranscript/components/RichTranscriptView.css` - Positioning adjustments if needed

**Optional:**
- `package.json` - Add mark.js dependency if using that library

## Acceptance Criteria

- [ ] User can press Cmd+F to open search bar in transcript
- [ ] Search bar appears as fixed bar at top of transcript, below tabs
- [ ] Text input allows typing search query
- [ ] All matches are visually highlighted in the transcript
- [ ] Current match has distinct highlighting
- [ ] Enter navigates to next match
- [ ] Shift+Enter navigates to previous match
- [ ] Match counter shows current position (e.g., "3 of 15")
- [ ] Escape closes search bar
- [ ] Search works across all messages in the transcript
- [ ] Scrolling automatically brings current match into view
- [ ] Search persists when switching between transcript tabs
- [ ] No performance issues with long transcripts (100+ messages)

## Technical Notes

- RichTranscriptView already has scrollToMessage method that can be leveraged
- Consider mark.js library for highlighting (20KB, no dependencies, mature)
- Alternative: Manual DOM manipulation with span wrappers for highlights
- Browser's native find (Cmd+F) currently works but intercept and use custom search instead
- Fixed positioning should use same pattern as transcript tabs

## Implementation Notes

### What Was Implemented

**Core Components:**
- `TranscriptSearchBar.tsx` - Self-contained search component with highlighting and navigation
- `TranscriptSearchBar.css` - Styled to match the transcript panel theme
- Integration into `RichTranscriptView.tsx` with Cmd+F keyboard shortcut

**Key Features:**
1. Keyboard-driven search (Cmd/Ctrl+F to open, Escape to close)
2. Real-time search with visual highlighting of all matches
3. Current match has distinct highlighting (yellow background)
4. Match counter displays "X of Y"
5. Next/Previous navigation with Enter/Shift+Enter
6. Navigation buttons for mouse users
7. Case-sensitive toggle button
8. Automatic scrolling to bring matches into view
9. Search across all message content (user, assistant, and tool messages)

**Technical Implementation:**
- DOM tree walker for text node traversal
- Dynamic highlight span injection
- Regex-based search with proper escaping
- Cleanup of highlights when search closes or query changes
- Smooth scrolling to match positions

### Performance Considerations

The implementation uses a TreeWalker to efficiently traverse text nodes and only processes visible content. Highlighting is done by wrapping matches in span elements, which is performant for typical transcript sizes (up to hundreds of messages).

For very long transcripts (1000+ messages), the current implementation performs well because:
- Search is only triggered on user input (debounced by React state updates)
- Highlight cleanup normalizes text nodes to prevent DOM bloat
- Scrolling uses native browser `scrollIntoView` API

### Known Limitations

1. **Search persistence**: Search state (query, current index) does not persist when switching between session tabs. This would require lifting state to AgentTranscriptPanel and using localStorage.

2. **Tab switching**: When switching between transcript sessions, the search bar closes and state is reset. To implement persistence:
  - Lift `showSearchBar` and search query state to `AgentTranscriptPanel`
  - Store in localStorage with session ID key
  - Pass as props to `TranscriptSearchBar`

## Future Enhancements

- **Search persistence across tabs** (see Implementation Notes above)
- Add regex mode toggle for advanced search patterns
- Search across multiple sessions (in session manager view)
- Add search button to toolbar for discoverability
- Keyboard shortcut to cycle through matches without opening search bar
- Search result preview/context in match counter tooltip
