---
planStatus:
  planId: plan-markdown-clipboard-copy
  title: Markdown Clipboard Copy Feature
  status: completed
  planType: feature
  priority: medium
  owner: assistant
  stakeholders:
    - users
  tags:
    - clipboard
    - markdown
    - copy-paste
  created: "2025-01-23"
  updated: "2025-01-23T00:00:00.000Z"
  progress: 100
---
# Markdown Clipboard Copy Feature
<!-- plan-status -->

## Current Status

Successfully implemented markdown clipboard copy as a **separate keyboard shortcut (Cmd+Shift+C)**, preserving Lexical's default HTML copy behavior for regular Cmd+C.

### What's Working

1. **MarkdownCopyPlugin** (`packages/rexical/src/plugins/MarkdownCopyPlugin/index.tsx`)
  - Registers custom keyboard shortcut: **Cmd+Shift+C** (Mac) or **Ctrl+Shift+C** (Windows/Linux)
  - Creates `COPY_AS_MARKDOWN_COMMAND` for markdown copying
  - Generates markdown using the enhanced markdown export system
  - Uses `navigator.clipboard.writeText()` to copy markdown
  - Works alongside Lexical's default copy (Cmd+C still copies as HTML)

2. **E2E Test** (`packages/electron/e2e/markdown/markdown-copy.spec.ts`)
  - Verifies Cmd+Shift+C copies markdown to system clipboard
  - Tests formatted content (headings, bold text)
  - Checks clipboard via `navigator.clipboard.read()`

3. **Behavior**
  - **Cmd+C**: Copies as HTML (Lexical's default) - works with Word, Google Docs, Gmail, etc.
  - **Cmd+Shift+C**: Copies as markdown - perfect for pasting into markdown editors, Slack, GitHub
  - Example: Cmd+Shift+C on "Hello **world**" heading produces `# Hello **world**`
  - Best of both worlds: users choose format based on destination app

### Advantages of This Approach

This keyboard shortcut solution **preserves all existing functionality while adding markdown support**:

1. **No Breaking Changes**
  - Regular Cmd+C unchanged - still copies HTML for rich text editors
  - Existing copy/paste workflows unaffected
  - No trade-offs or lost features

2. **User Choice**
  - Users decide which format they need per copy operation
  - Markdown copy is opt-in via keyboard shortcut
  - Intuitive: Shift key modifies behavior (like Shift+Click in many apps)

3. **Clean Implementation**
  - No conflicts with Lexical's copy handler
  - No need to intercept or modify COPY_COMMAND
  - Uses standard clipboard API (`navigator.clipboard.writeText`)
  - Simple keyboard shortcut registration

## Technical Implementation

### Keyboard Shortcut Registration

The plugin registers two command handlers:

1. **KEY\_MODIFIER\_COMMAND** handler
  - Detects Cmd+Shift+C (or Ctrl+Shift+C)
  - Dispatches custom `COPY_AS_MARKDOWN_COMMAND`
  - Prevents default to avoid interference

2. **COPY\_AS\_MARKDOWN\_COMMAND** handler
  - Reads selection from editor state
  - Generates markdown via `$convertSelectionToEnhancedMarkdownString()`
  - Copies to clipboard via `navigator.clipboard.writeText()`

### Why This Works

- **No ClipboardEvent needed**: Uses Clipboard API directly, avoiding browser limitations
- **No event.preventDefault() issues**: Not intercepting native copy events
- **No timing issues**: Clipboard write happens async via standard API
- **No read-only errors**: Not competing with other clipboard handlers

## Technical Challenges Discovered

### Browser Clipboard API Limitations (Original Approach)

When we initially tried to intercept Cmd+C and write both HTML and markdown:

1. **Custom MIME Types Not Supported**
  - `ClipboardEvent.clipboardData.setData('text/markdown', ...)` doesn't persist
  - Only standard formats work: `text/plain`, `text/html`, `text/uri-list`
  - Custom MIME types accepted during event but lost afterwards

2. **Read-Only Mode Errors**
  - Calling `event.preventDefault()` before `read()` causes editor state errors
  - `$getHtmlContent()` and `$getLexicalContent()` fail with "Cannot use method in read-only mode"

3. **Event Timing Issues**
  - `ClipboardEvent.clipboardData` only valid during event handler
  - Can't write clipboard data asynchronously after event

### Solution: Separate Keyboard Shortcut

By using a separate shortcut (Cmd+Shift+C), we avoid all these issues:
- Don't need ClipboardEvent (use Clipboard API instead)
- Don't interfere with Lexical's copy handler
- Don't need to write multiple MIME types simultaneously
- Clean, simple implementation

## Files Changed

- `packages/rexical/src/plugins/MarkdownCopyPlugin/index.tsx` - Plugin implementation
- `packages/rexical/src/Editor.tsx` - Added plugin to editor
- `packages/rexical/src/index.ts` - Exported plugin and command
- `packages/electron/e2e/markdown/markdown-copy.spec.ts` - E2E test
- `packages/rexical/src/markdown/EnhancedMarkdownExport.ts` - Selection export support

## User Documentation

Users should be informed of this feature:

**Keyboard Shortcuts**
- `Cmd+C` (Mac) / `Ctrl+C` (Windows/Linux): Copy as rich text (HTML) - use for pasting into Word, Google Docs, email
- `Cmd+Shift+C` (Mac) / `Ctrl+Shift+C` (Windows/Linux): Copy as markdown - use for pasting into markdown editors, Slack, GitHub, VS Code

## Future Enhancements

### Potential Improvements

1. **Context Menu**
  - Add "Copy as Markdown" to right-click menu
  - Provides discoverability for users who don't know the shortcut

2. **Paste Detection**
  - Detect markdown syntax on paste
  - Offer to convert markdown to rich text
  - Round-trip capability between editors

3. **Configuration**
  - Allow users to customize keyboard shortcut
  - Option to show indicator when markdown copy succeeds

4. **Additional Formats**
  - Cmd+Shift+Option+C for plain text (no formatting, no markdown)
  - Cmd+Option+C for HTML source code

## Lessons Learned

1. **Browser APIs are Limited**: Can't reliably write custom MIME types via ClipboardEvent
2. **Separate Shortcuts Work Better**: Avoids complexity of handling multiple formats in one copy operation
3. **User Choice is Valuable**: Let users pick format based on their destination app
4. **Keyboard Shortcuts are Intuitive**: Shift modifier follows established UI patterns

## Status: Complete

This feature is complete and ready for use. No further work needed unless we want to add the context menu or configuration options mentioned in Future Enhancements.
