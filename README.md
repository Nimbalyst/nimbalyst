# Preditor


Preditor is a powerful, rich text markdown editor based on the Lexical editor project. 

While heavily leveraging the Lexical playground environment, this editor works to make this functionality available as an embeddable component. It also adds an externally configurable plugin architecture and several new plugins.

## Features Added on top of Lexical

- Search / Replace
- Red / Green Diff rendering

## Packages

- **__`packages/rexical`__** - The core editor library
- **__`packages/playground`__** - Demo and testing playground web app
- **__`packages/electron`__** - Desktop application (Electron)
- **__`packages/capacitor`__** - Mobile application (Capacitor)
- **__`packages/tauri`__** - Desktop application (Tauri)

## Getting Started

### Prerequisites

- Node.js 18+
- npm 7+ (for workspaces support)

### Installation

```bash
# Install dependencies
npm install --legacy-peer-deps

# Start Electron app development
cd packages/electron && npm run dev

# Build Electron app for Mac
cd packages/electron && npm run build:mac:local
```

## Features

### 🔥 Core Editor Features
- **__Rich Text Editing__**: Full-featured WYSIWYG editor with support for bold, italic, underline, strikethrough, and more
- **__Markdown Support__**: Toggle between rich text and markdown source view with the markdown button in the toolbar
- **__Tables__**: Create, edit, and manage tables with cell merging, background colors, and horizontal scrolling
- **__Code Blocks__**: Syntax highlighting with support for multiple languages via Prism.js
- **__Lists__**: Ordered and unordered lists with nested indentation and checkboxes
- **__Images__**: Inline and block images with drag-and-drop support
- **__Excalidraw__**: Embedded drawing support

### 📁 File Management
- **__Hybrid File System__**: Supports web File System Access API, Origin Private File System (OPFS), and Electron
- **__Auto-save__**: Automatic saving with configurable intervals (default 2000ms)
- **__Manual Save__**: Cmd+S (Mac) / Ctrl+S (Windows) keyboard shortcuts
- **__File Operations__**: New File, Open File, Load File, and Save File operations
- **__URL Integration__**: File names are reflected in the URL for bookmarking and sharing

## Development

### Library Development

```bash
# Build library for production
npm run build
```

### Electron Development

```bash
# Build the preditor library first
npm run build

# Navigate to electron package
cd packages/electron

# Build the Electron app
npm run build

# Run the Electron app in development
npm run start

# Create distributable (DMG, ZIP) - macOS only
npm run dist
```

The Electron app features:
- **__Modern Electron version__** for improved performance and security
- **__PGLite database system__** - PostgreSQL in WebAssembly for robust data storage
- **__Native About window__** that respects the current theme
- **__Dark mode support__** with automatic title bar theming
- **__Code highlighting__** using Prism.js with full dark theme support
- **__Auto-save__** functionality every 2 seconds
- **__File watching__** for external changes with auto-reload
- **__Project mode__** for working with entire folders
- **__Recent files__** tracking in the application menu
- **__Window state persistence__** - remembers window position, size, and dev tools state
- **__Per-project window state__** - each project remembers its own window configuration
- **__Document history tracking__** - compressed binary storage with automatic migration
- **__AI Chat integration__** - Built-in Claude AI assistant with context-aware editing
- **__Session Manager__** - Global view of all AI chat sessions across projects
- **__Drag and drop__** file operations in the project sidebar with copy/move support

### Playground Development

The monorepo uses a simplified development setup with hot module replacement (HMR):

```bash
# Start development server
npm run dev

# This runs the playground dev server on port 4101
# The playground imports directly from the library source files via custom Vite plugin

# Build playground for deployment
npm run build:playground
```

#### Hot Module Replacement (HMR)

The development setup provides seamless HMR:
- Changes to `packages/rexical` source files are immediately reflected in the playground
- A custom Vite plugin handles module resolution to import directly from TypeScript source
- Both CSS and TypeScript changes trigger instant updates
- No manual rebuilds or separate library dev server required

### Library Installation (for end users)

```bash
npm install preditor
# or
yarn add preditor
```

## Usage

### As a Standalone Editor

The project runs in development mode with full file management capabilities:

```bash
npm run dev
```

Visit `http://localhost:4101` to access the editor with:
- File management toolbar (New File, Load File, Open File, Save File)
- URL-based file naming
- Auto-save functionality
- Full-screen editor experience

### As a Component

Import and use the `Preditor` component in your React application:

```tsx
import { Preditor } from 'preditor';
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
      <Preditor config={config} />
    </div>
  );
}
```

### ✅ No CSS Import Required!

**__Good news__**: The CSS is automatically included when you import the component. No separate CSS import is needed!

## AI Features (Electron App)

The Electron app includes powerful AI integration powered by Claude:

### AI Chat Panel
- **__Context-aware assistance__**: Claude understands your current document and project
- **__Real-time editing__**: Stream code changes directly to the editor
- **__Session persistence__**: Chat history is saved and restored across app restarts
- **__Draft persistence__**: Unsent messages are saved automatically
- **__Keyboard shortcut__**: Cmd+Shift+A to toggle the AI panel

