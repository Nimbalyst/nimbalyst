/**
 * Extension System
 *
 * Platform-agnostic extension loading system for Nimbalyst.
 * Extensions can provide custom editors, AI tools, and more.
 */

// Types
export type {
  ExtensionManifest,
  ExtensionPermissions,
  ExtensionContributions,
  ExtensionConfigurationContribution,
  ConfigurationProperty,
  CustomEditorContribution,
  CommandContribution,
  NewFileMenuContribution,
  SlashCommandContribution,
  ClaudePluginContribution,
  ClaudePluginCommand,
  ClaudePluginAgent,
  ExtensionModule,
  CustomEditorComponentProps,
  CustomEditorDiffState,
  CustomEditorCapabilities,
  CustomEditorHostCallbacks,
  JSONSchema,
  JSONSchemaProperty,
  ExtensionAITool,
  AIToolContext,
  ExtensionToolResult,
  ExtensionContext,
  ExtensionServices,
  ExtensionFileSystemService,
  ExtensionUIService,
  ExtensionAIService,
  ExtensionConfigurationService,
  ExtensionContextProvider,
  Disposable,
  LoadedExtension,
  ExtensionLoadResult,
  DiscoveredExtension,
} from './types';

// Platform Service
export type { ExtensionPlatformService } from './ExtensionPlatformService';
export {
  setExtensionPlatformService,
  getExtensionPlatformService,
  hasExtensionPlatformService,
} from './ExtensionPlatformService';

// Loader
export {
  ExtensionLoader,
  getExtensionLoader,
  initializeExtensions,
  setEnabledStateProvider,
  setConfigurationServiceProvider,
} from './ExtensionLoader';
export type { ConfigurationServiceProvider } from './ExtensionLoader';

// AI Tools Bridge
export {
  initializeExtensionAIToolsBridge,
  registerExtensionTools,
  unregisterExtensionTools,
  getExtensionTools,
  setOnToolsChangedCallback,
  getMCPToolDefinitions,
  executeExtensionTool,
} from './ExtensionAIToolsBridge';
export type { MCPToolDefinition } from './ExtensionAIToolsBridge';

// Editor Host
export type {
  EditorHost,
  EditorHostProps,
  DiffConfig,
  DiffResult,
} from './editorHost';

// Editor Host Hook
export { useEditorHost } from './useEditorHost';
export type { UseEditorHostOptions, UseEditorHostResult } from './useEditorHost';
