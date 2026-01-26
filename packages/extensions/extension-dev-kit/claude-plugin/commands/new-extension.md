---
description: Create a new Nimbalyst extension project from a template
allowed_tools:
  - Read
  - Write
  - Edit
  - Glob
  - Bash
---

# /new-extension Command

Scaffolds a new Nimbalyst extension project and creates a development plan for user review before implementation begins.

## Workflow

This command follows a **plan-first approach**:

1. **Scaffold** - Create base project files (manifest, package.json, configs)
2. **Plan** - Generate a README.md with development plan for review
3. **Wait** - User reviews plan, answers questions, approves approach
4. **Implement** - Only after approval, build the actual extension code

**IMPORTANT**: Do NOT immediately implement the full extension. Create the scaffold and plan first, then STOP and wait for user feedback.

## Usage

```
/new-extension <name> <path> [file-patterns]
```

### Arguments

- `<name>` - Human-readable name for the extension (e.g., "3D Model Viewer")
- `<path>` - Directory path where the extension should be created
- `[file-patterns]` - (Optional) Comma-separated file patterns (e.g., `*.obj,*.stl`)

### Examples

```
/new-extension "OBJ Viewer" ~/extensions/obj-viewer *.obj
/new-extension "Todo List Editor" ~/my-todo-extension *.todo
/new-extension "Code Metrics" ~/code-metrics
```

## Step 1: Create Project Scaffold

Create these base files only:

### manifest.json

```json
{
  "id": "com.nimbalyst.<extension-name>",
  "name": "<Extension Name>",
  "version": "0.1.0",
  "description": "<Brief description - will be refined in planning>",
  "main": "dist/index.js",
  "apiVersion": "1.0.0",
  "permissions": {},
  "contributions": {}
}
```

### package.json

```json
{
  "name": "<extension-id>",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "vite build"
  },
  "dependencies": {
    "react": "^18.2.0"
  },
  "devDependencies": {
    "@nimbalyst/extension-sdk": "*",
    "@types/react": "^18.2.0",
    "typescript": "^5.0.0",
    "vite": "^5.0.0"
  }
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

### vite.config.ts

```typescript
import { defineConfig } from 'vite';
import { createExtensionConfig } from '@nimbalyst/extension-sdk/vite';

export default defineConfig(createExtensionConfig({
  entry: './src/index.ts',
}));
```

### src/index.ts (minimal placeholder)

```typescript
// Extension entry point - implementation pending plan approval

export const components = {};

export function activate() {
  console.log('Extension activated');
}

export function deactivate() {
  console.log('Extension deactivated');
}
```

## Step 2: Create Development Plan (README.md)

After creating the scaffold, generate a comprehensive README.md that serves as the development plan. This is the most important output - it should help clarify requirements before any coding begins.

### README.md Template

```markdown
# <Extension Name>

> Development plan - please review and provide feedback before implementation begins.

## Overview

<Brief description of what this extension will do>

## Open Questions

Before building, I need clarification on:

1. **<Question about core functionality>**
   - Option A: ...
   - Option B: ...
   - Your preference?

2. **<Question about UI/UX>**
   - ...

3. **<Question about file format or data>**
   - ...

4. **<Question about edge cases>**
   - ...

## Proposed Features

### Core Features (v0.1.0)
- [ ] <Feature 1>
- [ ] <Feature 2>
- [ ] <Feature 3>

### Nice to Have (Future)
- [ ] <Future feature 1>
- [ ] <Future feature 2>

## Design Mockups

<If this is a visual extension, consider creating mockup files>

Would you like me to create a `.mockup.html` file to visualize the UI before building?

- [ ] Yes, create a mockup first
- [ ] No, proceed with implementation

## Technical Approach

### File Format
<Description of how files will be parsed/stored>

### Component Structure
<High-level description of React components>

### AI Tools (if applicable)
<What AI tools will be provided and what they'll do>

## Implementation Checklist

### Phase 1: Basic Structure
- [ ] Set up manifest.json with contributions
- [ ] Create main editor component
- [ ] Implement file parsing
- [ ] Implement file serialization
- [ ] Basic styling with theme variables

### Phase 2: Core Functionality
- [ ] <Specific feature implementation>
- [ ] <Another feature>
- [ ] Error handling

### Phase 3: Polish
- [ ] Keyboard shortcuts
- [ ] Undo/redo support
- [ ] Performance optimization for large files

### Phase 4: AI Integration (if needed)
- [ ] Define AI tools
- [ ] Implement tool handlers
- [ ] Test with Claude

## Next Steps

Please review this plan and:
1. Answer the open questions above
2. Confirm or modify the feature list
3. Let me know if you want mockups first
4. Say "approved" or "proceed" when ready to start implementation

