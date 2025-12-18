# Getting Started with Nimbalyst Extensions

This guide walks you through creating your first Nimbalyst extension. By the end, you'll have a working extension that registers a custom editor for `.hello` files.

## Prerequisites

1. **Enable Extension Dev Tools** - Go to Settings > Advanced and enable "Extension Dev Tools"
2. **Node.js 18+** - Required for building extensions

## Step 1: Create the Project

Create a new directory for your extension:

```bash
mkdir my-first-extension
cd my-first-extension
npm init -y
```

## Step 2: Install Dependencies

```bash
npm install --save-dev typescript vite @nimbalyst/extension-sdk
npm install react
```

## Step 3: Create the Manifest

Create `manifest.json` - this tells Nimbalyst about your extension:

```json
{
  "id": "com.example.hello-editor",
  "name": "Hello Editor",
  "version": "1.0.0",
  "description": "A simple custom editor for .hello files",
  "main": "dist/index.js",
  "apiVersion": "1.0.0",
  "contributions": {
    "customEditors": [
      {
        "filePatterns": ["*.hello"],
        "displayName": "Hello Editor",
        "component": "HelloEditor"
      }
    ],
    "newFileMenu": [
      {
        "extension": ".hello",
        "displayName": "Hello File",
        "icon": "description",
        "defaultContent": "Hello, World!"
      }
    ]
  }
}
```

## Step 4: Create the Vite Config

Create `vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import { createExtensionConfig } from '@nimbalyst/extension-sdk/vite';

export default defineConfig(
  createExtensionConfig({
    // Add any custom vite config here
  })
);
```

## Step 5: Create the TypeScript Config

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

## Step 6: Create the Extension Entry Point

Create `src/index.ts`:

```typescript
import { HelloEditor } from './HelloEditor';

// Export components that the manifest references
export const components = {
  HelloEditor,
};

// Called when the extension is loaded
export function activate(context: { extensionPath: string }) {
  console.log('Hello Editor extension activated!');
}

// Called when the extension is unloaded
export function deactivate() {
  console.log('Hello Editor extension deactivated');
}
```

## Step 7: Create the Editor Component

Create `src/HelloEditor.tsx`:

```tsx
import React, { useState, useEffect } from 'react';

interface HelloEditorProps {
  content: string;
  filePath: string;
  onChange: (content: string) => void;
}

export function HelloEditor({ content, filePath, onChange }: HelloEditorProps) {
  const [text, setText] = useState(content);

  // Update local state when content prop changes (file reload)
  useEffect(() => {
    setText(content);
  }, [content]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setText(newText);
    onChange(newText); // Notify Nimbalyst of changes
  };

  return (
    <div style={{
      padding: '20px',
      height: '100%',
      display: 'flex',
      flexDirection: 'column'
    }}>
      <h2 style={{ marginBottom: '10px' }}>Hello Editor</h2>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '10px' }}>
        Editing: {filePath}
      </p>
      <textarea
        value={text}
        onChange={handleChange}
        style={{
          flex: 1,
          padding: '10px',
          fontSize: '16px',
          fontFamily: 'monospace',
          backgroundColor: 'var(--surface-secondary)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-primary)',
          borderRadius: '4px',
          resize: 'none'
        }}
      />
    </div>
  );
}
```

## Step 8: Add Build Script

Update your `package.json` to add a build script:

```json
{
  "scripts": {
    "build": "vite build"
  }
}
```

## Step 9: Build and Install

Now ask Claude to build and install your extension:

> "Build and install my extension from ~/my-first-extension"

Claude will use the `extension_build` and `extension_install` tools to compile and load your extension.

## Step 10: Test It

1. Create a new file with the `.hello` extension
2. Your custom editor should appear instead of the default text editor
3. Make changes and save - they persist to the file

## Next Steps

- Add styling with a `styles.css` file
- Add AI tools so Claude can interact with your editor
- Add a toolbar with actions
- Handle more complex file formats

See the [Custom Editors](./custom-editors.md) guide for more advanced editor development.

## Troubleshooting

### Extension doesn't load

1. Check the console for errors (View > Toggle Developer Tools)
2. Verify your `manifest.json` has a valid `id` field
3. Make sure `dist/index.js` exists after building

### Editor doesn't appear for file type

1. Check that `filePatterns` in the manifest matches your file extension
2. Verify the `component` name matches what you export in `components`

### Changes don't appear after editing

Ask Claude to reload the extension:

> "Reload my hello-editor extension"

This will rebuild and hot-reload without restarting Nimbalyst.
