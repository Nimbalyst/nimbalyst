---
planStatus:
  planId: plan-theme-system-separation
  title: Separate Themes from Extension System
  status: in-development
  planType: refactor
  priority: medium
  owner: ghinkle
  stakeholders: []
  tags:
    - theming
    - architecture
    - ui
    - marketplace
  created: "2026-01-28"
  updated: "2026-01-28T17:00:00.000Z"
  progress: 75
  startDate: "2026-01-28"
---
# Separate Themes from Extension System

## Implementation Progress

### Phase 1: Core Infrastructure
- [x] Define `theme.json` schema and TypeScript interfaces
- [x] Create `ThemeLoader.ts` service with discovery/validation logic
- [x] Implement theme validation (no code, valid colors, size limits)
- [x] Add IPC handlers for theme management
- [ ] Create `.nimtheme` packaging format support

### Phase 2: Theme Migration
- [x] Extract built-in themes to JSON files
- [x] Create theme storage directory structure
- [x] Migrate `sample-themes` extension to individual themes
- [x] Remove old `sample-themes` extension directory
- [ ] Create migration tool for extension themes

### Phase 3: UI Components
- [x] Create `ThemesPanel.tsx` settings panel
- [x] Build theme preview component
- [x] Update `ThemeToggleButton.tsx` to use ThemeLoader
- [ ] Add "Import Theme" file picker dialog

### Phase 4: Testing & Documentation
- [ ] Unit tests for theme validation
- [ ] E2E tests for theme installation/switching
- [ ] Update THEMING.md documentation
- [ ] Create theme authoring guide

## Problem Statement

