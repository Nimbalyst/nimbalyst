---
planStatus:
  planId: plan-agent-transcript-rich-markdown
  title: Add Rich Markdown Formatting to Agent Transcript Output
  status: completed
  planType: feature
  priority: medium
  owner: ghinkle
  stakeholders:
    - ghinkle
  tags:
    - ui
    - agent-transcript
    - markdown
    - formatting
  created: "2025-10-12"
  updated: "2025-10-12T19:30:00.000Z"
  progress: 100
---
# Add Rich Markdown Formatting to Agent Transcript Output


## Goals

- Replace plain text rendering in agent transcript with rich markdown formatting
- Use react-markdown for consistent, safe markdown rendering
- Support code blocks with syntax highlighting
- Maintain existing transcript functionality (streaming, tool results, etc.)
- Improve readability of agent responses with proper formatting

## Current System Overview

The agent transcript currently displays responses in `RichTranscriptView.tsx` which handles:
- Streaming agent messages
- Tool execution results
- Message history
- Different message types (user, assistant, tool results)

The component is located at:
- `packages/runtime/src/ui/AgentTranscript/components/RichTranscriptView.tsx`

## Implementation Plan

### 1. Add react-markdown dependency
- Install `react-markdown` and `remark-gfm` (GitHub Flavored Markdown)
- Install syntax highlighting library (e.g., `react-syntax-highlighter`)

### 2. Update RichTranscriptView component
- Replace plain text rendering with react-markdown component
- Configure markdown rendering options:
  - Enable code block syntax highlighting
  - Support tables, strikethrough, task lists (GFM)
  - Configure link handling
  - Add custom renderers for specific elements if needed

### 3. Styling considerations
- Ensure markdown elements use CSS variables for theming
- Code blocks should respect current theme (light/dark/crystal-dark)
- Maintain consistent spacing and typography
- Preserve existing transcript layout and structure

### 4. Handle streaming content
- Ensure markdown renders correctly during streaming updates
- Handle partial markdown gracefully (incomplete code blocks, etc.)

### 5. Security considerations
- Use react-markdown's safe rendering (no raw HTML by default)
- Sanitize any user-provided content
- Configure allowed elements and protocols for links

## Acceptance Criteria

- Agent responses render with proper markdown formatting
- Code blocks display with syntax highlighting
- Links, lists, tables, and other markdown elements render correctly
- Streaming messages update smoothly without layout shifts
- Theming works correctly across all markdown elements
- No security vulnerabilities from markdown rendering
- Existing transcript functionality remains intact

## Technical Notes

Files to modify:
- `packages/runtime/src/ui/AgentTranscript/components/RichTranscriptView.tsx`
- Related CSS files for markdown styling
- `packages/runtime/package.json` (dependencies)

Dependencies to add:
- `react-markdown`
- `remark-gfm`
- `react-syntax-highlighter` or similar

## Implementation Summary

The implementation has been completed successfully:

1. **Dependencies Installed**:
  - `react-markdown@^10.1.0`
  - `remark-gfm@^4.0.1`
  - `react-syntax-highlighter@^15.6.6`
  - `@types/react-syntax-highlighter@^15.5.13`

2. **New Files Created**:
  - `packages/runtime/src/ui/AgentTranscript/components/MarkdownRenderer.tsx` - Main markdown rendering component with custom renderers for all markdown elements
  - `packages/runtime/src/ui/AgentTranscript/components/MarkdownRenderer.css` - CSS styling for markdown elements using CSS variables

3. **Files Modified**:
  - `packages/runtime/src/ui/AgentTranscript/components/MessageSegment.tsx` - Updated to use MarkdownRenderer instead of plain text rendering

4. **Key Features Implemented**:
  - Full markdown support including headings, lists, tables, blockquotes, links, and inline formatting
  - Syntax highlighting for code blocks using react-syntax-highlighter
  - GitHub Flavored Markdown support (strikethrough, task lists, tables)
  - Theme-aware styling using CSS variables (--accent-primary, --text-primary, --surface-tertiary, etc.)
  - Safe rendering (no raw HTML)
  - Maintains compatibility with existing streaming functionality

5. **CSS Variables Used**:
  - All styling uses proper CSS variables from PlaygroundEditorTheme.css
  - Correctly uses --accent-primary instead of --primary-color
  - Supports light, dark, and crystal-dark themes

The implementation meets all acceptance criteria and maintains backward compatibility with existing functionality.
