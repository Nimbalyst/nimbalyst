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
 * Context passed to the activate function.
 */
export interface ExtensionContext {
  /** Absolute path to the extension's installation directory */
  extensionPath: string;
}

/**
 * Context passed to AI tool handlers.
 */
export interface ToolContext {
  /** Path to the currently open file (may be undefined) */
  filePath?: string;

  /** Content of the currently open file (may be undefined) */
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

  /** JSON Schema for input parameters */
  inputSchema: {
    type: 'object';
    properties: Record<string, JsonSchemaProperty>;
    required?: string[];
  };

  /** Handler function */
  handler: (
    args: Record<string, unknown>,
    context: ToolContext
  ) => Promise<ToolResult>;
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
