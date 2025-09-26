/**
 * Core markdown transformer aggregation.
 * This module provides both core transformers and a way to aggregate
 * plugin-specific transformers for markdown import/export operations.
 */

import { Transformer } from '@lexical/markdown';

// Core transformers that are always available
import { CORE_TRANSFORMERS } from './core-transformers';

// Plugin registry for dynamic transformers
import { pluginRegistry } from '../plugins/PluginRegistry';

/**
 * Gets the complete set of transformers for the editor, including
 * both core transformers and those from enabled plugins.
 *
 * This is the recommended way to get transformers for editor operations
 * to ensure consistency with the plugin system.
 *
 * Order matters - more specific transformers should come before general ones.
 * Plugin transformers are loaded first so they can override core behavior.
 *
 * @returns Complete transformer array based on enabled plugins
 */
export function getEditorTransformers(): Transformer[] {
  return [
    // Plugin transformers come first (more specific)
    ...pluginRegistry.getAllTransformers(),
    // Core transformers come last (more general)
    ...CORE_TRANSFORMERS,
  ];
}

/**
 * Legacy export for backwards compatibility.
 * @deprecated Use getEditorTransformers() instead
 */
export const MARKDOWN_TRANSFORMERS: Array<Transformer> = CORE_TRANSFORMERS;

/**
 * Function to create a transformer set with specific plugins.
 * Useful for creating custom transformer sets outside of the main editor.
 *
 * @param pluginTransformers - Array of transformers from enabled plugins
 * @returns Complete transformer array
 */
export function createTransformers(
  pluginTransformers: Transformer[] = []
): Transformer[] {
  return [
    ...pluginTransformers,
    ...CORE_TRANSFORMERS,
  ];
}

// Re-export for convenience
// Note: Use the enhanced versions instead ($convertFromEnhancedMarkdownString, $convertToEnhancedMarkdownString)
export { MarkdownStreamProcessor, createHeadlessEditorFromEditor, markdownToJSONSync } from './MarkdownStreamProcessor';
export type { InsertMode } from './MarkdownStreamProcessor';

// Enhanced markdown system with frontmatter support
export {
  $convertToEnhancedMarkdownString,
  $convertNodeToEnhancedMarkdownString,
  type EnhancedExportOptions,
} from './EnhancedMarkdownExport';

export {
  $convertFromEnhancedMarkdownString,
  $updateFrontmatter,
  $mergeFrontmatter,
  $getFrontmatter,
  parseEnhancedMarkdown,
  type EnhancedImportOptions,
  type EnhancedImportResult,
} from './EnhancedMarkdownImport';

export {
  $setFrontmatter,
  parseFrontmatter,
  serializeWithFrontmatter,
  hasFrontmatter,
  isValidFrontmatter,
  type FrontmatterData,
} from './FrontmatterUtils';

// Export markdown configuration functions
export {
  setMarkdownConfig,
  getMarkdownConfig,
  type MarkdownConfig,
} from './MarkdownTransformers';

// Export list-specific configuration functions
export {
  setListConfig,
  getListConfig,
  resetDetectedIndent,
  type ListConfig,
} from './ListTransformers';

// Export markdown normalization functions
export {
  normalizeMarkdown,
  normalizeMarkdownLists,
  detectMarkdownIndentSize,
  type NormalizerConfig,
} from './MarkdownNormalizer';

// Export OUR FORKED markdown import function - never use Lexical's!
export { $convertFromMarkdownStringRexical } from './LexicalMarkdownImport';

