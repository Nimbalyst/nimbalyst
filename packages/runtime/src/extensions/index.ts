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
  CustomEditorContribution,
  CommandContribution,
  NewFileMenuContribution,
  ExtensionModule,
  CustomEditorComponentProps,
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
} from './ExtensionLoader';

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
