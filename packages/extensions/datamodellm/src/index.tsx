/**
 * DatamodelLM Extension
 *
 * A Nimbalyst extension for AI-assisted data modeling with visual
 * entity-relationship diagrams.
 *
 * This extension provides:
 * - A custom editor for .datamodel files
 * - Visual canvas with drag-and-drop entities
 * - Crow's foot notation for relationships
 * - AI tools for schema manipulation (coming soon)
 */

import './styles.css';
import { DatamodelLMEditor } from './components/DatamodelLMEditor';

// Export types for consumers
export type {
  Entity,
  Field,
  Relationship,
  Database,
  EntityViewMode,
  DataModelFile,
} from './types';

/**
 * Extension activation
 * Called when the extension is loaded
 */
export async function activate(context: unknown) {
  console.log('[DatamodelLM] Extension activated');
  console.log('[DatamodelLM] Extension context:', context);
}

/**
 * Extension deactivation
 * Called when the extension is unloaded
 */
export async function deactivate() {
  console.log('[DatamodelLM] Extension deactivated');
}

/**
 * Components exported by this extension
 * These are referenced in the manifest.json
 */
export const components = {
  DatamodelLMEditor,
};

/**
 * AI tools exported by this extension (coming in Phase 2)
 */
export const aiTools: unknown[] = [];
