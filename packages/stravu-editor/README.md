# [Stravu Editor](https://)

A powerful and extensible rich text editor built with Meta's Lexical framework, featuring markdown support, tables, and comprehensive editing capabilities.

## Installation

```bash
npm install stravu-editor
# or
yarn add stravu-editor
# or
pnpm add stravu-editor
```

## Usage

```tsx
import React from 'react';
import { StravuEditor } from 'stravu-editor';
import 'stravu-editor/styles';

function App() {
  return (
    <div className="my-app">
      <StravuEditor />
    </div>
  );
}
```

## Features

- 📝 Rich text editing with full formatting support
- 📊 Tables with advanced cell operations
- 🎨 Code highlighting with syntax support
- 🖼️ Image handling with drag & drop
- 📐 Markdown shortcuts and transformations
- 🎯 Mentions and hashtags
- 🔗 Auto-linking URLs
- 📋 Copy/paste with format preservation
- ⚡ Extensible plugin system
- 🌙 Dark mode support

## Configuration

```tsx
import { StravuEditor, type EditorConfig } from 'stravu-editor';

const config: EditorConfig = {
  theme: 'dark',
  emptyEditor: false,
  // ... other options
};

<StravuEditor config={config} />
```

## License

MIT