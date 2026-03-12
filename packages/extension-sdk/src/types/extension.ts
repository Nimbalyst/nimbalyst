/**
 * Core types for Nimbalyst extensions.
 */

import type { ComponentType } from 'react';
import type { EditorHostProps } from './editor';
import type {
  ExtensionStorage,
  PanelContribution,
  PanelExport,
  PanelGutterButtonProps,
  PanelHostProps,
  SettingsPanelContribution,
  SettingsPanelProps,
} from './panel';
import type { ThemeColors } from './theme';

/**
 * Extension manifest schema (manifest.json)
 */
export interface ExtensionManifest {
  /** Unique identifier (e.g., 'com.example.my-extension') */
  id: string;

  /** Display name */
  name: string;

  /** Semantic version */
  version: string;

  /** Brief description */
  description?: string;

  /** Author name or organization */
  author?: string;

  /** Path to main JS bundle (relative to manifest) */
  main: string;

  /** Path to CSS file (relative to manifest) */
  styles?: string;

  /** Minimum Nimbalyst API version required */
  apiVersion?: string;

  /** Permissions the extension requires */
  permissions?: ExtensionPermissions;

  /** What the extension contributes to Nimbalyst */
  contributions?: ExtensionContributions;

  /**
   * Minimum release channel required to see/use this extension.
   * - 'stable': Available to all users (default if not specified)
   * - 'alpha': Only visible to users on the alpha release channel
   */
  requiredReleaseChannel?: 'stable' | 'alpha';

  /**
   * Default enabled state for the extension.
   * - true: Extension is enabled by default when first discovered
   * - false: Extension is disabled by default until the user enables it
   */
  defaultEnabled?: boolean;
}

export interface ExtensionPermissions {
  /** Can read/write files */
  filesystem?: boolean;

  /** Can access AI services */
  ai?: boolean;

  /** Can make network requests */
  network?: boolean;
}

export interface ExtensionContributions {
  /** Custom editors for specific file types */
  customEditors?: CustomEditorContribution[];

  /** Custom file icons keyed by glob pattern */
  fileIcons?: Record<string, string>;

  /** AI tools the extension provides (list of tool names) */
  aiTools?: string[];

  /** Entries to add to the New File menu */
  newFileMenu?: NewFileMenuContribution[];

  /** Named actions an extension exposes */
  commands?: CommandContribution[];

  /** Key bindings that map key combos to commands */
  keybindings?: KeybindingContribution[];

  /** Slash commands for AI chat */
  slashCommands?: SlashCommandContribution[];

  /** Lexical node exports contributed by the extension */
  nodes?: string[];

  /** Markdown transformers for Lexical */
  transformers?: string[];

  /** Components mounted by the host at app level */
  hostComponents?: string[];

  /** Extension configuration schema */
  configuration?: ExtensionConfigurationContribution;

  /** Claude Code plugin metadata */
  claudePlugin?: ClaudePluginContribution;

  /**
   * Non-file-based panels (e.g., database browser, deployment dashboard).
   * Panels integrate with the navigation gutter and can expose AI tools.
   */
  panels?: PanelContribution[];

  /**
   * Settings panel shown in the Settings screen under "Extensions" section.
   */
  settingsPanel?: SettingsPanelContribution;

  /**
   * Document headers that render above editors for matching file types.
   * Headers augment the editor without replacing it.
   */
  documentHeaders?: DocumentHeaderContribution[];

  /**
   * Custom themes that users can select.
   * Extensions can provide color themes that override the built-in themes.
   */
  themes?: ThemeContribution[];
}

/**
 * Configuration schema for extension settings.
 * Follows a JSON Schema-like structure for defining configurable properties.
 */
export interface ExtensionConfigurationContribution {
  /** Title displayed in settings panel */
  title?: string;

  /** Configuration properties */
  properties: Record<string, ConfigurationProperty>;
}

/**
 * A single configuration property that can be set by the user.
 */
export interface ConfigurationProperty {
  /** Property type */
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';

  /** Default value */
  default?: unknown;

  /** Human-readable description */
  description?: string;

  /** Enum values for dropdown selection */
  enum?: (string | number)[];

  /** Human-readable labels for enum values */
  enumDescriptions?: string[];

  /**
   * Scope of the setting:
   * - 'user': Global setting
   * - 'workspace': Per-project setting
   * - 'both': Available in both scopes (workspace overrides user)
   */
  scope?: 'user' | 'workspace' | 'both';

