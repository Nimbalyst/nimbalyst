# Stravu Editor - Electron App

This package contains the Electron desktop application for Stravu Editor - a rich text editor built with Meta's Lexical framework.

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Package for distribution (unsigned)
npm run dist

# Build notarized macOS app (requires signing certificates)
npm run build:mac:notarized

# Build local macOS app (skip notarization)
npm run build:mac:local
```

## Features

### Editor Capabilities
- Rich text editing with comprehensive formatting options
- Tables, code blocks with syntax highlighting
- Math equations (KaTeX), emoji support
- Excalidraw integration for drawings
- Multiple editor themes (Light, Dark, Crystal Dark, Auto)

### Theme System
- **Light theme**: Clean, bright theme for daytime use
- **Dark theme**: Standard dark theme with warm gray colors (#2d2d2d)
- **Crystal Dark theme**: Premium theme with Tailwind gray scale (#0f172a)
- **Auto theme**: Follows system preference
- **Single source of truth**: All theme colors defined in `/src/renderer/index.css`
- **CSS Variables**: All components use CSS variables, never hardcoded colors
- **Documentation**: See `/packages/electron/THEMING.md` for theming guidelines

### Desktop Features
- Native file system access with file watching
- Project/folder view with file tree navigation
- Drag and drop file operations (move/copy with Option/Alt)
- Recent files and projects tracking
- Window state persistence (position, size, dev tools)
- Per-project window configuration
- Multiple windows support

### AI Integration
- **Multiple AI Providers**: Support for Claude, Claude Code (MCP), OpenAI, and LM Studio
- **AI Chat Panel**: Built-in chat interface (Cmd+Shift+A)
- **Document-aware**: AI understands document context and can make edits
- **Edit streaming**: Real-time streaming of edits directly to the editor
- **No document handling**: Clear messaging when no document is open
- **Session management**: Multiple chat sessions per project
- **Session Manager**: Global view of all AI sessions (Cmd+Alt+S)
- **Session persistence**: Chat sessions and drafts persist across app restarts
- **Model Selection**: Easy switching between different AI models
- **Smart Provider Detection**: Automatically detects configured providers

### Project Management
- **Project Manager**: Create and manage projects (Cmd+P)
- **Session-based workflow**: Each project maintains its own window state
- **File operations**: Right-click context menus for rename, delete, new window
- **Smart file handling**: Automatic unique naming for copied files

## Architecture

- `src/main/` - Main process code
  - `index.ts` - Application entry point and window management
  - `services/` - Core services
    - `ai/` - AI provider system (Claude, OpenAI, LM Studio)
    - `FileService.ts` - File operations and watching
    - `SessionManager.ts` - AI session management
  - `ipc/` - IPC handlers for renderer communication
  - `mcp/` - Model Context Protocol server for Claude Code
- `src/preload/` - Preload scripts for security
- `src/renderer/` - Renderer process (uses the main stravu-editor library)
  - `components/AIChat/` - AI chat interface components
  - `components/AIModels/` - AI model configuration UI

## Security

The app uses context isolation and disables node integration in the renderer process for security. All file system operations are handled through IPC channels defined in the preload script.

### Code Signing & Notarization (macOS)

For distribution on macOS without security warnings:
1. Requires Apple Developer ID Application certificate
2. Automatically signs all binaries during build
3. Notarizes the app with Apple for Gatekeeper approval
4. Handles special requirements for bundled tools (ripgrep, etc.)

## Debug Logging

In development mode (`NODE_ENV !== 'production'`), the Electron app automatically captures all browser console messages and writes them to a debug log file. This is useful for debugging browser load issues and renderer-side problems.

The debug log file location:
- **macOS**: `~/Library/Application Support/stravu-editor/stravu-editor-debug.log`
- **Windows**: `%APPDATA%/stravu-editor/stravu-editor-debug.log`
- **Linux**: `~/.config/stravu-editor/stravu-editor-debug.log`

The log file includes:
- All browser console messages (log, warn, error, info, debug)
- Main process logs
- Timestamps for each entry
- Source file and line number information
- Log levels (VERBOSE, INFO, WARNING, ERROR)

The log file is cleared on each app startup and the location is printed to the console when the app starts in development mode.