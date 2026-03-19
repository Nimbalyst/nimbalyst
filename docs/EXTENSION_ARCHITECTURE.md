# Extension Architecture

**The extension system is the foundation for all future development.** Every editor type and file handler will ultimately be provided through extensions, creating a cohesive, pluggable lifecycle for all content types.

## What Extensions Provide

Extensions can contribute:
- **Custom Editors**: Full editor implementations for specific file types (Monaco for code, RevoGrid for CSV/spreadsheets, Excalidraw for diagrams, DataModelLM for visual data modeling, mockup editors, etc.)
- **File Type Handlers**: Associate file extensions with specific editors
- **AI Tools via MCP**: Expose functionality to AI agents through the Model Context Protocol
- **Custom UI Components**: Panels, widgets, and tool call renderers

## Current Editor Types

Nimbalyst supports diverse editor types beyond traditional text:
- **Lexical** (`.md`, `.txt`): Rich text markdown editing with tables, images, code blocks
- **Monaco** (`.ts`, `.js`, `.json`, etc.): Full VS Code-style code editing with syntax highlighting, intellisense
- **RevoGrid** (`.csv`): Spreadsheet-style editing with formulas, sorting, filtering
- **Excalidraw** (`.excalidraw`): Whiteboard-style diagrams and drawings
- **DataModelLM** (`.datamodel`): Visual Prisma schema editor
- **Mockup Editor** (`.mockup.html`): Visual HTML mockup creation

## EditorHost Contract

All editors (including built-in ones) communicate through the `EditorHost` interface, ensuring consistent lifecycle management:

```typescript
interface EditorHost {
  loadContent(): Promise<string>;      // Load file content on mount
  saveContent(content: string): void;  // Save when user saves
  setDirty(dirty: boolean): void;      // Track unsaved changes
  onFileChanged(callback): void;       // Handle external file changes
  onSaveRequested(callback): void;     // Subscribe to save events
  onThemeChanged(callback): void;      // Subscribe to theme changes
  onDiffRequested?(callback): void;    // AI edit diff mode
  onDiffCleared?(callback): void;      // Diff mode dismissed
}
```

This contract ensures that extensions integrate seamlessly with tabs, dirty indicators, file watching, and AI edit streaming regardless of the underlying editor technology.

## useEditorLifecycle Hook (Recommended)

The `useEditorLifecycle` hook replaces all manual `EditorHost` subscription boilerplate with a single hook call. **All new custom editors should use this hook.**

```typescript
import { useEditorLifecycle } from '@nimbalyst/runtime';
import type { EditorHostProps } from '@nimbalyst/extension-sdk';

function MyEditor({ host }: EditorHostProps) {
  const editorRef = useRef<MyEditorAPI>(null);

  const { isLoading, error, theme, markDirty, diffState } = useEditorLifecycle(host, {
    applyContent: (parsed) => editorRef.current?.load(parsed),
    getCurrentContent: () => editorRef.current?.getData() ?? defaultValue,
    parse: (raw) => JSON.parse(raw),
    serialize: (data) => JSON.stringify(data),
  });

  return isLoading ? <Loading /> : <MyEditorComponent ref={editorRef} onChange={markDirty} />;
}
```

The hook handles:
- **Loading**: Calls `host.loadContent()` on mount, provides `isLoading` and `error` state
- **Saving**: Subscribes to `host.onSaveRequested()`, pulls content via `getCurrentContent`, serializes, and saves
- **Echo detection**: Ignores file change notifications caused by our own saves
- **External file changes**: Calls `applyContent` when the file changes on disk (not from our save)
- **Theme**: Tracks theme changes reactively
- **Diff mode**: Parses AI edit diffs and provides `diffState` with `accept`/`reject` callbacks
- **Source mode**: Tracks source mode toggle state

Content state **never** lives in this hook or in React state. The hook interacts with the editor through pull/push callbacks:
- `applyContent`: push content INTO the editor (load, external change)
- `getCurrentContent`: pull content FROM the editor (save)

This design works for all editor architectures:
- **Library-managed** (Excalidraw, Three.js): callbacks talk to the library's imperative API via refs
- **Store-managed** (Mindmap, DatamodelLM): callbacks talk to a Zustand store
- **Read-only** (PDF, SQLite): only `applyContent`, no `getCurrentContent`

### Advanced: Custom Save and Diff Overrides

For editors with specialized needs (async content extraction, cell-level diff), the hook provides override options:

```typescript
useEditorLifecycle(host, {
  applyContent: (content) => { /* ... */ },
  onSave: async () => {
    // Custom save flow (e.g., async serialization from RevoGrid)
    const content = await gridOps.toCSV();
    await host.saveContent(content);
  },
  onDiffRequested: (config) => {
    // Custom diff rendering (e.g., cell-level CSV diff with phantom rows)
  },
  onDiffCleared: async () => {
    // Custom diff cleanup
  },
});
```

## Extension Contract

