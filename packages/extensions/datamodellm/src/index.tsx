/**
 * DatamodelLM Extension
 *
 * A Nimbalyst extension for AI-assisted data modeling with visual
 * entity-relationship diagrams.
 *
 * This extension provides:
 * - A custom editor for .prisma files
 * - Visual canvas with drag-and-drop entities
 * - Crow's foot notation for relationships
 * - AI tools for schema manipulation
 * - Lexical integration for embedding data models in documents
 */

import './styles.css';
import { DatamodelLMEditor } from './components/DatamodelLMEditor';
import { aiTools as datamodelAITools } from './aiTools';

// Lexical integration imports
import {
  DataModelNode,
  DATAMODEL_TRANSFORMER,
  DataModelPickerMenuHost,
  showDataModelPickerMenu,
  setDataModelPlatformService,
} from './lexical';

// Export types for consumers
export type {
  Entity,
  Field,
  Relationship,
  Database,
  EntityViewMode,
  DataModelFile,
} from './types';

// Export store registration for AI tools
export { registerEditorStore, unregisterEditorStore } from './aiTools';

// Export lexical integration
export * from './lexical';

/**
 * Extension activation
 * Called when the extension is loaded
 */
export async function activate(context: unknown) {
  console.log('[DatamodelLM] Extension activated');
  console.log('[DatamodelLM] Extension context:', context);

  // Set up the platform service from the host
  // The host exposes the DataModelPlatformService implementation via window.__nimbalyst_extensions
  const hostExtensions = (window as any).__nimbalyst_extensions;
  if (hostExtensions && hostExtensions['@nimbalyst/datamodel-platform-service']) {
    const platformServiceModule = hostExtensions['@nimbalyst/datamodel-platform-service'];
    const service = platformServiceModule.getInstance();

    // Configure the showDataModelPicker method to use our picker menu
    service.showDataModelPicker = showDataModelPickerMenu;

    // Set the platform service for the Lexical integration
    setDataModelPlatformService(service);

    console.log('[DatamodelLM] Platform service initialized');
  } else {
    console.warn('[DatamodelLM] Host platform service not available - Lexical integration will not work');
  }
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
 * AI tools exported by this extension
 * These enable Claude to create and modify data models through conversation.
 */
export const aiTools = datamodelAITools;

/**
 * Lexical nodes exported by this extension
 * These are registered with the editor for embedding data models in documents.
 */
export const nodes = {
  DataModelNode,
};

/**
 * Markdown transformers exported by this extension
 * These handle import/export of data model references in markdown.
 */
export const transformers = {
  DATAMODEL_TRANSFORMER,
};

/**
 * Host components exported by this extension
 * These are mounted at the app level (e.g., picker menus).
 */
export const hostComponents = {
  DataModelPickerMenuHost,
};

/**
 * Slash command handlers exported by this extension
 * These are invoked when the user triggers the corresponding slash command.
 */
export const slashCommandHandlers = {
  handleInsertDataModel: () => {
    showDataModelPickerMenu();
  },
};
