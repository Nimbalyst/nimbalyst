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

# Package for distribution
npm run dist
```

## Features

### Editor Capabilities
- Rich text editing with comprehensive formatting options
- Tables, code blocks with syntax highlighting
- Math equations (KaTeX), emoji support
- Excalidraw integration for drawings
- Multiple editor themes (Light, Dark, Crystal Dark, Auto)

### Desktop Features
- Native file system access with file watching
- Project/folder view with file tree navigation
- Drag and drop file operations (move/copy with Option/Alt)
- Recent files and projects tracking
- Window state persistence (position, size, dev tools)
- Per-project window configuration
- Multiple windows support

### AI Integration
- **Claude AI Assistant**: Built-in AI chat panel (Cmd+Shift+A)
- **Context-aware suggestions**: Sends current document context with messages
- **Edit streaming**: Real-time streaming of code edits directly to the editor
- **Session management**: Multiple chat sessions per project
- **Session Manager**: Global view of all AI sessions (Cmd+Alt+S)
- **Session persistence**: Chat sessions and drafts persist across app restarts

### Project Management
- **Project Manager**: Create and manage projects (Cmd+P)
- **Session-based workflow**: Each project maintains its own window state
- **File operations**: Right-click context menus for rename, delete, new window
- **Smart file handling**: Automatic unique naming for copied files

## Architecture

- `src/main/` - Main process code
- `index.ts` - Application entry point and window management
- `services/` - Core services (Claude API, file operations, session management)
- `ipc/` - IPC handlers for renderer communication
- `src/preload/` - Preload scripts for security
- `src/renderer/` - Renderer process (uses the main stravu-editor library)

## Security

The app uses context isolation and disables node integration in the renderer process for security. All file system operations are handled through IPC channels defined in the preload script.

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