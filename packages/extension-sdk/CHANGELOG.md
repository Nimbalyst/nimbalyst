# Changelog

All notable changes to `@nimbalyst/extension-sdk` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this package follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The SDK is versioned independently of the Nimbalyst app. Each release declares its minimum compatible app version under the `nimbalyst.minAppVersion` field of `package.json`.

| SDK version | Minimum Nimbalyst app version |
| --- | --- |
| 0.1.1 | 0.58.5 |
| 0.1.0 | 0.58.5 |

## [Unreleased]

## [0.1.1]

First release published via GitHub Actions Trusted Publishing (OIDC). No API changes from 0.1.0.

## [0.1.0] - Initial release

Initial public release of the Nimbalyst extension SDK.

### Added

- `EditorHost` and `EditorHostProps` contract for custom editor extensions
- `useEditorLifecycle` hook for editor load/save/dirty/theme handling
- `ExtensionAITool`, `AIToolContext`, `ExtensionToolResult` types for AI tool extensions
- `ExtensionContext`, `ExtensionManifest`, `ExtensionContributions` for the extension manifest schema
- `PanelContribution`, `PanelExport`, `PanelHost` for non-file-based panels
- `SettingsPanelContribution`, `SettingsPanelProps` for extension settings panels
- `ThemeContribution` and `ThemeColors` for custom theme extensions
- `createExtensionConfig` Vite helper at `@nimbalyst/extension-sdk/vite`
- `createManifestValidationPlugin` Vite plugin to validate build output against `manifest.json`
- `mergeExtensionConfig` for extending the base Vite config
- Tailwind preset at `@nimbalyst/extension-sdk/tailwind`
- Testing utilities at `@nimbalyst/extension-sdk/testing`
- `ROLLUP_EXTERNALS`, `REQUIRED_EXTERNALS`, `EXTERNAL_PATTERNS` constants for the externals system
- `MaterialSymbol` re-export, `createReadOnlyHost`, `clipboard`, and document-path utilities

### Notes

- Several legacy aliases (`CustomEditorProps`, `ToolContext`, `ToolResult`, `AIToolDefinition`, `FileIconContribution`, `LexicalNodeContribution`) are exported for migration but marked `@deprecated`. They will be removed in a future major version.
- Requires Vite 7+ and React 18 or 19 (declared as optional peer dependencies).
