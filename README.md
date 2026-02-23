# Nimbalyst

Nimbalyst is an AI-native workspace where humans and AI agents collaborate through rich, specialized editors. Edit markdown documents, code files, spreadsheets, diagrams, and custom visual interfaces - while AI agents read context, stream changes directly into editors, and work alongside you in real-time.

The power is in the combination: complex visual editors with rich UIs (spreadsheets, diagrams, data models) that AI agents can understand and modify collaboratively. Every editor integrates through a unified extension system, giving AI agents consistent access to read files, make changes, and understand context regardless of the underlying editor technology.

## Key Benefits

- **AI-human collaboration**: AI agents stream edits directly into rich editors while you watch and guide - not just text generation, but true collaborative editing across code, spreadsheets, diagrams, and custom visual tools
- **Multi-editor workspace**: Purpose-built editors for different file types - Monaco for code, RevoGrid for spreadsheets, Excalidraw for diagrams, Lexical for markdown - all with consistent AI integration
- **Extension-first architecture**: All editors are provided through a unified extension system, enabling custom editors for any file type with automatic AI agent access
- **Local first, open formats**: Everything is stored in plain files - markdown, JSON, CSV - no proprietary database that your AI agents cannot see
- **Code-aware agent orchestration**: AI assistants inspect your repository to generate implementation plans, draft documentation, and track features while you stay in control
- **Production-ready foundations**: Built on proven technologies (Lexical, Monaco, Electron) for performance, stability, and cross-platform support

## Packages

- **`packages/electron`** - Desktop application (Electron)
- **`packages/capacitor`** - Mobile application (Capacitor)
- **`packages/runtime`** - Cross-platform runtime services (AI, sync, Lexical editor)
- **`packages/extension-sdk`** - Extension development kit
- **`packages/extensions`** - Built-in extensions
- **`packages/core`** - Shared utilities

## Supported Editor Types

Nimbalyst provides specialized editors for different file types, all integrated through the extension system:

| Editor | File Types | Description |
| --- | --- | --- |
| **Lexical** | `.md`, `.txt` | Rich text markdown with tables, images, code blocks, Excalidraw embeds |
| **Monaco** | `.ts`, `.js`, `.json`, `.css`, etc. | VS Code-style code editing with syntax highlighting and intellisense |
| **RevoGrid** | `.csv` | Spreadsheet editing with formulas, sorting, filtering |
| **Excalidraw** | `.excalidraw` | Whiteboard-style diagrams and drawings |
| **DataModelLM** | `.datamodel` | Visual Prisma schema editor |
| **Mockup** | `.mockup.html` | Visual HTML mockup creation with annotations |

All editors share the same lifecycle through the `EditorHost` contract - consistent tab management, dirty indicators, file watching, and AI edit streaming regardless of the underlying technology.

## Getting Started

### Prerequisites

- Node.js 18+
- npm 7+ (for workspaces support)

### Installation

```bash
# Install dependencies
npm install

# Start Electron app development
cd packages/electron && npm run dev

# Build Electron app for Mac
cd packages/electron && npm run build:mac:local
```

## Features

### 🤖 Agentic Workflows
- **Implementation planning**: Spin up AI coding agents that can read your repository, outline proposed changes, and turn them into actionable tasks.
- **Documentation copilots**: Generate architecture notes, release checklists, and onboarding docs that stay grounded in your source of truth.
- **Live task tracking**: Keep features, ideas, and todos synced inside the document so every conversation has an owner and next step.
- **Git worktree isolation**: Create isolated AI coding sessions in separate git worktrees, enabling safe experimentation on dedicated branches without affecting your main workspace.

### 🔥 Core Editor Features
- **Rich Text Editing**: Full-featured WYSIWYG editor with support for bold, italic, underline, strikethrough, and more
- **Markdown Support**: Toggle between rich text and markdown source view with the markdown button in the toolbar
- **Tables**: Create, edit, and manage tables with cell merging, background colors, and horizontal scrolling
- **Code Blocks**: Syntax highlighting with support for multiple languages via Prism.js
- **Lists**: Ordered and unordered lists with nested indentation and checkboxes
- **Images**: Inline and block images with drag-and-drop support
- **Excalidraw**: Embedded drawing support

### 📁 File Management
- **Hybrid File System**: Supports web File System Access API, Origin Private File System (OPFS), and Electron
- **Auto-save**: Automatic saving with configurable intervals (default 2000ms)
- **Manual Save**: Cmd+S (Mac) / Ctrl+S (Windows) keyboard shortcuts
- **File Operations**: New File, Open File, Load File, and Save File operations
- **URL Integration**: File names are reflected in the URL for bookmarking and sharing

## Open Data Philosophy

Nimbalyst keeps every insight in plain Markdown so you never lose control of your knowledge. Bugs, ideas, tasks, and implementation plans live alongside your content as transparent documents—no opaque databases or locked-down SaaS exports required. When you're ready to share, commit the files to Git and bring your workflows into the same review and collaboration loops that already power your code.

## Development

### Library Development

```bash
# Build library for production
npm run build
```

### Electron Development

```bash
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
- **Modern Electron version** for improved performance and security
- **PGLite database system** - PostgreSQL in WebAssembly for robust data storage
- **Native About window** that respects the current theme
- **Dark mode support** with automatic title bar theming
- **Code highlighting** using Prism.js with full dark theme support
- **Auto-save** functionality every 2 seconds
- **File watching** for external changes with auto-reload
- **Project mode** for working with entire folders
- **Recent files** tracking in the application menu
- **Window state persistence** - remembers window position, size, and dev tools state
- **Per-project window state** - each project remembers its own window configuration
- **Document history tracking** - compressed binary storage with automatic migration
- **AI Chat integration** - Built-in Claude AI assistant with context-aware editing
- **Session Manager** - Global view of all AI chat sessions across projects
- **Drag and drop** file operations in the project sidebar with copy/move support

### Library Installation (for end users)

```bash
npm install nimbalyst
# or
yarn add nimbalyst
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

