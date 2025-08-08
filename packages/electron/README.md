# [Stravu Editor - Electron App](https://)

This package contains the Electron desktop application for Stravu Editor.

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

- Native file system access
- Desktop integration
- Offline usage
- Better performance for large documents
- Debug logging in development mode
- Multiple themes including Light, Dark, Crystal Dark, and System preference
- Project/folder view with file tree navigation
- Recent files and projects tracking

## Architecture

- `src/main/` - Main process code
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