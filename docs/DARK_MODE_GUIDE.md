# Dark Mode Support Guide for Stravu Editor

This guide explains how to properly implement dark mode support for new components in Stravu Editor.

## Overview

Stravu Editor supports two dark themes:
- `dark` - The standard dark theme
- `crystal-dark` - A Tailwind-inspired gray-scale dark theme

Dark mode is implemented using CSS custom properties (CSS variables) that change based on the `data-theme` attribute.

## CSS Variable System

Both themes define a comprehensive set of CSS variables in their respective theme files:
- `/packages/rexical/src/themes/DarkEditorTheme.css`
- `/packages/rexical/src/themes/CrystalDarkTheme.css`

### Core Variables

```css
/* Background colors */
--stravu-bg-primary      /* Main background */
--stravu-bg-secondary    /* Cards, dialogs, dropdowns */
--stravu-bg-tertiary     /* Hover states, secondary backgrounds */

/* Text colors */
--stravu-text-primary    /* Main text color */
--stravu-text-secondary  /* Muted text */
--stravu-text-muted      /* Disabled/placeholder text */

/* Interactive states */
--stravu-hover-bg        /* Hover background */
--stravu-active-bg       /* Active/pressed state */
--stravu-focus-border    /* Focus outline color */

/* Component-specific */
--stravu-editor-border   /* Border color for components */
--stravu-toolbar-bg      /* Toolbar background */
--stravu-link-color      /* Link text color */
```

## Implementation Steps

### 1. Use CSS Variables in Your Component

```css
/* Default light theme styles */
.my-component {
  background: #fff;
  color: #000;
  border: 1px solid #e0e0e0;
}

.my-button {
  background: #4a90e2;
  color: white;
}

.my-button:hover {
  background: #357abd;
}
```

### 2. Add Dark Theme Support

```css
/* Dark theme overrides */
.stravu-editor[data-theme="dark"] .my-component {
  background: var(--stravu-bg-secondary);
  color: var(--stravu-text-primary);
  border-color: var(--stravu-editor-border);
}

.stravu-editor[data-theme="dark"] .my-button {
  background: var(--stravu-focus-border);
  color: white;
}

.stravu-editor[data-theme="dark"] .my-button:hover {
  background-color: var(--stravu-active-bg);
}
```

### 3. Add Crystal Dark Theme Support

```css
/* Crystal Dark theme overrides */
.stravu-editor[data-theme="crystal-dark"] .my-component {
  background: var(--stravu-bg-secondary);
  color: var(--stravu-text-primary);
  border-color: var(--stravu-editor-border);
}

.stravu-editor[data-theme="crystal-dark"] .my-button {
  background: var(--stravu-focus-border);
  color: white;
}

.stravu-editor[data-theme="crystal-dark"] .my-button:hover {
  background-color: var(--stravu-active-bg);
}
```

## Best Practices

### 1. Always Use CSS Variables

Instead of hardcoding colors for dark themes, use the predefined CSS variables. This ensures consistency and makes it easier to update themes.

### 2. Test Both Dark Themes

Always test your component with both `dark` and `crystal-dark` themes to ensure proper support.

### 3. Handle All Interactive States

Don't forget to style:
- Hover states
- Active/pressed states
- Disabled states
- Focus states

### 4. Consider Contrast

Ensure sufficient contrast between text and backgrounds. Use:
- `--stravu-text-primary` for important text on dark backgrounds
- `--stravu-text-secondary` for less important text
- `--stravu-text-muted` for disabled or placeholder text

### 5. Use Semantic Variables

Choose variables based on their semantic meaning rather than their color:
- Use `--stravu-hover-bg` for hover states, not a specific color
- Use `--stravu-focus-border` for focus indicators
- Use `--stravu-bg-secondary` for card/dialog backgrounds

## Complete Example: Search Dialog

Here's a complete example from the SearchReplacePlugin:

```css
/* Light theme (default) */
.search-replace-dialog {
  background: #fff;
  border: 1px solid #e0e0e0;
}

.search-replace-button {
  background: #4a90e2;
  color: white;
}

/* Dark theme */
.stravu-editor[data-theme="dark"] .search-replace-dialog {
  background: var(--stravu-bg-secondary);
  border-color: var(--stravu-editor-border);
}

.stravu-editor[data-theme="dark"] .search-replace-button {
  background: var(--stravu-focus-border);
  color: white;
}

.stravu-editor[data-theme="dark"] .search-replace-button:hover:not(:disabled) {
  background-color: var(--stravu-active-bg);
}

/* Crystal Dark theme */
.stravu-editor[data-theme="crystal-dark"] .search-replace-dialog {
  background: var(--stravu-bg-secondary);
  border-color: var(--stravu-editor-border);
}

.stravu-editor[data-theme="crystal-dark"] .search-replace-button {
  background: var(--stravu-focus-border);
  color: white;
}

.stravu-editor[data-theme="crystal-dark"] .search-replace-button:hover:not(:disabled) {
  background-color: var(--stravu-active-bg);
}
```

## Testing Dark Mode

To test dark mode in the playground:

1. Use the theme selector in the toolbar to switch between themes
2. Check all component states (normal, hover, active, disabled)
3. Verify text readability and contrast
4. Test in different contexts (toolbar, dialogs, editor content)

## Common Pitfalls

1. **Forgetting hover states** - Always style hover states for interactive elements
2. **Using hardcoded colors** - Always use CSS variables for dark theme colors
3. **Missing disabled states** - Disabled elements need proper styling too
4. **Insufficient contrast** - Test readability in both themes
5. **Forgetting crystal-dark** - Don't just add dark theme support, add crystal-dark too
