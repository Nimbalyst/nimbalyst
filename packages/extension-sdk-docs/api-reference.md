# API Reference

This document covers the TypeScript types and interfaces available in the Extension SDK.

## Extension Entry Point

Your extension's `index.ts` should export these items:

```typescript
// Required: Components referenced by manifest
export const components: Record<string, React.ComponentType<any>>;

// Optional: AI tools
export const aiTools: ExtensionAITool[];

// Optional: Lifecycle hooks
export function activate(context: ExtensionContext): void;
export function deactivate(): void;
```

## ExtensionContext

Passed to `activate()`:

```typescript
interface ExtensionContext {
  // Absolute path to the extension's installation directory
  extensionPath: string;
}
```

## Custom Editor Props

Props passed to custom editor components:

```typescript
interface CustomEditorProps {
  // Current file content as a string
  content: string;

  // Absolute path to the file
  filePath: string;

  // Call when content changes
  onChange: (newContent: string) => void;

  // Optional extension context
  context?: {
    extensionPath: string;
  };
}
```

### Usage

```tsx
function MyEditor({ content, filePath, onChange }: CustomEditorProps) {
  // Parse content into your data structure
  const [data, setData] = useState(() => parse(content));

  // Sync with content prop when file reloads
  useEffect(() => {
    setData(parse(content));
  }, [content]);

  // Notify Nimbalyst of changes
  const handleChange = (newData: MyData) => {
    setData(newData);
    onChange(serialize(newData));
  };

  return <div>...</div>;
}
```

## AI Tool Types

### ExtensionAITool

Definition for an AI tool:

```typescript
interface ExtensionAITool {
  // Unique name (use prefix.action format)
  name: string;

  // Description for Claude to understand when to use it
  description: string;

  // JSON Schema for input parameters
  inputSchema: {
    type: 'object';
    properties: Record<string, JsonSchemaProperty>;
    required?: string[];
  };

  // Handler function
  handler: (
    args: Record<string, unknown>,
    context: ToolContext
  ) => Promise<ToolResult>;
}
```

### JsonSchemaProperty

Property definition in input schema:

```typescript
interface JsonSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: string[];
  items?: JsonSchemaProperty;  // For arrays
  properties?: Record<string, JsonSchemaProperty>;  // For objects
}
```

### ToolContext

Context passed to tool handlers:

```typescript
interface ToolContext {
  // Path to the currently open file (may be undefined)
  filePath?: string;

  // Content of the currently open file (may be undefined)
  fileContent?: string;

  // Path to extension installation directory
  extensionPath: string;
}
```

### ToolResult

Return type for tool handlers:

```typescript
// Success result
interface ToolSuccessResult {
  // Any data to return to Claude
  [key: string]: unknown;

  // If present, updates the file content
  newContent?: string;
}

// Error result
interface ToolErrorResult {
  error: string;
}

type ToolResult = ToolSuccessResult | ToolErrorResult;
```

## Manifest Types

### ExtensionManifest

Full manifest schema:

```typescript
interface ExtensionManifest {
  // Required fields
  id: string;
  name: string;
  version: string;
  main: string;
  apiVersion: string;

  // Optional metadata
  description?: string;
  author?: string;
  license?: string;
  repository?: string;
  icon?: string;
  styles?: string;

  // Permissions
  permissions?: {
    filesystem?: boolean;
    ai?: boolean;
  };

  // Contributions
  contributions?: {
    customEditors?: CustomEditorContribution[];
    aiTools?: string[];
    newFileMenu?: NewFileMenuContribution[];
    fileIcons?: Record<string, string>;
    slashCommands?: SlashCommandContribution[];
  };
}
```

### CustomEditorContribution

```typescript
interface CustomEditorContribution {
  // Glob patterns for files (e.g., ["*.csv", "*.tsv"])
  filePatterns: string[];

  // Name shown in editor selector
  displayName: string;

  // Key in exported components object
  component: string;
}
```

### NewFileMenuContribution

```typescript
interface NewFileMenuContribution {
  // File extension with dot (e.g., ".csv")
  extension: string;

  // Name shown in menu
  displayName: string;

  // Material icon name
  icon: string;

  // Initial file content
  defaultContent: string;
}
```

### SlashCommandContribution

```typescript
interface SlashCommandContribution {
  // Command identifier
  name: string;

  // Shown in command palette
  displayName: string;

  // Help text
  description: string;

  // Name of exported handler function
  handler: string;
}
```

## Vite Configuration

### createExtensionConfig

Helper to create a vite config with correct externals:

```typescript
import { createExtensionConfig } from '@nimbalyst/extension-sdk/vite';

// Basic usage
export default defineConfig(createExtensionConfig());

// With custom config
export default defineConfig(createExtensionConfig({
  build: {
    sourcemap: true,
  },
}));
```

### REQUIRED_EXTERNALS

List of packages that must be externalized (provided by Nimbalyst):

```typescript
import { REQUIRED_EXTERNALS } from '@nimbalyst/extension-sdk';

// ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'lexical', ...]
```

## Validation

### validateExtensionBundle

Validate an extension bundle before installation:

```typescript
import { validateExtensionBundle } from '@nimbalyst/extension-sdk';

const result = await validateExtensionBundle('/path/to/extension');

if (result.valid) {
  console.log('Extension is valid');
} else {
  console.error('Validation errors:', result.errors);
}
```

Returns:

```typescript
interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  manifest?: ExtensionManifest;
}
```

## CSS Variables

Available CSS variables for theming:

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

Always use these variables instead of hardcoded colors for theme compatibility.
