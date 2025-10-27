# Theming Documentation

## Critical Rules for Theming

### NEVER HARDCODE COLORS IN CSS FILES
All colors MUST use CSS variables defined in `/packages/rexical/src/themes/PlaygroundEditorTheme.css`. This is the single source of truth for ALL theme colors.

### Single Source of Truth
The theme system uses `/packages/rexical/src/themes/PlaygroundEditorTheme.css` as the ONLY place where theme colors are defined. All other CSS files MUST reference these variables.

## Theme Architecture

### 1. Theme Definition Location
```
/packages/rexical/src/themes/PlaygroundEditorTheme.css
```

This file contains ALL theme variable definitions for:
- Light theme (default :root)
- Dark theme (dark theme selectors)
- Crystal Dark theme (crystal-dark theme selectors)

### 2. How Themes are Applied

Themes are applied using BOTH CSS classes AND data-theme attributes on the root HTML element:

```javascript
// Correct theme application (as in GlobalSettings.tsx, SessionManager.tsx)
if (savedTheme === 'dark') {
  root.setAttribute('data-theme', 'dark');
  root.classList.add('dark-theme');
} else if (savedTheme === 'crystal-dark') {
  root.setAttribute('data-theme', 'crystal-dark');
  root.classList.add('crystal-dark-theme');
} else if (savedTheme === 'light') {
  root.setAttribute('data-theme', 'light');
  root.classList.add('light-theme');
}
```

### 3. CSS Variable Structure

#### Core Variables (defined in PlaygroundEditorTheme.css):
```css
/* Surfaces/Backgrounds */
--surface-primary: #ffffff;       /* Main content background */
--surface-secondary: #f9fafb;     /* Sidebar, panels */
--surface-tertiary: #f3f4f6;      /* Hover states, subtle backgrounds */

/* Text */
--text-primary: #111827;          /* Main text */
--text-secondary: #6b7280;        /* Muted text */
--text-tertiary: #9ca3af;         /* Very muted text */

/* Borders */
--border-primary: #e5e7eb;        /* Default borders */
--border-focus: #3b82f6;          /* Focus state borders */

/* Accent Colors */
--accent-primary: #3b82f6;        /* Primary actions, links */
--accent-primary-hover: #2563eb;  /* Primary hover */

/* Status Colors */
--success-color: #10b981;
--error-color: #ef4444;
--warning-color: #f59e0b;
--info-color: #3b82f6;
```

### 4. Dark Theme Colors

The regular dark theme uses warm grays (#2d2d2d, #1a1a1a, #3a3a3a):

```css
:root.dark-theme {
    --surface-primary: #2d2d2d; /* NOT #0f172a (that's crystal-dark) */
    --surface-secondary: #1a1a1a;
    --surface-tertiary: #3a3a3a;
    /* ... */
}
```

The Crystal Dark theme uses Tailwind gray scale colors (#0f172a, #020617, #1e293b):

```css
:root.crystal-dark-theme {
    --surface-primary: #0f172a;
    --surface-secondary: #020617;
    --surface-tertiary: #1e293b;
    /* ... */
}
```

## Common Mistakes to Avoid

### ❌ WRONG: Hardcoding colors in component CSS
```css
/* NEVER DO THIS */
.my-component {
  background-color: #ffffff;
  color: #111827;
}
```

### ✅ CORRECT: Using CSS variables

```css
/* ALWAYS DO THIS */
.my-component {
    background-color: var(--surface-primary);
    color: var(--text-primary);
}
```

### ❌ WRONG: Defining theme colors in multiple places
```css
/* component.css - NEVER DO THIS */
:root {
  --my-bg-color: #ffffff;
}
.dark-theme {
  --my-bg-color: #1a1a1a;
}
```

### ✅ CORRECT: Using variables from PlaygroundEditorTheme.css

```css
/* component.css - ALWAYS DO THIS */
.my-component {
    background: var(--surface-primary); /* Defined in PlaygroundEditorTheme.css */
}
```

### ❌ WRONG: Using only data-theme attribute
```javascript
// INCOMPLETE - Won't work properly
root.setAttribute('data-theme', 'dark');
```

### ✅ CORRECT: Setting both attribute and class
```javascript
// ALWAYS SET BOTH
root.setAttribute('data-theme', 'dark');
root.classList.add('dark-theme');
```

## Adding New Components

When creating new components that need theming:

1. **NEVER** hardcode colors
2. **ALWAYS** use variables from PlaygroundEditorTheme.css
3. **NEVER** create new theme variable definitions in your component
4. If you need a new color variable, add it to PlaygroundEditorTheme.css for ALL themes

Example for a new component:

```css
/* NewComponent.css */
.new-component {
    background: var(--surface-primary);
    color: var(--text-primary);
    border: 1px solid var(--border-primary);
}

.new-component:hover {
    background: var(--surface-secondary);
}

.new-component-title {
    color: var(--text-secondary);
}
```

## Testing Themes

Always test your component in all three themes:
1. Light theme
2. Dark theme (warm grays: #2d2d2d)
3. Crystal Dark theme (Tailwind grays: #0f172a)

Use the Window > Theme menu in the Electron app to switch between themes.

## Debugging Theme Issues

If a component shows wrong colors:

1. **Check for hardcoded colors**: Search the component's CSS for hex colors (#) or rgb values
2. **Verify variable usage**: Ensure all colors use var(--variable-name)
3. **Check theme application**: Verify the component sets both data-theme AND class name
4. **Inspect CSS cascade**: Use DevTools to see which styles are being applied
5. **Check PlaygroundEditorTheme.css imports**: Ensure PlaygroundEditorTheme.css is imported before component CSS

## The Golden Rule

**There is ONE and ONLY ONE place to define theme colors: `/packages/rexical/src/themes/PlaygroundEditorTheme.css`**

Everything else MUST reference these variables. No exceptions.
