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
  {
    name: 'createDocument',
    description: 'Create a new document file and switch the editor to it. Use this when you need to create new documentation or files in specific folders.',
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Relative path from workspace root where to create the file (e.g., "docs/user-guide.md" or "plans/new-feature.md")',
        },
        initialContent: {
          type: 'string',
          description: 'Initial content for the file. If not provided, file will be created empty.',
        },
        switchToFile: {
          type: 'boolean',
          description: 'Whether to switch the editor to the newly created file (default: true)',
        },
      },
      required: ['filePath'],
    },
    source: 'runtime',
  },
];