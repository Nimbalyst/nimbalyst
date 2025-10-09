---
planStatus:
  planId: plan-markdown-paste-support
  title: Markdown Paste Support
  status: completed
  planType: feature
  priority: medium
  owner: ghinkle
  stakeholders:
    - ghinkle
  tags:
    - editor
    - markdown
    - paste
    - clipboard
    - ux
  created: "2025-10-06"
  updated: "2025-10-09T14:33:00.000Z"
  progress: 100
---
# Markdown Paste Support
<!-- plan-status -->

## Summary

When users paste content that is in markdown format, Preditor should detect this and paste the transformed/rendered content instead of raw markdown text. This feature leverages the existing markdown transformer system to convert pasted markdown into Lexical nodes, providing a seamless experience when copying markdown from other sources like documentation, GitHub, or note-taking apps.

## Goals

- Automatically detect when pasted content is markdown
- Transform markdown to rich content using existing transformer system
- Preserve user intent when pasting from markdown sources
- Maintain fallback to plain text paste when markdown detection is uncertain
- Provide consistent behavior with existing copy/paste functionality
- Support all markdown features already handled by transformers

## Problem Statement

Currently, when users paste markdown text into Preditor:
- Markdown is pasted as literal text (with asterisks, hashes, brackets, etc.)
- Users must manually format the content after pasting
- No automatic recognition of common markdown patterns
- Poor experience when moving content from markdown-based tools
- Extra steps required to get properly formatted content

This creates friction when:
- Copying documentation from GitHub or wikis
- Pasting from markdown note-taking apps (Obsidian, Notion, etc.)
- Moving content between markdown editors
- Importing markdown snippets from web sources

## Use Cases

### Primary Use Cases

**From GitHub:**
- Copy markdown from README files
- Paste issue descriptions written in markdown
- Import code snippets with markdown formatting

**From Documentation:**
- Copy formatted documentation
- Paste API reference content
- Import tutorial content with headers, lists, code blocks

**From Note Apps:**
- Paste from Obsidian, Notion, Bear
- Import personal notes
- Move research content

**From Other Editors:**
- VSCode markdown files
- Typora, iA Writer, etc.
- Web-based markdown editors

### Edge Cases

**Ambiguous Content:**
- Text that could be markdown or plain text
- Partial markdown formatting
- Mixed content with some markdown patterns

**Complex Markdown:**
- Tables
- Nested lists
- Code blocks with language specifiers
- Links with titles
- Images

**Non-Markdown:**
- Plain text that happens to have asterisks
- Code that uses markdown-like syntax
- Content that should remain literal

## Detection Strategy

### Clipboard Format Analysis

**MIME Type Detection:**
- Check clipboard for `text/html` - if present, use existing HTML paste
- Check clipboard for `text/markdown` - explicit markdown indicator
- Fall back to `text/plain` analysis if no HTML/markdown type

**Content Pattern Analysis:**
When clipboard contains only plain text, analyze patterns:

**Strong Markdown Indicators:**
- Lines starting with `#` followed by space (headers)
- Lines starting with `-`, `*`, or `+` followed by space (lists)
- Lines starting with numbers followed by `.` and space (ordered lists)
- Lines with `**text**` or `__text__` (bold)
- Lines with `*text*` or `_text_` (italic)
- Lines starting with `>` (blockquotes)
- Code fences with triple backticks
- Links in `[text](url)` format
- Horizontal rules (`---`, `***`, `___`)

**Scoring System:**
Calculate markdown likelihood score:
- Each strong indicator adds points
- Multiple different indicators increase confidence
- Percentage of markdown-formatted lines
- Presence of markdown-specific structures (tables, code blocks)

**Threshold:**
- High confidence (score > 80): Auto-transform as markdown
- Medium confidence (score 40-80): Transform, but monitor for user feedback
- Low confidence (score < 40): Paste as plain text

**Whitelist Patterns:**
Known safe patterns that always trigger markdown mode:
- Content starting with YAML frontmatter (`---`)
- Content with clear document structure (multiple headers)
- GitHub-flavored markdown patterns (task lists, tables)

