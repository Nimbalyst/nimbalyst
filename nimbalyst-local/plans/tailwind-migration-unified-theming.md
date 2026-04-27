---
planStatus:
  planId: plan-tailwind-migration-unified-theming
  title: Tailwind Migration & Unified Theming System
  status: in-review
  planType: refactor
  priority: high
  owner: ghinkle
  stakeholders:
    - ghinkle
  tags:
    - tailwind
    - theming
    - css
    - extensions
    - refactor
  created: "2026-01-08"
  updated: "2026-04-27T00:00:00.000Z"
  startDate: "2026-01-24"
  progress: 100
---
# Tailwind Migration & Unified Theming System

## Implementation Progress

### Phase 6: Final Cleanup (2026-04-27)
- [x] Fix stale `--surface-*` / `--text-primary` / `--accent-primary` / `--border-primary` variables in `AdvancedPanel.tsx`
- [x] Remove `PlaygroundEditorTheme` reference in `tailwind.config.ts` comment
- [x] Remove `PlaygroundEditorTheme` reference in `NimbalystEditorTheme.ts` comment
- [x] Remove `PlaygroundEditorTheme__ul` fallback in `e2e/theme/theme.spec.ts`
- [x] Convert color/theming inline styles in `TrackerMode/SessionKanbanBoard.tsx` (rgba/hex backgrounds, var(--nim-*) calls)
- [x] Convert color/theming inline styles in `TrackerMode/TrackerItemDetail.tsx`
- [x] Convert color/theming inline styles in `AgentMode/AgentWorkstreamPanel.tsx`
- [x] Convert var(--nim-text-muted) inline style in `TabEditor/CollaborativeTabEditor.tsx`
- [x] Convert var(--nim-success) inline style in `Settings/panels/SyncPanel.tsx`
- [x] Replace stale `var(--warning-color, ...)` in `runtime/AgentTranscript/TranscriptSearchBar.tsx` with `var(--nim-warning)`
- [x] Replace stale `var(--error-color, ...)` in `UnifiedAI/PendingVoiceCommand.tsx` with `text-nim-error`
- [x] Replace stale `var(--error-color, ...)` in `UnifiedAI/VoiceModeButton.tsx` with `bg-nim-error` / `text-nim-error` / `border-nim-error`
- [x] Replace stale `var(--error-color)` in `Terminal/TerminalPanel.tsx` (and convert that block to Tailwind)
- [x] Remove `--primary-color` / `--primary-color-hover` backwards-compat aliases from `packages/electron/src/renderer/index.css`
- [x] Rewrite `docs/CSS_VARIABLES.md` to use `--nim-*` naming
- [x] Verify no stale `--surface-*` / `--text-primary` / `--accent-*` / `--*-color` references remain in source
- [x] Typecheck passes (`@nimbalyst/electron` + `@nimbalyst/runtime`)

**Note on remaining inline styles:** The ~200 remaining `style={{}}` usages in the renderer are either dynamic (data-driven values like `style={{ background: tag.color }}`) or structural (positioning, computed grid templates, etc.). The plan's success criteria explicitly allows structural inline styles — only color/theming inline styles needed to be eliminated, and all of those have been converted.

### Phase 1: Foundation Setup
- [x] Create monorepo `tailwind.config.ts` at repository root
- [x] Create `NimbalystTheme.css` in `/packages/rexical/src/themes/`
- [x] Create TypeScript theme types (`types.ts`) in rexical
- [x] Create theme registry (`registry.ts`) in rexical
- [x] Set up PostCSS configuration for all packages
- [x] Export theme types from rexical package

### Phase 2: Lexical Theme Rename
- [x] Create `NimbalystEditorTheme.ts` with new class prefixes
- [x] Create `NimbalystEditorTheme.css` with renamed classes
- [x] Update all Lexical theme imports throughout codebase
- [x] Create backward compatibility shim for PlaygroundEditorTheme
- [x] Delete old PlaygroundEditorTheme files after migration complete

### Phase 3: Package Migration
- [x] Capacitor: Update tailwind.config.js to extend shared config
- [x] Electron: Install Tailwind and configure postcss
- [x] Electron: Migrate CSS variables to `--nim-*` prefix (~1500+ occurrences)
- [x] Electron: Create shared component utilities (`styles/components.css`)
- [x] **BUGFIX**: Fixed CSS import order - theme variables must load before `@tailwind` directives
- [x] **BUGFIX**: Fixed all incorrect variable names (--nim-bg-primary → --nim-bg, etc.) across 1000+ occurrences
- [x] **DOCUMENTATION**: Added canonical CSS variable reference to `/CLAUDE.md`
- [x] Electron: Convert inline styles to Tailwind classes (prioritize)
- [x] Electron: Consolidate/reduce component CSS files (~90 CSS files deleted)
- [x] Rexical: Migrate UI components to use new variables
- [x] Runtime: Migrate AI components to use new variables (AgentTranscript, CustomToolWidgets, TrackerPlugin)
- [x] Extensions: Update to use `--nim-*` variables (image-generation, excalidraw, datamodellm, csv-spreadsheet)

