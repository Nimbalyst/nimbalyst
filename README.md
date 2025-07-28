# Stravu Editor - Monorepo

This is the monorepo for Stravu Editor, a powerful rich text editor built with Meta's Lexical framework, featuring markdown support, tables, and comprehensive editing capabilities.

## Packages

- **`packages/stravu-editor`** - The core library (published to npm)
- **`packages/playground`** - Demo and testing playground web app
- **`packages/electron`** - Desktop application (Electron)

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm 8+

### Installation

```bash
# Install dependencies
pnpm install

# Start development (runs both library and playground)
pnpm dev

# Build the library for production
pnpm build
```

## Features

### 🔥 Core Editor Features
- **Rich Text Editing**: Full-featured WYSIWYG editor with support for bold, italic, underline, strikethrough, and more
- **Markdown Support**: Toggle between rich text and markdown source view with the markdown button in the toolbar
- **Tables**: Create, edit, and manage tables with cell merging, background colors, and horizontal scrolling
- **Code Blocks**: Syntax highlighting with support for multiple languages via Shiki
- **Lists**: Ordered and unordered lists with nested indentation and checkboxes
- **Images**: Inline and block images with drag-and-drop support
- **Excalidraw**: Embedded drawing support

### 📁 File Management
- **Hybrid File System**: Supports web File System Access API, Origin Private File System (OPFS), and Electron
- **Auto-save**: Automatic saving with configurable intervals (default 2000ms)
- **Manual Save**: Cmd+S (Mac) / Ctrl+S (Windows) keyboard shortcuts
- **File Operations**: New File, Open File, Load File, and Save File operations
- **URL Integration**: File names are reflected in the URL for bookmarking and sharing

## Development

### Library Development

```bash
# Watch and rebuild library on changes
pnpm dev:lib

# Build library for production
pnpm build
```

### Playground Development

The monorepo uses a concurrent development setup that runs both the library and playground in watch mode with hot module replacement (HMR):

```bash
# Start both library and playground dev servers concurrently
pnpm dev

# This runs:
# - Library dev server on port 4100 (with HMR)
# - Playground dev server on port 4101 (imports directly from library source)

# Build playground for deployment
pnpm build:playground
```

#### Hot Module Replacement (HMR)

The development setup provides seamless HMR between packages:
- Changes to `packages/stravu-editor` source files are immediately reflected in the playground
- The playground imports directly from the library's TypeScript source files
- Both CSS and TypeScript changes trigger instant updates
- No manual rebuilds required during development

### Library Installation (for end users)

```bash
npm install stravu-editor
# or
yarn add stravu-editor
# or
pnpm add stravu-editor
```

## Usage

### As a Standalone Editor

The project runs in development mode with full file management capabilities:

```bash
pnpm run dev
```

Visit `http://localhost:4101` to access the editor with:
- File management toolbar (New File, Load File, Open File, Save File)
- URL-based file naming
- Auto-save functionality
- Full-screen editor experience

### As a Component

Import and use the `StravuEditor` component in your React application:

```tsx
import { StravuEditor } from 'stravu-editor';
// CSS is automatically included when you import the component!

const config = {
  isRichText: true,
  autoSaveInterval: 3000,
  markdownOnly: false,
  // ... other configuration options
};

function MyApp() {
  return (
    <div style={{ height: '400px' }}>
      <StravuEditor config={config} />
    </div>
  );
}
```

### ✅ No CSS Import Required!

**Good news**: The CSS is automatically included when you import the component. No separate CSS import is needed!

## Configuration

The editor is highly configurable through the `EditorConfig` interface:

```typescript
interface EditorConfig {
  // Core editor behavior
  isRichText?: boolean;                     // Enable rich text mode (default: true)
  emptyEditor?: boolean;                    // Start with empty editor (default: false)
  
  // Markdown-only mode
  markdownOnly?: boolean;                   // Hide non-markdown features (default: false)
  
  // Theme configuration
  theme?: 'light' | 'dark' | 'auto';       // Set theme: 'auto' follows system (default: 'auto')
  
  // Features
  isAutocomplete?: boolean;                 // Enable autocomplete (default: false)
  hasLinkAttributes?: boolean;              // Enable link attributes (default: false)
  isCodeHighlighted?: boolean;              // Enable code highlighting (default: true)
  isCodeShiki?: boolean;                    // Use Shiki for highlighting (default: true)
  showTableOfContents?: boolean;            // Show table of contents (default: false)
  
  // File operations
  fileService?: FileService;                // Custom file service implementation
  autoSaveInterval?: number;                // Auto-save interval in ms (default: 2000)
  onContentChange?: (content: string) => void;     // Content change callback
  onFileNameChange?: (fileName: string | null) => void;  // File name change callback
  onGetContent?: (getContentFn: () => string) => void;   // Access to content getter
  onSave?: (saveFn: () => Promise<void>) => void;        // Access to save function
  onFileServiceCreated?: (fileService: FileService) => void;  // File service creation callback
  initialContent?: string;                  // Pre-loaded content to set in editor
  
  // Limits and validation
  isMaxLength?: boolean;                    // Enable max length validation (default: false)
  isCharLimit?: boolean;                    // Enable character limit (default: false)
  isCharLimitUtf8?: boolean;                // Use UTF-8 for char limit (default: false)
  
  // Collaboration
  isCollab?: boolean;                       // Enable collaboration mode (default: false)
  
  // Context menu and selection
  shouldUseLexicalContextMenu?: boolean;    // Use Lexical context menu (default: false)
  selectionAlwaysOnDisplay?: boolean;       // Always show selection (default: false)
  
  // Markdown behavior
  shouldPreserveNewLinesInMarkdown?: boolean;     // Preserve newlines in markdown (default: true)
  shouldAllowHighlightingWithBrackets?: boolean;  // Allow bracket highlighting (default: false)
  
  // Table features
  tableCellBackgroundColor?: boolean;       // Enable table cell background colors (default: true)
  tableCellMerge?: boolean;                 // Enable table cell merging (default: false)
  tableHorizontalScroll?: boolean;          // Enable horizontal scrolling (default: true)
  
  // Advanced options
  disableBeforeInput?: boolean;             // Disable beforeinput handling (default: false)
  listStrictIndent?: boolean;               // Use strict list indentation (default: false)
  measureTypingPerf?: boolean;              // Measure typing performance (default: false)
  showTreeView?: boolean;                   // Show AST tree view (default: false)
  showNestedEditorTreeView?: boolean;       // Show nested editor tree (default: false)
}
```

### Key Configuration Options

**Theme Control**: Set `theme: 'light'`, `theme: 'dark'`, or `theme: 'auto'` to control the editor's appearance. Auto mode follows the system theme preference.

**Markdown-Only Mode**: Set `markdownOnly: true` to hide rich text formatting options (font styling, colors, advanced formatting) while preserving markdown-native features like images, tables, excalidraw drawings, and collapsible containers.

**File Operations**: Configure auto-save behavior, provide custom file service implementations, and set up callbacks for content and file name changes.

**Feature Toggles**: Enable/disable specific features like autocomplete, code highlighting, collaboration, and table functionalities.

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

## Troubleshooting

### Editor appears unstyled/broken
**Problem**: The editor shows up but looks completely unstyled or broken.

**Solution**: This should not happen as CSS is automatically included. If you still see issues:
1. Make sure you're importing from the correct package
2. Check that your bundler supports CSS imports
3. Try clearing your node_modules and reinstalling

### Missing Lexical dependencies
**Problem**: Build errors about missing `@lexical/*` packages.

**Solution**: Install the required peer dependencies:
```bash
npm install lexical @lexical/react @lexical/rich-text @lexical/plain-text @lexical/code @lexical/code-shiki @lexical/list @lexical/link @lexical/table @lexical/utils @lexical/selection @lexical/markdown @lexical/clipboard @lexical/file @lexical/hashtag @lexical/mark @lexical/overflow @lexical/yjs
```

### TypeScript errors
**Problem**: TypeScript complains about missing type definitions.

**Solution**: The library includes TypeScript definitions. Make sure you're importing from the correct path:
```tsx
import { StravuEditor, type EditorConfig } from 'stravu-editor';
```

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
