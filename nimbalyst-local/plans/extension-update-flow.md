---
planStatus:
  planId: plan-extension-update-flow
  title: Extension Update Flow
  status: in-review
  planType: feature
  priority: high
  owner: greg
  stakeholders: []
  tags: [extensions, marketplace]
  created: "2026-04-21"
  updated: "2026-04-21T12:00:00.000Z"
  progress: 75
---

# Extension Update Flow

## Problem

The extension marketplace has full install/uninstall support and a publish pipeline (build -> .nimext -> R2 -> Cloudflare Worker), but there is no working update flow. The `check-updates` and `auto-update` IPC handlers exist in `ExtensionMarketplaceHandlers.ts` but are never called from anywhere.

When a developer publishes a new version of an extension (e.g., mindmap v2), users have no way to know an update is available and no way to apply it.

## Current State

### What works
- **Publish pipeline**: `packages/marketplace/scripts/` -- `build-extension.sh` -> `generate-registry.sh` -> `publish-extensions.sh`
- **Registry**: Cloudflare Worker at `extensions.nimbalyst.com/registry` serves `registry.json` from R2
- **Install**: Downloads `.nimext` from CDN, verifies SHA-256 checksum, extracts to `~/.nimbalyst/extensions/{id}/`
- **Install tracking**: `MarketplaceInstallRecord` in electron-store with `version`, `installedAt`, `updatedAt`
- **Version display**: Detail modal shows version; Installed tab shows `v{version}`
- **Backend IPC**: `extension-marketplace:check-updates` compares installed vs registry versions; `extension-marketplace:auto-update` downloads and installs all available updates

### What's missing
1. **No caller**: Nothing invokes `check-updates` or `auto-update` -- the IPC handlers are dead code
2. **No UI indicators**: No "Update Available" badge, no update button, no changelog diff
3. **No startup check**: No periodic or on-launch update check
4. **No InstalledExtensionsPanel integration**: The Settings > Extensions panel is separate from marketplace and shows no update info
5. **Version comparison**: Uses simple string inequality (not semver) -- noted as TODO in code

## Design

### Publisher Workflow (for Greg right now)

To publish a new version of an extension:

1. Bump the `version` field in the extension's `manifest.json`
2. Run the pipeline:
   ```bash
   cd packages/marketplace
   ./scripts/build-extension.sh ../../extensions/mindmap   # or path to extension
   ./scripts/generate-registry.sh
   ./scripts/publish-extensions.sh --env production
   ```
3. The registry at `extensions.nimbalyst.com/registry` now serves the new version
4. Users get the update via the client-side update flow (below)

### Client-Side Update Flow

#### 1. Startup update check

On app ready (after marketplace handlers are registered), check for updates once:

```
main/index.ts (app ready):
  -> invoke extension-marketplace:auto-update
  -> log results
```

This is silent -- no UI prompt needed. The existing `auto-update` handler already downloads and installs all available updates. Extensions hot-reload via `notifyExtensionsChanged`.

#### 2. Marketplace panel "Update Available" indicators

In `ExtensionMarketplacePanel.tsx`:
- On panel mount, call `extension-marketplace:check-updates`
- Show an "Update" button (instead of "Installed" badge) on cards/detail modal for extensions with available updates
- Show the new version number and changelog in the detail modal

#### 3. Installed tab update info

In the Installed tab of the marketplace panel:
- Show "v{current} -> v{available}" when an update is available
- Add an "Update" button per extension
- Add an "Update All" button in the header

#### 4. InstalledExtensionsPanel (Settings > Extensions) -- optional

Could add a subtle "updates available" indicator, but since the marketplace panel already handles this, it may not be needed in v1.

### Decisions

- **Auto-update strategy**: Both -- silent auto-update on startup AND UI indicators in the marketplace panel for transparency
- **Mindmap extension**: Already published in live registry, just needs version bump
- **Scope**: Implement the full update flow now

### Implementation Tasks

#### 1. Wire up auto-update on app startup
- [x] In `main/index.ts`, after marketplace handlers are registered, call `extension-marketplace:auto-update` (fire and forget, don't block startup)
- [x] Log which extensions were updated

#### 2. Marketplace panel -- Discover tab update indicators
- [x] On panel mount, call `extension-marketplace:check-updates` alongside existing data loading
- [x] Store available updates in state: `Map<extensionId, { currentVersion, availableVersion }>`
- [x] On extension cards: show "Update" button instead of "Installed" badge when update available
- [x] In detail modal: show "Update to v{new}" button, display version diff and changelog

#### 3. Marketplace panel -- Installed tab update indicators
- [x] Show `v{current} -> v{available}` when update available
- [x] Add "Update" button per extension (calls `installFromUrl` with new version)
- [x] Add "Update All" button in the Installed tab header when any updates are available

#### 4. Publish mindmap extension update
- [ ] Bump version in mindmap `manifest.json`
- [ ] Run build + generate + publish pipeline
- [ ] Verify update shows in live registry

### Future improvements (not v1)

- Semver-aware version comparison
- User notification toast when extensions are auto-updated
- Settings toggle to disable auto-updates
- Update check in InstalledExtensionsPanel (Settings > Extensions)
- Periodic background check (not just on startup)
- Changelog diff view (what changed between versions)

## Key Files

| File | Role |
| --- | --- |
| `packages/electron/src/main/ipc/ExtensionMarketplaceHandlers.ts` | IPC handlers (check-updates, auto-update already implemented) |
| `packages/electron/src/renderer/components/Settings/panels/ExtensionMarketplacePanel.tsx` | Marketplace UI |
| `packages/electron/src/main/index.ts` | App startup (add auto-update call) |
| `packages/marketplace/scripts/` | Publish pipeline |
| Extension `manifest.json` | Version source of truth |