### Special Handling

**HTML with Markdown:**
- If clipboard has both HTML and plain text
- Prefer HTML paste (existing behavior)
- Markdown detection only applies to plain text

**Rich Text Sources:**
- Word processors, Google Docs already provide HTML
- Continue using HTML paste path
- Markdown detection not needed

**Code Snippets:**
- Code from IDEs typically includes language metadata
- May contain markdown-like patterns but shouldn't be transformed
- Detection should be conservative with code-like content

## Transformation Implementation

### Using Existing Transformers

**Leverage Current System:**
Preditor already has markdown transformers in:
- `packages/rexical/src/markdown/` - Core markdown transformers
- `MARKDOWN_TRANSFORMERS` constant - Available transformer set
- `$convertFromMarkdownString` - Transformation function

**Integration Point:**
Hook into existing paste handling in `ClipboardPlugin`:
- Located at `packages/rexical/src/plugins/ClipboardPlugin/`
- Currently handles HTML and plain text paste
- Add markdown detection before plain text handling

**Transformation Flow:**
1. Detect markdown in clipboard plain text
2. Extract plain text content
3. Pass to `$convertFromMarkdownString` with `MARKDOWN_TRANSFORMERS`
4. Insert transformed nodes into editor
5. Handle as if content was typed/imported

### Handling Edge Cases

**Partial Paste:**
- Pasting into middle of existing content
- Respect cursor position
- Merge appropriately with surrounding nodes

**Selection Replacement:**
- Replace selected content with transformed markdown
- Maintain proper node boundaries
- Handle block vs inline replacement

**Undo/Redo:**
- Single undo operation for paste
- Can undo to state before paste
- Transformation is atomic

**Failed Transformation:**
- If transformation throws error, fall back to plain text
- Log error for debugging
- Don't break user flow

## User Experience Design

### Transparent Behavior

**No Configuration Needed:**
- Feature works automatically
- No settings to enable/disable initially
- Smart defaults

**Feedback:**
- Paste happens immediately
- No loading state or delay
- Feels instantaneous like normal paste

**Discoverability:**
- Users discover naturally when pasting markdown
- No explicit feature announcement needed
- Works as users expect

### User Control

**Paste as Plain Text Override:**
- Standard keyboard shortcut: Cmd+Shift+V (or Ctrl+Shift+V)
- Bypasses markdown detection
- Always pastes literal text

**Future: Paste Options Menu:**
- Right-click paste menu
- Options: "Paste", "Paste as Plain Text", "Paste as Markdown"
- Explicit control when needed

**Future: Settings Toggle:**
- Advanced setting: "Auto-detect markdown on paste"
- Default: enabled
- Users can disable if unwanted

### Error Handling

**Graceful Degradation:**
- If detection fails, paste as plain text
- If transformation fails, paste as plain text
- Never block paste operation

**User Feedback:**
- No error messages for failed detection (silent fallback)
- Log errors to console for debugging
- Track metrics on detection success rate

## Technical Implementation

### Plugin Integration

**ClipboardPlugin Enhancement:**

Current plugin handles:
- HTML paste from rich text sources
- Plain text paste
- Image paste
- File paste

Add markdown detection:
- Before plain text handler
- After HTML handler (HTML takes precedence)
- Analyze plain text for markdown patterns
- Transform if detected

**Code Location:**
- Primary: `packages/rexical/src/plugins/ClipboardPlugin/`
- Utilities: Consider extracting detection to separate utility
- Tests: Add clipboard paste tests with markdown samples

### Detection Algorithm

**Phase 1: Quick Checks**
- MIME type check for `text/markdown`
- Presence of HTML (skip markdown detection)
- Content length (too short = unlikely markdown)

**Phase 2: Pattern Matching**
- Line-by-line analysis
- Count markdown indicators
- Calculate confidence score

**Phase 3: Structure Analysis**
- Check for document structure (headers, paragraphs)
- Validate markdown syntax
- Detect ambiguous patterns