### Phase 4: Extension Theme API
- [x] Update `ExtensionContributions` type with themes array
- [x] Implement theme registration in ExtensionLoader
- [x] Implement dynamic theme application function
- [x] Update ThemeToggleButton for custom themes
- [x] Test with sample theme extension

### Phase 5: Documentation
- [x] Create `EXTENSION_THEMING.md` documentation
- [x] Update existing `THEMING.md` with new system
- [x] Create Tailwind preset for extensions in extension-sdk
- [x] Add theme contribution examples to extension docs

---

## Key Decisions

### Semantic Class Names Must Be Preserved

**Decision**: Keep semantic class names alongside Tailwind utility classes.

**Rationale**:
1. **Playwright tests** rely on semantic selectors like `.confirm-dialog-overlay`
2. **DevTools debugging** is much easier with meaningful class names
3. **Code readability** improves when you can identify components by class name

**Pattern**:
```tsx
// CORRECT: Semantic class first, then utility classes
<div className="confirm-dialog-overlay nim-overlay">
<button className="confirm-dialog-button-cancel nim-btn-secondary">

// WRONG: Only utility classes (loses testability)
<div className="fixed inset-0 bg-black/50 flex items-center justify-center">
```

**Alternative Pattern**: Use `@apply` in CSS so semantic classes contain the styles:
```css
.confirm-dialog-overlay {
  @apply fixed inset-0 flex items-center justify-center z-[10000];
  background: rgba(0, 0, 0, 0.5);
}
```

### Shared Component Utilities

Created `/packages/electron/src/renderer/styles/components.css` with reusable `nim-*` utility classes:

| Class | Purpose |
| --- | --- |
| `nim-overlay` | Modal backdrop |
| `nim-modal` | Modal container |
| `nim-modal-header/body/footer` | Modal structure |
| `nim-btn`, `nim-btn-primary/secondary/ghost/danger` | Button variants |
| `nim-btn-icon`, `nim-btn-icon-sm/lg` | Icon buttons |
| `nim-input` | Form inputs |
| `nim-list-item` | Interactive list items |
| `nim-badge`, `nim-pill` | Tags/badges |
| `nim-panel`, `nim-panel-header/body` | Card/panel structure |
| `nim-scrollbar` | Scrollbar styling |
| `nim-section-label` | Small uppercase text |
| `nim-focus-ring` | Focus states |

### CSS File Strategy

**Goal**: Reduce CSS footprint while maintaining testability.

1. **Keep CSS files** for complex component-specific styles
2. **Use shared utilities** for common patterns (modals, buttons, inputs)
3. **Semantic classes** remain in JSX for testing/debugging
4. **Tailwind utilities** for layout/spacing that doesn't need semantic meaning

**Do NOT delete CSS files blindly** - evaluate each for:
- Playwright test selectors in use
- Complex styles that can't be expressed in Tailwind
- Component-specific animations or states

## Overview

Migrate the entire Nimbalyst monorepo to Tailwind CSS while unifying the fragmented theming system. This involves:

1. **Tailwind adoption** across all packages (electron, rexical, runtime, capacitor, extensions, extension-sdk)
2. **Eliminating the "PlaygroundEditorTheme" nomenclature** in favor of a unified "Nimbalyst" theme system
3. **Reducing CSS and inline styles** in favor of Tailwind utility classes
4. **Extension theme contribution API** allowing extensions to register custom themes
5. **Extension developer guidance** for theming best practices

## Current State Analysis

### Styling Fragmentation

| Package | Current Approach | CSS Files | Inline Styles |
| --- | --- | --- | --- |
| electron | CSS files + CSS variables | ~50+ | ~314 |
| rexical | CSS files + Lexical theme object | ~30+ | ~50 |
| runtime | CSS files + CSS variables | ~15+ | ~30 |
| capacitor | Tailwind + CSS variables (hybrid) | 1 | minimal |
| extensions | CSS files + CSS variables | ~10+ | ~20 |

### Theme Definition Duplication

Currently, theme colors are defined in **three separate places**:

1. **`/packages/rexical/src/themes/PlaygroundEditorTheme.css`** - ~100+ CSS variables (primary source)
2. **`/packages/runtime/src/store/atoms/theme.ts`** - TypeScript `ThemeColors` interface (duplicated values)
3. **`/packages/capacitor/src/styles/global.css`** - ~15 CSS variables (subset, duplicated)

### Lexical Integration Complexity

The Lexical editor requires a theme object (`EditorThemeClasses`) that maps node types to CSS class names. Currently using `PlaygroundEditorTheme__` prefix for 60+ classes:

```typescript
// Current: packages/rexical/src/themes/PlaygroundEditorTheme.ts
const theme: EditorThemeClasses = {
  heading: {
    h1: 'PlaygroundEditorTheme__h1',
    h2: 'PlaygroundEditorTheme__h2',
    // ...
  },
  text: {
    bold: 'PlaygroundEditorTheme__textBold',
    // ...
  },
  // 60+ more classes
};
```

