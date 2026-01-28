/**
 * MockupLM Extension
 *
 * A Nimbalyst extension for creating and editing visual UX mockups using HTML/CSS.
 *
 * This extension provides:
 * - A custom editor for .mockup.html files
 * - Drawing and annotation capabilities
 * - Screenshot capture for AI context
 * - Slider-based diff comparison for changes
 */

import { MockupEditor } from './components/MockupEditor';

// Export types for consumers
export type { } from './components/MockupEditor';

/**
 * Extension activation
 * Called when the extension is loaded
 */
export async function activate(context: unknown) {
  console.log('[MockupLM] Extension activated');
}

/**
 * Extension deactivation
 * Called when the extension is unloaded
 */
export async function deactivate() {
  console.log('[MockupLM] Extension deactivated');
}

/**
 * Components exported by this extension
 * These are referenced in the manifest.json
 */
export const components = {
  MockupEditor,
};

/**
 * AI tools exported by this extension
 * MockupLM uses the shared capture_editor_screenshot tool from the core MCP server
 */
export const aiTools = {};
