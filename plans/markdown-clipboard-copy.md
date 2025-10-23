---
planStatus:
  planId: plan-markdown-clipboard-copy
  title: Markdown Clipboard Copy Feature
  status: in-development
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
  progress: 60
---
# Markdown Clipboard Copy Feature
<!-- plan-status -->

## Current Status

Successfully implemented a basic markdown clipboard copy feature that writes markdown to `text/plain` when copying from the Lexical editor.

### What's Working

1. **MarkdownCopyPlugin** (`packages/rexical/src/plugins/MarkdownCopyPlugin/index.tsx`)
  - Registers at `COMMAND_PRIORITY_CRITICAL` for Lexical's `COPY_COMMAND`
  - Generates markdown using the enhanced markdown export system
  - Writes markdown to `text/plain` clipboard format
  - Prevents default browser copy behavior
  - Stops other Lexical copy handlers from running

2. **E2E Test** (`packages/electron/e2e/markdown/markdown-copy.spec.ts`)
  - Verifies markdown is written to system clipboard
  - Tests formatted content (headings, bold text)
  - Checks clipboard via `navigator.clipboard.read()`

3. **Behavior**
  - When copying from editor: `text/plain` contains markdown syntax
  - Example: copying "Hello **world**" heading produces `# Hello **world**`
  - Pasting into plain text editors gives markdown source
  - Works without forking Lexical or custom clipboard APIs

### What We've Lost

By writing markdown to `text/plain`, we've lost important clipboard features:

1. **No HTML Format**
  - Previously: `text/html` contained rich HTML for pasting into rich text editors
  - Now: Only markdown in `text/plain`, no HTML
  - Impact: Pasting into Word, Google Docs, rich email clients won't preserve formatting

2. **No Lexical Format**
  - Previously: `application/x-lexical-editor` preserved full editor state
  - Now: This format is not written
  - Impact: Can't copy/paste between Lexical editors with full fidelity

3. **Limited Cross-App Compatibility**
  - Apps that expect HTML for rich formatting won't get it
  - Apps that don't understand markdown will show raw markdown syntax
  - No fallback to plain text (markdown syntax includes special characters)

## Technical Challenges Discovered

### Browser Clipboard API Limitations

1. **Custom MIME Types Not Supported**
  - Chromium/Electron's `ClipboardEvent.clipboardData.setData()` only supports standard formats
  - Standard formats: `text/plain`, `text/html`, `text/uri-list`
  - Custom formats like `text/markdown` are accepted during the event but don't persist to system clipboard
  - Verified through testing: `text/markdown` was set but not readable by `navigator.clipboard.read()`

2. **Read-Only Mode Errors**
  - Calling `event.preventDefault()` before `editor.getEditorState().read()` causes errors
  - Error: "Cannot use method in read-only mode" when calling `$getHtmlContent()` or `$getLexicalContent()`
  - Solution: Generate content first, then prevent default

3. **Event Timing Issues**
  - `ClipboardEvent.clipboardData` is only valid during the event handler
  - Reading after event completes (e.g., in setTimeout) returns empty data
  - System clipboard must be read via `navigator.clipboard.read()` after copy completes

## Future Solutions

### Option 1: Multiple MIME Types (Ideal Solution)

**Goal:** Write markdown to `text/plain` AND HTML/Lexical formats

**Approach:**
```typescript
// In MarkdownCopyPlugin
editor.getEditorState().read(() => {
  const selection = $getSelection();

  // Generate all formats
  const markdown = $convertSelectionToEnhancedMarkdownString(transformers, selection, true);
  const htmlContent = $getHtmlContent(editor, selection);
  const lexicalContent = $getLexicalContent(editor, selection);

  // Set all formats
  clipboardData.setData('text/plain', markdown);
  clipboardData.setData('text/html', htmlContent);
  clipboardData.setData('application/x-lexical-editor', lexicalContent);
});
```

**Challenges:**
- Must solve "read-only mode" error when calling `$getHtmlContent()` and `$getLexicalContent()`
- Need to understand why these functions fail after `preventDefault()` is called
- May need to call these functions in a different way or at a different time

**Investigation Needed:**
1. Check if `$getHtmlContent()` and `$getLexicalContent()` require write access
2. Try calling them in a separate `read()` context before the copy event
3. Look at how Lexical's own copy handler calls these functions
4. Consider if we need to use `editor.update()` instead of `editor.getEditorState().read()`

### Option 2: Electron Native Clipboard (Electron-Only Solution)

**Goal:** Use Electron's native clipboard API which supports any MIME type

**Approach:**
1. Add IPC method in preload (`window.electronAPI.setClipboard()`)
2. Add handler in main process using Electron's `clipboard.write()`
3. Plugin calls IPC after generating markdown

