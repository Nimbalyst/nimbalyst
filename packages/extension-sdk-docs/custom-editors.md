# Building Custom Editors

Custom editors are the most powerful extension type. They let you create entirely new ways to view and edit file types - from spreadsheets to diagrams to 3D models.

## How Custom Editors Work

When a user opens a file, Nimbalyst checks if any extension has registered a custom editor for that file type. If found, your React component is rendered instead of the default editor.

Your component receives a single `host` prop from Nimbalyst. The host handles loading, saving, dirty tracking, file change notifications, and optional features like diff mode.

## The useEditorLifecycle Hook

The recommended way to build custom editors is with the `useEditorLifecycle` hook. It replaces all manual `EditorHost` subscription boilerplate (loading, saving, echo detection, file watching, diff mode, theme) with a single hook call.

```tsx
import { useEditorLifecycle } from '@nimbalyst/extension-sdk';
import type { EditorHostProps } from '@nimbalyst/extension-sdk';

export function MyEditor({ host }: EditorHostProps) {
  const editorRef = useRef<MyEditorAPI>(null);

  const { isLoading, error, theme, markDirty, diffState } = useEditorLifecycle(host, {
    applyContent: (data) => editorRef.current?.load(data),
    getCurrentContent: () => editorRef.current?.getData() ?? defaultValue,
    parse: (raw) => JSON.parse(raw),
    serialize: (data) => JSON.stringify(data),
  });

  if (error) return <div>Failed to load: {error.message}</div>;
  if (isLoading) return <div>Loading...</div>;

  return <MyEditorComponent ref={editorRef} onChange={markDirty} theme={theme} />;
}
```

### How It Works

The hook interacts with your editor through pull/push callbacks -- content never lives in React state:

- **`applyContent(parsed)`**: Called to push content INTO the editor (on initial load, on external file change). Update your editor's internal state here.
- **`getCurrentContent()`**: Called to pull content FROM the editor (on save). Return the current state. Omit for read-only editors.
- **`parse(raw)`**: Convert raw file string into your editor's format. Omit if your editor works with raw strings.
- **`serialize(data)`**: Convert your editor's format back to a string for saving. Omit if already a string.

### What It Returns

| Field | Type | Description |
| --- | --- | --- |
| `isLoading` | `boolean` | `true` until initial content is loaded |
| `error` | `Error \| null` | Error from initial load |
| `theme` | `string` | Current theme name (reactive) |
| `markDirty` | `() => void` | Call when the user makes an edit |
| `isDirty` | `boolean` | Whether unsaved changes exist |
| `diffState` | `DiffState<T> \| null` | AI edit diff with `accept`/`reject` callbacks |
| `toggleSourceMode` | `(() => void) \| undefined` | Toggle to Monaco source view |
| `isSourceMode` | `boolean` | Whether source mode is active |

### Editor Architecture Patterns

The hook supports three common architectures:

**Library-managed** (Excalidraw, Three.js) -- callbacks talk to the library's imperative API via refs:
```tsx
const apiRef = useRef<ExcalidrawImperativeAPI>(null);
useEditorLifecycle(host, {
  applyContent: (elements) => apiRef.current?.updateScene({ elements }),
  getCurrentContent: () => apiRef.current?.getSceneElements() ?? [],
  parse: (raw) => JSON.parse(raw).elements,
  serialize: (elements) => JSON.stringify({ elements }),
});
```

**Store-managed** (Zustand, custom stores) -- callbacks talk to a store:
```tsx
const storeRef = useRef(createMyStore());
useEditorLifecycle(host, {
  applyContent: (doc) => storeRef.current.getState().loadDocument(doc),
  getCurrentContent: () => storeRef.current.getState().document,
  parse: parseDocument,
  serialize: serializeDocument,
});
```

**Read-only** (PDF viewer, SQLite browser) -- only `applyContent`, no save:
```tsx
const dataRef = useRef<ArrayBuffer | null>(null);
const [, forceRender] = useReducer((x) => x + 1, 0);
useEditorLifecycle(host, {
  applyContent: (data) => { dataRef.current = data; forceRender(); },
  binary: true,
});
```

### Additional Options