### Session Manager
- **__Global session view__**: Access all AI sessions across all projects (Cmd+Alt+S)
- **__Search functionality__**: Find sessions by content, project, or date
- **__Full conversation history__**: View and reopen any past conversation
- **__Export sessions__**: Save conversations for documentation or sharing
- **__Clean interface__**: Left navigation with session list, detailed view on the right

### Window State Management
- **__Smart persistence__**: Every window remembers its position, size, and dev tools state
- **__Per-project memory__**: Each project maintains its own window configuration
- **__Session restoration__**: Reopening the app restores all windows exactly as they were
- **__Focus order preservation__**: Windows are restored in the correct stacking order

### Enhanced File Operations
- **__Drag and drop__**: Move files and folders in the project sidebar
- **__Copy on drag__**: Hold Option/Alt while dragging to copy instead of move
- **__Visual feedback__**: Clear indicators show valid drop targets
- **__Smart renaming__**: Copied files automatically get unique names

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

**__Theme Control__**: Set `theme: 'light'`, `theme: 'dark'`, or `theme: 'auto'` to control the editor's appearance. Auto mode follows the system theme preference.

**__Markdown-Only Mode__**: Set `markdownOnly: true` to hide rich text formatting options (font styling, colors, advanced formatting) while preserving markdown-native features like images, tables, excalidraw drawings, and collapsible containers.

**__File Operations__**: Configure auto-save behavior, provide custom file service implementations, and set up callbacks for content and file name changes.

**__Feature Toggles__**: Enable/disable specific features like autocomplete, code highlighting, collaboration, and table functionalities.

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
- **__App.tsx__**: Main application with development mode and file management
- **__Editor.tsx__**: Core editor component with plugin orchestration
- **__EditorConfig.ts__**: Configuration interface and defaults
- **__FileService.ts__**: File system abstraction layer

### Plugin System
The editor uses a modular plugin architecture:
- **__ToolbarPlugin__**: Main editing toolbar with markdown toggle
- **__FloatingTextFormatToolbarPlugin__**: Context-sensitive formatting
- **__TablePlugin__**: Table creation and management
- **__ImagesPlugin__**: Image handling and upload
- **__AutoLinkPlugin__**: Automatic link detection
- **__MarkdownShortcutPlugin__**: Markdown syntax shortcuts
- And 20+ other specialized plugins

### Node System
Custom Lexical nodes extend base functionality:
- **__ImageNode/InlineImageNode__**: Image handling
- **__EmojiNode, MentionNode, KeywordNode__**: Special text elements
- **__ExcalidrawNode__**: Drawing integration
- **__Layout nodes__**: Column layouts

## Development

### Project Structure
```javascript
packages/
├── core/                  # Core editor library
├── playground/            # Development playground
├── electron/              # Electron desktop app
├── capacitor/             # Mobile app (Capacitor)
└── tauri/                 # Desktop app (Tauri)
```

### Testing

- `npm run test:unit`: Vitest unit suite (JSDOM)
- `npm run test:e2e`: Playwright e2e projects
- `npm run test:e2e -- --project=electron`: Electron autosave-on-navigation regression test (requires `npm run build --workspace @preditor/electron`; see `docs/PLAYWRIGHT.md`)

### Key Commands

- **__Markdown Toggle__**: Click the markdown button (leftmost in toolbar) to switch between rich text and markdown source view
- **__Save__**: Cmd+S (Mac) / Ctrl+S (Windows) for manual save
- **__Auto-save__**: Automatic saving on content changes and tab blur
- **__File Management__**: Use toolbar buttons for file operations

## Troubleshooting

### LexicalComposerContext Error
**__Problem__**: Getting "LexicalComposerContext.useLexicalComposerContext: cannot find a LexicalComposerContext" error.

**__Solution__**: This is typically caused by Vite module caching issues. Clear the cache:
```bash
# Quick cache clean
npm run clean

# Full clean and reinstall
npm run clean:full
```

### Editor appears unstyled/broken
**__Problem__**: The editor shows up but looks completely unstyled or broken.

**__Solution__**: This should not happen as CSS is automatically included. If you still see issues:
1. Make sure you're importing from the correct package
2. Check that your bundler supports CSS imports
3. Try clearing your node_modules and reinstalling

### Missing Lexical dependencies
**__Problem__**: Build errors about missing `@lexical/*` packages.

**__Solution__**: Install the required peer dependencies:
```bash
npm install lexical @lexical/react @lexical/rich-text @lexical/plain-text @lexical/code @lexical/code-shiki @lexical/list @lexical/link @lexical/table @lexical/utils @lexical/selection @lexical/markdown @lexical/clipboard @lexical/file @lexical/hashtag @lexical/mark @lexical/overflow @lexical/yjs
```

### TypeScript errors
**__Problem__**: TypeScript complains about missing type definitions.

**__Solution__**: The library includes TypeScript definitions. Make sure you're importing from the correct path:
```tsx
import { Preditor, type EditorConfig } from 'preditor';
```

## Browser Support

- **__Modern browsers__** with ES2020+ support
- **__File System Access API__**: Chrome 86+, Edge 86+
- **__Origin Private File System__**: Chrome 86+, Firefox with flag
- **__Electron__**: All supported Electron versions

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
