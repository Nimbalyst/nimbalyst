# Theming Documentation

## Critical Rules for Theming

### NEVER HARDCODE COLORS IN CSS FILES
All colors MUST use CSS variables defined in `/packages/electron/src/renderer/index.css`. This is the single source of truth for ALL theme colors.

### Single Source of Truth
The theme system uses `/packages/electron/src/renderer/index.css` as the ONLY place where theme colors are defined. All other CSS files MUST reference these variables.

## Theme Architecture

### 1. Theme Definition Location
```
/packages/electron/src/renderer/index.css
```

This file contains ALL theme variable definitions for:
- Light theme (default :root)
- Dark theme (:root.dark-theme)
- Crystal Dark theme (:root.crystal-dark-theme)

### 2. How Themes are Applied

Themes are applied using BOTH CSS classes AND data-theme attributes on the root HTML element:

```javascript
// Correct theme application (as in AIModels.tsx, SessionManager.tsx)
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

#### Core Variables (defined in index.css):
```css
/* Backgrounds */
--background-primary: #ffffff;    /* Main content background */
--background-secondary: #f9fafb;  /* Sidebar, panels */
--background-tertiary: #f3f4f6;   /* Hover states, subtle backgrounds */

/* Text */
--text-primary: #111827;          /* Main text */
--text-secondary: #6b7280;        /* Muted text */
--text-tertiary: #9ca3af;         /* Very muted text */

/* Borders */
--border-color: #e5e7eb;          /* Default borders */
--border-color-hover: #d1d5db;    /* Hover state borders */

/* Accent Colors */
--primary-color: #3b82f6;         /* Primary actions, links */
--primary-color-dark: #2563eb;    /* Primary hover */
--primary-color-light: rgba(59, 130, 246, 0.1); /* Primary backgrounds */

/* Status Colors */
--success-color: #10b981;
--danger-color: #ef4444;
--warning-color: #f59e0b;

/* Provider-specific colors */
--provider-claude-bg: #fef3c7;
--provider-claude-color: #92400e;
--provider-claude-code-bg: #dbeafe;
--provider-claude-code-color: #1e40af;
/* ... etc ... */
```

### 4. Dark Theme Colors

The regular dark theme uses warm grays (#2d2d2d, #1a1a1a, #3a3a3a):
```css
:root.dark-theme {
  --background-primary: #2d2d2d;    /* NOT #0f172a (that's crystal-dark) */
  --background-secondary: #1a1a1a;
  --background-tertiary: #3a3a3a;
  /* ... */
}
```

The Crystal Dark theme uses Tailwind gray scale colors (#0f172a, #020617, #1e293b):
```css
:root.crystal-dark-theme {
  --background-primary: #0f172a;
  --background-secondary: #020617;
  --background-tertiary: #1e293b;
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
  background-color: var(--background-primary);
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

### ✅ CORRECT: Using variables from index.css
```css
/* component.css - ALWAYS DO THIS */
.my-component {
  background: var(--background-primary); /* Defined in index.css */
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
2. **ALWAYS** use variables from index.css
3. **NEVER** create new theme variable definitions in your component
4. If you need a new color variable, add it to index.css for ALL themes

Example for a new component:
```css
/* NewComponent.css */
.new-component {
  background: var(--background-primary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
}

.new-component:hover {
  background: var(--background-secondary);
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
5. **Check index.css imports**: Ensure index.css is imported before component CSS

## The Golden Rule

**There is ONE and ONLY ONE place to define theme colors: `/packages/electron/src/renderer/index.css`**

Everything else MUST reference these variables. No exceptions.