**Implementation Considerations:**
- Fast execution (paste should be instant)
- Avoid complex regex on large content
- Cache detection result if pasting same content multiple times

### Transformation Execution

**Integration with Existing System:**

Use `$convertFromMarkdownString`:
- Located in `@lexical/markdown`
- Takes markdown string and transformers
- Returns Lexical nodes
- Already handles all markdown features

**Execution in Editor Update:**
```javascript
editor.update(() => {
  const selection = $getSelection();
  if ($isRangeSelection(selection)) {
    $convertFromMarkdownString(markdownText, MARKDOWN_TRANSFORMERS, selection);
  }
});
```

**Error Handling:**
- Wrap in try/catch
- Fall back to plain text on error
- Log transformation failures

### Testing Strategy

**Unit Tests:**
- Markdown detection accuracy
- Pattern matching correctness
- Confidence scoring
- Edge case handling

**Integration Tests:**
- Paste markdown into empty editor
- Paste markdown into existing content
- Replace selection with markdown
- Various markdown structures (headers, lists, tables, code)

**Test Samples:**
- Real markdown from GitHub READMEs
- Documentation snippets
- Note-taking app exports
- Complex nested structures
- Ambiguous content (should not transform)

**Regression Tests:**
- Ensure HTML paste still works
- Plain text paste unchanged
- Image paste unaffected
- Paste as plain text shortcut works

## Markdown Feature Support

### Supported Elements

All elements currently supported by `MARKDOWN_TRANSFORMERS`:

**Block Elements:**
- Headings (H1-H6)
- Paragraphs
- Blockquotes
- Ordered lists
- Unordered lists
- Code blocks (with language syntax highlighting)
- Horizontal rules
- Tables

**Inline Elements:**
- Bold
- Italic
- Strikethrough
- Inline code
- Links
- Images

**Extensions:**
- Task lists (GitHub-flavored markdown)
- Footnotes (if supported by transformers)

### Unsupported/Special Cases

**Custom Extensions:**
- Obsidian wikilinks
- Notion-specific formatting
- Custom HTML in markdown

**Handling:**
- Transform what's supported
- Pass through unsupported as plain text
- Don't break on unknown syntax

## Performance Considerations

### Detection Performance

**Content Size:**
- Small pastes (< 1KB): Analyze fully
- Medium pastes (1KB - 100KB): Sample-based detection
- Large pastes (> 100KB): Quick pattern check only

**Optimization:**
- Early exit if HTML present
- Cache detection results
- Limit line-by-line analysis to first N lines
- Use simple string operations, avoid heavy regex

### Transformation Performance

**Large Documents:**
- Markdown transformation can be slow for large content
- Consider showing loading state for > 100KB
- Break into chunks if needed
- Maintain UI responsiveness

**Memory:**
- Large transformed documents create many nodes
- Monitor memory usage
- Consider progressive rendering for very large pastes

## Future Enhancements

### Advanced Detection

**Machine Learning:**
- Train model on markdown vs non-markdown corpus
- More accurate detection
- Adaptive learning from user corrections

**User Feedback Loop:**
- Track when users immediately undo paste
- Learn from patterns
- Adjust detection threshold

### Paste Preview

**Preview Before Transform:**
- Show preview modal on paste
- Options: "Paste as Markdown" or "Paste as Plain Text"
- Remember user preference for similar content

### Format Preferences

**Per-Source Preferences:**
- Remember GitHub always has markdown
- Remember Google Docs always has HTML
- Source-based rules

