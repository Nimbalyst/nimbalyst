# Release Notes - v0.42.35

## Bug Fixes

- **Build System**: Fix Linux build failure by adding ajv dependency to rexical package

## Technical Changes

- Add ajv@^8.0.0 as devDependency in rexical to ensure proper dependency resolution in CI
- Resolves "Cannot find module 'ajv/dist/core'" error during Linux builds
