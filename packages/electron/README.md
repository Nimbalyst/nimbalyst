# Stravu Editor - Electron App

This package contains the Electron desktop application for Stravu Editor.

## Development

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm dev

# Build for production
pnpm build

# Package for distribution
pnpm dist
```

## Features

- Native file system access
- Desktop integration
- Offline usage
- Better performance for large documents

## Architecture

- `src/main/` - Main process code
- `src/preload/` - Preload scripts for security
- `src/renderer/` - Renderer process (uses the main stravu-editor library)

## Security

The app uses context isolation and disables node integration in the renderer process for security. All file system operations are handled through IPC channels defined in the preload script.