### Extension Theming Gaps

- Extensions cannot contribute custom themes
- `registerCustomTheme()` exists in runtime but is not exposed
- No extension SDK API for theme registration
- Extensions rely on CSS variable availability with fallbacks

## Goals

1. **Single source of truth** for all theme values (Tailwind config)
2. **Consistent naming** - Replace "PlaygroundEditorTheme" with "nimbalyst" prefix
3. **Extension theme API** - Allow extensions to contribute themes
4. **Developer guidance** - Document theming best practices for extension developers
5. **Reduce CSS footprint** - Convert to Tailwind utilities where practical
6. **Maintain Lexical compatibility** - Preserve necessary CSS class structure

## Non-Goals

- Full elimination of CSS files (some will remain for complex styling)
- Breaking changes to extension styling (provide migration path)
- Changing the three built-in themes (light, dark, crystal-dark)

---

## Architecture

### Unified Theme System

```
tailwind.config.ts (monorepo root)
    |
    +-- Defines all theme colors as Tailwind theme values
    |
    +-- Generates CSS variables at build time
    |
    v
packages/rexical/src/themes/
    |
    +-- NimbalystTheme.ts    - TypeScript theme types & registry
    +-- NimbalystTheme.css   - CSS variables + Lexical-specific classes
    +-- tokens.ts            - Design token exports
    |
    v
Extension SDK
    |
    +-- Theme contribution API
    +-- CSS variable consumption
    +-- Tailwind preset for extensions
```

**Why rexical?** Rexical is already the home for theming (PlaygroundEditorTheme.css) and is a dependency of all UI packages. This avoids creating a new package and aligns with potential future rexical/runtime merge.

### Design Token Flow

```
Tailwind Config (source of truth)
    |
    +-- CSS Variables (--nim-bg, --nim-text, --nim-primary, etc.)
    |
    +-- Tailwind Classes (bg-nim, text-nim, bg-nim-primary, etc.)
    |
    +-- TypeScript Types (ThemeColors interface)
    |
    v
All Packages Consume
```

### Naming Philosophy

**Use conventional names that match CSS/Tailwind mental models:**

| Concept | CSS Variable | Tailwind Class | Why |
| --- | --- | --- | --- |
| Main background | `--nim-bg` | `bg-nim` | Matches CSS `background` |
| Secondary bg | `--nim-bg-secondary` | `bg-nim-secondary` | Clear hierarchy |
| Main text | `--nim-text` | `text-nim` | Matches CSS/Tailwind |
| Muted text | `--nim-text-muted` | `text-nim-muted` | Common pattern |
| Action/brand color | `--nim-primary` | `bg-nim-primary` | Industry standard |
| Border | `--nim-border` | `border-nim` | Matches Tailwind |

**Rationale**: AI coding assistants are trained on millions of codebases using these conventions. Fighting that training leads to constant mistakes like `background-secondary` vs `surface-secondary`.

### Extension Theme Contribution

Extensions can contribute themes via manifest:

```json
{
  "id": "com.example.solarized-theme",
  "contributions": {
    "themes": [{
      "id": "solarized-light",
      "name": "Solarized Light",
      "isDark": false,
      "colors": {
        "bg": "#fdf6e3",
        "bg-secondary": "#eee8d5",
        "text": "#657b83",
        "primary": "#268bd2"
      }
    }]
  }
}
```

---

## Implementation Phases

### Phase 1: Foundation Setup

**Goal**: Establish shared Tailwind configuration and new theme system foundation.

#### 1.1 Create Monorepo Tailwind Config

Create `/tailwind.config.ts` at repository root:

```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './packages/*/src/**/*.{ts,tsx,js,jsx}',
  ],
  darkMode: ['class', '[data-theme="dark"]', '[data-theme="crystal-dark"]'],
  theme: {
    extend: {
      colors: {
        // Nimbalyst theme colors - conventional naming
        nim: {
          // Backgrounds (use: bg-nim, bg-nim-secondary, etc.)
          bg: 'var(--nim-bg)',
          'bg-secondary': 'var(--nim-bg-secondary)',
          'bg-tertiary': 'var(--nim-bg-tertiary)',
          'bg-hover': 'var(--nim-bg-hover)',
          'bg-selected': 'var(--nim-bg-selected)',
          'bg-active': 'var(--nim-bg-active)',

          // Text (use: text-nim, text-nim-muted, etc.)
          text: 'var(--nim-text)',
          'text-muted': 'var(--nim-text-muted)',
          'text-faint': 'var(--nim-text-faint)',
          'text-disabled': 'var(--nim-text-disabled)',

          // Borders (use: border-nim, border-nim-focus)
          border: 'var(--nim-border)',
          'border-focus': 'var(--nim-border-focus)',

          // Primary action color (use: bg-nim-primary, text-nim-primary)
          primary: 'var(--nim-primary)',
          'primary-hover': 'var(--nim-primary-hover)',

          // Links
          link: 'var(--nim-link)',
          'link-hover': 'var(--nim-link-hover)',

          // Status colors
          success: 'var(--nim-success)',
          warning: 'var(--nim-warning)',
          error: 'var(--nim-error)',
          info: 'var(--nim-info)',
        },
      },
    },
  },
  plugins: [],
};

export default config;
```