Themes are currently implemented as a hybrid system:
- **Built-in themes** (Light, Dark, Crystal Dark) are hardcoded in `theme.ts`
- **Extension themes** are contributed through the extension system via `contributions.themes` in manifest.json
- Theme management UI is mixed: theme picker shows all themes, but extension settings panel doesn't surface theme-specific configuration
- No dedicated theme marketplace or discovery system
- Themes can theoretically contain code (they're just extensions), but we want themes to be style-only

This creates confusion and limits our ability to build a proper theme marketplace with preview, download, and rating features.

## Goals

1. **Separate themes from extensions** - treat them as distinct entities with their own lifecycle
2. **Style-only enforcement** - themes should only contain styling (colors, CSS), no executable code
3. **Dedicated theme UI** - create a dedicated "Themes" settings panel with browse/install/manage capabilities
4. **Theme marketplace** - enable discovering, previewing, and installing themes from a marketplace
5. **Maintain backwards compatibility** - existing extension themes should continue to work during migration

## Proposed Architecture

### Theme Manifest Format

Create a new `theme.json` manifest format (separate from `manifest.json`):

```json
{
  "id": "solarized-dark",
  "name": "Solarized Dark",
  "version": "1.0.0",
  "author": "Your Name",
  "description": "Eye-friendly dark theme",
  "isDark": true,
  "colors": {
    "bg": "#002b36",
    "bg-secondary": "#073642",
    "text": "#839496",
    "text-muted": "#586e75",
    "primary": "#268bd2",
    "success": "#859900",
    "warning": "#b58900",
    "error": "#dc322f"
  },
  "preview": "preview.png",
  "tags": ["dark", "low-contrast", "developer"]
}
```

**Key differences from extension manifest:**
- No `contributions` section (themes ARE the contribution)
- No `main` or code entry points (themes are data-only)
- Dedicated `preview` field for marketplace screenshots
- Tags for discovery and filtering
- Simpler structure focused purely on theming

### Directory Structure

```
~/.nimbalyst/themes/          # User-installed themes
  ├── solarized-dark/
  │   ├── theme.json
  │   └── preview.png
  ├── monokai/
  │   ├── theme.json
  │   └── preview.png

packages/runtime/src/themes/  # Built-in themes
  ├── light.json
  ├── dark.json
  └── crystal-dark.json
```

**Migration from current structure:**
- Extension themes in `~/.nimbalyst/extensions/sample-themes/` would be migrated to individual theme folders
- Built-in themes would be extracted from hardcoded `theme.ts` into JSON files
- No code allowed in theme directories (validation on load)

### Theme Loader Service

Create new `ThemeLoader.ts` (similar to `ExtensionLoader.ts` but simpler):

```typescript
class ThemeLoader {
  // Discovery
  discoverThemes(): Theme[]
  loadTheme(themeId: string): Theme | null

  // Validation
  validateTheme(manifest: any): boolean  // Ensures no code, valid colors

  // Management
  installTheme(zipPath: string): Promise<void>
  uninstallTheme(themeId: string): Promise<void>

  // Marketplace integration
  fetchMarketplaceThemes(): Promise<MarketplaceTheme[]>
  downloadTheme(themeId: string): Promise<void>
}
```

**Key principles:**
- No code execution (themes are pure data)
- Validate color format and required fields
- Support theme packaging as `.nimtheme` zip files
- Marketplace metadata separate from installed themes

### UI Changes

#### 1. Dedicated Themes Settings Panel

Create new `ThemesPanel.tsx` in settings with three sections:

**Active Theme Section:**
- Shows currently selected theme with preview
- Quick theme switcher (similar to current theme toggle)
- "Customize" button (for future theme customization feature)

**Installed Themes Section:**
- Grid/list view of installed themes with previews
- Enable/disable toggles (themes can be installed but inactive)
- Delete button for user-installed themes (can't delete built-ins)
- "Import Theme" button to install from `.nimtheme` file

**Browse Themes Section:**
- Marketplace integration showing available themes
- Filter by tags (dark/light, color scheme, purpose)
- Preview themes before installing
- Download and install with one click
- Show ratings/downloads/author info

#### 2. Theme Toggle Button Update

Current `ThemeToggleButton.tsx` stays mostly the same but:
- Fetches themes from `ThemeLoader` instead of `ExtensionLoader.getThemes()`
- Links to new Themes settings panel ("More themes...")
- Simplified since themes are no longer mixed with extensions

#### 3. Extension Settings Panel Update

`InstalledExtensionsPanel.tsx` removes theme-related code:
- No longer shows extensions that only provide themes
- Focus purely on functional extensions (tools, editors, MCP servers)

### Migration Strategy

**Phase 1: Dual Support (Backwards Compatible)**
- Keep existing extension theme support working
- Add new `ThemeLoader` alongside `ExtensionLoader`
- Theme picker shows both extension themes and new-format themes
- UI shows migration prompt for extension themes

**Phase 2: Migration Tools**
- Add "Convert to Theme" button in extension settings for theme-only extensions
- Auto-migrate built-in `sample-themes` extension to new format
- Command-line tool to convert extension themes to `.nimtheme` format

**Phase 3: Deprecation**
- Mark `contributions.themes` as deprecated in extension manifest
- Show warning when loading extension themes
- Documentation guides users to new theme format

**Phase 4: Removal**
- Remove theme support from extension system
- Delete `sample-themes` extension (replaced by individual themes)
- Clean up `ExtensionLoader.getThemes()` and related code

### Theme Marketplace Integration

**Marketplace API structure:**
```typescript
interface MarketplaceTheme {
  id: string;
  name: string;
  author: string;
  version: string;
  description: string;
  downloads: number;
  rating: number;
  tags: string[];
  preview: string;          // URL to preview image
  downloadUrl: string;      // URL to .nimtheme file
  lastUpdated: string;
}
```

**Discovery flow:**
1. User opens Themes panel > Browse tab
2. Frontend fetches theme list from marketplace API
3. User clicks "Install" on a theme
4. Download `.nimtheme` file, validate, extract to `~/.nimbalyst/themes/`
5. Theme appears in "Installed Themes" section
6. User can activate it via theme picker

### Validation and Security

**Theme validation checks:**
1. **No executable code** - theme directory must only contain `theme.json` and image assets
2. **Valid JSON** - theme.json must parse and validate against schema
3. **Color format validation** - all colors must be valid hex codes or CSS color names
4. **Size limits** - theme package must be under 5MB
5. **Required fields** - id, name, version, isDark must be present

**Security considerations:**
- Themes are data-only (no code execution)
- Downloaded themes scanned for executable files
- Marketplace themes reviewed before publishing
- User themes stored in isolated directory (can't access system files)

## Implementation Checklist

### Core Infrastructure
- [ ] Create `ThemeLoader.ts` service with discovery/validation logic
- [ ] Define `theme.json` schema and TypeScript interfaces
- [ ] Implement theme validation (no code, valid colors, size limits)
- [ ] Create `.nimtheme` packaging format (zip with theme.json + assets)
- [ ] Add IPC handlers for theme management (`theme:install`, `theme:uninstall`, `theme:list`)

### Theme Migration
- [ ] Extract built-in themes (light/dark/crystal-dark) to JSON files
- [ ] Create migration tool to convert extension themes to new format
- [ ] Migrate `sample-themes` extension to individual theme files
- [ ] Update theme storage path from `extensions/` to `themes/`

### UI Components
- [ ] Create new `ThemesPanel.tsx` settings panel with three sections
- [ ] Build theme preview component with color swatches
- [ ] Update `ThemeToggleButton.tsx` to use `ThemeLoader`
- [ ] Add "Import Theme" file picker dialog
- [ ] Create theme marketplace browser UI

### Marketplace Integration
- [ ] Define marketplace API endpoints and data schema
- [ ] Implement theme download and install flow
- [ ] Add theme search and filtering
- [ ] Create theme preview/screenshot viewer
- [ ] Implement theme ratings and reviews (future)

### Backwards Compatibility
- [ ] Keep `ExtensionLoader.getThemes()` working during migration period
- [ ] Add deprecation warnings for extension themes
- [ ] Create conversion tool for existing extension themes
- [ ] Document migration path for theme authors

### Testing
- [ ] Unit tests for theme validation logic
- [ ] E2E tests for theme installation/uninstallation
- [ ] E2E tests for theme switching
- [ ] Test theme migration from extension format
- [ ] Test marketplace download and install

### Documentation
- [ ] Theme authoring guide (creating theme.json)
- [ ] Theme packaging guide (creating .nimtheme files)
- [ ] Marketplace submission guidelines
- [ ] Migration guide for extension theme authors
- [ ] Update THEMING.md with new architecture

## Open Questions

1. **Theme naming/scoping**: Should themes use flat IDs or namespaced like `author/theme-name`?
2. **Theme variants**: Should themes support multiple variants (e.g., Solarized Dark/Light as one theme)?
3. **Custom CSS**: Should themes allow custom CSS files or only color overrides?
4. **Theme preview generation**: Auto-generate previews from color definitions or require manual screenshots?
5. **Theme updates**: Auto-update installed themes from marketplace or require manual update?
6. **Theme configuration**: Should themes expose configuration options (accent color, contrast level)?

## Success Criteria

- [ ] Themes are completely separate from extensions system
- [ ] No executable code in theme packages
- [ ] Dedicated Themes settings panel with install/browse/manage
- [ ] Theme marketplace integration working
- [ ] All existing themes migrated to new format
- [ ] Theme installation and switching tested in E2E tests
- [ ] Documentation complete for theme authors and users

## Related Work

- Requires marketplace backend API (separate project)
- Theme preview generation tooling
- Extension system cleanup (remove theme-related code)
- Settings UI refactoring (new Themes panel)

## Implementation Notes

### Completed Components

**Type System** (`packages/extension-sdk/src/types/theme.ts`):
- `ThemeManifest` - Schema for theme.json files
- `Theme` - Runtime theme object with resolved colors
- `ThemeColors` - Color key-value type mappings
- `ThemeSource` - Tracking theme origin (builtin/user/extension)
- `MarketplaceTheme` - Future marketplace integration types

**Theme Loader** (`packages/runtime/src/themes/ThemeLoader.ts`):
- Platform-agnostic discovery and validation
- Validates color formats (hex, rgb, hsl, CSS names)
- Enforces style-only constraint (no code files)
- Size limit enforcement (5MB max)
- Caching and reload capabilities
- `ThemePlatformService` interface for portability

**IPC Handlers** (`packages/electron/src/main/ipc/ThemeHandlers.ts`):
- `theme:list` - List all discovered themes
- `theme:get` - Get specific theme by ID
- `theme:validate` - Validate theme directory
- `theme:install` - Install from directory or .nimtheme
- `theme:uninstall` - Remove user theme
- `theme:reload` - Rescan theme directories
- Electron platform service implementation

**Built-in Themes** (`packages/runtime/src/themes/builtin/`):
- Migrated from hardcoded to JSON: light, dark, crystal-dark
- Migrated from sample-themes extension: solarized-dark, solarized-light, monokai
- All themes use consistent theme.json schema
- Removed old `sample-themes` extension directory

**Extension API Cleanup**:
- Deprecated `ThemeContribution` interface in extension.ts
- Deprecated `ThemeColorKey` type in extension.ts
- Deprecated `contributions.themes` in ExtensionContributions
- Deprecated `ExtensionLoader.getThemes()` method
- Added deprecation notices pointing to new theme system

**UI Integration**:
- Updated `ThemeToggleButton` to fetch from new theme system
- Added `getAllAvailableThemesAsync()` for async theme loading
- Maintains backward compatibility with extension themes during transition
- Created comprehensive `ThemesPanel.tsx` settings panel with:
  - Theme browsing and selection
  - Active theme indicator
  - Theme uninstall functionality
  - Theme details sidebar with metadata and color preview
  - Built-in vs user theme categorization
  - Refresh/reload functionality

### Architecture Decisions

1. **Dual Support During Migration**: The system supports both new standalone themes and legacy extension themes to ensure smooth migration path.

2. **Theme Directory Locations**:
  - Built-in: `packages/runtime/src/themes/builtin/` (bundled with app)
  - User-installed: `~/.nimbalyst/themes/` (auto-created)

3. **Validation Strategy**: Multi-layered validation ensures themes are safe:
  - File type whitelist (only .json and images)
  - Color format validation
  - Size limits
  - Required field checks

4. **Backward Compatibility**: Extension themes continue to work via `isExtensionTheme()` check, allowing gradual migration.

### Next Steps

The foundation is complete. Remaining work:

1. **ThemesPanel.tsx**: Dedicated settings panel with install/browse/manage UI
2. **Theme Preview**: Visual preview component showing theme colors
3. **Import Dialog**: File picker for installing .nimtheme files
4. **Testing**: Unit and E2E tests for theme system
5. **Documentation**: Update THEMING.md and create authoring guide
6. **Migration Tool**: CLI tool to convert extension themes
7. **Deprecation**: Mark extension theme support as deprecated
8. **Cleanup**: Remove theme-related code from ExtensionLoader