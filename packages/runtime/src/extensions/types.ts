/**
 * Extension System Types
 *
 * Core type definitions for the Nimbalyst extension system.
 * This module is platform-agnostic and can be used in both
 * Electron and Capacitor environments.
 */

import type { ComponentType } from 'react';
import type { EditorHostProps } from './editorHost';

// ============================================================================
// Extension Manifest Types
// ============================================================================

/**
 * Extension manifest - the manifest.json that declares extension capabilities
 */
export interface ExtensionManifest {
  /** Unique extension identifier (reverse domain notation, e.g., "com.nimbalyst.datamodellm") */
  id: string;

  /** Human-readable name */
  name: string;

  /** Semantic version (e.g., "1.0.0") */
  version: string;

  /** Brief description of the extension */
  description?: string;

  /** Author name or organization */
  author?: string;

  /** Path to main JS entry point (relative to extension root) */
  main: string;

  /** Path to CSS styles (relative to extension root) */
  styles?: string;

  /** Minimum Nimbalyst API version required */
  apiVersion?: string;

  /** Permissions the extension needs */
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

/**
 * Permissions that extensions can request
 */
export interface ExtensionPermissions {
  /** Access to read/write files in workspace */
  filesystem?: boolean;

  /** Access to AI services and tool registration */
  ai?: boolean;

  /** Access to network (for future use) */
  network?: boolean;
}

/**
 * Contributions that extensions can provide to Nimbalyst
 */
export interface ExtensionContributions {
  /** Custom editor registrations */
  customEditors?: CustomEditorContribution[];

  /** AI tools the extension provides */
  aiTools?: string[];

  /** File icons by pattern */
  fileIcons?: Record<string, string>;

  /** New file menu contributions */
  newFileMenu?: NewFileMenuContribution[];

  /** Commands (for future use) */
  commands?: CommandContribution[];

  /** Slash commands for the component picker (e.g., /datamodel) */
  slashCommands?: SlashCommandContribution[];

  /** Custom Lexical nodes (names of exported node classes) */
  nodes?: string[];

  /** Markdown transformers (names of exported transformer objects) */
  transformers?: string[];

  /** Host components to mount at app level (names of exported components) */
  hostComponents?: string[];

  /** Extension configuration schema */
  configuration?: ExtensionConfigurationContribution;

  /**
   * Claude Agent SDK plugin bundled with this extension.
   * Provides slash commands, agents, skills, and hooks that are loaded
   * into Claude Code sessions. Unlike MCP tools (which are context-aware
   * and only active for matching editors), these plugins are always available
   * when enabled.
   */
  claudePlugin?: ClaudePluginContribution;
}

// ============================================================================
// Extension Configuration Types
// ============================================================================

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
   * - 'user': Global setting (same across all projects)
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

// ============================================================================
// Claude Plugin Types
// ============================================================================

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

/**
 * A slash command provided by a Claude plugin
 */
export interface ClaudePluginCommand {
  /** Command name (without slash or namespace) */
  name: string;

  /** Human-readable description */
  description: string;
}

/**
 * An agent provided by a Claude plugin
 */
export interface ClaudePluginAgent {
  /** Agent name */
  name: string;

  /** Human-readable description */
  description: string;
}

/**
 * New file menu contribution - adds option to "New File" menu
 */
export interface NewFileMenuContribution {
  /** File extension (e.g., ".datamodel") */
  extension: string;

  /** Display name in menu (e.g., "Data Model") */
  displayName: string;

  /** Material icon name */
  icon: string;

  /** Default content for new files (JSON string or function name) */
  defaultContent: string;
}

/**
 * Custom editor contribution from manifest
 */
export interface CustomEditorContribution {
  /** File patterns this editor handles (e.g., ["*.datamodel", "*.dm"]) */
  filePatterns: string[];

  /** Display name shown in UI */
  displayName: string;

  /** Component name to look up in module exports */
  component: string;

