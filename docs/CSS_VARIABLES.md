# CSS Variables Guide

This document provides an overview of the CSS variable system used across the Preditor editor project. All theme colors and design tokens are defined using CSS custom properties (variables) to ensure consistent styling and theming support.

## Core Principles

1. **Single Source of Truth**: All theme tokens are defined in Rexical and consumed by other packages
2. **Semantic Naming**: Variables use semantic names describing their purpose rather than presentation
3. **Theme Support**: Variables support light, dark, and crystal dark themes
4. **No Hardcoded Colors**: Never hardcode colors in CSS files - always use variables
5. **Component-Specific Inheritance**: Components reference base tokens rather than defining their own colors

## Base Variable Categories

### Surface Colors

Controls backgrounds and layering:

```css
--surface-primary    /* Main application background */
--surface-secondary  /* Secondary/elevated surfaces */
--surface-tertiary   /* Highest elevation surfaces */
--surface-hover      /* Hover state overlay */
--surface-selected   /* Selection/focus state */
--surface-active     /* Active/pressed state */
```

### Text Colors

Typography hierarchy:

```css
--text-primary      /* Primary content text */
--text-secondary    /* Secondary/supporting text */
--text-tertiary     /* Most muted text */
--text-disabled     /* Disabled state text */
```

### Border & Focus

Border and focus indicators:

```css
--border-primary    /* Default borders */
--border-focus      /* Focus ring/outline */
```

### Interactive Colors

Action and state colors:

```css
--accent-primary        /* Primary action color */
--accent-primary-hover  /* Primary hover state */
--accent-link          /* Link text color */
--accent-link-hover    /* Link hover color */
```

### Semantic Colors

Status and feedback colors:

```css
--success-color     /* Success states/feedback */
--warning-color     /* Warning states/feedback */
--error-color       /* Error states/feedback */
--info-color        /* Info states/feedback */
```

## Component-Specific Variables

### Editor Canvas

Editor-specific styling:

```css
--editor-background    /* Editor canvas background */
--editor-text          /* Editor content text */
```

### Code Blocks

Code syntax highlighting:

```css
--code-background      /* Code block background */
--code-gutter          /* Line number gutter */
--code-border          /* Code block border */
--code-text            /* Code text color */
```

### Tables

Table styling:

```css
--table-border         /* Table grid lines */
--table-header        /* Header row/column */
--table-cell          /* Standard cell */
--table-stripe        /* Alternating row */
--table-frozen        /* Frozen row/column */
```

### Toolbar

Toolbar styling:

```css
--toolbar-background    /* Toolbar background */
--toolbar-border        /* Toolbar borders */
--toolbar-button-hover  /* Button hover state */
--toolbar-button-active /* Button active state */
```

### Special Elements

Special content types:

```css
--highlight-background  /* Text highlight bg */
--highlight-border     /* Highlight border */
--quote-text           /* Blockquote text */
--quote-border         /* Quote left border */
```

## Theme Color Values

### Dark Theme

Standard dark theme with warm gray colors:

```css
--surface-primary: #2d2d2d
--surface-secondary: #1a1a1a
--surface-tertiary: #3a3a3a
```

### Crystal Dark Theme

Premium dark theme using Tailwind gray scale:

```css
--surface-primary: #0f172a    /* slate-900 */
--surface-secondary: #020617  /* slate-950 */
--surface-tertiary: #1e293b   /* slate-800 */
```

## Usage Guidelines

1. **Component Variables**
  - Components should use semantic base tokens
  - Avoid creating component-specific color variables
  - Inherit from base tokens when possible

2. **Theme Support**
  - Apply theme with both CSS class and data-attribute:
```css
     .dark-theme,
     [data-theme="dark"] {
       /* theme variables */
     }
```

3. **Dark Theme Icons**
  - Use `filter: invert(1)` for icon colors in dark themes
  - Define in shared dark theme section

4. **Variable Inheritance**
  - Build on base tokens for variants:
```css
     .toolbar-button {
       background: var(--surface-primary);
       color: var(--text-primary);
       border-color: var(--border-primary);
     }
     .toolbar-button:hover {
       background: var(--surface-hover);
     }
```

## Implementation Notes

1. **Theme Files**
  - Dark theme: `packages/rexical/src/themes/DarkEditorTheme.css`
  - Crystal theme: `packages/rexical/src/themes/CrystalDarkTheme.css`
  - Light theme: Variables defined in `index.css`

2. **Package Usage**
  - All packages import themes from Rexical
  - No package-specific color definitions
  - Component styles reference Rexical variables

3. **Responsive Design**
  - Variables support responsive adjustments
  - Use media queries to modify values when needed
  - Maintain semantic meaning across breakpoints