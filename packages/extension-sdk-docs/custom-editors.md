# Building Custom Editors

Custom editors are the most powerful extension type. They let you create entirely new ways to view and edit file types - from spreadsheets to diagrams to 3D models.

## How Custom Editors Work

When a user opens a file, Nimbalyst checks if any extension has registered a custom editor for that file type. If found, your React component is rendered instead of the default editor.

Your component receives props from Nimbalyst including the file content, path, theme, and callbacks for managing dirty state and content retrieval.

## Editor Component Interface

```typescript
interface CustomEditorProps {
  /** Absolute path to the file being edited */
  filePath: string;

  /** File name (basename) */
  fileName: string;

  /** Initial file content (may be empty for binary files) */
  initialContent: string;

  /** Current theme: 'light' | 'dark' | 'crystal-dark' */
  theme: 'light' | 'dark' | 'crystal-dark';

  /** Whether this editor tab is currently active/focused */
  isActive: boolean;

  /** Workspace path (if in a workspace) */
  workspaceId?: string;

  /**
   * Called when the editor content changes.
   * This triggers dirty state tracking and autosave.
   */
  onContentChange?: () => void;

  /**
   * Called to update the dirty state.
   * @param isDirty - Whether the editor has unsaved changes
   */
  onDirtyChange?: (isDirty: boolean) => void;

  /**
   * Register a function that returns the current editor content.
   * This is called by the host when saving.
   *
   * IMPORTANT: For read-only editors (like PDF viewer), do NOT call this.
   * Calling it with a function that returns '' will cause file corruption.
   */
  onGetContentReady?: (getContentFn: () => string) => void;

  /** Called when user requests to view file history */
  onViewHistory?: () => void;

  /** Called when user requests to rename the document */
  onRenameDocument?: () => void;
}
```

## Basic Editor Structure

```tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { CustomEditorProps } from '@nimbalyst/extension-sdk';

export function MyEditor({
  initialContent,
  filePath,
  fileName,
  theme,
  isActive,
  onContentChange,
  onDirtyChange,
  onGetContentReady,
}: CustomEditorProps) {
  // Parse the file content into your internal data structure
  const [data, setData] = useState(() => parseContent(initialContent));
  const dataRef = useRef(data);

  // Keep ref in sync for the getContent callback
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  // Register the content getter for saving
  useEffect(() => {
    if (onGetContentReady) {
      onGetContentReady(() => serializeContent(dataRef.current));
    }
  }, [onGetContentReady]);

  // Re-parse when file is reloaded from disk
  useEffect(() => {
    setData(parseContent(initialContent));
  }, [initialContent]);

  // Handle user edits
  const handleEdit = useCallback((newData: MyDataType) => {
    setData(newData);
    onDirtyChange?.(true);    // Mark as dirty
    onContentChange?.();      // Trigger autosave timer
  }, [onDirtyChange, onContentChange]);

  return (
    <div className="my-editor" data-theme={theme}>
      {/* Your editor UI */}
    </div>
  );
}

function parseContent(content: string): MyDataType {
  // Parse file content into your data structure
}

function serializeContent(data: MyDataType): string {
  // Convert data structure back to file content
}
```

## Key Concepts

### Content Management

Unlike simpler editor patterns, Nimbalyst uses a **pull-based** content model:

1. **Initial content**: You receive `initialContent` once when the editor mounts
2. **Dirty tracking**: Call `onDirtyChange(true)` when the user makes changes
3. **Content retrieval**: Register a getter via `onGetContentReady` that returns current content
4. **Saving**: When the user saves, Nimbalyst calls your getter to retrieve the content

This pattern allows editors to maintain complex internal state without constantly serializing to a string.

### Why not just `onChange(content)`?

The pull-based model is more efficient for complex editors:
- Spreadsheets with thousands of cells don't serialize on every keystroke
- Diagram editors can maintain rich object graphs internally
- Binary format editors only serialize when actually saving

## Registering the Editor

In your `manifest.json`:

```json
{
  "contributions": {
    "customEditors": [
      {
        "filePatterns": ["*.mytype", "*.myt"],
        "displayName": "My Type Editor",
        "component": "MyEditor"
      }
    ]
  }
}
```

And export it from your entry point:

```typescript
// src/index.ts
import { MyEditor } from './MyEditor';

export const components = {
  MyEditor,
};
```

## Styling Your Editor

### Using CSS Variables

Nimbalyst provides CSS variables for theming. Always use these instead of hardcoded colors:

```css
.my-editor {
  background: var(--nim-bg);
  color: var(--nim-text);
  border: 1px solid var(--nim-border);
}

.my-editor-toolbar {
  background: var(--nim-bg-secondary);
  border-bottom: 1px solid var(--nim-border);
}

.my-editor-button:hover {
  background: var(--nim-bg-hover);
}
```

