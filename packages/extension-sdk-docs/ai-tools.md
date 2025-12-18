# Adding AI Tools to Extensions

AI tools let Claude interact with your extension programmatically. When you add tools, Claude can read data, make changes, and help users work with your custom file types.

## Why Add AI Tools?

Without tools, Claude can only:
- Read the raw file content
- Suggest edits to the raw content

With tools, Claude can:
- Query structured data ("What columns are in this spreadsheet?")
- Make targeted changes ("Add a row with these values")
- Perform complex operations ("Sort by the date column")
- Understand your data model ("What entities are defined?")

## Tool Definition Structure

Tools are defined in your extension's entry point:

```typescript
// src/index.ts
import type { ExtensionAITool } from '@nimbalyst/extension-sdk';

export const aiTools: ExtensionAITool[] = [
  {
    name: 'my_tool_name',
    description: 'What this tool does - Claude reads this to decide when to use it',
    inputSchema: {
      type: 'object',
      properties: {
        param1: {
          type: 'string',
          description: 'Description of param1',
        },
        param2: {
          type: 'number',
          description: 'Description of param2',
        },
      },
      required: ['param1'],
    },
    handler: async (args, context) => {
      // Implement tool logic
      return { result: 'success' };
    },
  },
];
```

## Registering Tools in the Manifest

Add tools to your `manifest.json`:

```json
{
  "permissions": {
    "ai": true
  },
  "contributions": {
    "aiTools": [
      "myext.get_data",
      "myext.update_data"
    ]
  }
}
```

## Tool Handler Context

The handler receives a context object with useful information:

```typescript
interface ToolContext {
  // Path to the currently open file (if any)
  filePath?: string;

  // Current content of the file
  fileContent?: string;

  // Path to your extension's installation directory
  extensionPath: string;
}
```

## Example: Spreadsheet Tools

Here's a complete example for a CSV/spreadsheet editor:

```typescript
import type { ExtensionAITool } from '@nimbalyst/extension-sdk';

// Helper to parse CSV
function parseCSV(content: string): string[][] {
  return content.split('\n').map(row => row.split(','));
}

export const aiTools: ExtensionAITool[] = [
  {
    name: 'csv.get_schema',
    description: 'Get the column names and row count of the current CSV file',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async (_args, context) => {
      if (!context.fileContent) {
        return { error: 'No file is currently open' };
      }

      const rows = parseCSV(context.fileContent);
      const headers = rows[0] || [];

      return {
        columns: headers,
        rowCount: rows.length - 1, // Exclude header row
        filePath: context.filePath,
      };
    },
  },

  {
    name: 'csv.get_rows',
    description: 'Get rows from the CSV file. Returns data as objects with column names as keys.',
    inputSchema: {
      type: 'object',
      properties: {
        startRow: {
          type: 'number',
          description: 'Starting row index (0-based, excluding header)',
        },
        count: {
          type: 'number',
          description: 'Number of rows to return (default: 10)',
        },
      },
    },
    handler: async (args, context) => {
      if (!context.fileContent) {
        return { error: 'No file is currently open' };
      }

      const rows = parseCSV(context.fileContent);
      const headers = rows[0] || [];
      const dataRows = rows.slice(1);

      const start = args.startRow || 0;
      const count = args.count || 10;
      const selectedRows = dataRows.slice(start, start + count);

      return {
        rows: selectedRows.map(row => {
          const obj: Record<string, string> = {};
          headers.forEach((h, i) => {
            obj[h] = row[i] || '';
          });
          return obj;
        }),
        totalRows: dataRows.length,
      };
    },
  },

  {
    name: 'csv.add_row',
    description: 'Add a new row to the CSV file',
    inputSchema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          description: 'Object with column names as keys and cell values',
        },
      },
      required: ['data'],
    },
    handler: async (args, context) => {
      if (!context.fileContent) {
        return { error: 'No file is currently open' };
      }

      const rows = parseCSV(context.fileContent);
      const headers = rows[0] || [];

      // Build new row from data object
      const newRow = headers.map(h => args.data[h] || '');
      rows.push(newRow);

      // Return the new content - Nimbalyst will update the file
      return {
        success: true,
        newContent: rows.map(r => r.join(',')).join('\n'),
        rowIndex: rows.length - 1,
      };
    },
  },
];
```

## Updating File Content

When a tool needs to modify the file, return a `newContent` field:

```typescript
handler: async (args, context) => {
  // ... modify data ...

  return {
    success: true,
    newContent: serializedData, // This updates the file
    message: 'Row added successfully',
  };
}
```

