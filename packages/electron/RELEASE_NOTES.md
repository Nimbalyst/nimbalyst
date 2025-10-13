# Release Notes - v0.42.34

## Improvements

- **AI SDK**: Upgrade @anthropic-ai/sdk to v0.65.0 for latest features and improvements
- **Build System**: Resolve electron-builder dependency resolution issues with AI SDK runtime dependencies

## Technical Changes

- Install AI SDK runtime dependencies (node-fetch, formdata-node, form-data-encoder, etc.) as direct dependencies
- Configure Vite to properly externalize AI SDKs while allowing electron-builder to package them
- Remove non-existent Excalidraw CSS import that was causing build warnings
