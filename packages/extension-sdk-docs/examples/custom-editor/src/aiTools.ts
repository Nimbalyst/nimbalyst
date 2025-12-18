/**
 * AI Tools for JSON Viewer
 *
 * These tools let Claude interact with JSON data programmatically.
 */

import type { ExtensionAITool } from '@nimbalyst/extension-sdk';

export const aiTools: ExtensionAITool[] = [
  {
    name: 'json.get_structure',
    description: 'Get the structure of the JSON document showing keys and types at each level',
    inputSchema: {
      type: 'object',
      properties: {
        maxDepth: {
          type: 'number',
          description: 'Maximum depth to traverse (default: 3)',
        },
      },
    },
    handler: async (args, context) => {
      if (!context.fileContent) {
        return { error: 'No file is currently open' };
      }

      try {
        const data = JSON.parse(context.fileContent);
        const maxDepth = args.maxDepth ?? 3;

        const getStructure = (value: unknown, depth: number): unknown => {
          if (depth > maxDepth) return '...';

          if (value === null) return 'null';
          if (Array.isArray(value)) {
            if (value.length === 0) return '[]';
            return [getStructure(value[0], depth + 1)];
          }
          if (typeof value === 'object') {
            const result: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(value)) {
              result[k] = getStructure(v, depth + 1);
            }
            return result;
          }
          return typeof value;
        };

        return {
          structure: getStructure(data, 0),
          filePath: context.filePath,
        };
      } catch (e) {
        return { error: `Failed to parse JSON: ${(e as Error).message}` };
      }
    },
  },

  {
    name: 'json.get_value',
    description: 'Get the value at a specific path in the JSON document',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Dot-notation path (e.g., "users.0.name")',
        },
      },
      required: ['path'],
    },
    handler: async (args, context) => {
      if (!context.fileContent) {
        return { error: 'No file is currently open' };
      }

      try {
        const data = JSON.parse(context.fileContent);
        const pathParts = args.path.split('.');

        let current: any = data;
        for (const part of pathParts) {
          if (current === undefined || current === null) {
            return { error: `Path not found: ${args.path}` };
          }
          current = current[part];
        }

        return {
          path: args.path,
          value: current,
          type: Array.isArray(current) ? 'array' : typeof current,
        };
      } catch (e) {
        return { error: `Failed to parse JSON: ${(e as Error).message}` };
      }
    },
  },

  {
    name: 'json.set_value',
    description: 'Set the value at a specific path in the JSON document',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Dot-notation path (e.g., "users.0.name")',
        },
        value: {
          description: 'The new value to set (any JSON-compatible type)',
        },
      },
      required: ['path', 'value'],
    },
    handler: async (args, context) => {
      if (!context.fileContent) {
        return { error: 'No file is currently open' };
      }

      try {
        const data = JSON.parse(context.fileContent);
        const pathParts = args.path.split('.');

        // Navigate to parent
        let current: any = data;
        for (let i = 0; i < pathParts.length - 1; i++) {
          const part = pathParts[i];
          if (current[part] === undefined) {
            // Create intermediate objects/arrays as needed
            const nextPart = pathParts[i + 1];
            current[part] = isNaN(Number(nextPart)) ? {} : [];
          }
          current = current[part];
        }

        // Set the value
        const lastPart = pathParts[pathParts.length - 1];
        const oldValue = current[lastPart];
        current[lastPart] = args.value;

        return {
          success: true,
          path: args.path,
          oldValue,
          newValue: args.value,
          newContent: JSON.stringify(data, null, 2),
        };
      } catch (e) {
        return { error: `Failed to update JSON: ${(e as Error).message}` };
      }
    },
  },
];
