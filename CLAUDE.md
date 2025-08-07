# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Codebase Overview

This is Stravu Editor - a rich text editor built with Meta's Lexical framework. Originally based on the Lexical playground, it's been adapted as the foundation for a new editor project with comprehensive features including rich text editing, tables, collaboration, code highlighting, and various plugins.

## Development Commands

- **Start dev server**: `npm run dev` - Runs Vite dev server on port 3000
- **Build for development**: `npm run build-dev` - Creates development build
- **Build for production**: `npm run build-prod` - Creates optimized production build with terser minification
- **Preview build**: `npm run preview` - Preview the built application

## Testing

The project uses multiple testing approaches:

- **Unit tests**: Located in `__tests__/unit/` using Jest
- **E2E tests**: Located in `__tests__/e2e/` using Playwright 
- **Regression tests**: Located in `__tests__/regression/` using Playwright

The tests are organized by functionality (CopyAndPaste, Headings, etc.) and include both behavior testing and regression testing for specific issues.

## Architecture

### Core Structure
- `src/App.tsx` - Main application wrapper with LexicalComposer setup
- `src/Editor.tsx` - Core editor component with all plugins
- `src/nodes/` - Custom Lexical nodes (Image, Emoji, Equation, etc.)
- `src/plugins/` - Feature plugins (AutoLink, CodeHighlight, Tables, etc.)
- `src/themes/` - Editor themes and styling
- `src/ui/` - Reusable UI components

### Key Components
- **PlaygroundNodes.ts**: Registers all custom node types
- **Editor.tsx**: Orchestrates all plugins and editor functionality
- **Context providers**: Settings, History, Toolbar, and FlashMessage contexts
- **Plugin system**: Modular features like AutoComplete, DragDrop, FloatingToolbar

### Plugin Architecture
The editor uses a comprehensive plugin system where each feature is implemented as a separate plugin in `src/plugins/`. Plugins handle everything from basic functionality (AutoLink, CodeHighlight) to complex features (Tables, Collaboration, DragDrop).

### Node System
Custom nodes extend Lexical's base functionality:
- ImageNode/InlineImageNode for image handling
- EquationNode for KaTeX math equations
- EmojiNode, MentionNode, KeywordNode for special text
- Layout nodes for column layouts
- ExcalidrawNode for drawings

### Styling and Themes
- CSS modules and regular CSS files for component styling
- Theme system in `src/themes/` for consistent editor appearance
- Responsive design with mobile considerations

## Important File Patterns

- Plugin files follow `src/plugins/[PluginName]Plugin/index.tsx`
- Node files in `src/nodes/[NodeName].tsx`
- UI components in `src/ui/[Component].tsx` with accompanying CSS
- Themes in `src/themes/[ThemeName].ts` and `.css`

## Dependencies

Built with modern React, TypeScript, and Vite. Uses extensive Lexical packages (@lexical/\*) for editor functionality, plus supporting libraries like KaTeX for equations, Prettier for code formatting, and Excalidraw for drawings.

## Electron App Debug Logging

The Electron app (`packages/electron/`) includes a debug logging feature that captures all browser console messages in development mode. This is useful for debugging renderer-side issues and browser load problems.

- **Log file location**: `~/Library/Application Support/stravu-editor/stravu-editor-debug.log` (macOS)
- **What's logged**: All browser console messages, main process logs, timestamps, source locations, and log levels
- **When active**: Only in development mode (`NODE_ENV !== 'production'`)
- **Implementation**: See `packages/electron/src/main/index.ts` - uses `webContents.on('console-message')` event

## Theme Support

The editor supports multiple themes:
- **Light**: Clean, bright theme for daytime use
- **Dark**: Standard dark theme with good contrast
- **Crystal Dark**: A premium dark theme with Tailwind gray scale colors and refined aesthetics
- **Auto**: Follows system preference

The Electron app includes a Window > Theme menu to switch between all themes. The selected theme is persisted and applied to all windows.
