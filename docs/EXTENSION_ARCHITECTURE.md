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
}
```

This contract ensures that extensions integrate seamlessly with tabs, dirty indicators, file watching, and AI edit streaming regardless of the underlying editor technology.

## Extension Contract

Extensions receive `EditorHost` and must:
- Call `loadContent()` on mount (not expect content prop)
- Own all internal state
- Call `saveContent()` when save requested
- Handle `onFileChanged()` for external edits
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

## Related Documentation

- [FILE_TYPE_HANDLING.md](./FILE_TYPE_HANDLING.md) - How file types are associated with editors
- [EXTENSION_PANELS.md](./EXTENSION_PANELS.md) - Creating custom panels
- [EXTENSION_THEMING.md](./EXTENSION_THEMING.md) - Theming extensions
