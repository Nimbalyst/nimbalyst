# `@nimbalyst/extension-sdk`

Build Nimbalyst extensions with a stable TypeScript contract and Vite helpers.

This package provides:

- Shared extension types such as `ExtensionContext`, `EditorHostProps`, and `ExtensionAITool`
- `createExtensionConfig()` for the required extension build setup
- `validateExtensionBundle()` for bundle and manifest validation
- Tailwind helpers for extension styling

## Install

```bash
npm install --save-dev @nimbalyst/extension-sdk typescript vite
```

If your extension renders React UI, also install:

```bash
npm install react react-dom
npm install --save-dev @vitejs/plugin-react
```

## Vite Setup

```ts
import react from '@vitejs/plugin-react';
import { createExtensionConfig } from '@nimbalyst/extension-sdk/vite';

export default createExtensionConfig({
  entry: './src/index.tsx',
  plugins: [react()],
});
```

## Custom Editor Example

Use the `useEditorLifecycle` hook to handle all editor lifecycle concerns (loading, saving, echo detection, file watching, diff mode, theme):

```tsx
import { useRef } from 'react';
import { useEditorLifecycle, type EditorHostProps } from '@nimbalyst/extension-sdk';

export function ExampleEditor({ host }: EditorHostProps) {
  const dataRef = useRef<MyData>(defaultData);

  const { isLoading, markDirty, theme } = useEditorLifecycle(host, {
    applyContent: (data: MyData) => { dataRef.current = data; },
    getCurrentContent: () => dataRef.current,
    parse: (raw) => JSON.parse(raw),
    serialize: (data) => JSON.stringify(data),
  });

  if (isLoading) return <div>Loading...</div>;
  return <MyEditorUI data={dataRef.current} onChange={markDirty} />;
}

export const components = {
  ExampleEditor,
};
```

See the [custom editors guide](packages/extension-sdk-docs/custom-editors.md) for architecture patterns and advanced options.

## AI Tool Example

```ts
import type {
  ExtensionAITool,
  ExtensionToolResult,
} from '@nimbalyst/extension-sdk';

export const aiTools: ExtensionAITool[] = [
  {
    name: 'example.describe_file',
    description: 'Describe the active file',
    scope: 'editor',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async (_args, context): Promise<ExtensionToolResult> => {
      const filePath = context.activeFilePath;
      if (!filePath) {
        return { success: false, error: 'No active file.' };
      }

      const content = await context.extensionContext.services.filesystem.readFile(filePath);
      return {
        success: true,
        data: {
          filePath,
          length: content.length,
        },
      };
    },
  },
];
```

## Manifest Notes

- `apiVersion` is currently optional but recommended.
- `contributions.aiTools` must be an array of tool-name strings, not full tool objects.
- `contributions.fileIcons` must be an object map such as `{ "*.csv": "table" }`.

## Docs

- Getting started: `packages/extension-sdk-docs/getting-started.md`
- Manifest reference: `packages/extension-sdk-docs/manifest-reference.md`
- API reference: `packages/extension-sdk-docs/api-reference.md`
- Examples: `packages/extension-sdk-docs/examples/`

## Release Checks

From the monorepo root:

```bash
npm run extension-sdk:check-public
```
