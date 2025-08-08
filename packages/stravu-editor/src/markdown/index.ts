/**
 * Core markdown transformer aggregation.
 * This module provides both core transformers and a way to aggregate
 * plugin-specific transformers for markdown import/export operations.
 */

import { Transformer } from '@lexical/markdown';

// Core transformers that are always available
import { CORE_TRANSFORMERS } from './core-transformers';

// Plugin-specific transformers - will be dynamically loaded in the future
// For now, these are statically imported but will eventually be injected
// via the plugin system based on configuration
import { TABLE_TRANSFORMER } from '../plugins/TablePlugin/TableTransformer';
import { IMAGE_TRANSFORMER } from '../plugins/ImagesPlugin/ImageTransformer';
import { EMOJI_TRANSFORMER } from '../plugins/EmojisPlugin/EmojiTransformer';
import { COLLAPSIBLE_TRANSFORMER } from '../plugins/CollapsiblePlugin/CollapsibleTransformer';

// TODO: Move ExcalidrawTransform when refactoring that plugin
import { ExcalidrawTransform } from '../plugins/ExcalidrawPlugin/ExcalidrawNode/excalidrawTransform';

/**
 * Plugin transformers that require specific plugins to be loaded.
 * In the future, these will be dynamically injected based on which
 * plugins are included in the editor configuration.
 */
export const PLUGIN_TRANSFORMERS: Array<Transformer> = [
  // These transformers require their respective plugins to be loaded
  COLLAPSIBLE_TRANSFORMER,
  ExcalidrawTransform,
  TABLE_TRANSFORMER,
  IMAGE_TRANSFORMER,
  EMOJI_TRANSFORMER,
];

/**
 * Complete set of transformers for the Stravu editor.
 * This currently includes both core and plugin transformers.
 *
 * In the future plugin architecture:
 * - CORE_TRANSFORMERS will always be included
 * - Plugin transformers will be added dynamically based on config
 *
 * Order matters - more specific transformers should come before general ones.
 */
export const MARKDOWN_TRANSFORMERS: Array<Transformer> = [
  // Plugin-specific transformers (will be conditional in the future)
  ...PLUGIN_TRANSFORMERS,

  // Core transformers (always included)
  ...CORE_TRANSFORMERS,
];

/**
 * Function to create a transformer set with specific plugins.
 * This is a preview of the future API where plugins can be
 * selectively included.
 *
 * @param pluginTransformers - Array of transformers from enabled plugins
 * @returns Complete transformer array
 */
export function createTransformers(
  pluginTransformers: Transformer[] = PLUGIN_TRANSFORMERS
): Transformer[] {
  return [
    ...pluginTransformers,
    ...CORE_TRANSFORMERS,
  ];
}

// Re-export for convenience
export { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown';
