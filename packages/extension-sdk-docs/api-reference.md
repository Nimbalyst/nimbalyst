# API Reference

This document summarizes the main TypeScript exports from `@nimbalyst/extension-sdk`.

## Main Imports

```ts
import type {
  ExtensionContext,
  ExtensionManifest,
  ExtensionModule,
  EditorHostProps,
  ExtensionAITool,
  AIToolContext,
  ExtensionToolResult,
  PanelHostProps,
  SettingsPanelProps,
} from '@nimbalyst/extension-sdk';

import { REQUIRED_EXTERNALS, validateExtensionBundle } from '@nimbalyst/extension-sdk';
import { createExtensionConfig } from '@nimbalyst/extension-sdk/vite';
```

## Extension Entry Point

Your extension module can export any subset of these fields:

```ts
interface ExtensionModule {
  activate?: (context: ExtensionContext) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;

  components?: Record<string, React.ComponentType<EditorHostProps>>;
  aiTools?: ExtensionAITool[];
  slashCommandHandlers?: Record<string, () => void>;

  nodes?: Record<string, unknown>;
  transformers?: Record<string, unknown>;
  hostComponents?: Record<string, React.ComponentType>;

  panels?: Record<string, PanelExport>;
  settingsPanel?: Record<string, React.ComponentType<SettingsPanelProps>>;
}
```

## `ExtensionContext`

Passed to `activate()` and available inside `AIToolContext.extensionContext`.

```ts
interface ExtensionContext {
  manifest: ExtensionManifest;
  extensionPath: string;
  services: ExtensionServices;
  subscriptions: Disposable[];
}
```

### `ExtensionServices`

```ts
interface ExtensionServices {
  filesystem: ExtensionFileSystemService;
  ui: ExtensionUIService;
  ai?: ExtensionAIService;
  configuration?: ExtensionConfigurationService;
}
```

```ts
interface ExtensionFileSystemService {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  fileExists(path: string): Promise<boolean>;
  findFiles(pattern: string): Promise<string[]>;
}

interface ExtensionUIService {
  showInfo(message: string): void;
  showWarning(message: string): void;
  showError(message: string): void;
}

interface ExtensionConfigurationService {
  get<T>(key: string, defaultValue?: T): T;
  update(key: string, value: unknown, scope?: 'user' | 'workspace'): Promise<void>;
  getAll(): Record<string, unknown>;
}
```

### `ExtensionAIService`

Available when `permissions.ai` is `true`. Provides AI tool registration and direct access to chat/completion models.

```ts
interface ExtensionAIService {
  // Register AI tools that Claude can call
  registerTool(tool: ExtensionAITool): Disposable;
  registerContextProvider(provider: ExtensionContextProvider): Disposable;

  // Session-backed prompt (creates a session in history)
  sendPrompt(options: {
    prompt: string;
    sessionName?: string;
    provider?: 'claude-code' | 'claude' | 'openai';
    model?: string;
  }): Promise<{ sessionId: string; response: string }>;

  // List available chat models (Claude, OpenAI, LM Studio)
  listModels(): Promise<ExtensionAIModel[]>;

  // Stateless chat completion (no session created)
  chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult>;

  // Streaming chat completion (no session created)
  chatCompletionStream(options: ChatCompletionStreamOptions): Promise<ChatCompletionStreamHandle>;
}
```

### Chat Completion Types

```ts
interface ExtensionAIModel {
  id: string;        // e.g. "claude:claude-sonnet-4-6-20250514"
  name: string;      // e.g. "Claude Sonnet 4.6"
  provider: string;  // "claude" | "openai" | "lmstudio"
}

interface ChatCompletionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ChatCompletionOptions {
  messages: ChatCompletionMessage[];
  model?: string;           // Model ID from listModels(). Provider default if omitted.
  maxTokens?: number;
  temperature?: number;     // 0-1
  systemPrompt?: string;    // Prepended as system message
  responseFormat?: ResponseFormat; // Constrain output format (JSON, JSON schema)
}

type ResponseFormat =
  | { type: 'text' }                                          // Default: plain text
  | { type: 'json_object' }                                   // Valid JSON output
  | { type: 'json_schema';                                    // JSON matching a schema
      schema: JSONSchema;
      name?: string;     // Optional schema name (default: 'response')
      strict?: boolean;  // default: true for OpenAI
    };

interface ChatCompletionResult {
  content: string;          // Assistant response
  model: string;            // Model that was used
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

interface ChatCompletionStreamChunk {
  type: 'text' | 'error' | 'done';
  content?: string;         // Text delta (when type is 'text')
  error?: string;           // Error message (when type is 'error')
}

interface ChatCompletionStreamOptions extends ChatCompletionOptions {
  onChunk: (chunk: ChatCompletionStreamChunk) => void;
}

interface ChatCompletionStreamHandle {
  abort(): void;                        // Cancel the stream
  result: Promise<ChatCompletionResult>; // Resolves on completion
}
```

