# MarkdownCopyPlugin

A Lexical plugin that adds `text/markdown` MIME type to the clipboard when copying content. This allows other applications that support markdown (like Obsidian, Notion, etc.) to receive properly formatted markdown instead of just plain text or HTML.

## Features

- Adds `text/markdown` to clipboard alongside existing formats (text/plain, text/html, application/x-lexical-editor)
- Uses the enhanced markdown export system with node-level transformers
- Works without forking Lexical by intercepting COPY_COMMAND
- Respects selections - only exports selected content

## Usage

Add the plugin to your editor configuration:

```tsx
import { MarkdownCopyPlugin } from '@rexical/core';
import { getEditorTransformers } from '@rexical/core';

function MyEditor() {
  const transformers = getEditorTransformers();

  return (
    <LexicalComposer>
      {/* ... other plugins ... */}
      <MarkdownCopyPlugin transformers={transformers} />
    </LexicalComposer>
  );
}
```

## How It Works

1. Registers a COPY_COMMAND handler with COMMAND_PRIORITY_LOW
2. When copy occurs, gets the current selection
3. Converts selection to markdown using `$convertSelectionToEnhancedMarkdownString`
4. Adds the markdown to clipboardData with `setData('text/markdown', markdown)`
5. Returns false to allow other handlers to run (preserving default behavior)

## Implementation Details

The plugin extends the `EnhancedMarkdownExport` system to support selections:

- `$convertSelectionToEnhancedMarkdownString()` - New function for selection-based export
- Selection filtering is done via `node.isSelected(selection)` checks
- Only selected nodes are included in the markdown output
- Diff-removed nodes are excluded from export

## MIME Type

Uses the standard `text/markdown` MIME type, which is recognized by:
- Obsidian
- Notion
- VS Code
- Many other markdown-aware applications