  /** Order for display (lower = higher priority) */
  order?: number;

  /** Minimum value for numbers */
  minimum?: number;

  /** Maximum value for numbers */
  maximum?: number;

  /** Pattern for string validation (regex) */
  pattern?: string;

  /** Placeholder text for input fields */
  placeholder?: string;
}

/**
 * Claude Agent SDK plugin contribution.
 * Allows extensions to bundle Claude Code plugins that provide
 * slash commands, agents, skills, and hooks.
 */
export interface ClaudePluginContribution {
  /** Path to plugin directory relative to extension root */
  path: string;

  /** Human-readable name for settings UI */
  displayName: string;

  /** Description for settings UI */
  description?: string;

  /** Whether this plugin is enabled by default */
  enabledByDefault?: boolean;

  /** Commands provided by this plugin (for documentation/UI) */
  commands?: ClaudePluginCommand[];

  /** Agents provided by this plugin (for documentation/UI) */
  agents?: ClaudePluginAgent[];
}

export interface ClaudePluginCommand {
  /** Command name (without slash or namespace) */
  name: string;

  /** Human-readable description */
  description: string;
}

export interface ClaudePluginAgent {
  /** Agent name */
  name: string;

  /** Human-readable description */
  description: string;
}

/**
 * New file menu contribution.
 */
export interface NewFileMenuContribution {
  /** File extension with dot (e.g., '.csv') */
  extension: string;

  /** Name shown in menu */
  displayName: string;

  /** Material icon name */
  icon: string;

  /** Initial file content */
  defaultContent: string;
}

export interface CustomEditorContribution {
  /** Glob patterns for files this editor handles (e.g., ['*.csv', '*.tsv']) */
  filePatterns: string[];

  /** Display name shown in UI */
  displayName: string;

  /** Component name exported from the extension */
  component: string;

  /**
   * Whether this editor supports source mode (editing the raw file in Monaco).
   * When true, the host will provide a source-mode toggle.
   */
  supportsSourceMode?: boolean;
}

export interface DocumentHeaderContribution {
  /** Unique identifier for this header (e.g., 'astro-frontmatter') */
  id: string;

  /** Glob patterns for files this header applies to (e.g., ['*.astro']) */
  filePatterns: string[];

  /** Display name shown in UI */
  displayName: string;

  /** Component name exported from the extension (key in module.components) */
  component: string;

  /** Priority for ordering (higher renders first, default 50) */
  priority?: number;
}

export interface CommandContribution {
  /** Unique command ID */
  id: string;

  /** Display name */
  title: string;
}

/**
 * Keybinding contribution that binds a key combo to a command.
 *
 * @example
 * ```json
 * { "key": "ctrl+shift+g", "command": "com.nimbalyst.git.git-log.toggle" }
 * ```
 *
 * Key format: modifier+key (all lowercase, modifiers: ctrl, shift, alt, cmd)
 * - `ctrl` — Ctrl on all platforms
 * - `cmd` — Cmd/Meta on macOS, Ctrl on Windows/Linux (same cross-platform semantics as built-ins)
 * - Modifiers can be combined: `ctrl+shift+g`, `cmd+alt+k`
 *
 * Toggle commands for panels are auto-registered as `${extensionId}.${panelId}.toggle`,
 * so you only need to declare the keybinding — no explicit command declaration required.
 */
export interface KeybindingContribution {
  /** Key combination (e.g., "ctrl+shift+g") */
  key: string;

  /** Full command ID to execute (e.g., "com.nimbalyst.git.git-log.toggle") */
  command: string;
}

export interface SlashCommandContribution {
  /** Unique command ID (namespaced, e.g., "myext.do-something") */
  id: string;

  /** Display title in the "/" menu */
  title: string;

  /** Optional description */
  description?: string;

  /** Material icon name */
  icon?: string;

  /** Search keywords */
  keywords?: string[];

  /** Handler function name exported from extension */
  handler: string;
}

/**
 * Theme contribution for extensions.
 * Extensions can provide custom color themes that users can select.
 */
export interface ThemeContribution {
  /** Unique theme ID within this extension (will be namespaced as extensionId:themeId) */
  id: string;

  /** Display name for the theme (shown in theme picker) */
  name: string;

  /** Whether this is a dark theme (determines base theme for fallbacks) */
  isDark: boolean;

