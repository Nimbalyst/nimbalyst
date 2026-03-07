# Building Custom Editors

Custom editors are the most powerful extension type. They let you create entirely new ways to view and edit file types - from spreadsheets to diagrams to 3D models.

## How Custom Editors Work

When a user opens a file, Nimbalyst checks if any extension has registered a custom editor for that file type. If found, your React component is rendered instead of the default editor.

Your component receives a single `host` prop from Nimbalyst. The host handles loading, saving, dirty tracking, file change notifications, and optional features like diff mode.

## Editor Component Interface

```typescript
interface EditorHostProps {
  host: EditorHost;
}

interface EditorHost {
  readonly filePath: string;
  readonly fileName: string;
  readonly theme: string;
  readonly isActive: boolean;
  readonly workspaceId?: string;

  loadContent(): Promise<string>;
  loadBinaryContent(): Promise<ArrayBuffer>;
  onFileChanged(callback: (newContent: string) => void): () => void;
  setDirty(isDirty: boolean): void;
  saveContent(content: string | ArrayBuffer): Promise<void>;
  onSaveRequested(callback: () => void): () => void;
  openHistory(): void;
}
```

## Basic Editor Structure

```tsx
import React, { useState, useEffect } from 'react';
import type { EditorHostProps } from '@nimbalyst/extension-sdk';

export function MyEditor({ host }: EditorHostProps) {
  const [content, setContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    host.loadContent().then((initialContent) => {
      if (!mounted) return;
      setContent(initialContent);
      setIsLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, [host]);

  useEffect(() => {
    return host.onSaveRequested(async () => {
      await host.saveContent(content);
      host.setDirty(false);
    });
  }, [host, content]);

  useEffect(() => {
    return host.onFileChanged((newContent) => {
      setContent(newContent);
      host.setDirty(false);
    });
  }, [host]);

  const handleEdit = (nextContent: string) => {
    setContent(nextContent);
    host.setDirty(true);
  };

  if (isLoading) {
    return <div className="my-editor">Loading...</div>;
  }

  return <div className="my-editor">{/* Your editor UI */}</div>;
}
```

## Key Concepts

### Content Management

Nimbalyst uses a **host-driven save model**:

1. **Initial load**: Call `host.loadContent()` when the editor mounts
2. **Dirty tracking**: Call `host.setDirty(true)` when the user makes changes
3. **Saving**: Subscribe with `host.onSaveRequested()` and push the current content via `host.saveContent()`
4. **External reloads**: Subscribe with `host.onFileChanged()` to react to disk changes

This lets complex editors own their in-memory state while still integrating cleanly with tabs, autosave, file watching, and AI edits.

### Why not just pass `content` as a prop?

The `EditorHost` model is more efficient for complex editors:
- Spreadsheets with thousands of cells do not need to serialize on every keystroke
- Diagram editors can maintain rich object graphs internally
- Binary editors can load and save `ArrayBuffer` data without pretending everything is text

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
  "styles": "dist/index.css"
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