**Usage examples:**
```tsx
// Backgrounds
<div className="bg-nim">              // Main background
<div className="bg-nim-secondary">    // Sidebar, panels
<div className="bg-nim-hover">        // Hover states

// Text
<p className="text-nim">              // Main text
<p className="text-nim-muted">        // Secondary text
<p className="text-nim-faint">        // Tertiary/hint text

// Borders
<div className="border border-nim">   // Standard border
<input className="border-nim-focus">  // Focus state

// Primary action color
<button className="bg-nim-primary text-white hover:bg-nim-primary-hover">
```

#### 1.2 Create New Theme Definition

Create `/packages/rexical/src/themes/NimbalystTheme.css`:

```css
:root {
  /* ===== LIGHT THEME (Default) ===== */

  /* Backgrounds */
  --nim-bg: #ffffff;
  --nim-bg-secondary: #f9fafb;
  --nim-bg-tertiary: #f3f4f6;
  --nim-bg-hover: #f3f4f6;
  --nim-bg-selected: #e5e7eb;
  --nim-bg-active: #dbeafe;

  /* Text */
  --nim-text: #111827;
  --nim-text-muted: #6b7280;
  --nim-text-faint: #9ca3af;
  --nim-text-disabled: #d1d5db;

  /* Borders */
  --nim-border: #e5e7eb;
  --nim-border-focus: #3b82f6;

  /* Primary (action/brand color) */
  --nim-primary: #3b82f6;
  --nim-primary-hover: #2563eb;

  /* Links */
  --nim-link: #2563eb;
  --nim-link-hover: #1d4ed8;

  /* Status */
  --nim-success: #10b981;
  --nim-warning: #f59e0b;
  --nim-error: #ef4444;
  --nim-info: #3b82f6;

  /* Code blocks */
  --nim-code-bg: #f8f9fa;
  --nim-code-text: #24292e;
  --nim-code-border: #e1e4e8;
}

/* Dark Theme */
:root[data-theme="dark"],
:root.dark-theme {
  --nim-bg: #2d2d2d;
  --nim-bg-secondary: #1a1a1a;
  --nim-bg-tertiary: #3a3a3a;
  --nim-bg-hover: #3a3a3a;
  --nim-bg-selected: #4a4a4a;
  --nim-bg-active: #1e3a5f;

  --nim-text: #ffffff;
  --nim-text-muted: #a0a0a0;
  --nim-text-faint: #707070;
  --nim-text-disabled: #505050;

  --nim-border: #404040;
  --nim-border-focus: #3b82f6;
  /* ... etc ... */
}

/* Crystal Dark Theme */
:root[data-theme="crystal-dark"],
:root.crystal-dark-theme {
  --nim-bg: #0f172a;
  --nim-bg-secondary: #020617;
  --nim-bg-tertiary: #1e293b;
  --nim-bg-hover: #1e293b;
  --nim-bg-selected: #334155;
  --nim-bg-active: #1e3a5f;

  --nim-text: #f8fafc;
  --nim-text-muted: #94a3b8;
  --nim-text-faint: #64748b;
  --nim-text-disabled: #475569;

  --nim-border: #334155;
  --nim-border-focus: #3b82f6;
  /* ... etc ... */
}
```

#### 1.3 Create TypeScript Theme Types

Create `/packages/rexical/src/themes/types.ts`:

```typescript
/**
 * Theme identifier.
 * Built-in themes plus any custom theme IDs registered by extensions.
 */
export type ThemeId = 'light' | 'dark' | 'crystal-dark' | (string & {});

/**
 * Complete set of theme color tokens.
 * Uses conventional naming that matches CSS/Tailwind mental models.
 */
export interface ThemeColors {
  // Backgrounds
  'bg': string;
  'bg-secondary': string;
  'bg-tertiary': string;
  'bg-hover': string;
  'bg-selected': string;
  'bg-active': string;

  // Text
  'text': string;
  'text-muted': string;
  'text-faint': string;
  'text-disabled': string;

  // Borders
  'border': string;
  'border-focus': string;

  // Primary (action/brand color)
  'primary': string;
  'primary-hover': string;

  // Links
  'link': string;
  'link-hover': string;

  // Status
  'success': string;
  'warning': string;
  'error': string;
  'info': string;
}

/**
 * Theme definition.
 */
export interface Theme {
  id: ThemeId;
  name: string;
  isDark: boolean;
  colors: ThemeColors;
  /** Extension ID that contributed this theme (undefined for built-in) */
  contributedBy?: string;
}

/**
 * Theme contribution in extension manifest.
 */
export interface ThemeContribution {
  id: string;
  name: string;
  isDark: boolean;
  colors: Partial<ThemeColors>;
}
```

#### 1.4 Create Theme Registry

Create `/packages/rexical/src/themes/registry.ts`:

```typescript
import type { Theme, ThemeId, ThemeColors } from './types';

const themes = new Map<ThemeId, Theme>();
const listeners = new Set<(themes: Theme[]) => void>();

// Built-in themes (loaded from NimbalystTheme.css values)
const builtInThemes: Theme[] = [
  { id: 'light', name: 'Light', isDark: false, colors: { /* ... */ } },
  { id: 'dark', name: 'Dark', isDark: true, colors: { /* ... */ } },
  { id: 'crystal-dark', name: 'Crystal Dark', isDark: true, colors: { /* ... */ } },
];

builtInThemes.forEach(t => themes.set(t.id, t));

export function getTheme(id: ThemeId): Theme | undefined {
  return themes.get(id);
}

export function getAllThemes(): Theme[] {
  return Array.from(themes.values());
}

export function registerTheme(theme: Theme): () => void {
  themes.set(theme.id, theme);
  notifyListeners();
  return () => {
    themes.delete(theme.id);
    notifyListeners();
  };
}

export function onThemesChanged(listener: (themes: Theme[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyListeners() {
  const allThemes = getAllThemes();
  listeners.forEach(fn => fn(allThemes));
}
```

### Phase 2: Rename and Migrate Lexical Theme

**Goal**: Replace "PlaygroundEditorTheme" nomenclature with "nimbalyst" prefix.

#### 2.1 Create New Lexical Theme Object

Create `/packages/rexical/src/themes/NimbalystEditorTheme.ts`:

```typescript
import type { EditorThemeClasses } from 'lexical';
import './NimbalystEditorTheme.css';

const theme: EditorThemeClasses = {
  autocomplete: 'nim-autocomplete',
  blockCursor: 'nim-block-cursor',
  code: 'nim-code',
  codeHighlight: {
    atrule: 'nim-token-attr',
    attr: 'nim-token-attr',
    boolean: 'nim-token-property',
    // ... all 25+ token types
  },
  heading: {
    h1: 'nim-h1',
    h2: 'nim-h2',
    h3: 'nim-h3',
    h4: 'nim-h4',
    h5: 'nim-h5',
    h6: 'nim-h6',
  },
  // ... rest of theme classes with nimbalyst- prefix
};

export default theme;
```

#### 2.2 Create NimbalystEditorTheme.css

Migrate all CSS from `PlaygroundEditorTheme.css` to `NimbalystEditorTheme.css`:

- Rename all `.PlaygroundEditorTheme__*` classes to `.nim-*`
- Use new `--nim-*` CSS variables
- Add Tailwind `@apply` directives where appropriate

```css
/* Example class migration */
.nim-h1 {
  @apply text-3xl font-bold mb-4;
  color: var(--nim-text);
}

.nim-paragraph {
  @apply mb-2;
  color: var(--nim-text);
}

/* Code highlighting - more complex, keep CSS */
.nim-code {
  background-color: var(--nim-code-bg);
  border: 1px solid var(--nim-code-border);
  /* ... */
}
```

#### 2.3 Update All Imports

Update all files that import the old theme:

```typescript
// Before
import PlaygroundEditorTheme from '@nimbalyst/rexical/themes/PlaygroundEditorTheme';

// After
import NimbalystEditorTheme from '@nimbalyst/rexical/themes/NimbalystEditorTheme';
```

#### 2.4 Backward Compatibility Shim

Create temporary re-export for gradual migration:

```typescript
// packages/rexical/src/themes/PlaygroundEditorTheme.ts
/** @deprecated Use NimbalystEditorTheme instead */
export { default } from './NimbalystEditorTheme';
```

### Phase 3: Package-by-Package Tailwind Migration

#### 3.1 Capacitor Package (Already Tailwind)

- Update `tailwind.config.js` to extend monorepo config
- Replace local CSS variables with shared `--nim-*` variables
- Verify all components use semantic Tailwind classes

#### 3.2 Electron Package

**3.2.1 Install and Configure Tailwind**

```bash
cd packages/electron
npm install -D tailwindcss postcss autoprefixer
```

Create `packages/electron/tailwind.config.ts`:

```typescript
import baseConfig from '../../tailwind.config';
import type { Config } from 'tailwindcss';

const config: Config = {
  ...baseConfig,
  content: [
    './src/**/*.{ts,tsx}',
    '../runtime/src/**/*.{ts,tsx}',
  ],
};

export default config;
```

**3.2.2 Inline Style Conversion (Priority)**

Convert the ~314 inline styles to Tailwind classes. Example patterns:

```tsx
// Before
<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>

// After
<div className="flex items-center gap-2">
```

**3.2.3 Component CSS Migration**

For each component CSS file:
1. Identify styles that map to Tailwind utilities
2. Convert simple properties to `className`
3. Keep complex/conditional styles in CSS using `@apply`

Example migration:

```css
/* Before: FileTree.css */
.file-tree-item {
  display: flex;
  align-items: center;
  padding: 4px 8px;
  cursor: pointer;
  border-radius: 4px;
  color: var(--text-primary);
}

.file-tree-item:hover {
  background-color: var(--surface-hover);
}
```

