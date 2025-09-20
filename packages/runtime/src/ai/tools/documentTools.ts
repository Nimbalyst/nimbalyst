import type { ToolDefinition } from './index';

export const DOCUMENT_TOOLS: ToolDefinition[] = [
  {
    name: 'getDocumentContent',
    description: 'Get the current content of the open document in the editor',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    source: 'runtime',
  },
  {
    name: 'updateFrontmatter',
    description: 'Update the frontmatter of a markdown document with new metadata',
    parameters: {
      type: 'object',
      properties: {
        updates: {
          type: 'object',
          description: 'Key-value pairs to update in the frontmatter (e.g., { status: "completed", title: "My Document" })',
          additionalProperties: true,
        },
      },
      required: ['updates'],
    },
    source: 'runtime',
  },
];