  /**
   * Whether this editor supports source mode (viewing/editing raw file content in Monaco).
   * When true, the host will provide a "View Source" button and handle mode switching.
   * Default: false
   */
  supportsSourceMode?: boolean;
}

/**
 * Command contribution (for future use)
 */
export interface CommandContribution {
  /** Unique command ID */
  id: string;

  /** Display name */
  title: string;

  /** Optional keyboard shortcut */
  keybinding?: string;
}

/**
 * Slash command contribution for the component picker ("/command" menu)
 */
export interface SlashCommandContribution {
  /** Unique command ID (namespaced, e.g., "datamodellm.insert") */
  id: string;

  /** Display title in the "/" menu */
  title: string;

  /** Optional description */
  description?: string;

  /** Material icon name */
  icon?: string;

  /** Search keywords */
  keywords?: string[];

  /** Handler function name exported from module */
  handler: string;
}

// ============================================================================
// Extension Module Types
// ============================================================================

/**
 * The shape of an extension's exported module
 */
export interface ExtensionModule {
  /** Called when extension is activated */
  activate?: (context: ExtensionContext) => Promise<void> | void;

  /** Called when extension is deactivated */
  deactivate?: () => Promise<void> | void;

  /** React components exported by the extension (for custom editors) */
  components?: Record<string, ComponentType<EditorHostProps>>;

  /** AI tools exported by the extension */
  aiTools?: ExtensionAITool[];

  /** Slash command handlers (function name -> handler function) */
  slashCommandHandlers?: Record<string, () => void>;

  /** Lexical node classes (node name -> node class) */
  nodes?: Record<string, unknown>; // Klass<LexicalNode> - but we avoid lexical dependency here

  /** Markdown transformers (transformer name -> transformer object) */
  transformers?: Record<string, unknown>; // Transformer type from @lexical/markdown

  /** Host components to mount at app level (component name -> React component) */
  hostComponents?: Record<string, ComponentType>;
}

// Note: CustomEditorComponentProps has been replaced by EditorHostProps from './editorHost'
// Custom editors now receive a single 'host' prop that provides all communication with TabEditor.

// ============================================================================
// AI Tool Types
// ============================================================================

/**
 * JSON Schema type for tool parameters
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
 * AI tool definition from an extension
 */
export interface ExtensionAITool {
  /** Tool name (should be namespaced, e.g., "datamodellm.create_entity") */
  name: string;

  /** Human-readable description shown to AI */
  description: string;

  /**
   * JSON Schema for tool parameters.
   * Use either 'inputSchema' (preferred, matches MCP convention) or 'parameters'.
   */
  inputSchema?: JSONSchema;

  /**
   * JSON Schema for tool parameters (legacy field name).
   * Prefer 'inputSchema' for new tools.
   * @deprecated Use inputSchema instead
   */
  parameters?: JSONSchema;

  /**
   * Tool scope - determines when the tool is available:
   * - 'global': Always available in MCP
   * - 'editor': Only available when a matching editor is active
   * Defaults to 'editor' for backwards compatibility
   */
  scope?: 'global' | 'editor';

  /**
   * File patterns this tool applies to (for editor-scoped tools).
   * Uses glob patterns like ["*.datamodel", "*.dm"].
   * If not specified for editor-scoped tools, inherits from the extension's
   * customEditors contribution.
   */
  editorFilePatterns?: string[];

  /** Tool execution handler */
  handler: (
    params: Record<string, unknown>,
    context: AIToolContext
  ) => Promise<ExtensionToolResult>;
}

/**
 * Context passed to AI tool handlers
 */
export interface AIToolContext {
  /** Absolute path to current workspace */
  workspacePath?: string;

  /** Absolute path to currently active file */
  activeFilePath?: string;

