---
planStatus:
  planId: plan-transcript-virtualization
  title: Virtualized Transcript Rendering for Long AI Sessions
  status: in-development
  planType: feature
  priority: high
  owner: ghinkle
  stakeholders:
    - ghinkle
  tags:
    - performance
    - ai-chat
    - virtualization
    - rendering
  created: "2025-12-04"
  updated: "2025-12-04T21:55:00.000Z"
  progress: 64
  startDate: "2025-12-04"
---
# Virtualized Transcript Rendering for Long AI Sessions

## Implementation Progress

- [x] Create HeightCache utility for storing/estimating message heights
- [x] Create useVirtualizedMessages hook for managing visible window
- [x] Integrate virtualization into RichTranscriptView
- [x] Adapt scrollToMessage() to use height cache
- [x] Adapt auto-scroll on new messages
- [x] Adapt search navigation (find-next/find-previous) - works for visible range; future: search against message data
- [x] Handle tool expansion/collapse height changes
- [ ] Sessions with 200+ messages render without perceptible lag
- [ ] Scrolling remains smooth (60fps)
- [ ] No visible flickering when scrolling
- [ ] Memory usage stays bounded

## Goals

- Eliminate performance degradation when rendering AI sessions with 100+ messages
- Reduce DOM node count from thousands to a fixed window of visible items
- Maintain all existing functionality: scroll-to-message, search, tool expansion, auto-scroll
- Keep memory footprint bounded regardless of session length

## Problem Statement

RichTranscriptView currently renders ALL messages using a simple `map()` over the full messages array. With long AI sessions containing complex tool calls, code blocks, and diffs, this causes:

1. Thousands of DOM nodes (100 messages can easily generate 5,000+ nodes)
2. Slow re-renders when new messages stream in
3. Memory growth proportional to session length
4. UI jank when expanding/collapsing tool results

## Current Architecture

**Component hierarchy:**
- AgentTranscriptPanel
  - RichTranscriptView (main scroll container, renders all messages)
    - TranscriptSearchBar
    - Message list (simple map over all messages)
      - Message headers, avatars, timestamps
      - MessageSegment (markdown, code blocks)
      - Tool cards (recursive for child tools)
      - EditToolResultCard with DiffViewer

**Key pain points:**
- No virtualization - full DOM for every message
- Tool cards can have deeply nested children, each rendered
- DiffViewer creates DOM elements per line of diff
- ReactMarkdown + SyntaxHighlighter per code block
- Message grouping logic recalculates on every render

## Proposed Solution

Implement windowed virtualization that only renders messages in/near the viewport, with height caching to maintain accurate scroll positions.

### Phase 1: Core Window Virtualization

**What to build:**
- Virtualization hook (useVirtualizedList) for managing visible window
- Height cache for accurate scroll calculations
- ResizeObserver integration for dynamic height measurement
- Scroll position tracking with debounced updates

**Key components:**
- VirtualizedMessageList - wraps message rendering with windowing
- useVirtualizedMessages hook - calculates visible range, manages heights
- HeightCache utility - stores measured heights, estimates unmeasured

**Files affected:**
- packages/runtime/src/ui/AgentTranscript/components/RichTranscriptView.tsx
- New: packages/runtime/src/ui/AgentTranscript/hooks/useVirtualizedMessages.ts
- New: packages/runtime/src/ui/AgentTranscript/utils/heightCache.ts

### Phase 2: Feature Integration

**Existing features to adapt:**
- scrollToMessage(index) - use height cache for offset calculation instead of DOM refs
- Auto-scroll on new messages - calculate if user is at bottom from cached positions
- Search navigation - jump to message index, ensure it's in visible range
- Message refs - only store refs for visible messages

**Tool expansion handling:**
- When tools expand/collapse, remeasure affected message heights
- Use ResizeObserver on message containers
- Debounce height updates during expansion animations

### Phase 3: Advanced Optimizations

**Secondary improvements:**
- Lazy tool content - render placeholder until tool is expanded
- Lazy diff rendering - show summary until user clicks to expand
- Code block virtualization - for very long code blocks
- Message grouping precalculation - compute once, cache

## Technical Approach

### Virtualization Strategy

Use a simple "render window" approach rather than a library:
- Calculate viewport height and scroll position
- Determine which message indices fall within viewport + buffer
- Only render those messages
- Use spacer divs above/below for scroll height

**Why not use react-virtualized or similar:**
- Variable height items with dynamic expansion are complex
- Need tight integration with existing scroll-to-message and search
- Custom height estimation based on message content type
- Avoid adding bundle size for narrow use case

### Height Estimation

Estimate initial heights based on message type:
- User message: 60px base + 20px per line of content
- Assistant message: 80px base + content estimation
- Tool message (collapsed): 50px
- Tool message (expanded): measured dynamically

After render, use ResizeObserver to get actual heights and update cache.

### Scroll Position Management

Maintain scroll position across renders:
- On scroll, record current message index and offset within message
- On message list changes, restore position to same message + offset
- For scrollToMessage, calculate target offset from height cache

## Acceptance Criteria

1. Sessions with 200+ messages render without perceptible lag
2. Scrolling remains smooth (60fps) regardless of session length
3. scrollToMessage() works correctly with virtualized list
4. Search find-next/find-previous navigates correctly
5. Tool expansion/collapse doesn't cause scroll jumps
6. Auto-scroll to new messages works when user is at bottom
7. No visible flickering when scrolling through messages
8. Memory usage stays bounded (not proportional to session length)

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Height estimation inaccuracy causing scroll jumps | Use ResizeObserver for actual measurement, smooth corrections |
| Complex tool nesting hard to height-estimate | Start with conservative estimates, refine after measurement |
| Search highlighting for non-visible items | Keep search state, apply highlighting when item enters viewport |
| Regression in scroll-to-message accuracy | Maintain comprehensive height cache, test thoroughly |
| Performance of height cache operations | Use efficient data structure, avoid recalculating on every scroll |

## Testing Strategy

- Unit tests for height cache and virtualization hooks
- E2E test with 200+ message session verifying smooth scroll
- E2E test for scrollToMessage accuracy
- E2E test for search navigation across virtualized list
- Manual testing of tool expansion with various nesting depths

## Future Considerations

- Consider applying similar virtualization to file tree for large workspaces
- Tool result content could benefit from lazy rendering (show summary, expand on demand)
- Very long code blocks or diffs might need their own line-level virtualization
