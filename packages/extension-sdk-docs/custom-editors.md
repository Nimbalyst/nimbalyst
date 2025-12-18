# Building Custom Editors

Custom editors are the most powerful extension type. They let you create entirely new ways to view and edit file types - from spreadsheets to diagrams to 3D models.

## How Custom Editors Work

When a user opens a file, Nimbalyst checks if any extension has registered a custom editor for that file type. If found, your React component is rendered instead of the default editor.

Your component receives:
- `content` - The file's current content as a string
- `filePath` - Absolute path to the file
- `onChange` - Callback to notify Nimbalyst when content changes

## Editor Component Interface

```typescript
interface CustomEditorProps {
  // The file content as a string
  content: string;

  // Absolute path to the file being edited
  filePath: string;

  // Call this when the user makes changes
  // Nimbalyst will mark the file as dirty and handle saving
  onChange: (newContent: string) => void;

  // Optional: Extension context with path info
  context?: {
    extensionPath: string;
  };
}
```

## Basic Editor Structure

```tsx
import React, { useState, useEffect } from 'react';

interface MyEditorProps {
  content: string;
  filePath: string;
  onChange: (content: string) => void;
}

export function MyEditor({ content, filePath, onChange }: MyEditorProps) {
  // Parse the file content into your internal data structure
  const [data, setData] = useState(() => parseContent(content));

  // Re-parse when file is reloaded from disk
  useEffect(() => {
    setData(parseContent(content));
  }, [content]);

  // Handle user edits
  const handleEdit = (newData: MyDataType) => {
    setData(newData);
    onChange(serializeContent(newData)); // Convert back to string
  };

  return (
    <div className="my-editor">
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
  background: var(--surface-primary);
  color: var(--text-primary);
  border: 1px solid var(--border-primary);
}

.my-editor-toolbar {
  background: var(--surface-secondary);
  border-bottom: 1px solid var(--border-primary);
}

.my-editor-button:hover {
  background: var(--surface-hover);
}
```

### Available CSS Variables

| Variable | Purpose |
| --- | --- |
| `--surface-primary` | Main background |
| `--surface-secondary` | Toolbar/panel background |
| `--surface-tertiary` | Nested element background |
| `--surface-hover` | Hover state background |
| `--text-primary` | Main text color |
| `--text-secondary` | Muted text |
| `--text-tertiary` | Very muted text |
| `--border-primary` | Main borders |
| `--primary-color` | Accent/brand color |

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
                <td key={colIndex} style={{ border: '1px solid var(--border-primary)' }}>
                  <input
                    value={cell}
                    onChange={e => handleCellChange(rowIndex, colIndex, e.target.value)}
                    style={{
                      width: '100%',
                      padding: '4px',
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--text-primary)'
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
