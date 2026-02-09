---
planStatus:
  planId: plan-ai-session-html-export
  title: "Phase 1: AI Session HTML Export"
  status: draft
  planType: feature
  priority: medium
  owner: ghinkle
  stakeholders: []
  tags: [ai-sessions, export, sharing]
  created: "2026-02-06"
  updated: "2026-02-06T00:00:00.000Z"
  progress: 0
---

# Phase 1: AI Session HTML Export

## Goal

Export an AI session as a single self-contained HTML file that non-technical teammates can open in any browser to view the full conversation transcript. Primary use case: teammates send sessions to developers for debugging.

## Design Decisions

### What gets exported

- Full conversation transcript: user messages, assistant messages, tool calls
- Tool call results shown in collapsible `<details>` blocks (collapsed by default)
- Code blocks with syntax highlighting (bundled highlight.js or Prism, or pre-highlighted spans)
- File edit diffs rendered as simple colored diffs (green/red lines)
- Session metadata header: title, provider/model, date range, message count
- Timestamps on each message

### What gets excluded

- Streaming status messages, hidden messages
- Interactive widgets (permission prompts, plan approval) - show as static text instead
- Image attachments (reference them by filename, don't embed base64 to keep file size down)
- Custom tool widget rendering - just show tool name + result text

### Privacy / cleanup

- Replace absolute paths with relative: `/Users/ghinkle/sources/project/src/foo.ts` becomes `src/foo.ts` (strip up to and including the workspace root)
- Small banner at the top: "This session export may contain sensitive code and credentials. Share with care."
- No scrubbing of content itself - user's responsibility for phase 1

### Styling

- Self-contained: all CSS inlined in `<style>` block, no external dependencies
- Dark theme by default (matches typical Nimbalyst usage), with a light theme toggle via CSS class swap
- Clean, readable layout - max-width container, distinct user/assistant message styling
- Nimbalyst branding: small "Exported from Nimbalyst" footer with link
- Responsive - works on mobile browsers too

## Architecture

### Where the export runs

The export runs **in the main process** as an IPC handler. This is the right choice because:
- Needs access to the database to load full session + messages
- Needs file system access to write the HTML file (via save dialog)
- The renderer just triggers it and receives status

### Flow

```
User clicks "Export HTML" in session context menu
  -> renderer sends IPC: export-session-html { sessionId }
  -> main process:
       1. Load session + messages from PGLite
       2. Transform messages (same as transformAgentMessagesToUI)
       3. Render to HTML string using a template
       4. Show native save dialog (default filename: session title + date)
       5. Write file
  -> renderer gets success/failure result
```

### Key components

1. **`SessionHtmlExporter.ts`** (new file, main process)
   - `exportSessionToHtml(sessionId: string): Promise<string>` - returns HTML string
   - Takes session data + messages, renders them into an HTML template
   - Handles path stripping, message formatting, code highlighting
   - Template is a tagged template literal (no external template engine needed)

2. **IPC handler** in existing session handlers
   - `export-session-html` - loads data, calls exporter, shows save dialog, writes file

3. **UI entry point** - context menu item on `SessionListItem.tsx`
   - "Export as HTML..." menu item
   - Also accessible from session header actions

### HTML template structure

```html
<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="utf-8">
  <title>{session title} - Nimbalyst Export</title>
  <style>
    /* All CSS inlined here */
    /* Dark/light theme variables */
    /* Message layout, code blocks, diff styling */
    /* Collapsible tool cards */
    /* Responsive breakpoints */
  </style>
</head>
<body>
  <header>
    <div class="privacy-banner">
      This session export may contain sensitive code and credentials.
      Share with care.
    </div>
    <h1>{session title}</h1>
    <div class="session-meta">
      Provider: {provider} | Model: {model} |
      {message count} messages | {date range}
    </div>
    <button onclick="toggleTheme()">Toggle light/dark</button>
  </header>

  <main class="transcript">
    <!-- For each message: -->
    <div class="message user|assistant">
      <div class="message-avatar">{U|A}</div>
      <div class="message-body">
        <div class="message-meta">{timestamp}</div>
        <div class="message-content">
          <!-- Rendered markdown as HTML -->
        </div>
        <!-- If tool calls: -->
        <details class="tool-card">
          <summary>{tool name} - {file path if applicable}</summary>
          <div class="tool-result">
            <!-- Tool result content, code diffs, etc. -->
          </div>
        </details>
      </div>
    </div>
  </main>

  <footer>
    Exported from <a href="https://nimbalyst.com">Nimbalyst</a>
    on {export date}
  </footer>

  <script>
    function toggleTheme() {
      document.documentElement.classList.toggle('dark');
      document.documentElement.classList.toggle('light');
    }
  </script>
</body>
</html>
```

### Markdown rendering in export

Rather than bundling a markdown parser in the HTML output, render markdown to HTML **at export time** in the main process:
- Use `marked` (already a dependency) to convert markdown content to HTML
- Use `highlight.js` for code block syntax highlighting at render time
- The exported HTML contains pre-rendered HTML, no JS-based markdown parsing needed
- This keeps the exported file lightweight (no runtime JS dependencies)

### Path stripping

```typescript
function stripAbsolutePaths(content: string, workspacePath: string): string {
  // Replace workspace path prefix with empty string
  // Handle both forward and backslash separators
  const normalized = workspacePath.replace(/\\/g, '/');
  return content.replaceAll(normalized + '/', '')
                .replaceAll(normalized, '');
}
```

Applied to: message content, tool call arguments, tool results.

## Implementation Steps

### Step 1: Create SessionHtmlExporter

- New file: `packages/electron/src/main/services/SessionHtmlExporter.ts`
- Function to convert SessionData + messages to HTML string
- HTML/CSS template with dark/light theme support
- Markdown-to-HTML rendering using `marked`
- Syntax highlighting for code blocks
- Tool call rendering as collapsible `<details>` elements
- Path stripping utility
- Diff rendering (simple colored lines)

### Step 2: Add IPC handler

- Add `export-session-html` handler to session-related IPC handlers
- Load session + messages from database
- Transform messages using existing `transformAgentMessagesToUI`
- Call exporter to generate HTML
- Show native save dialog via `dialog.showSaveDialog`
- Write the HTML file

### Step 3: Add UI entry points

- Add "Export as HTML..." item to `SessionListItem.tsx` context menu
- Add export button to `AgentSessionHeader.tsx` (session header actions)
- Wire up IPC call with loading state
- Show success/error notification

### Step 4: Testing

- Unit test the exporter with sample session data
- Verify exported HTML renders correctly in Chrome/Safari/Firefox
- Test with large sessions (100+ messages)
- Test with code-heavy sessions (lots of diffs and tool calls)
- Test path stripping with various workspace paths

## Future phases (out of scope)

- **Phase 2**: Upload to Cloudflare R2 for shareable links
- **Phase 3**: Redaction UI - let user remove specific messages before export
- **Phase 4**: Export as markdown or JSON formats
- **Phase 5**: Content scrubbing (detect and warn about API keys/tokens)

## Open questions

- Should we add syntax highlighting via bundled highlight.js CSS themes, or render code with inline styles for maximum compatibility? (Inline styles = larger file but works everywhere including email)
- Should sub-agent/teammate tool hierarchies be shown nested, or flattened?
- Worth adding a "copy to clipboard" option in addition to save-to-file? (For quick paste into Slack/email)