---
*This plan was generated by the Extension Developer Kit. Edit as needed.*
```

## Step 3: STOP and Wait

After creating the scaffold and README.md:

1. **Tell the user** the project has been scaffolded
2. **Point them to README.md** to review the development plan
3. **Ask them to review** and provide feedback
4. **Do NOT start implementing** until they approve

Example response after scaffolding:

> I've created the extension scaffold at `<path>` with:
> - `manifest.json` - Extension metadata
> - `package.json` - Dependencies
> - `tsconfig.json` - TypeScript config
> - `vite.config.ts` - Build config
> - `src/index.ts` - Placeholder entry point
> - `README.md` - **Development plan for your review**
>
> Please open `README.md` and:
> 1. Review the proposed features
> 2. Answer the open questions
> 3. Let me know if you'd like mockups before implementation
> 4. Say "approved" when ready to proceed
>
> I'll wait for your feedback before writing any implementation code.

## Reference: Manifest Contributions

When updating the manifest during implementation, use these schemas:

### customEditors

```json
"customEditors": [
  {
    "filePatterns": ["*.ext"],
    "displayName": "My Editor",
    "component": "MyEditorComponent"
  }
]
```

### newFileMenu

```json
"newFileMenu": [
  {
    "extension": ".ext",
    "displayName": "My File Type",
    "icon": "description",
    "defaultContent": "# New file\n"
  }
]
```

**Required fields**: `extension`, `displayName`, `icon`, `defaultContent`
**Do NOT use `label`** - use `displayName` instead.

### fileIcons

```json
"fileIcons": {
  "*.ext": "icon_name"
}
```

### aiTools

```json
"aiTools": ["myext.tool_name", "myext.another_tool"]
```

## Reference: CSS Theme Variables

| Variable | Purpose |
| --- | --- |
| `--nim-bg` | Main background |
| `--nim-bg-secondary` | Toolbar/panel background |
| `--nim-bg-tertiary` | Nested element background |
| `--nim-bg-hover` | Hover state background |
| `--nim-text` | Main text color |
| `--nim-text-muted` | Muted text |
| `--nim-border` | Main borders |
| `--nim-primary` | Accent/brand color |

## Reference: EditorHost API

Custom editors receive an `EditorHost` object that handles all communication with Nimbalyst:

```typescript
import type { EditorHostProps } from '@nimbalyst/extension-sdk';

interface EditorHost {
  // File info (read-only)
  readonly filePath: string;      // Absolute path to file
  readonly fileName: string;      // File basename
  readonly theme: 'light' | 'dark' | 'crystal-dark';
  readonly isActive: boolean;     // Whether tab is focused
  readonly workspaceId?: string;  // Workspace path if applicable

  // Content loading - call on mount instead of receiving initialContent
  loadContent(): Promise<string>;
  loadBinaryContent(): Promise<ArrayBuffer>;  // For binary files

  // File change notifications - subscribe to external changes
  onFileChanged(callback: (newContent: string) => void): () => void;

  // Dirty state - call when editor has unsaved changes
  setDirty(isDirty: boolean): void;

  // Save - editor pushes content when save is requested
  saveContent(content: string | ArrayBuffer): Promise<void>;
  onSaveRequested(callback: () => void): () => void;

  // History
  openHistory(): void;

  // Optional: Diff mode for AI edits
  onDiffRequested?(callback: (config: DiffConfig) => void): () => void;
  reportDiffResult?(result: DiffResult): void;

  // Optional: Source mode toggle
  toggleSourceMode?(): void;
  onSourceModeChanged?(callback: (isSourceMode: boolean) => void): () => void;
  readonly supportsSourceMode?: boolean;
}
```

### Basic Pattern

```tsx
import type { EditorHostProps } from '@nimbalyst/extension-sdk';

export function MyEditor({ host }: EditorHostProps) {
  const [data, setData] = useState<MyData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const dataRef = useRef(data);

  useEffect(() => { dataRef.current = data; }, [data]);

  // Load content on mount
  useEffect(() => {
    host.loadContent().then(content => {
      setData(parse(content));
      setIsLoading(false);
    });
  }, [host]);

  // Handle save requests from host (autosave, Cmd+S)
  useEffect(() => {
    return host.onSaveRequested(async () => {
      if (dataRef.current) {
        const content = serialize(dataRef.current);
        await host.saveContent(content);
      }
    });
  }, [host]);

  // Handle external file changes
  useEffect(() => {
    return host.onFileChanged(newContent => {
      setData(parse(newContent));
    });
  }, [host]);

  const handleEdit = (newData: MyData) => {
    setData(newData);
    host.setDirty(true);  // Mark dirty - triggers autosave
  };

  if (isLoading) return <div>Loading...</div>;
  return <div>...</div>;
}
```

## Key Principles

1. **Plan first, code later** - Always create README.md plan before implementation
2. **Ask questions** - If requirements are unclear, add them to Open Questions
3. **Suggest mockups** - For visual extensions, offer to create mockup.html files
4. **Incremental approval** - Get buy-in on approach before writing complex code
5. **Feature scope** - Start with core features, list nice-to-haves separately
