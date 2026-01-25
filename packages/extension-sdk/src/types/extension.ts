/**
 * Core types for Nimbalyst extensions.
 */

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
}

export interface ExtensionPermissions {
  /** Can read/write files */
  filesystem?: boolean;

  /** Can make network requests */
  network?: boolean;

  /** Can access clipboard */
  clipboard?: boolean;

  /** Can register AI tools */
  ai?: boolean;
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

// Import panel types from panel.ts
import type { PanelContribution, SettingsPanelContribution } from './panel';

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
   * Missing colors will fall back to the appropriate base theme (light or dark).
   *
   * Available color keys:
   * - bg, bg-secondary, bg-tertiary, bg-hover, bg-selected, bg-active
   * - text, text-muted, text-faint, text-disabled
   * - border, border-focus
   * - primary, primary-hover
   * - link, link-hover
   * - success, warning, error, info
   */
  colors: Partial<Record<ThemeColorKey, string>>;
}

/**
 * Available theme color keys.
 * Extensions can override any of these colors.
 */
export type ThemeColorKey =
  | 'bg' | 'bg-secondary' | 'bg-tertiary' | 'bg-hover' | 'bg-selected' | 'bg-active'
  | 'text' | 'text-muted' | 'text-faint' | 'text-disabled'
  | 'border' | 'border-focus'
  | 'primary' | 'primary-hover'
  | 'link' | 'link-hover'
  | 'success' | 'warning' | 'error' | 'info';

export interface ExtensionContributions {
  /** Custom editors for specific file types */
  customEditors?: CustomEditorContribution[];

  /** Custom file icons */
  fileIcons?: FileIconContribution[];

  /** AI tools the extension provides (list of tool names) */
  aiTools?: string[];

  /** Entries to add to the New File menu */
  newFileMenu?: NewFileMenuContribution[];

  /** Lexical nodes the extension contributes */
  lexicalNodes?: LexicalNodeContribution[];

  /** Slash commands for AI chat */
  slashCommands?: SlashCommandContribution[];

  /**
   * Non-file-based panels (e.g., database browser, deployment dashboard).
   * Panels integrate with the navigation gutter and can expose AI tools.
   */
  panels?: PanelContribution[];

  /**
   * Settings panel shown in the Settings screen under "Extensions" section.
   * Use this for managing extension configuration like database connections.
   */
  settingsPanel?: SettingsPanelContribution;

  /**
   * Custom themes that users can select.
   * Extensions can provide color themes that override the built-in themes.
   */
  themes?: ThemeContribution[];
}

export interface CustomEditorContribution {
  /** Glob patterns for files this editor handles (e.g., ['*.csv', '*.tsv']) */
  filePatterns: string[];

  /** Display name shown in UI */
  displayName: string;

  /** Component name exported from the extension */
  component: string;
}

export interface FileIconContribution {
  /** Glob pattern (e.g., '*.pdf') */
  pattern: string;

  /** Material symbol icon name */
  icon: string;

  /** Icon color (hex) */
  color?: string;
}

export interface LexicalNodeContribution {
  /** Node type identifier */
  type: string;

  /** Display name */
  name: string;

  /** Node class name exported from extension */
  nodeClass: string;
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
 * The module interface that extensions export.
 */
export interface ExtensionModule {
  /** Called when extension is activated */
  activate?: () => void | Promise<void>;

  /** Called when extension is deactivated */
  deactivate?: () => void | Promise<void>;

  /** React components exported by the extension */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  components?: Record<string, any>;

  /** AI tools the extension provides */
  aiTools?: AIToolDefinition[];

  /** Lexical nodes contributed by the extension */
  nodes?: Record<string, any>;

  /** Markdown transformers for Lexical */
  transformers?: Record<string, any>;

  /** Components that render inside the host editor */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  hostComponents?: Record<string, any>;

  /** Slash command handlers */
  slashCommandHandlers?: Record<string, (args: string) => Promise<string>>;

  /**
   * Panel exports for non-file-based UIs.
   * Keys are panel IDs matching the `panels` contribution in manifest.json.
   * @see {@link ./panel.ts} for PanelExport type
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  panels?: Record<string, any>;

  /**
   * Settings panel component for the Settings screen.
   * Keys match the `settingsPanel.component` in manifest.json.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settingsPanel?: Record<string, any>;
}

/**
 * AI tool definition for extensions.
 */
export interface AIToolDefinition {
  /** Tool name */
  name: string;

