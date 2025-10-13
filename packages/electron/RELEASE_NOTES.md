# Release Notes - v0.42.36

## Bug Fixes

- **Build System**: Resolve rexical build issues for Linux/CI
  - Add ajv-draft-04 as direct dependency (not devDependency) in rexical
  - Mark mermaid as external in rexical vite config to prevent bundling
  - Fixes "Cannot find module 'ajv/dist/core'" error during Linux builds
  - Fixes "Rollup failed to resolve import 'mermaid'" error in rexical build