## Custom Editors

Custom editors receive a single `host` prop. Use the `useEditorLifecycle` hook (from `@nimbalyst/extension-sdk`) to handle all lifecycle concerns.

### useEditorLifecycle Hook

```ts
import { useEditorLifecycle } from '@nimbalyst/extension-sdk';

function useEditorLifecycle<T = string>(
  host: EditorHost,
  options: UseEditorLifecycleOptions<T>
): UseEditorLifecycleResult<T>;
```

```ts
interface UseEditorLifecycleOptions<T> {
  applyContent: (content: T) => void;       // Push content into the editor
  getCurrentContent?: () => T;               // Pull content from the editor (omit for read-only)
  parse?: (raw: string) => T;                // Parse raw file string into editor format
  serialize?: (content: T) => string;        // Serialize editor format to string
  binary?: boolean;                          // Use loadBinaryContent() for binary files
  onLoaded?: () => void;                     // Called after initial load
  onExternalChange?: (content: T) => void;   // Called on external file changes (not echoes)
  onSave?: () => Promise<void>;              // Custom save flow (replaces default)
  onDiffRequested?: (config: DiffConfig) => void;  // Custom diff handling
  onDiffCleared?: () => Promise<void>;       // Custom diff cleanup
}

interface UseEditorLifecycleResult<T> {
  isLoading: boolean;                        // True until initial content loads
  error: Error | null;                       // Load error
  theme: string;                             // Current theme (reactive)
  markDirty: () => void;                     // Call on user edit
  isDirty: boolean;                          // Unsaved changes exist
  diffState: DiffState<T> | null;            // AI edit diff (null when inactive)
  toggleSourceMode: (() => void) | undefined;
  isSourceMode: boolean;
}

interface DiffState<T> {
  original: T;                               // Content before AI edit
  modified: T;                               // Content after AI edit
  tagId: string;                             // History tag ID
  sessionId: string;                         // AI session that made the edit
  accept: () => void;                        // Accept changes
  reject: () => void;                        // Revert to original
}
```

### EditorHost Interface

The `useEditorLifecycle` hook wraps this interface. You rarely need to use it directly.

```ts
interface EditorHostProps {
  host: EditorHost;
}
```

```ts
interface EditorHost {
  readonly filePath: string;
  readonly fileName: string;
  readonly theme: string;
  readonly isActive: boolean;
  readonly workspaceId?: string;
  readonly supportsSourceMode?: boolean;
  readonly storage: ExtensionStorage;

  onThemeChanged(callback: (theme: string) => void): () => void;

  loadContent(): Promise<string>;
  loadBinaryContent(): Promise<ArrayBuffer>;
  onFileChanged(callback: (newContent: string) => void): () => void;

  setDirty(isDirty: boolean): void;
  saveContent(content: string | ArrayBuffer): Promise<void>;
  onSaveRequested(callback: () => void): () => void;

  openHistory(): void;

  onDiffRequested?(callback: (config: DiffConfig) => void): () => void;
  reportDiffResult?(result: DiffResult): void;
  isDiffModeActive?(): boolean;
  onDiffCleared?(callback: () => void): () => void;

  toggleSourceMode?(): void;
  onSourceModeChanged?(callback: (isSourceMode: boolean) => void): () => void;
  isSourceModeActive?(): boolean;

  getConfig?<T>(key: string, defaultValue?: T): T;
  registerMenuItems(items: EditorMenuItem[]): void;
}
```

Supporting editor types:

```ts
interface EditorMenuItem {
  label: string;
  icon?: string;
  onClick: () => void;
}

interface DiffConfig {
  originalContent: string;
  modifiedContent: string;
  tagId: string;
  sessionId: string;
}

interface DiffResult {
  content: string;
  action: 'accept' | 'reject';
}
```

## AI Tools

