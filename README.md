# Stravu Editor

A rich text editor built with Meta's Lexical framework, transformed from the Lexical playground into a markdown editor component with comprehensive features including rich text editing, tables and code highlighting.

## Features

### 🔥 Core Editor Features
- **Rich Text Editing**: Full-featured WYSIWYG editor with support for bold, italic, underline, strikethrough, and more
- **Markdown Support**: Toggle between rich text and markdown source view with the markdown button in the toolbar
- **Tables**: Create, edit, and manage tables with cell merging, background colors, and horizontal scrolling
- **Code Blocks**: Syntax highlighting with support for multiple languages via Prism.js or Shiki
- **Lists**: Ordered and unordered lists with nested indentation and checkboxes
- **Images**: Inline and block images with drag-and-drop support
- **Excalidraw**: Embedded drawing support

### 📁 File Management
- **Hybrid File System**: Supports web File System Access API, Origin Private File System (OPFS), and Electron
- **Auto-save**: Automatic saving with configurable intervals (default 2000ms)
- **Manual Save**: Cmd+S (Mac) / Ctrl+S (Windows) keyboard shortcuts
- **File Operations**: New File, Open File, Load File, and Save File operations
- **URL Integration**: File names are reflected in the URL for bookmarking and sharing

## Installation

```bash
# Install dependencies
pnpm install

# Start development server
pnpm run dev

# Build for development
pnpm run build-dev

# Build for production
pnpm run build-prod

# Preview built application
pnpm run preview
```

## Usage

### As a Standalone Editor

The project runs in development mode with full file management capabilities:

```bash
pnpm run dev
```

Visit `http://localhost:4000` to access the editor with:
- File management toolbar (New File, Load File, Open File, Save File)
- URL-based file naming
- Auto-save functionality
- Full-screen editor experience

### As a Component

Import and use the `StravaEditor` component in your React application:

```tsx
import { StravaEditor } from './src/App';
import { EditorConfig } from './src/EditorConfig';

const config: EditorConfig = {
  isRichText: true,
  autoSaveInterval: 3000,
  // ... other configuration options
};

function MyApp() {
  return <StravaEditor config={config} />;
}
```

## Configuration

The editor is highly configurable through the `EditorConfig` interface:

```typescript
interface EditorConfig {
  // Core editor behavior
  isRichText?: boolean;
  emptyEditor?: boolean;
  
  // Features
  isAutocomplete?: boolean;
  hasLinkAttributes?: boolean;
  isCodeHighlighted?: boolean;
  showTableOfContents?: boolean;
  
  // File operations
  fileService?: FileService;
  autoSaveInterval?: number;
  onContentChange?: (content: string) => void;
  onFileNameChange?: (fileName: string | null) => void;
  initialContent?: string;
  
  // Table features
  tableCellBackgroundColor?: boolean;
  tableCellMerge?: boolean;
  tableHorizontalScroll?: boolean;
  
  // And many more options...
}
```

## File Services

The editor supports three file service implementations:

### 1. Web File System Access API
- For modern browsers with File System Access API support
- Requires user interaction for each file operation
- Directly accesses local file system

### 2. Origin Private File System (OPFS)
- Browser-based private storage
- Supports auto-save functionality
- Files persist in browser storage

### 3. Electron
- For desktop applications built with Electron
- Full file system access
- Requires main process IPC handlers

## Architecture

### Core Components
- **App.tsx**: Main application with development mode and file management
- **Editor.tsx**: Core editor component with plugin orchestration
- **EditorConfig.ts**: Configuration interface and defaults
- **FileService.ts**: File system abstraction layer

### Plugin System
The editor uses a modular plugin architecture:
- **ToolbarPlugin**: Main editing toolbar with markdown toggle
- **FloatingTextFormatToolbarPlugin**: Context-sensitive formatting
- **TablePlugin**: Table creation and management
- **ImagesPlugin**: Image handling and upload
- **AutoLinkPlugin**: Automatic link detection
- **MarkdownShortcutPlugin**: Markdown syntax shortcuts
- And 20+ other specialized plugins

### Node System
Custom Lexical nodes extend base functionality:
- **ImageNode/InlineImageNode**: Image handling
- **EquationNode**: KaTeX math equations
- **EmojiNode, MentionNode, KeywordNode**: Special text elements
- **ExcalidrawNode**: Drawing integration
- **Layout nodes**: Column layouts

## Development

### Project Structure
```javascript
src/
├── App.tsx                 # Main app and dev mode
├── Editor.tsx             # Core editor component
├── EditorConfig.ts        # Configuration interface
├── FileService.ts         # File system abstraction
├── plugins/               # Feature plugins
├── nodes/                 # Custom Lexical nodes
├── ui/                    # Reusable UI components
├── themes/                # Editor themes
└── utils/                 # Utility functions
```

### Testing

The project includes comprehensive testing:

```bash
# Unit tests (Jest)
__tests__/unit/

# End-to-end tests (Playwright)
__tests__/e2e/

# Regression tests (Playwright)
__tests__/regression/
```

### Key Commands

- **Markdown Toggle**: Click the markdown button (leftmost in toolbar) to switch between rich text and markdown source view
- **Save**: Cmd+S (Mac) / Ctrl+S (Windows) for manual save
- **Auto-save**: Automatic saving on content changes and tab blur
- **File Management**: Use toolbar buttons for file operations

## Browser Support

- **Modern browsers** with ES2020+ support
- **File System Access API**: Chrome 86+, Edge 86+
- **Origin Private File System**: Chrome 86+, Firefox with flag
- **Electron**: All supported Electron versions

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is based on Meta's Lexical playground and maintains the same MIT license. See the LICENSE file in the root directory for details.

## Acknowledgments

- Built on [Meta's Lexical framework](https://lexical.dev/)
- Originally based on the Lexical playground example
- Transformed into a production-ready editor component
- Comprehensive plugin architecture for extensibility