### Available CSS Variables

| Variable | Purpose |
| --- | --- |
| `--nim-bg` | Main background |
| `--nim-bg-secondary` | Toolbar/panel background |
| `--nim-bg-tertiary` | Nested element background |
| `--nim-bg-hover` | Hover state background |
| `--nim-text` | Main text color |
| `--nim-text-muted` | Muted text |
| `--nim-text-faint` | Very muted text |
| `--nim-border` | Main borders |
| `--nim-primary` | Accent/brand color |

### Including Styles

Create a `styles.css` file and reference it in your manifest:

```json
{
  "styles": "dist/styles.css"
}
```

Import it in your entry point:

```typescript
// src/index.ts
import './styles.css';
```

## Handling Large Files

For large files, consider:

### Virtualization

Only render visible rows/items:

```tsx
import { useVirtualizer } from '@tanstack/react-virtual';

function LargeListEditor({ items }) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 35,
  });

  return (
    <div ref={parentRef} style={{ height: '100%', overflow: 'auto' }}>
      <div style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map(virtualRow => (
          <div
            key={virtualRow.key}
            style={{
              position: 'absolute',
              top: virtualRow.start,
              height: virtualRow.size,
            }}
          >
            {items[virtualRow.index]}
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Lazy Parsing

Parse content incrementally:

```typescript
function parseContentLazy(content: string) {
  // Return a lightweight wrapper that parses on demand
  return {
    getRow(index: number) {
      // Parse just this row when needed
    },
    get length() {
      // Count rows without full parse
    }
  };
}
```

## Undo/Redo Support

Nimbalyst doesn't provide built-in undo for custom editors. Implement your own:

```tsx
import { useState, useCallback } from 'react';

function useUndoRedo<T>(initialState: T) {
  const [history, setHistory] = useState<T[]>([initialState]);
  const [index, setIndex] = useState(0);

  const state = history[index];

  const setState = useCallback((newState: T) => {
    const newHistory = history.slice(0, index + 1);
    newHistory.push(newState);
    setHistory(newHistory);
    setIndex(newHistory.length - 1);
  }, [history, index]);

  const undo = useCallback(() => {
    if (index > 0) setIndex(index - 1);
  }, [index]);

  const redo = useCallback(() => {
    if (index < history.length - 1) setIndex(index + 1);
  }, [index, history.length]);

  const canUndo = index > 0;
  const canRedo = index < history.length - 1;

  return { state, setState, undo, redo, canUndo, canRedo };
}
```

## Keyboard Shortcuts

Handle keyboard shortcuts in your editor:

```tsx
function MyEditor({ content, onChange }) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + Z for undo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      // Cmd/Ctrl + Shift + Z for redo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  // ...
}
```

## Example: CSV Editor

A complete example of a CSV editor:

```tsx
import React, { useState, useEffect, useMemo } from 'react';

interface CSVEditorProps {
  content: string;
  filePath: string;
  onChange: (content: string) => void;
}

export function CSVEditor({ content, onChange }: CSVEditorProps) {
  // Parse CSV into 2D array
  const parseCSV = (text: string): string[][] => {
    return text.split('\n').map(row =>
      row.split(',').map(cell => cell.trim())
    );
  };

  const serializeCSV = (data: string[][]): string => {
    return data.map(row => row.join(',')).join('\n');
  };

  const [data, setData] = useState(() => parseCSV(content));

  useEffect(() => {
    setData(parseCSV(content));
  }, [content]);

  const handleCellChange = (row: number, col: number, value: string) => {
    const newData = data.map((r, i) =>
      i === row ? r.map((c, j) => j === col ? value : c) : r
    );
    setData(newData);
    onChange(serializeCSV(newData));
  };

  return (
    <div style={{ padding: '10px', overflow: 'auto', height: '100%' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <tbody>
          {data.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, colIndex) => (
                <td key={colIndex} style={{ border: '1px solid var(--nim-border)' }}>
                  <input
                    value={cell}
                    onChange={e => handleCellChange(rowIndex, colIndex, e.target.value)}
                    style={{
                      width: '100%',
                      padding: '4px',
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--nim-text)'
                    }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

## Best Practices

1. **Always sync with content prop** - The file may be reloaded from disk
2. **Use CSS variables** - Your editor should respect the user's theme
3. **Handle empty content** - The file might be new or empty
4. **Debounce onChange** - Don't call it on every keystroke for large files
5. **Clean up effects** - Remove event listeners in cleanup functions
6. **Test with large files** - Ensure your editor performs well

## Next Steps

- Add [ai-tools.md](./ai-tools.md) so Claude can interact with your editor
- See [manifest-reference.md](./manifest-reference.md) for all configuration options
- Check [examples/custom-editor](./examples/custom-editor/) for a complete working example