```typescript
// In main process
ipcMain.handle('clipboard:write', async (event, formats) => {
  const { clipboard } = require('electron');
  clipboard.write({
    text: formats.markdown,
    html: formats.html,
    // Custom formats work in Electron!
    'text/markdown': formats.markdown
  });
});

// In plugin
editor.getEditorState().read(() => {
  const markdown = $convertSelectionToEnhancedMarkdownString(...);
  const html = $getHtmlContent(editor, selection);

  // Let default copy happen first for standard formats
  // Then enhance with our custom format via Electron
  setTimeout(() => {
    window.electronAPI.setClipboard({
      markdown,
      html
    });
  }, 0);
});
```

**Pros:**
- Can write `text/markdown` as a real MIME type
- Full control over all clipboard formats
- Can preserve both markdown and HTML

**Cons:**
- Only works in Electron, not in browser
- Adds IPC complexity
- Race condition between browser copy and Electron clipboard write

### Option 3: Smart Format Detection (Compromise)

**Goal:** Write different formats based on selection content

**Approach:**
```typescript
editor.getEditorState().read(() => {
  const selection = $getSelection();

  // Check if content has rich formatting
  const hasFormatting = checkForRichFormatting(selection);

  if (hasFormatting) {
    // Rich content: write HTML to preserve formatting
    const html = $getHtmlContent(editor, selection);
    clipboardData.setData('text/plain', selection.getTextContent());
    clipboardData.setData('text/html', html);
  } else {
    // Plain content: write markdown
    const markdown = $convertSelectionToEnhancedMarkdownString(...);
    clipboardData.setData('text/plain', markdown);
  }
});
```

**Pros:**
- Best of both worlds for different content types
- No complex infrastructure needed
- Works in browser and Electron

**Cons:**
- Users don't get consistent behavior
- Hard to define "rich formatting" vs "simple markdown"
- Doesn't solve the core problem

### Option 4: User Preference Toggle

**Goal:** Let users choose their preferred copy format

**Approach:**
1. Add setting: "Copy as Markdown" vs "Copy as Rich Text"
2. Plugin respects user preference

```typescript
// In settings
const copyFormat = settings.get('copyFormat'); // 'markdown' | 'html'

// In plugin
if (copyFormat === 'markdown') {
  const markdown = $convertSelectionToEnhancedMarkdownString(...);
  clipboardData.setData('text/plain', markdown);
} else {
  const html = $getHtmlContent(editor, selection);
  const text = selection.getTextContent();
  clipboardData.setData('text/plain', text);
  clipboardData.setData('text/html', html);
}
```

**Pros:**
- User control
- Simple to implement
- Clear behavior

**Cons:**
- Users have to know what they want in advance
- Can't have both formats simultaneously
- Extra UI/settings complexity

## Recommended Next Steps

1. **Investigate Read-Only Error** (High Priority)
  - Debug why `$getHtmlContent()` fails with "Cannot use method in read-only mode"
  - Test calling it before `preventDefault()`
  - Look at Lexical source for `$getHtmlContent()` implementation
  - Goal: Enable writing multiple formats simultaneously

2. **Implement Option 1** (If Investigation Succeeds)
  - Add back HTML and Lexical formats alongside markdown
  - Update test to verify all formats are written
  - Document behavior: markdown in plain, HTML for rich text editors, Lexical for copy/paste within editor

3. **Consider Option 4** (If Option 1 Fails)
  - Add user preference for copy format
  - Default to HTML (current Lexical behavior)
  - Add keyboard shortcut for "Copy as Markdown"

4. **Future Enhancement: Paste Detection**
  - Detect markdown syntax on paste
  - Offer to convert markdown to rich text
  - Preserves round-trip capability

## Files Changed

- `packages/rexical/src/plugins/MarkdownCopyPlugin/index.tsx` - Plugin implementation
- `packages/rexical/src/Editor.tsx` - Added plugin to editor
- `packages/rexical/src/index.ts` - Exported plugin
- `packages/electron/e2e/markdown/markdown-copy.spec.ts` - E2E test
- `packages/rexical/src/markdown/EnhancedMarkdownExport.ts` - Enhanced markdown export with selection support

## Test Coverage

- ✅ E2E test verifies markdown in clipboard
- ✅ Test checks formatted content (headings, bold)
- ❌ No test for HTML format (currently not written)
- ❌ No test for Lexical format (currently not written)
- ❌ No test for pasting into different apps

## Related Issues

- Custom MIME types in browser clipboard API
- Lexical clipboard architecture
- Cross-application paste compatibility
