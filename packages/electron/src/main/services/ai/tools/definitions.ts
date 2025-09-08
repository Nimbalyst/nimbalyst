/**
 * Standard tool definitions for AI providers
 */

import { ToolDefinition } from '../types';

export const BUILT_IN_TOOLS: ToolDefinition[] = [
  {
    name: 'applyDiff',
    description: 'Apply text replacements to the current document',
    parameters: {
      type: 'object',
      properties: {
        replacements: {
          type: 'array',
          description: 'Array of text replacements to apply',
          items: {
            type: 'object',
            properties: {
              oldText: {
                type: 'string',
                description: 'The exact text to replace (must match exactly)'
              },
              newText: {
                type: 'string',
                description: 'The text to replace it with'
              }
            },
            required: ['oldText', 'newText']
          }
        }
      },
      required: ['replacements']
    },
    source: 'main'
  },
  
  {
    name: 'streamContent',
    description: 'Stream new content directly to the editor at a specific position',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The content to stream into the editor'
        },
        position: {
          type: 'string',
          enum: ['cursor', 'end', 'after-selection'],
          description: 'Where to insert the content (default: cursor)'
        },
        insertAfter: {
          type: 'string',
          description: 'Optional text to find and insert after'
        },
        mode: {
          type: 'string',
          enum: ['append', 'replace', 'insert'],
          description: 'How to handle the content (default: append)'
        }
      },
      required: ['content']
    },
    source: 'main'
  }
];

// Future renderer-specific tools can be defined here
export const RENDERER_TOOLS: ToolDefinition[] = [
  // Example: Table editing tool
  {
    name: 'editTable',
    description: 'Edit table cells in the current document',
    parameters: {
      type: 'object',
      properties: {
        tableIndex: {
          type: 'number',
          description: 'Index of the table to edit (0-based)'
        },
        row: {
          type: 'number',
          description: 'Row index (0-based)'
        },
        column: {
          type: 'number',
          description: 'Column index (0-based)'
        },
        newContent: {
          type: 'string',
          description: 'New content for the cell'
        }
      },
      required: ['tableIndex', 'row', 'column', 'newContent']
    },
    source: 'renderer'
  },
  
  // Example: Diagram DSL tool
  {
    name: 'createDiagram',
    description: 'Create or update a diagram using DSL',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['mermaid', 'plantuml', 'graphviz'],
          description: 'Type of diagram DSL'
        },
        code: {
          type: 'string',
          description: 'The diagram DSL code'
        },
        position: {
          type: 'string',
          enum: ['cursor', 'end', 'replace-selection'],
          description: 'Where to insert the diagram'
        }
      },
      required: ['type', 'code']
    },
    source: 'renderer'
  }
];

/**
 * Get tool definitions in Anthropic format
 */
export function toAnthropicTools(tools: ToolDefinition[]): any[] {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters
  }));
}

/**
 * Get tool definitions in OpenAI format
 */
export function toOpenAITools(tools: ToolDefinition[]): any[] {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));
}