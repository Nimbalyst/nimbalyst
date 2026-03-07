---
name: extension-development
description: Build, install, and hot-reload Nimbalyst extensions using MCP tools. Use when developing, testing, or iterating on Nimbalyst extensions.
---

# Extension Development in Nimbalyst

Nimbalyst provides MCP tools for building, installing, and hot-reloading extensions directly from within the running app. This enables rapid iteration on extension development without manually running build commands.

The recommended in-app scaffold flow uses `File > New Extension Project`, `Developer > New Extension Project`, or the Extension Developer Kit's `/new-extension` command. Enable Extension Dev Tools in Settings > Advanced before using the build/install workflow.

## Available MCP Tools

### Build Extension
```
mcp__nimbalyst-extension-dev__extension_build
```
Runs `npm run build` (vite build) on an extension project.

**Parameters:**
- `path`: Absolute path to the extension project root (directory containing package.json and manifest.json)

**Returns:** Build output including any errors or warnings.

### Install Extension
```
mcp__nimbalyst-extension-dev__extension_install
```
Installs a built extension into the running Nimbalyst instance. The extension must be built first.

**Parameters:**
- `path`: Absolute path to the extension project root

**Returns:** Installation status and any validation warnings.

### Hot Reload Extension
```
mcp__nimbalyst-extension-dev__extension_reload
```
Rebuilds and reinstalls an extension in one step. This is the most common tool for iterating on extension development.

**Parameters:**
- `extensionId`: The extension ID from manifest.json (e.g., "com.nimbalyst.my-extension")
- `path`: Absolute path to the extension project root

**Returns:** Build and reload status.

### Uninstall Extension
```
mcp__nimbalyst-extension-dev__extension_uninstall
```
Removes an installed extension from the running Nimbalyst instance.

**Parameters:**
- `extensionId`: The extension ID to uninstall

### Get Extension Status
```
mcp__nimbalyst-extension-dev__extension_get_status
```
Gets the current status of an installed extension, including whether it loaded successfully and what it contributes.

**Parameters:**
- `extensionId`: The extension ID to query

### Restart Nimbalyst
```
mcp__nimbalyst-extension-dev__restart_nimbalyst
```
Restarts the entire Nimbalyst application. **Only use when explicitly requested by the user.**

## Development Workflow

### Initial Setup
1. Create extension project with `/new-extension <template> <path> <name> [file-patterns]`
2. Implement the extension code
3. Build with `extension_build`
4. Install with `extension_install`
5. Test in Nimbalyst

### Iteration Loop
1. Make code changes
2. Run `extension_reload` to rebuild and reinstall
3. Test changes immediately
4. Repeat

### Debugging
1. Check extension status with `extension_get_status`
2. Read logs with `mcp__nimbalyst-extension-dev__get_main_process_logs` (filter by component: "EXTENSION")
3. Check renderer logs with `mcp__nimbalyst-extension-dev__get_renderer_debug_logs`

## Important Notes

- **Always build before install** - `extension_install` requires a pre-built extension
- **Use `extension_reload` for iteration** - It combines build + reinstall in one step
- **Check manifest validation** - Build and install tools validate manifest.json and report warnings
- **Extensions load on app start** - For full reload, user may need to restart Nimbalyst
- **Never restart without permission** - Only use `restart_nimbalyst` when the user explicitly asks

## Common Issues

### "Extension not found" after install
- Check that the extension ID in manifest.json matches what you're querying
- Verify the build output exists in `dist/index.js`

### Build fails
- Check that `npm install` was run in the extension directory
- Verify vite.config.ts is properly configured
- Check for TypeScript errors in the output

### Extension doesn't appear
- Use `extension_get_status` to check if it's loaded
- Check the release channel - some extensions require "alpha" channel
- Verify the extension is enabled in Settings > Extensions