  /** Description for the AI */
  description: string;

  /** JSON schema for parameters */
  parameters?: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };

  /** Handler function */
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Services provided to extensions via the context.
 */
export interface ExtensionServices {
  /** File system operations */
  filesystem: {
    /** Read a file's contents */
    readFile: (path: string) => Promise<string>;
    /** Write content to a file */
    writeFile: (path: string, content: string) => Promise<void>;
    /** Check if a file exists */
    fileExists: (path: string) => Promise<boolean>;
    /** Find files matching a pattern */
    findFiles: (pattern: string) => Promise<string[]>;
  };

  /** UI operations */
  ui: {
    /** Show an info message */
    showInfo: (message: string) => void;
    /** Show a warning message */
    showWarning: (message: string) => void;
    /** Show an error message */
    showError: (message: string) => void;
  };

  /** AI services (only available if permissions.ai is true) */
  ai?: {
    /** Register an AI tool */
    registerTool: (tool: ExtensionAITool) => { dispose: () => void };
    /** Register a context provider */
    registerContextProvider: (provider: { id: string; getContext: () => Promise<string> }) => { dispose: () => void };
  };

  /** Configuration service (only available if contributions.configuration is defined) */
  configuration?: {
    /** Get a configuration value */
    get: <T>(key: string, defaultValue?: T) => T;
    /** Update a configuration value */
    update: (key: string, value: unknown, scope?: 'user' | 'workspace') => Promise<void>;
    /** Get all configuration values */
    getAll: () => Record<string, unknown>;
  };
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
   * Array to add disposables to - these will be cleaned up on deactivation.
   * Push any cleanup functions here.
   */
  subscriptions: Array<{ dispose: () => void }>;
}

/**
 * Context passed to AI tool handlers.
 * NOTE: This is different from ExtensionContext!
 */
export interface AIToolContext {
  /** Path to the current workspace (may be undefined if no workspace is open) */
  workspacePath?: string;

  /** Path to the currently active file (may be undefined if no file is open) */
  activeFilePath?: string;

  /** The extension context for accessing services */
  extensionContext: ExtensionContext;
}

/**
 * @deprecated Use AIToolContext instead. This type has incorrect property names.
 */
export interface ToolContext {
  /** @deprecated Use activeFilePath instead */
  filePath?: string;

  /** @deprecated This property is not available - use extensionContext.services.filesystem.readFile */
  fileContent?: string;

  /** Path to extension installation directory */
  extensionPath: string;
}

/**
 * Result returned from AI tool handlers.
 */
export type ToolResult = ToolSuccessResult | ToolErrorResult;

export interface ToolSuccessResult {
  /** Any data to return to Claude */
  [key: string]: unknown;

  /** If present, updates the file content */
  newContent?: string;
}

export interface ToolErrorResult {
  error: string;
}

/**
 * Full AI tool definition with typed handler.
 * This is the recommended type to use when defining tools.
 */
export interface ExtensionAITool {
  /** Unique name (use prefix.action format, e.g., 'csv.get_schema') */
  name: string;

  /** Description for Claude to understand when to use it */
  description: string;

  /**
   * JSON Schema for input parameters.
   * Can use either 'inputSchema' or 'parameters' - both are supported.
   */
  inputSchema?: {
    type: 'object';
    properties: Record<string, JsonSchemaProperty>;
    required?: string[];
  };

  /**
   * JSON Schema for input parameters (alias for inputSchema).
   * Use whichever naming convention you prefer.
   */
  parameters?: {
    type: 'object';
    properties: Record<string, JsonSchemaProperty>;
    required?: string[];
  };

  /**
   * Handler function.
   * @param args - The validated input parameters
   * @param context - Context including workspace path, active file, and extension services
   * @returns A result object. Use { success: true, message: "..." } for success,
   *          or { success: false, error: "..." } for errors.
   */
  handler: (
    args: Record<string, unknown>,
    context: AIToolContext
  ) => Promise<ExtensionToolResult>;
}

/**
 * Result returned from extension AI tool handlers.
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
}

/**
 * JSON Schema property definition for tool input schemas.
 */
export interface JsonSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: string[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
}