  /**
   * Theme color values. Only include colors you want to override.
   * Missing colors will fall back to the appropriate base theme.
   */
  colors: ThemeColors;
}

/**
 * The module interface that extensions export.
 */
export interface ExtensionModule {
  /** Called when extension is activated */
  activate?: (context: ExtensionContext) => void | Promise<void>;

  /** Called when extension is deactivated */
  deactivate?: () => void | Promise<void>;

  /** React components exported by the extension */
  components?: Record<string, ComponentType<EditorHostProps>>;

  /** AI tools the extension provides */
  aiTools?: ExtensionAITool[];

  /** Lexical nodes contributed by the extension */
  nodes?: Record<string, unknown>;

  /** Markdown transformers for Lexical */
  transformers?: Record<string, unknown>;

  /** Components that render inside the host editor */
  hostComponents?: Record<string, ComponentType>;

  /** Slash command handlers */
  slashCommandHandlers?: Record<string, () => void>;

  /**
   * Panel exports for non-file-based UIs.
   * Keys are panel IDs matching the `panels` contribution in manifest.json.
   */
  panels?: Record<string, PanelExport>;

  /**
   * Settings panel component for the Settings screen.
   * Keys match the `settingsPanel.component` in manifest.json.
   */
  settingsPanel?: Record<string, ComponentType<SettingsPanelProps>>;
}

/**
 * JSON Schema type for tool parameters.
 */
export interface JSONSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  items?: JSONSchema;
  description?: string;
}

export interface JSONSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'null';
  description?: string;
  enum?: (string | number)[];
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  default?: unknown;
}

/**
 * AI tool definition from an extension.
 */
export interface ExtensionAITool {
  /** Unique name (use prefix.action format, e.g., 'csv.get_schema') */
  name: string;

  /** Description for the AI */
  description: string;

  /**
   * JSON Schema for tool parameters.
   * Use either 'inputSchema' (preferred) or 'parameters'.
   */
  inputSchema?: JSONSchema;

  /**
   * JSON Schema for tool parameters (legacy alias).
   * @deprecated Use inputSchema instead.
   */
  parameters?: JSONSchema;

  /**
   * Tool scope.
   * - 'global': Always available
   * - 'editor': Only available when a matching editor is active
   */
  scope?: 'global' | 'editor';

  /**
   * File patterns this tool applies to when scope is 'editor'.
   * If omitted, the host may inherit the extension's custom editor patterns.
   */
  editorFilePatterns?: string[];

  /** Handler function */
  handler: (
    params: Record<string, unknown>,
    context: AIToolContext
  ) => Promise<ExtensionToolResult>;
}

/**
 * Result returned from extension AI tool handlers.
 * Includes enhanced error details for debugging and diagnostics.
 */
export interface ExtensionToolResult {
  /** Whether the tool executed successfully */
  success: boolean;

  /** Human-readable result message (shown to AI) */
  message?: string;

  /** Structured data result */
  data?: unknown;

  /** Error message if success is false */
  error?: string;

  /** Extension ID that provided this tool (added during execution) */
  extensionId?: string;

  /** Tool name that was executed (added during execution) */
  toolName?: string;

  /** Stack trace if an error occurred (for debugging) */
  stack?: string;

  /** Additional context about the error (for debugging) */
  errorContext?: Record<string, unknown>;
}

/**
 * Services provided to extensions via the runtime context.
 */
export interface ExtensionServices {
  /** File system operations */
  filesystem: ExtensionFileSystemService;

  /** UI operations */
  ui: ExtensionUIService;

  /** AI services (only available if permissions.ai is true) */
  ai?: ExtensionAIService;

  /** Configuration service (only available if contributions.configuration is defined) */
  configuration?: ExtensionConfigurationService;
}

/**
 * Context passed to the activate function.
 * This is the full context available at runtime.
 */
export interface ExtensionContext {
  /** The extension's manifest */
  manifest: ExtensionManifest;

  /** Absolute path to the extension's installation directory */
  extensionPath: string;

  /** Services available to the extension */
  services: ExtensionServices;

  /**
   * Array to add disposables to.
   * These will be cleaned up on deactivation.
   */
  subscriptions: Disposable[];
}

/**
 * Context passed to AI tool handlers.
 */
export interface AIToolContext {
  /** Path to the current workspace (may be undefined if no workspace is open) */
  workspacePath?: string;