```tsx
// After: FileTree.tsx
<div className="flex items-center px-2 py-1 cursor-pointer rounded text-nim hover:bg-nim-hover">
```

#### 3.3 Rexical Package

**Special consideration**: Lexical requires CSS classes for node styling.

- Keep `NimbalystEditorTheme.css` for Lexical node classes
- Migrate UI component CSS (Dialog, Modal, ColorPicker) to Tailwind
- Plugin CSS stays as CSS files but uses `--nim-*` variables

#### 3.4 Runtime Package

- Install Tailwind with electron package config
- Migrate AI component styles to Tailwind
- AgentTranscript, AIInput, AIChat components

#### 3.5 Extensions

Each extension updated to:
1. Use `--nim-*` CSS variables (dropping fallbacks once migration complete)
2. Optionally adopt Tailwind via extension SDK preset

### Phase 4: Extension Theme Contribution API

#### 4.1 Update Extension Manifest Schema

Add `themes` to `ExtensionContributions`:

```typescript
// packages/extension-sdk/src/types/extension.ts
export interface ExtensionContributions {
  customEditors?: CustomEditorContribution[];
  fileIcons?: FileIconContribution[];
  aiTools?: string[];
  newFileMenu?: NewFileMenuContribution[];
  lexicalNodes?: LexicalNodeContribution[];
  slashCommands?: SlashCommandContribution[];
  /** Custom themes contributed by this extension */
  themes?: ThemeContribution[];
}

export interface ThemeContribution {
  /** Unique theme ID (will be namespaced with extension ID) */
  id: string;
  /** Display name */
  name: string;
  /** Whether this is a dark theme */
  isDark: boolean;
  /**
   * Theme color values. Only include colors you want to override.
   * Missing colors will fall back to the appropriate base theme (light or dark).
   */
  colors: Partial<ThemeColors>;
}
```

#### 4.2 Theme Registration at Extension Load

```typescript
// packages/electron/src/renderer/services/ExtensionLoader.ts
function loadExtensionThemes(manifest: ExtensionManifest): void {
  if (!manifest.contributions?.themes) return;

  for (const themeContrib of manifest.contributions.themes) {
    const fullId = `${manifest.id}:${themeContrib.id}`;
    const baseTheme = themeContrib.isDark ? getTheme('dark') : getTheme('light');

    const theme: Theme = {
      id: fullId,
      name: themeContrib.name,
      isDark: themeContrib.isDark,
      colors: { ...baseTheme.colors, ...themeContrib.colors },
      contributedBy: manifest.id,
    };

    registerTheme(theme);
  }
}
```

#### 4.3 Dynamic Theme Application

```typescript
// packages/electron/src/renderer/hooks/useTheme.ts
export function applyTheme(themeId: ThemeId): void {
  const theme = getTheme(themeId);
  if (!theme) {
    console.error(`Theme not found: ${themeId}`);
    return;
  }

  const root = document.documentElement;

  // Apply CSS variables
  for (const [key, value] of Object.entries(theme.colors)) {
    root.style.setProperty(`--nim-${key}`, value);
  }

  // Set theme attribute for CSS selectors
  root.setAttribute('data-theme', theme.isDark ? 'dark' : 'light');

  // Set custom theme attribute for extension themes
  if (theme.contributedBy) {
    root.setAttribute('data-custom-theme', themeId);
  } else {
    root.removeAttribute('data-custom-theme');
  }
}
```

### Phase 5: Extension Developer Guidance

#### 5.1 Create Theme Documentation

Create `/docs/EXTENSION_THEMING.md`:

