/**
 * Extension System Types
 *
 * Core type definitions for the Nimbalyst extension system.
 * This module is platform-agnostic and can be used in both
 * Electron and Capacitor environments.
 */

import type { ComponentType } from 'react';

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

  /** React components exported by the extension */
  components?: Record<string, ComponentType<CustomEditorComponentProps>>;

  /** AI tools exported by the extension */
  aiTools?: ExtensionAITool[];
}

/**
 * Props passed to custom editor components from extensions
 */
export interface CustomEditorComponentProps {
  /** Absolute path to the file being edited */
  filePath: string;

  /** File name without path */
  fileName: string;

  /** Initial file content as string */
  initialContent: string;

  /** Current theme */
  theme: 'light' | 'dark' | 'crystal-dark';

  /** Whether this editor is the active/focused one */
  isActive: boolean;

  /** Workspace identifier (if in a workspace) */
  workspaceId?: string;

  /** Called when content changes (for dirty tracking) */
  onContentChange?: () => void;

  /** Called when dirty state changes */
  onDirtyChange?: (isDirty: boolean) => void;

  /** Register a function to get current content (for saving) */
  onGetContentReady?: (getContentFn: () => string) => void;

  /** Open document history dialog */
  onViewHistory?: () => void;

  /** Trigger document rename */
  onRenameDocument?: () => void;
}

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

  /** JSON Schema for tool parameters */
  parameters: JSONSchema;

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
 * Result returned from extension AI tool execution
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