| Option | Type | Description |
| --- | --- | --- |
| `binary` | `boolean` | Use `loadBinaryContent()` instead of `loadContent()`. For PDFs, images, SQLite, etc. |
| `onLoaded` | `() => void` | Called after initial content is loaded and applied |
| `onExternalChange` | `(content: T) => void` | Called when an external file change is detected (not from our own save) |
| `onSave` | `() => Promise<void>` | Replace the default save flow. Use for async content extraction (e.g., RevoGrid) |
| `onDiffRequested` | `(config: DiffConfig) => void` | Replace default diff handling. Use for specialized diff rendering (e.g., cell-level CSV diff) |
| `onDiffCleared` | `() => Promise<void>` | Replace default diff cleanup. Paired with `onDiffRequested` |

### Echo Detection

The hook automatically ignores file change notifications caused by our own saves. This prevents the editor from reloading content immediately after saving -- a common source of bugs in manual implementations.

## EditorHost Interface

The `useEditorLifecycle` hook wraps this interface. You rarely need to use it directly, but it's useful to understand what's available:

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
  onThemeChanged(callback: (theme: string) => void): () => void;
  openHistory(): void;

  // Diff mode (AI edits)
  onDiffRequested?(callback: (config: DiffConfig) => void): () => void;
  reportDiffResult?(result: DiffResult): void;
  onDiffCleared?(callback: () => void): () => void;

  // Source mode (toggle to Monaco)
  toggleSourceMode?(): void;
  onSourceModeChanged?(callback: (isActive: boolean) => void): () => void;
  isSourceModeActive?(): boolean;
}
```

## Key Concepts

### Content Ownership

Nimbalyst editors use a **host-driven save model** where the editor owns its content state:

1. **Initial load**: The hook calls `host.loadContent()` and passes the result to your `applyContent` callback
2. **Dirty tracking**: Call `markDirty()` when the user makes changes
3. **Saving**: The hook subscribes to save events and calls your `getCurrentContent` to get the data
4. **External changes**: The hook detects external file changes, filters echoes, and calls `applyContent`

### Why Not Pass Content as a Prop?

The `EditorHost` model is more efficient for complex editors:
- Spreadsheets with thousands of cells do not need to serialize on every keystroke
- Diagram editors can maintain rich object graphs internally
- Binary editors can load and save `ArrayBuffer` data without pretending everything is text
- Imperative editor libraries (Excalidraw, RevoGrid, Three.js) cannot be re-rendered anyway

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

## Example: Simple Table Editor

A complete example using `useEditorLifecycle`:

```tsx
import React, { useRef } from 'react';
import { useEditorLifecycle } from '@nimbalyst/extension-sdk';
import type { EditorHostProps } from '@nimbalyst/extension-sdk';

export function TableEditor({ host }: EditorHostProps) {
  const dataRef = useRef<string[][]>([]);
  const tableRef = useRef<HTMLTableElement>(null);

  const parseCSV = (text: string): string[][] =>
    text.split('\n').map(row => row.split(',').map(cell => cell.trim()));

  const serializeCSV = (data: string[][]): string =>
    data.map(row => row.join(',')).join('\n');

  const { isLoading, error, theme, markDirty } = useEditorLifecycle(host, {
    applyContent: (data: string[][]) => {
      dataRef.current = data;
      renderTable();
    },
    getCurrentContent: () => dataRef.current,
    parse: parseCSV,
    serialize: serializeCSV,
  });

  function renderTable() {
    // Re-render table imperatively or use forceUpdate
  }

  if (error) return <div>Error: {error.message}</div>;
  if (isLoading) return <div>Loading...</div>;

  return (
    <div style={{ padding: '10px', overflow: 'auto', height: '100%' }}>
      <table ref={tableRef} style={{ borderCollapse: 'collapse', width: '100%' }}>
        <tbody>
          {dataRef.current.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, colIndex) => (
                <td key={colIndex} style={{ border: '1px solid var(--nim-border)' }}>
                  <input
                    defaultValue={cell}
                    onChange={e => {
                      dataRef.current[rowIndex][colIndex] = e.target.value;
                      markDirty();
                    }}
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

1. **Use `useEditorLifecycle`** - Handles loading, saving, echo detection, file watching, diff mode, and theme
2. **Keep content out of React state** - Use refs or external stores for editor data
3. **Use CSS variables** - Your editor should respect the user's theme
4. **Handle empty content** - The file might be new or empty
5. **Call `markDirty()`** - Not `host.setDirty()` directly -- the hook tracks dirty state for you
6. **Test with large files** - Ensure your editor performs well

## Next Steps

- Add [ai-tools.md](./ai-tools.md) so Claude can interact with your editor
- See [manifest-reference.md](./manifest-reference.md) for all configuration options
- Check [examples/custom-editor](./examples/custom-editor/) for a complete working example