**Content Type Detection:**
- Detect code snippets (don't transform)
- Detect prose (more likely markdown)
- Detect structured data (likely plain text)

### Bidirectional Support

**Copy as Markdown:**
- When copying from Preditor, include markdown in clipboard
- Add `text/markdown` MIME type
- Other markdown editors can paste with formatting

## Platform Considerations

### Cross-Platform Clipboard

**macOS:**
- Standard clipboard API
- NSPasteboard types
- HTML and plain text both available

**Windows:**
- Windows clipboard API
- HTML format
- Plain text format

**Linux:**
- X11 clipboard
- Wayland clipboard
- Format availability varies

**Web:**
- Clipboard API
- DataTransfer object
- MIME type support

### Browser Compatibility

**Clipboard API:**
- Modern browsers: Full support
- Electron: Full access to clipboard
- Fallback: Use execCommand for older environments

**MIME Type Support:**
- Check for `text/html`, `text/plain`
- `text/markdown` rarely provided by sources
- Rely on pattern detection for plain text

## Security Considerations

### Sanitization

**Markdown Content:**
- Markdown transformers should sanitize HTML
- Prevent XSS through markdown links
- Validate image URLs

**External Links:**
- Links in markdown are preserved
- No automatic fetching of external content
- User clicks to navigate

### Privacy

**No External Requests:**
- Detection and transformation are local
- No content sent to servers
- No tracking of pasted content

## Accessibility

### Screen Reader Support

**Announce Transformation:**
- If markdown is transformed, announce result
- "Pasted heading and paragraph"
- Describe inserted structure

**Plain Text Option:**
- Paste as plain text shortcut remains accessible
- Users can disable auto-transformation if it interferes

### Keyboard Navigation

**Standard Shortcuts:**
- Cmd/Ctrl+V: Paste (with markdown detection)
- Cmd/Ctrl+Shift+V: Paste as plain text (no transformation)
- No new shortcuts needed

## Success Criteria

- Markdown paste works transparently for users
- Detection accuracy > 90% for clear markdown content
- No false positives on plain text or code
- Performance impact < 50ms for typical pastes
- Existing paste functionality unchanged
- Users discover and appreciate feature naturally
- Reduces manual formatting after paste

## Implementation Summary

### Completed (2025-10-09)

The markdown paste support feature has been successfully implemented with the following components:

1. **Markdown Detection Utility** (`packages/rexical/src/utils/markdownDetection.ts`)
  - Pattern-based detection for markdown content
  - Confidence scoring system (default threshold: 15)
  - Support for block-level patterns: headings, lists, code blocks, blockquotes, tables
  - Support for inline patterns: bold, italic, code, links
  - Special handling for frontmatter
  - Configurable detection parameters

2. **MarkdownPastePlugin** (`packages/rexical/src/plugins/MarkdownPastePlugin/index.tsx`)
  - Intercepts PASTE_COMMAND at high priority
  - HTML paste takes precedence (no interception)
  - Detects markdown in plain text clipboard content
  - Transforms detected markdown using editor's transformers
  - Graceful fallback to plain text on error
  - Respects Shift+V for paste-as-plain-text

3. **Integration**
  - Plugin integrated into Editor.tsx alongside MarkdownShortcutPlugin
  - Uses existing markdown transformer system ($convertFromEnhancedMarkdownString)
  - Works seamlessly with frontmatter support

4. **Testing**
  - Comprehensive test suite (30 tests, all passing)
  - Tests for detection accuracy with various markdown patterns
  - Tests for false negative prevention (plain text, code, JSON)
  - Real-world example tests (GitHub READMEs, documentation)

### Design Decisions

- **Conservative detection**: Threshold set to 15 to minimize false positives
- **Single weak signals ignored**: One asterisk or backtick won't trigger transformation
- **HTML takes precedence**: Rich text paste uses existing HTML path
- **No configuration needed**: Feature works transparently
- **Error handling**: Falls back to plain text if transformation fails

### Files Created/Modified

Created:
- `packages/rexical/src/utils/markdownDetection.ts`
- `packages/rexical/src/utils/__tests__/markdownDetection.test.ts`
- `packages/rexical/src/plugins/MarkdownPastePlugin/index.tsx`

Modified:
- `packages/rexical/src/Editor.tsx` - Added plugin import and usage

## Open Questions

Answered:
- Detection threshold: 15 (conservative to avoid false positives)
- Detection is always on, no configuration needed initially
- No visual feedback - transformation is transparent
- Partial markdown handled well (scoring system accounts for this)
- Tables supported through existing transformers
- Unsupported extensions passed through as plain text
- Future: Could add telemetry for accuracy tracking