Nimbalyst will:
1. Update the file content
2. Mark the file as dirty (unsaved)
3. Refresh the editor view

## Tool Naming Conventions

Use a prefix for your tools to avoid conflicts:

```
extensionname.action_name
```

Examples:
- `csv.get_schema`
- `csv.add_row`
- `diagram.add_node`
- `datamodel.get_entities`

## Writing Good Tool Descriptions

Claude uses the description to decide when to use your tool. Be specific:

**Good:**
```typescript
description: 'Get the column names and data types from the current CSV file. Returns an array of column definitions.'
```

**Bad:**
```typescript
description: 'Get schema'  // Too vague
```

## Error Handling

Return errors as objects, not thrown exceptions:

```typescript
handler: async (args, context) => {
  if (!context.fileContent) {
    return { error: 'No file is currently open' };
  }

  if (!args.columnName) {
    return { error: 'columnName parameter is required' };
  }

  try {
    // ... do work ...
    return { success: true, data: result };
  } catch (e) {
    return { error: `Failed to process: ${e.message}` };
  }
}
```

## Input Schema

The `inputSchema` follows JSON Schema format:

```typescript
inputSchema: {
  type: 'object',
  properties: {
    // String parameter
    name: {
      type: 'string',
      description: 'The name to use',
    },

    // Number parameter
    count: {
      type: 'number',
      description: 'How many items',
    },

    // Boolean parameter
    includeHeaders: {
      type: 'boolean',
      description: 'Whether to include header row',
    },

    // Enum parameter
    format: {
      type: 'string',
      enum: ['json', 'csv', 'xml'],
      description: 'Output format',
    },

    // Array parameter
    columns: {
      type: 'array',
      items: { type: 'string' },
      description: 'List of column names',
    },

    // Object parameter
    options: {
      type: 'object',
      properties: {
        sortBy: { type: 'string' },
        ascending: { type: 'boolean' },
      },
    },
  },
  required: ['name'], // Required parameters
}
```

## Best Practices

1. **Keep tools focused** - One tool, one job
2. **Return structured data** - Objects are easier for Claude to work with
3. **Include context in responses** - Return relevant metadata
4. **Handle missing files gracefully** - Check if `fileContent` exists
5. **Validate inputs** - Check required parameters
6. **Use descriptive names** - `get_column_stats` not `stats`

## Testing Tools

Test your tools by asking Claude to use them:

> "What columns are in this CSV file?"

Claude should invoke your `csv.get_schema` tool and report the results.

## Example: Data Model Tools

For a more complex example, here are tools for a data modeling extension:

```typescript
export const aiTools: ExtensionAITool[] = [
  {
    name: 'datamodel.get_entities',
    description: 'List all entities (tables/models) defined in the data model',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, context) => {
      const model = parseDataModel(context.fileContent);
      return {
        entities: model.entities.map(e => ({
          name: e.name,
          fieldCount: e.fields.length,
        })),
      };
    },
  },

  {
    name: 'datamodel.get_entity',
    description: 'Get detailed information about a specific entity',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Entity name' },
      },
      required: ['name'],
    },
    handler: async (args, context) => {
      const model = parseDataModel(context.fileContent);
      const entity = model.entities.find(e => e.name === args.name);

      if (!entity) {
        return { error: `Entity '${args.name}' not found` };
      }

      return {
        name: entity.name,
        fields: entity.fields.map(f => ({
          name: f.name,
          type: f.type,
          required: f.required,
        })),
        relations: entity.relations,
      };
    },
  },

  {
    name: 'datamodel.add_field',
    description: 'Add a new field to an entity',
    inputSchema: {
      type: 'object',
      properties: {
        entityName: { type: 'string' },
        fieldName: { type: 'string' },
        fieldType: { type: 'string' },
        required: { type: 'boolean' },
      },
      required: ['entityName', 'fieldName', 'fieldType'],
    },
    handler: async (args, context) => {
      const model = parseDataModel(context.fileContent);
      const entity = model.entities.find(e => e.name === args.entityName);

      if (!entity) {
        return { error: `Entity '${args.entityName}' not found` };
      }

      entity.fields.push({
        name: args.fieldName,
        type: args.fieldType,
        required: args.required ?? false,
      });

      return {
        success: true,
        newContent: serializeDataModel(model),
      };
    },
  },
];
```

## Next Steps

- See [Custom Editors](./custom-editors.md) to build the visual component
- Check [Manifest Reference](./manifest-reference.md) for all configuration options
- Look at [examples/ai-tool](./examples/ai-tool/) for a complete working example
