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
}

export interface ExtensionPermissions {
  /** Can read/write files */
  filesystem?: boolean;

  /** Can make network requests */
  network?: boolean;

  /** Can access clipboard */
  clipboard?: boolean;
}

export interface ExtensionContributions {
  /** Custom editors for specific file types */
  customEditors?: CustomEditorContribution[];

  /** Custom file icons */
  fileIcons?: FileIconContribution[];

  /** AI tools the extension provides */
  aiTools?: AIToolContribution[];

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

export interface AIToolContribution {
  /** Tool name (used in AI function calling) */
  name: string;

  /** Description for the AI */
  description: string;

  /** JSON schema for tool parameters */
  parameters?: Record<string, unknown>;
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
  /** Command name (without slash) */
  name: string;

  /** Description shown in autocomplete */
  description: string;

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