  /** Path to the currently active file (may be undefined if no file is open) */
  activeFilePath?: string;

  /** The extension context for accessing services */
  extensionContext: ExtensionContext;
}

export interface ExtensionConfigurationService {
  /**
   * Get a configuration value.
   * Returns the workspace value if set, otherwise the user value, otherwise the default.
   */
  get<T>(key: string, defaultValue?: T): T;

  /**
   * Update a configuration value.
   * @param scope Which scope to update ('user' or 'workspace')
   */
  update(key: string, value: unknown, scope?: 'user' | 'workspace'): Promise<void>;

  /** Get all configuration values */
  getAll(): Record<string, unknown>;
}

export interface ExtensionFileSystemService {
  /** Read a file's contents */
  readFile(path: string): Promise<string>;

  /** Write content to a file */
  writeFile(path: string, content: string): Promise<void>;

  /** Check if a file exists */
  fileExists(path: string): Promise<boolean>;

  /** Find files matching a pattern */
  findFiles(pattern: string): Promise<string[]>;
}

export interface ExtensionUIService {
  /** Show an info message */
  showInfo(message: string): void;

  /** Show a warning message */
  showWarning(message: string): void;

  /** Show an error message */
  showError(message: string): void;
}

export interface ExtensionAIService {
  /** Register an AI tool */
  registerTool(tool: ExtensionAITool): Disposable;

  /** Register a context provider */
  registerContextProvider(provider: ExtensionContextProvider): Disposable;

  /** Send a prompt to the AI and get a response. Defaults to claude-code provider. */
  sendPrompt(options: {
    prompt: string;
    sessionName?: string;
    /** AI provider to use. Defaults to 'claude-code'. */
    provider?: 'claude-code' | 'claude' | 'openai';
    /** Model ID (e.g. 'claude-code:opus', 'claude-code:sonnet'). Uses provider default if omitted. */
    model?: string;
  }): Promise<{
    sessionId: string;
    response: string;
  }>;
}

export interface ExtensionContextProvider {
  /** Provider identifier */
  id: string;

  /** Priority (higher = earlier in context) */
  priority?: number;

  /** Generate context string */
  provideContext(): Promise<string>;
}

export interface Disposable {
  dispose(): void;
}

// ============================================================================
// Deprecated compatibility aliases
// ============================================================================

/**
 * @deprecated Use AIToolContext instead. This type has incorrect property names.
 */
export interface ToolContext {
  /** @deprecated Use activeFilePath instead */
  filePath?: string;

  /** @deprecated This property is not available. Use services.filesystem.readFile(). */
  fileContent?: string;

  /** Path to extension installation directory */
  extensionPath: string;
}

/**
 * @deprecated Use ExtensionToolResult for tool handlers.
 * This remains as a loose compatibility type for older internal extensions.
 */
export type ToolResult = ToolSuccessResult | ToolErrorResult;

/**
 * @deprecated Use ExtensionToolResult for tool handlers.
 */
export interface ToolSuccessResult {
  /** Any data to return to the AI */
  [key: string]: unknown;

  /** If present, updates the file content */
  newContent?: string;
}

/**
 * @deprecated Use ExtensionToolResult for tool handlers.
 */
export interface ToolErrorResult {
  error: string;
}

/**
 * @deprecated Use ExtensionAITool instead.
 */
export type AIToolDefinition = ExtensionAITool;

/**
 * @deprecated Use JSONSchemaProperty instead.
 */
export type JsonSchemaProperty = JSONSchemaProperty;

/**
 * @deprecated `fileIcons` now uses a Record<string, string> map in ExtensionContributions.
 */
export interface FileIconContribution {
  pattern: string;
  icon: string;
  color?: string;
}

/**
 * @deprecated Use `contributions.nodes` plus exported node classes instead.
 */
export interface LexicalNodeContribution {
  type: string;
  name: string;
  nodeClass: string;
}

/**
 * @deprecated Extensions should use host storage and service contracts instead.
 */
export type SettingsPanelStorage = ExtensionStorage;

/**
 * @deprecated Use PanelHostProps from './panel' instead.
 */
export type LegacyPanelHostProps = PanelHostProps;

/**
 * @deprecated Use PanelGutterButtonProps from './panel' instead.
 */
export type LegacyPanelGutterButtonProps = PanelGutterButtonProps;