Import and use the `Nimbalyst` component in your React application:

```tsx
import { Nimbalyst } from 'nimbalyst';
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
      <Nimbalyst config={config} />
    </div>
  );
}
```

### ✅ No CSS Import Required!

**Good news**: The CSS is automatically included when you import the component. No separate CSS import is needed!

## AI Features (Electron App)

The Electron app includes powerful AI integration powered by Claude:

### AI Chat Panel
- **Context-aware assistance**: Claude understands your current document and project
- **Real-time editing**: Stream code changes directly to the editor
- **Session persistence**: Chat history is saved and restored across app restarts
- **Draft persistence**: Unsent messages are saved automatically
- **Keyboard shortcut**: Cmd+Shift+A to toggle the AI panel

### Session Manager
- **Global session view**: Access all AI sessions across all projects (Cmd+Alt+S)
- **Search functionality**: Find sessions by content, project, or date
- **Full conversation history**: View and reopen any past conversation
- **Export sessions**: Save conversations for documentation or sharing
- **Clean interface**: Left navigation with session list, detailed view on the right

### Window State Management
- **Smart persistence**: Every window remembers its position, size, and dev tools state
- **Per-project memory**: Each project maintains its own window configuration
- **Session restoration**: Reopening the app restores all windows exactly as they were
- **Focus order preservation**: Windows are restored in the correct stacking order

### Enhanced File Operations
- **Drag and drop**: Move files and folders in the project sidebar
- **Copy on drag**: Hold Option/Alt while dragging to copy instead of move
- **Visual feedback**: Clear indicators show valid drop targets
- **Smart renaming**: Copied files automatically get unique names

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
- **EmojiNode, MentionNode, KeywordNode**: Special text elements
- **ExcalidrawNode**: Drawing integration
- **Layout nodes**: Column layouts

## Development

### Project Structure
```
packages/
├── electron/              # Electron desktop app
├── runtime/               # Cross-platform services (AI, sync, Lexical editor)
├── capacitor/             # Mobile app (iOS/Android)
├── extension-sdk/         # Extension development kit
├── extensions/            # Built-in extensions
└── core/                  # Shared utilities
```

### Marketing Screenshots & Videos

Automated Playwright capture for nimbalyst.com marketing assets. Produces 1440x900 PNG screenshots in both dark and light themes, plus WebM video recordings with a DOM-injected cursor.

```bash
# Requires dev server running first
cd packages/electron && npm run dev

# In another terminal - capture everything
cd packages/electron && npm run marketing:screenshots

# Capture specific categories
npm run marketing:screenshots:grep -- "hero-"
npm run marketing:screenshots:grep -- "editor-"
npm run marketing:screenshots:grep -- "ai-"
npm run marketing:screenshots:grep -- "video-"

# Convert WebM videos to MP4/GIF (requires ffmpeg)
bash packages/electron/marketing/process-videos.sh
```

Output structure:
```
packages/electron/marketing/
  screenshots/
    dark/     # 26 PNGs - hero shots, editor types, AI features, settings
    light/    # Same 26 PNGs in light theme
  videos/
    dark/     # WebM - hero ambient, feature loops
    light/    # WebM - hero ambient light theme
```

For the marketing website, swap `dark/` and `light/` directories based on theme toggle. All filenames are identical between themes. See [docs/MARKETING_SCREENSHOTS.md](./docs/MARKETING_SCREENSHOTS.md) for the full output inventory and architecture.

### Testing

- `npm run test:unit`: Vitest unit suite (JSDOM)
- `npm run test:e2e`: Playwright e2e projects
- `npm run test:e2e -- --project=electron`: Electron autosave-on-navigation regression test (requires `npm run build --workspace @nimbalyst/electron`; see `docs/PLAYWRIGHT.md`)

### Key Commands

- **Markdown Toggle**: Click the markdown button (leftmost in toolbar) to switch between rich text and markdown source view
- **Save**: Cmd+S (Mac) / Ctrl+S (Windows) for manual save
- **Auto-save**: Automatic saving on content changes and tab blur
- **File Management**: Use toolbar buttons for file operations

### Claude Commands

The project includes custom Claude Code commands in `.claude/commands/` for common development tasks:

- `/restart` - Restart the Nimbalyst Electron app (useful when working in AI agent mode)

## Troubleshooting

### LexicalComposerContext Error
**Problem**: Getting "LexicalComposerContext.useLexicalComposerContext: cannot find a LexicalComposerContext" error.

**Solution**: This is typically caused by Vite module caching issues. Clear the cache:
```bash
# Quick cache clean
npm run clean

# Full clean and reinstall
npm run clean:full
```

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
import { Nimbalyst, type EditorConfig } from 'nimbalyst';
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

### Releasing

See [RELEASING.md](./RELEASING.md) for complete release process documentation.

## 
## Acknowledgments

- Built on [Meta's Lexical framework](https://lexical.dev/)
- [Monaco Editor](https://microsoft.github.io/monaco-editor/) for code editing
- [Excalidraw](https://excalidraw.com/) for diagram support
- [RevoGrid](https://revolist.github.io/revogrid/) for spreadsheet editing