Extensions receive `EditorHost` and must:
- Use `useEditorLifecycle` hook (recommended) or manually subscribe to host events
- Own all internal state -- content NEVER in React state for complex editors
- Call `saveContent()` when save requested
- Handle external file changes (hook does this automatically)
- NEVER depend on parent re-rendering them

## AI Completion API

Extensions with `permissions.ai: true` can call AI chat/completion models directly. This is a stateless API -- no sessions are created in the session history.

### Available Methods

```typescript
// List models the user has enabled (Claude, OpenAI, LM Studio)
const models = await services.ai.listModels();
// => [{ id: "claude:claude-sonnet-4-6-...", name: "Claude Sonnet 4.6", provider: "claude" }, ...]

// Non-streaming completion
const result = await services.ai.chatCompletion({
  messages: [{ role: 'user', content: 'Summarize this text: ...' }],
  model: models[0].id,       // optional, uses provider default if omitted
  systemPrompt: 'Be concise', // optional, prepended as system message
  temperature: 0.7,           // optional
  maxTokens: 1024,            // optional
});
// => { content: "Here is a summary...", model: "claude-sonnet-4-6-...", usage: { inputTokens: 50, outputTokens: 30 } }

// Streaming completion
const handle = await services.ai.chatCompletionStream({
  messages: [{ role: 'user', content: 'Write a poem' }],
  onChunk: (chunk) => {
    if (chunk.type === 'text') appendToUI(chunk.content);
    if (chunk.type === 'error') showError(chunk.error);
    // chunk.type === 'done' signals completion
  },
});
// Abort if needed: handle.abort();
const finalResult = await handle.result;
```

### Key Points

- **Chat providers only**: Claude, OpenAI, and LM Studio. Agent providers (Claude Code, Codex) are not available through this API.
- **Model selection**: Pass a model `id` from `listModels()`, or omit to use the first available provider's default.
- **Multi-turn**: Pass multiple messages with alternating `user`/`assistant` roles for conversation context.
- **No sessions**: These completions are stateless and do not appear in session history. Use the existing `sendPrompt()` if you need session tracking.
- **Streaming abort**: The `ChatCompletionStreamHandle.abort()` method cancels the in-flight request.

### Types

All types are exported from `@nimbalyst/extension-sdk`:

| Type | Description |
|------|-------------|
| `ExtensionAIModel` | Model descriptor: `id`, `name`, `provider` |
| `ChatCompletionMessage` | Message: `role` (`user`/`assistant`/`system`), `content` |
| `ChatCompletionOptions` | Request: `messages`, `model?`, `maxTokens?`, `temperature?`, `systemPrompt?` |
| `ChatCompletionResult` | Response: `content`, `model`, `usage?` |
| `ChatCompletionStreamChunk` | Stream chunk: `type` (`text`/`error`/`done`), `content?`, `error?` |
| `ChatCompletionStreamOptions` | Extends options with `onChunk` callback |
| `ChatCompletionStreamHandle` | Stream control: `abort()`, `result` promise |

## Extension Development

When working on extensions in `packages/extensions/`:
- Use `mcp__nimbalyst-extension-dev__extension_reload` to rebuild and reload extensions
- Use `mcp__nimbalyst-extension-dev__extension_get_logs` to check for errors
- Use `mcp__nimbalyst-extension-dev__extension_get_status` to verify extension state
- **Never use manual `npm run build`** - always use the MCP tools for extension builds

## Marketplace Screenshots

Extensions can include screenshots for the in-app marketplace and marketing website. Add a `screenshots` array to the `marketplace` section of `manifest.json`:

```json
{
  "marketplace": {
    "screenshots": [
      {
        "alt": "Description of what the screenshot shows",
        "src": "screenshots/my-extension-dark.png",
        "srcLight": "screenshots/my-extension-light.png"
      }
    ]
  }
}
```

**Fields:**
- `src` (string) - Relative path to a dark-theme screenshot image bundled with the extension. If only one variant is provided, it is used for both themes.
- `srcLight` (string, optional) - Relative path to a light-theme screenshot. When provided, the in-app marketplace and website automatically show the correct variant based on the user's theme.
- `fileToOpen` (string) - Relative path to a sample file for the automated screenshot pipeline (internal extensions only).
- `selector` (string) - CSS selector to capture a specific element (used with `fileToOpen`).
- `alt` (string) - Alt text describing the screenshot.

External extension developers should place their screenshots in a `screenshots/` directory and reference them via `src` and optionally `srcLight`. The `fileToOpen` and `selector` fields are used by Nimbalyst's internal Playwright-based screenshot pipeline and can be ignored by external developers.

## Related Documentation

- [FILE_TYPE_HANDLING.md](./FILE_TYPE_HANDLING.md) - How file types are associated with editors
- [EXTENSION_PANELS.md](./EXTENSION_PANELS.md) - Creating custom panels
- [EXTENSION_THEMING.md](./EXTENSION_THEMING.md) - Theming extensions