```ts
interface ExtensionAITool {
  name: string;
  description: string;
  inputSchema?: JSONSchema;
  parameters?: JSONSchema; // legacy alias
  scope?: 'global' | 'editor';
  editorFilePatterns?: string[];
  handler: (
    params: Record<string, unknown>,
    context: AIToolContext
  ) => Promise<ExtensionToolResult>;
}
```

```ts
interface AIToolContext {
  workspacePath?: string;
  activeFilePath?: string;
  extensionContext: ExtensionContext;
}
```

```ts
interface ExtensionToolResult {
  success: boolean;
  message?: string;
  data?: unknown;
  error?: string;
  extensionId?: string;
  toolName?: string;
  stack?: string;
  errorContext?: Record<string, unknown>;
}
```

### JSON Schema Types

```ts
interface JSONSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  items?: JSONSchema;
  description?: string;
}

interface JSONSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'null';
  description?: string;
  enum?: Array<string | number>;
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  default?: unknown;
}
```

## Panels

Panels are non-file-based extension UIs.

```ts
interface PanelExport {
  component: React.ComponentType<PanelHostProps>;
  gutterButton?: React.ComponentType<PanelGutterButtonProps>;
  settingsComponent?: React.ComponentType<PanelHostProps>;
}
```

```ts
interface PanelHostProps {
  host: PanelHost;
}

interface PanelHost {
  readonly panelId: string;
  readonly extensionId: string;
  readonly theme: string;
  readonly workspacePath: string;
  readonly isSettingsOpen: boolean;
  readonly ai?: PanelAIContext;
  readonly storage: ExtensionStorage;

  onThemeChanged(callback: (theme: string) => void): () => void;
  openFile(path: string): void;
  openPanel(panelId: string): void;
  close(): void;
  openSettings(): void;
  closeSettings(): void;
}
```

```ts
interface PanelAIContext {
  setContext(context: Record<string, unknown>): void;
  getContext(): Record<string, unknown>;
  clearContext(): void;
  notifyChange(event: string, data?: unknown): void;
  onContextChanged(callback: (context: Record<string, unknown>) => void): () => void;
}
```

```ts
interface SettingsPanelProps {
  storage: ExtensionStorage;
  theme: string;
}
```

## Extension Storage

`ExtensionStorage` is available to custom editors, panels, and settings panels.

```ts
interface ExtensionStorage {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;

  getGlobal<T>(key: string): T | undefined;
  setGlobal<T>(key: string, value: T): Promise<void>;
  deleteGlobal(key: string): Promise<void>;

  getSecret(key: string): Promise<string | undefined>;
  setSecret(key: string, value: string): Promise<void>;
  deleteSecret(key: string): Promise<void>;
}
```

## Manifest Types

The manifest shape is defined by `ExtensionManifest` and `ExtensionContributions`.
See [Manifest Reference](./manifest-reference.md) for field-by-field guidance.

```ts
interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  main: string;
  styles?: string;
  apiVersion?: string;
  permissions?: ExtensionPermissions;
  contributions?: ExtensionContributions;
  requiredReleaseChannel?: 'stable' | 'alpha';
  defaultEnabled?: boolean;
}
```

```ts
interface ExtensionContributions {
  customEditors?: CustomEditorContribution[];
  fileIcons?: Record<string, string>;
  aiTools?: string[];
  newFileMenu?: NewFileMenuContribution[];
  commands?: CommandContribution[];
  slashCommands?: SlashCommandContribution[];
  nodes?: string[];
  transformers?: string[];
  hostComponents?: string[];
  configuration?: ExtensionConfigurationContribution;
  claudePlugin?: ClaudePluginContribution;
  panels?: PanelContribution[];
  settingsPanel?: SettingsPanelContribution;
  documentHeaders?: DocumentHeaderContribution[];
  themes?: ThemeContribution[];
}
```

## Vite Helper

Use `createExtensionConfig()` to get the correct externalization and output shape for extensions.

```ts
import react from '@vitejs/plugin-react';
import { createExtensionConfig } from '@nimbalyst/extension-sdk/vite';

export default createExtensionConfig({
  entry: './src/index.tsx',
  plugins: [react()],
});
```

## Validation Helpers

```ts
import { validateExtensionBundle } from '@nimbalyst/extension-sdk';

const result = await validateExtensionBundle('/path/to/extension');
```

```ts
interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  manifest?: ExtensionManifest;
}
```

## Required Externals

`REQUIRED_EXTERNALS` exports the package names that must stay external in your build because Nimbalyst provides them at runtime.
