/**
 * DatamodelLM AI Tools
 *
 * AI tools for interacting with the data model editor.
 *
 * Note: Schema editing (create/update/delete entity/relationship) is now handled
 * by Claude directly editing the Prisma schema file. These tools provide
 * read-only access and screenshot capture functionality.
 */

import type { DataModelStoreApi } from './store';

// Registry of active editor stores by file path
const activeStores = new Map<string, DataModelStoreApi>();

/**
 * Register an editor's store for AI tool access
 */
export function registerEditorStore(filePath: string, store: DataModelStoreApi): void {
  activeStores.set(filePath, store);
  console.log('[DatamodelLM] Registered store for:', filePath);
}

/**
 * Unregister an editor's store
 */
export function unregisterEditorStore(filePath: string): void {
  activeStores.delete(filePath);
  console.log('[DatamodelLM] Unregistered store for:', filePath);
}

/**
 * Get the store for a file path
 */
function getStore(filePath?: string): DataModelStoreApi | null {
  if (filePath && activeStores.has(filePath)) {
    return activeStores.get(filePath)!;
  }
  // If no specific path, try to get the first/only active store
  if (activeStores.size === 1) {
    return activeStores.values().next().value ?? null;
  }
  return null;
}

/**
 * AI Tool definitions for DatamodelLM
 *
 * Schema manipulation is handled by editing the .prisma file directly.
 * These tools provide supplementary functionality.
 */
export const aiTools = [
  {
    name: 'get_schema',
    description: `Get the current data model schema. Use this to understand the existing entities and relationships before making changes.

Example usage:
- "What tables exist?"
- "Show me the current schema"
- "What fields does User have?"`,
    parameters: {
      type: 'object' as const,
      properties: {},
    },
    handler: async (_params: Record<string, never>, context: { activeFilePath?: string }) => {
      const store = getStore(context.activeFilePath);
      if (!store) {
        return {
          success: false,
          error: 'No active data model editor found. Please open a .prisma file first.',
        };
      }

      const state = store.getState();
      const { entities, relationships, database } = state;

      const schema = {
        database,
        entities: entities.map(e => ({
          name: e.name,
          description: e.description,
          fields: e.fields.map(f => ({
            name: f.name,
            type: f.dataType,
            isPrimaryKey: f.isPrimaryKey,
            isForeignKey: f.isForeignKey,
            isNullable: f.isNullable,
            isArray: f.isArray,
            isEmbedded: f.isEmbedded,
          })),
        })),
        relationships: relationships.map(r => ({
          from: `${r.sourceEntityName}.${r.sourceFieldName || 'id'}`,
          to: `${r.targetEntityName}.${r.targetFieldName || 'id'}`,
          type: r.type,
        })),
      };

      return {
        success: true,
        message: `Found ${entities.length} entities and ${relationships.length} relationships.`,
        data: schema,
      };
    },
  },

  {
    name: 'capture_screenshot',
    description: `Capture a screenshot of the current data model diagram. Use this when the user wants to see or share the visual representation of their schema.

Example usage:
- "Show me the diagram"
- "Take a screenshot of the data model"
- "Let me see how this looks"`,
    parameters: {
      type: 'object' as const,
      properties: {},
    },
    handler: async (_params: Record<string, never>, context: { activeFilePath?: string }) => {
      const store = getStore(context.activeFilePath);
      if (!store) {
        return {
          success: false,
          error: 'No active data model editor found. Please open a .prisma file first.',
        };
      }

      // The screenshot will be captured by the extension platform
      // We return a special response that triggers screenshot capture
      return {
        success: true,
        message: 'Screenshot capture requested.',
        captureScreenshot: true,
        data: {
          filePath: context.activeFilePath,
          entityCount: store.getState().entities.length,
        },
      };
    },
  },
];