  /** Extension context for accessing services */
  extensionContext: ExtensionContext;
}

/**
 * Result returned from extension AI tool execution.
 * Includes enhanced error details for debugging and diagnostics.
 */
export interface ExtensionToolResult {
  /** Whether the tool executed successfully */
  success: boolean;

  /** Human-readable result message for AI */
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

// ============================================================================
// Extension Context Types
// ============================================================================

/**
 * Context provided to extensions when they activate
 */
export interface ExtensionContext {
  /** The extension's manifest */
  manifest: ExtensionManifest;

  /** Absolute path to the extension's root directory */
  extensionPath: string;

  /** Services provided by the host */
  services: ExtensionServices;

  /** Disposables to clean up on deactivation */
  subscriptions: Disposable[];
}

/**
 * Services available to extensions
 */
export interface ExtensionServices {
  /** File system operations */
  filesystem: ExtensionFileSystemService;

  /** UI operations */
  ui: ExtensionUIService;

  /** AI operations (if permitted) */
  ai?: ExtensionAIService;

  /** Configuration service (if extension has configuration contribution) */
  configuration?: ExtensionConfigurationService;
}

/**
 * Configuration service for extensions to read/write their settings.
 */
export interface ExtensionConfigurationService {
  /**
   * Get a configuration value.
   * Returns the workspace value if set, otherwise the user value, otherwise the default.
   */
  get<T>(key: string, defaultValue?: T): T;

  /**
   * Update a configuration value.
   * @param key - Configuration property key
   * @param value - New value to set
   * @param scope - Which scope to update ('user' or 'workspace')
   */
  update(key: string, value: unknown, scope?: 'user' | 'workspace'): Promise<void>;

  /**
   * Get all configuration values for this extension.
   */
  getAll(): Record<string, unknown>;
}

/**
 * File system service for extensions
 */
export interface ExtensionFileSystemService {
  /** Read a file as text */
  readFile(path: string): Promise<string>;

  /** Write content to a file */
  writeFile(path: string, content: string): Promise<void>;

  /** Check if a file exists */
  fileExists(path: string): Promise<boolean>;

  /** List files matching a pattern in workspace */
  findFiles(pattern: string): Promise<string[]>;
}

/**
 * UI service for extensions
 */
export interface ExtensionUIService {
  /** Show an information message */
  showInfo(message: string): void;

  /** Show a warning message */
  showWarning(message: string): void;

  /** Show an error message */
  showError(message: string): void;
}

/**
 * AI service for extensions (requires ai permission)
 */
export interface ExtensionAIService {
  /** Register an AI tool */
  registerTool(tool: ExtensionAITool): Disposable;

  /** Register a context provider */
  registerContextProvider(provider: ExtensionContextProvider): Disposable;
}

/**
 * Context provider that adds information to AI context
 */
export interface ExtensionContextProvider {
  /** Provider identifier */
  id: string;

  /** Priority (higher = earlier in context) */
  priority?: number;

  /** Generate context string */
  provideContext(): Promise<string>;
}

/**
 * Disposable pattern for cleanup
 */
export interface Disposable {
  dispose(): void;
}

// ============================================================================
// Extension Loader Types
// ============================================================================

/**
 * A loaded extension instance
 */
export interface LoadedExtension {
  /** The extension's manifest */
  manifest: ExtensionManifest;

  /** The loaded module */
  module: ExtensionModule;

  /** Context provided to the extension */
  context: ExtensionContext;

  /** Function to remove injected styles */
  disposeStyles?: () => void;

  /** Whether the extension is currently enabled */
  enabled: boolean;

  /** Dispose and unload the extension */
  dispose(): Promise<void>;
}

/**
 * Extension loading result
 */
export type ExtensionLoadResult =
  | { success: true; extension: LoadedExtension }
  | { success: false; error: string; manifestPath?: string };

/**
 * Extension discovery result
 */
export interface DiscoveredExtension {
  /** Path to the extension directory */
  path: string;

  /** Parsed manifest */
  manifest: ExtensionManifest;
}
