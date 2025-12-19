# Manifest Reference

The `manifest.json` file defines your extension's metadata, permissions, and contributions. This document covers all available fields.

## Basic Structure

```json
{
  "id": "com.example.my-extension",
  "name": "My Extension",
  "version": "1.0.0",
  "description": "What my extension does",
  "author": "Your Name",
  "main": "dist/index.js",
  "styles": "dist/styles.css",
  "apiVersion": "1.0.0",
  "permissions": {},
  "contributions": {}
}
```

## Required Fields

### id

Unique identifier for your extension. Use reverse domain notation:

```json
"id": "com.yourcompany.extension-name"
```

- Must be globally unique
- Use lowercase letters, numbers, dots, and hyphens only
- Cannot be changed after publishing

### name

Human-readable name displayed in the UI:

```json
"name": "CSV Spreadsheet Editor"
```

### version

Semantic version (semver) of your extension:

```json
"version": "1.0.0"
```

### main

Path to the compiled JavaScript entry point:

```json
"main": "dist/index.js"
```

### apiVersion

Version of the Nimbalyst Extension API your extension uses:

```json
"apiVersion": "1.0.0"
```

## Optional Fields

### description

Short description of what your extension does:

```json
"description": "Edit CSV files with a spreadsheet interface"
```

### author

Extension author name or organization:

```json
"author": "Your Name <email@example.com>"
```

### styles

Path to CSS file to include:

```json
"styles": "dist/styles.css"
```

### icon

Path to extension icon (displayed in settings):

```json
"icon": "icon.png"
```

### repository

URL to source code repository:

```json
"repository": "https://github.com/user/extension"
```

### license

SPDX license identifier:

```json
"license": "MIT"
```

## Permissions

Declare what capabilities your extension needs:

```json
"permissions": {
  "filesystem": true,
  "ai": true
}
```

### Available Permissions

| Permission | Description |
| --- | --- |
| `filesystem` | Read/write files through editor APIs |
| `ai` | Register AI tools for Claude |

## Contributions

The `contributions` object declares what your extension adds to Nimbalyst.

### customEditors

Register custom editors for file types:

```json
"contributions": {
  "customEditors": [
    {
      "filePatterns": ["*.csv", "*.tsv"],
      "displayName": "Spreadsheet Editor",
      "component": "SpreadsheetEditor"
    }
  ]
}
```

| Field | Type | Description |
| --- | --- | --- |
| `filePatterns` | `string[]` | Glob patterns for matching files |
| `displayName` | `string` | Name shown in editor selector |
| `component` | `string` | Name of exported React component |

The `component` value must match a key in your exported `components` object:

```typescript
// src/index.ts
export const components = {
  SpreadsheetEditor: SpreadsheetEditorComponent,
};
```

### aiTools

Declare AI tools your extension provides. **This is an array of tool name strings, NOT objects.**

```json
"contributions": {
  "aiTools": [
    "csv.get_schema",
    "csv.get_rows",
    "csv.add_row"
  ]
}
```

**IMPORTANT:** The manifest only lists tool names as strings. The actual tool definitions (with descriptions, input schemas, and handlers) go in your TypeScript code:

```typescript
// src/aiTools.ts - Tool definitions with full details
export const aiTools: ExtensionAITool[] = [
  {
    name: 'csv.get_schema',
    description: 'Get the column names and types from the CSV',
    inputSchema: { type: 'object', properties: {} },
    handler: async (args, context) => { /* ... */ }
  }
];

// src/index.ts - Export the tools
export { aiTools } from './aiTools';
```

**Common mistake:** Don't put objects in the manifest:

```json
// WRONG - will cause runtime errors!
"aiTools": [
  { "name": "csv.get_schema", "description": "..." }
]

// CORRECT - just the tool names
"aiTools": [
  "csv.get_schema"
]
```

### newFileMenu

Add entries to the "New File" menu:

```json
"contributions": {
  "newFileMenu": [
    {
      "extension": ".csv",
      "displayName": "CSV Spreadsheet",
      "icon": "table",
      "defaultContent": "Column A,Column B,Column C\n,,\n,,"
    }
  ]
}
```

| Field | Type | Description |
| --- | --- | --- |
| `extension` | `string` | File extension including dot |
| `displayName` | `string` | Name shown in menu |
| `icon` | `string` | Material icon name |
| `defaultContent` | `string` | Initial file content |

### fileIcons

Custom icons for file types in the sidebar:

```json
"contributions": {
  "fileIcons": {
    "*.csv": "table",
    "*.tsv": "table",
    "*.json": "data_object"
  }
}
```

Keys are glob patterns, values are Material icon names.

### slashCommands

Register slash commands for the editor:

```json
"contributions": {
  "slashCommands": [
    {
      "name": "insert-chart",
      "displayName": "Insert Chart",
      "description": "Insert a chart from CSV data",
      "handler": "insertChartCommand"
    }
  ]
}
```

| Field | Type | Description |
| --- | --- | --- |
| `name` | `string` | Command identifier |
| `displayName` | `string` | Shown in command palette |
| `description` | `string` | Help text |
| `handler` | `string` | Name of exported handler function |

## Complete Example

Here's a complete manifest for a CSV editor extension:

```json
{
  "id": "com.nimbalyst.csv-spreadsheet",
  "name": "CSV Spreadsheet",
  "version": "1.0.0",
  "description": "Edit CSV files with a spreadsheet interface and formula support",
  "author": "Nimbalyst",
  "main": "dist/index.js",
  "styles": "dist/styles.css",
  "apiVersion": "1.0.0",
  "license": "MIT",
  "repository": "https://github.com/nimbalyst/csv-spreadsheet",
  "permissions": {
    "filesystem": true,
    "ai": true
  },
  "contributions": {
    "customEditors": [
      {
        "filePatterns": ["*.csv", "*.tsv"],
        "displayName": "Spreadsheet Editor",
        "component": "SpreadsheetEditor"
      }
    ],
    "aiTools": [
      "csv.get_schema",
      "csv.get_rows",
      "csv.query"
    ],
    "fileIcons": {
      "*.csv": "table",
      "*.tsv": "table"
    },
    "newFileMenu": [
      {
        "extension": ".csv",
        "displayName": "CSV Spreadsheet",
        "icon": "table",
        "defaultContent": "Column A,Column B,Column C\n,,\n,,\n,,"
      }
    ]
  }
}
```

## File Pattern Syntax

File patterns use glob syntax:

| Pattern | Matches |
| --- | --- |
| `*.csv` | Any file ending in `.csv` |
| `*.{csv,tsv}` | Files ending in `.csv` or `.tsv` |
| `data/*.json` | JSON files in `data/` folder |
| `**/*.test.ts` | Test files anywhere in tree |

## Validation

Nimbalyst validates your manifest on load. Common errors:

- **Missing required fields** - Add `id`, `name`, `version`, `main`, `apiVersion`
- **Invalid id format** - Use lowercase, dots, and hyphens only
- **Component not found** - Ensure component name matches export
- **Invalid version** - Use semver format (e.g., `1.0.0`)

## Best Practices

1. **Use descriptive ids** - `com.company.feature-description`
2. **Keep descriptions short** - One sentence, under 100 characters
3. **Request minimal permissions** - Only what you need
4. **Include all file patterns** - Don't miss common variations
5. **Test with validation** - Use `validateExtensionBundle()` during development