```markdown
# Extension Theming Guide

## Using Theme Colors

Always use CSS variables for colors. Never hardcode hex values.

### CSS Variables Available

| Variable | Usage |
|----------|-------|
| `--nim-bg` | Main content background |
| `--nim-bg-secondary` | Sidebar, panel backgrounds |
| `--nim-text` | Main text color |
| `--nim-text-muted` | Secondary/muted text |
| `--nim-primary` | Primary actions, buttons |
| `--nim-border` | Default borders |

### In CSS

\`\`\`css
.my-extension-component {
  background-color: var(--nim-bg);
  color: var(--nim-text);
  border: 1px solid var(--nim-border);
}

.my-extension-component:hover {
  background-color: var(--nim-bg-hover);
}

.my-button {
  background-color: var(--nim-primary);
  color: white;
}
\`\`\`

### In Tailwind (if using)

\`\`\`tsx
<div className="bg-nim text-nim border border-nim">
  My content
</div>

<button className="bg-nim-primary text-white hover:bg-nim-primary-hover">
  Action
</button>
\`\`\`

## Contributing Custom Themes

Extensions can contribute themes via manifest.json:

\`\`\`json
{
  "contributions": {
    "themes": [{
      "id": "my-theme",
      "name": "My Custom Theme",
      "isDark": true,
      "colors": {
        "bg": "#1a1b26",
        "text": "#c0caf5",
        "primary": "#7aa2f7"
      }
    }]
  }
}
\`\`\`

## Best Practices

1. **Always use semantic colors** - Use `--nim-bg` not specific hex values
2. **Test in all themes** - Light, Dark, and Crystal Dark
3. **Provide fallbacks during migration** - `var(--nim-bg, #ffffff)`
4. **Don't override global styles** - Scope all CSS to your extension's container
5. **Use container queries** - Not media queries, for responsive layouts

## Custom Editor Theming

For custom editors (like spreadsheets, diagrams):

\`\`\`tsx
function MyCustomEditor({ host }: CustomEditorProps) {
  // Subscribe to theme changes
  const isDark = useAtomValue(isDarkThemeAtom);

  // Apply to third-party component
  useEffect(() => {
    thirdPartyComponent.setTheme(isDark ? 'dark' : 'light');
  }, [isDark]);

  return (
    <div className="bg-nim text-nim h-full">
      {/* Your editor */}
    </div>
  );
}
\`\`\`

## Third-Party Component Theming

When integrating third-party components (Monaco, RevoGrid, Excalidraw):

1. Map Nimbalyst CSS variables to component's theme system
2. Subscribe to theme changes via `isDarkThemeAtom`
3. Update component theme when Nimbalyst theme changes

Example for RevoGrid:

\`\`\`css
.revo-grid-container {
  --revo-bg-color: var(--nim-bg);
  --revo-text-color: var(--nim-text);
  --revo-border-color: var(--nim-border);
}
\`\`\`
\`\`\`
```

#### 5.2 Update Extension SDK

Add Tailwind preset for extensions:

```typescript
// packages/extension-sdk/src/tailwind-preset.ts
import type { Config } from 'tailwindcss';

export const nimbalystPreset: Partial<Config> = {
  theme: {
    extend: {
      colors: {
        nim: {
          bg: 'var(--nim-bg)',
          'bg-secondary': 'var(--nim-bg-secondary)',
          'bg-tertiary': 'var(--nim-bg-tertiary)',
          'bg-hover': 'var(--nim-bg-hover)',
          text: 'var(--nim-text)',
          'text-muted': 'var(--nim-text-muted)',
          'text-faint': 'var(--nim-text-faint)',
          border: 'var(--nim-border)',
          primary: 'var(--nim-primary)',
          'primary-hover': 'var(--nim-primary-hover)',
          // ... other colors
        },
      },
    },
  },
};
```

Extensions can use:

```javascript
// extension's tailwind.config.js
import { nimbalystPreset } from '@nimbalyst/extension-sdk/tailwind-preset';

export default {
  presets: [nimbalystPreset],
  content: ['./src/**/*.{ts,tsx}'],
};
```

---

## Migration Checklist

### Phase 1: Foundation
- [ ] Create monorepo `tailwind.config.ts`
- [ ] Create `NimbalystTheme.css` in `/packages/rexical/src/themes/`
- [ ] Create TypeScript theme types in rexical
- [ ] Create theme registry in rexical
- [ ] Set up PostCSS for all packages
- [ ] Export theme types from rexical package

### Phase 2: Lexical Theme Rename
- [ ] Create `NimbalystEditorTheme.ts`
- [ ] Create `NimbalystEditorTheme.css` with renamed classes
- [ ] Update all Lexical theme imports
- [ ] Create backward compatibility shim
- [ ] Delete old PlaygroundEditorTheme files after migration

### Phase 3: Package Migration
- [ ] Capacitor: Update to shared config
- [ ] Electron: Install Tailwind, convert inline styles
- [ ] Electron: Migrate component CSS files
- [ ] Rexical: Migrate UI components
- [ ] Runtime: Migrate AI components
- [ ] Extensions: Update to `--nim-*` variables

### Phase 4: Extension Theme API
- [ ] Update `ExtensionContributions` type
- [ ] Implement theme registration in ExtensionLoader
- [ ] Implement dynamic theme application
- [ ] Update ThemeToggleButton for custom themes
- [ ] Test with sample theme extension

### Phase 5: Documentation
- [ ] Create `EXTENSION_THEMING.md`
- [ ] Update existing `THEMING.md`
- [ ] Create Tailwind preset for extensions
- [ ] Add theme contribution examples to extension docs

---

## CSS Variable Mapping Reference

| Old Variable | New Variable | Tailwind Class |
| --- | --- | --- |
| `--surface-primary` | `--nim-bg` | `bg-nim` |
| `--surface-secondary` | `--nim-bg-secondary` | `bg-nim-secondary` |
| `--surface-tertiary` | `--nim-bg-tertiary` | `bg-nim-tertiary` |
| `--surface-hover` | `--nim-bg-hover` | `bg-nim-hover` |
| `--text-primary` | `--nim-text` | `text-nim` |
| `--text-secondary` | `--nim-text-muted` | `text-nim-muted` |
| `--text-tertiary` | `--nim-text-faint` | `text-nim-faint` |
| `--border-primary` | `--nim-border` | `border-nim` |
| `--border-focus` | `--nim-border-focus` | `border-nim-focus` |
| `--accent-primary` | `--nim-primary` | `bg-nim-primary` |
| `--accent-primary-hover` | `--nim-primary-hover` | `bg-nim-primary-hover` |
| `--accent-link` | `--nim-link` | `text-nim-link` |
| `--success-color` | `--nim-success` | `text-nim-success` |
| `--warning-color` | `--nim-warning` | `text-nim-warning` |
| `--error-color` | `--nim-error` | `text-nim-error` |
| `--info-color` | `--nim-info` | `text-nim-info` |

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Lexical theme breakage | Medium | High | Keep CSS classes, test thoroughly |
| Extension compatibility | Medium | Medium | Provide fallback values, migration guide |
| Performance regression | Low | Medium | Monitor bundle size, use PurgeCSS |
| Visual regressions | High | Low | Visual regression testing |
| Third-party component theming | Medium | Medium | Document mapping patterns |
| CSS variable naming conflicts | High | Medium | Use backward compatibility aliases during migration |

## Known Issues & Fixes

### Blue Background Bug (Fixed 2026-01-24)

**Problem**: Entire UI showed blue backgrounds instead of theme colors.

**Root Cause**:
1. CSS import order in `index.css` - Tailwind's `@tailwind base` ran before theme variables were defined
2. Components using `--nim-bg-primary` and `--nim-text-primary` which didn't exist (should be `--nim-bg` and `--nim-text`)

**Fix**:
1. Reordered CSS imports - theme CSS now loads BEFORE `@tailwind` directives
2. Fixed all incorrect variable names across the codebase:
  - `--nim-bg-primary` → `--nim-bg` (1000+ occurrences)
  - `--nim-text-primary` → `--nim-text`
  - `--nim-text-secondary` → `--nim-text-muted`
  - `--nim-text-tertiary` → `--nim-text-faint`
  - `--nim-accent` → `--nim-primary`
  - `--nim-bg-surface` → `--nim-bg-secondary`

**Files Changed**:
- `/packages/electron/src/renderer/index.css` - Import order fix and variable name corrections
- `/packages/electron/src/renderer/styles/components.css` - Variable name corrections
- All TSX files in `/packages/electron/src/renderer/**/*.tsx` - Bulk sed replacement of incorrect variable names
- `/packages/rexical/src/themes/NimbalystTheme.css` - Confirmed correct variable definitions

**Canonical variable names documented in ****`/CLAUDE.md`** for future reference.

### Tailwind Conditional Classes Bug (Fixed 2026-01-25)

**Problem**: Active/selected states not showing correctly (e.g., nav buttons, layout mode toggles).

**Root Cause**: Tailwind does NOT override based on class order in the className string. When both `bg-transparent` and `bg-nim-primary` are in the same className, Tailwind's generated CSS order determines which wins.

**Fix**: Use ternary to apply mutually exclusive class sets:

```tsx
// WRONG
<button className={`bg-transparent ${isActive ? 'bg-nim-primary' : ''}`}>

// CORRECT
<button className={`${isActive ? 'bg-nim-primary text-white' : 'bg-transparent text-nim-muted'}`}>
```

**Files Changed**: NavigationGutter.tsx, LayoutControls.tsx, ThemeToggleButton.tsx

### Container Background Misuse (Fixed 2026-01-25)

**Problem**: Blue backgrounds appearing on panels, dialogs, and containers.

**Root Cause**: Using `bg-nim-primary` (the brand/action color) for container backgrounds instead of `bg-nim` or `bg-nim-secondary`.

**Fix**: `--nim-primary` should ONLY be used for buttons and interactive elements. Container backgrounds use:
- `bg-nim` - Main content areas
- `bg-nim-secondary` - Sidebars, panels
- `bg-nim-tertiary` - Nested panels

**Files Changed**: PlansPanel.tsx, ResizablePanel.tsx, ChatSidebar.tsx, DiffModeView.tsx, PromptQueueList.tsx

### File Tree Styles Missing (Fixed 2026-01-25)

**Problem**: File tree text and icons not styled correctly after CSS file deletion.

**Root Cause**: WorkspaceSidebar.css was deleted during migration but file tree styles weren't added to index.css.

**Fix**: Added file tree styles to `/packages/electron/src/renderer/index.css` using unified `--nim-*` variables.

### CSS Files That Must Remain

Some CSS files cannot be converted to inline Tailwind because they use:
1. Classes applied via DOM manipulation (`classList.add()`)
2. Vendor-prefixed pseudo-elements (`::-webkit-slider-thumb`)
3. Complex selectors applied dynamically by Lexical nodes

Examples kept:
- `CollapsiblePlugin/Collapsible.css`
- `KanbanBoardPlugin/Board.css`
- `FloatingLinkEditorPlugin/index.css`
- `StatusBarSlider.css`
- Search highlight CSS files

---

## Success Criteria

1. All packages use shared Tailwind configuration
2. Zero inline `style={{}}` usages for color/theming (structural styles OK)
3. "PlaygroundEditorTheme" nomenclature completely removed
4. Extensions can contribute custom themes via manifest
5. Documentation complete for extension developers
6. All three built-in themes work correctly
7. Bundle size does not increase more than 10%
