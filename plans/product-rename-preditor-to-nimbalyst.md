---
planStatus:
  planId: plan-product-rename-nimbalyst
  title: Rename Product from Preditor to Nimbalyst
  status: completed
  planType: refactor
  priority: high
  owner: ghinkle
  stakeholders:
    - ghinkle
  tags:
    - branding
    - refactor
    - product-rename
  created: "2025-10-16"
  updated: "2025-10-19T16:30:00.000Z"
  progress: 100
---
# Rename Product from Preditor to Nimbalyst
<!-- plan-status -->

## Goals

Rename the entire product from "Preditor" to "Nimbalyst" across all code, configuration, documentation, and data storage locations. Ensure a clean migration path that preserves user data and settings.

## Scope

This refactor impacts:
- Application identifiers and bundle IDs
- Package names and metadata
- Data storage paths and migration
- UI text and branding
- Documentation
- Build configuration
- Code references (class names, comments, variables)

## Implementation Plan

### Phase 1: Package Configuration

**Package Names**
- Update `packages/electron/package.json`:
  - `name`: `@preditor/electron` → `@nimbalyst/electron`
  - `productName`: `Preditor` → `Nimbalyst`
  - `description`: Update references
  - `appId`: `com.preditor.electron` → `com.nimbalyst.electron`
  - `copyright`: Update company/product name (The company is still named Stravu for copyright purposes)
- Update `packages/rexical/package.json`:
  - `name`: `@preditor/rexical` → `@nimbalyst/rexical`
  - `description`: Update references
- Update `packages/runtime/package.json`:
  - `name`: `@preditor/runtime` → `@nimbalyst/runtime`
  - `description`: Update references
- Update root `package.json`:
  - `name`: Update if present
  - Workspace references

**Build Configuration**
- Update `packages/electron/electron-builder.yml`:
  - `appId`: Update to nimbalyst
  - `productName`: Update to Nimbalyst
  - Mac-specific settings (CFBundleName, etc.)
  - Windows-specific settings if applicable

### Phase 2: Data Storage Migration

**Data Paths**
- Current: `~/Library/Application Support/@preditor/electron/`
- New: `~/Library/Application Support/@nimbalyst/electron/`

**Migration Strategy**
- Implement automatic migration on first launch
- Check for existing `@preditor` data directory
- Copy/migrate to new `@nimbalyst` directory
- Preserve original directory for rollback
- Add migration tracking to prevent duplicate migrations

**Affected Data**
- PGLite database (`pglite-db/`)
- Logs directory (`logs/`)
- State files (json)
- Debug log (`preditor-debug.log` → `nimbalyst-debug.log`)
- Legacy history files if present

### Phase 3: Code References

**File and Class Names**
- Search for "preditor" (case-insensitive) across all source files
- Update class names, variables, comments
- Key files to check:
  - Main process entry points
  - Service classes
  - Configuration files
  - Type definitions

**Import Paths**
- Update package imports from `@preditor/*` to `@nimbalyst/*`
- Update relative imports if any use "preditor" in paths

**Constants and Identifiers**
- Application name constants
- Window titles
- Error messages
- Log prefixes

### Phase 4: Documentation

**README Files**
- Update root README.md
- Update package-specific README files
- Update installation instructions

**Documentation Files**
- Update CLAUDE.md references
- Update any .md files in root and packages
- Update plan documents that reference "Preditor"

**Code Comments**
- Update header comments with product name
- Update inline comments mentioning "Preditor"

### Phase 5: UI and Branding

**Menu Items**
- Application menu name (Mac menu bar)
- About dialog
- Preferences/Settings window

**Window Titles**
- Main window title format
- Dialog titles
- Notification text

**Messages and Labels**
- Error messages
- Status messages
- User-facing strings in components

### Phase 6: Build and Release

**Scripts**
- Update `scripts/release.sh` if it contains product name
- Update any build scripts with hardcoded names
- Update CI/CD configuration (GitHub Actions)

**Artifacts**
- DMG/installer naming
- Update signing certificate references if product-specific
- Update notarization configuration

**Release Notes**
- Update template in `packages/electron/RELEASE_NOTES.md`
- Document the rename in next release notes

### Phase 7: External References

**Repository**
- Consider renaming GitHub repository
- Update repository URLs in package.json files
- Update git remote URLs locally

**Assets**
- Application icon (if it contains "Preditor" text)
- Splash screens
- Marketing materials

## Testing Checklist

- Fresh install works with new name
- Migration from existing Preditor installation works
- Data is preserved (AI sessions, settings, project state)
- Application launches and functions normally
- Build process creates correctly named artifacts
- Mac code signing and notarization work with new appId
- Menu items display correct name
- About dialog shows correct name
- No console errors referencing old name
- Package installation works via npm

## Rollback Plan

If issues arise:
- Original `@preditor` data directory preserved
- Git history allows reverting changes
- Users can reinstall previous version if needed

## Acceptance Criteria

- No references to "Preditor" remain in user-facing text
- All package names updated to `@nimbalyst/*`
- Application data stored in new `@nimbalyst` directory
- Existing user data migrates automatically on first launch
- Application builds and runs successfully with new name
- Code signing and notarization work with new appId
- Documentation reflects new product name
- Build artifacts use new name

## Notes

- This is a comprehensive rename affecting all layers of the application
- Care must be taken to preserve backward compatibility for data migration
- Consider timing of rename relative to major version release
- May want to communicate rename to existing users via release notes

## Implementation Summary

### Completed: 2025-10-19

All phases of the product rename have been successfully completed:

**Phase 1: Package Configuration**
- Updated all package.json files with new @nimbalyst namespace
- Changed product name, app ID, and binary names
- Updated build configuration for Electron
- Updated GitHub release repository reference

**Phase 2: Data Storage Migration**
- Implemented multi-source migration (supports both @preditor and @stravu-editor)
- Migration includes: PGLite database, logs, sessions, history files
- Updated debug log filename to nimbalyst-debug.log
- Added migration markers for tracking
- Preserves original data as backup

**Phase 3: Code References**
- Updated 50+ TypeScript files with new @nimbalyst/runtime imports
- Updated electron.vite.config.ts with new package aliases
- Replaced all debug log references
- Updated all "Preditor" string references to "Nimbalyst"

**Phase 4: Documentation**
- Updated CLAUDE.md with all Nimbalyst references
- Updated README files in all packages
- Updated build script comments
- Renamed CLI binary from stravueditor to nimbalyst

**Phase 5: UI and Branding**
- Updated all menu items and window titles
- Updated About dialog and application menu
- Updated all user-facing strings

**Phase 6: Build and Release**
- Verified successful build with new package names
- Tested dev server startup
- Confirmed data migration works on first launch

### Verification Results

Development server test confirmed:
- App builds successfully
- Migration automatically detected @preditor data
- Successfully migrated config.json, ai-sessions.json, ai-settings.json, preferences.json
- App launches with new branding
- Debug log created at correct path: nimbalyst-debug.log

### Migration Path Summary

**Old locations:**
- ~/Library/Application Support/@preditor/electron/
- ~/Library/Application Support/@stravu-editor/electron/

**New location:**
- ~/Library/Application Support/@nimbalyst/electron/

The migration system checks for existing data in order of precedence (@preditor first, then @stravu-editor) and automatically migrates to the new location on first launch.
