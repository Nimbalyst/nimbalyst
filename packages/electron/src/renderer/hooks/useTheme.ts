import { useEffect } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import type { ConfigTheme } from 'rexical';
import { themeIdAtom, setThemeAtom, store, type ThemeId } from '@nimbalyst/runtime/store';
import { getExtensionLoader } from '@nimbalyst/runtime';
import { getBaseThemeColors, type ExtendedThemeColors } from 'rexical';

/**
 * Map of ExtendedThemeColors keys to CSS variable names.
 *
 * These are the --nim-* variable names that components use directly.
 * Extension themes override these variables to change the look.
 */
const CSS_VAR_MAP: Record<keyof ExtendedThemeColors, string> = {
  // Core colors - set --nim-* vars directly
  'bg': '--nim-bg',
  'bg-secondary': '--nim-bg-secondary',
  'bg-tertiary': '--nim-bg-tertiary',
  'bg-hover': '--nim-bg-hover',
  'bg-selected': '--nim-bg-selected',
  'bg-active': '--nim-bg-active',
  'text': '--nim-text',
  'text-muted': '--nim-text-muted',
  'text-faint': '--nim-text-faint',
  'text-disabled': '--nim-text-disabled',
  'border': '--nim-border',
  'border-focus': '--nim-border-focus',
  'primary': '--nim-primary',
  'primary-hover': '--nim-primary-hover',
  'link': '--nim-link',
  'link-hover': '--nim-link-hover',
  'success': '--nim-success',
  'warning': '--nim-warning',
  'error': '--nim-error',
  'info': '--nim-info',

  // Code blocks
  'code-bg': '--nim-code-bg',
  'code-text': '--nim-code-text',
  'code-border': '--nim-code-border',
  'code-gutter': '--nim-code-gutter',

  // Table
  'table-border': '--nim-table-border',
  'table-header': '--nim-table-header',
  'table-cell': '--nim-table-cell',
  'table-stripe': '--nim-table-stripe',

  // Toolbar
  'toolbar-bg': '--nim-toolbar-bg',
  'toolbar-border': '--nim-toolbar-border',
  'toolbar-hover': '--nim-toolbar-hover',
  'toolbar-active': '--nim-toolbar-active',

  // Special
  'highlight-bg': '--nim-highlight-bg',
  'highlight-border': '--nim-highlight-border',
  'quote-text': '--nim-quote-text',
  'quote-border': '--nim-quote-border',

  // Scrollbar
  'scrollbar-thumb': '--nim-scrollbar-thumb',
  'scrollbar-thumb-hover': '--nim-scrollbar-thumb-hover',
  'scrollbar-track': '--nim-scrollbar-track',

  // Diff
  'diff-add-bg': '--nim-diff-add-bg',
  'diff-add-border': '--nim-diff-add-border',
  'diff-remove-bg': '--nim-diff-remove-bg',
  'diff-remove-border': '--nim-diff-remove-border',

  // Syntax highlighting
  'code-comment': '--nim-code-comment',
  'code-punctuation': '--nim-code-punctuation',
  'code-property': '--nim-code-property',
  'code-selector': '--nim-code-selector',
  'code-operator': '--nim-code-operator',
  'code-attr': '--nim-code-attr',
  'code-variable': '--nim-code-variable',
  'code-function': '--nim-code-function',

  // Terminal
  'terminal-bg': '--terminal-bg',
  'terminal-fg': '--terminal-fg',
  'terminal-cursor': '--terminal-cursor',
  'terminal-cursor-accent': '--terminal-cursor-accent',
  'terminal-selection': '--terminal-selection',

  // Terminal ANSI standard colors (0-7)
  'terminal-ansi-black': '--terminal-ansi-black',
  'terminal-ansi-red': '--terminal-ansi-red',
  'terminal-ansi-green': '--terminal-ansi-green',
  'terminal-ansi-yellow': '--terminal-ansi-yellow',
  'terminal-ansi-blue': '--terminal-ansi-blue',
  'terminal-ansi-magenta': '--terminal-ansi-magenta',
  'terminal-ansi-cyan': '--terminal-ansi-cyan',
  'terminal-ansi-white': '--terminal-ansi-white',

  // Terminal ANSI bright colors (8-15)
  'terminal-ansi-bright-black': '--terminal-ansi-bright-black',
  'terminal-ansi-bright-red': '--terminal-ansi-bright-red',
  'terminal-ansi-bright-green': '--terminal-ansi-bright-green',
  'terminal-ansi-bright-yellow': '--terminal-ansi-bright-yellow',
  'terminal-ansi-bright-blue': '--terminal-ansi-bright-blue',
  'terminal-ansi-bright-magenta': '--terminal-ansi-bright-magenta',
  'terminal-ansi-bright-cyan': '--terminal-ansi-bright-cyan',
  'terminal-ansi-bright-white': '--terminal-ansi-bright-white',
};

// Track currently applied extension theme for cleanup
let currentExtensionThemeId: string | null = null;

/**
 * Initialize theme from main process and set up IPC listener.
 * Called once at app startup to sync the atom with main process state.
 */
export function initializeTheme(): void {
  // Get theme synchronously from main process
  const mainProcessTheme = window.electronAPI?.getThemeSync?.() || 'light';
  store.set(themeIdAtom, mainProcessTheme as ThemeId);

  // Apply the theme (handles both built-in and extension themes)
  applyThemeToDOM(mainProcessTheme as ThemeId);

  // Listen for theme changes from the menu (Window > Theme) or other windows
  if (window.electronAPI?.on) {
    window.electronAPI.on('theme-change', (newTheme: string) => {
      const resolvedTheme = newTheme as ThemeId;

      // Update atom (this will re-render all subscribing components)
      store.set(themeIdAtom, resolvedTheme);

      // Update DOM immediately (handles both built-in and extension themes)
      applyThemeToDOM(resolvedTheme);
    });
  }
}

/**
 * Apply theme to DOM (classList and data-theme attribute).
 * Handles both built-in themes and extension themes.
 */
function applyThemeToDOM(theme: ThemeId): void {
  const root = document.documentElement;

  // Check if this is an extension theme
  if (isExtensionTheme(theme)) {
    // Apply extension theme (which sets base theme + CSS variables)
    applyExtensionTheme(theme);
    return;
  }

  // Clear any extension theme when switching to built-in
  clearExtensionTheme();

  // Apply built-in theme
  let targetClass = '';
  let targetDataTheme = '';

  if (theme === 'dark') {
    targetClass = 'dark-theme';
    targetDataTheme = 'dark';
  } else if (theme === 'light') {
    targetClass = 'light-theme';
    targetDataTheme = 'light';
  } else if (theme === 'crystal-dark') {
    targetClass = 'crystal-dark-theme';
    targetDataTheme = 'crystal-dark';
  } else {
    // Fallback to light
    console.warn('[useTheme] Unexpected theme:', theme);
    targetClass = 'light-theme';
    targetDataTheme = 'light';
  }

  root.classList.remove('dark-theme', 'light-theme', 'crystal-dark-theme');
  root.classList.add(targetClass);
  root.setAttribute('data-theme', targetDataTheme);
}

/**
 * Get the effective base theme for a theme ID.
 * For built-in themes, returns as-is.
 * For extension themes, looks up isDark and returns 'dark' or 'light'.
 */
function getEffectiveBaseTheme(themeId: string): ConfigTheme {
  // Built-in themes pass through
  if (themeId === 'light' || themeId === 'dark' || themeId === 'crystal-dark') {
    return themeId;
  }

  // Extension theme - look up whether it's dark
  if (isExtensionTheme(themeId)) {
    try {
      const loader = getExtensionLoader();
      const themes = loader.getThemes();
      const theme = themes.find(t => t.id === themeId);
      if (theme) {
        return theme.isDark ? 'dark' : 'light';
      }
    } catch {
      // Extension system not ready, fall back to light
    }
  }

  return 'light';
}

/**
 * Custom hook for managing application theme.
 *
 * IMPORTANT: This hook does NOT re-apply the theme on mount to prevent flash.
 * The initial theme is applied synchronously in index.html before React loads.
 * This hook only:
 * 1. Reads theme from the Jotai atom
 * 2. Provides setTheme for programmatic changes
 *
 * Theme changes from menu are handled by initializeTheme() which runs once.
 *
 * Returns:
 * - theme: The effective theme for components that only understand 'light'|'dark'|'crystal-dark'
 * - themeId: The raw theme ID (may be an extension theme like 'sample-themes:solarized-light')
 * - setTheme: Function to change the theme
 */
export function useTheme() {
  const themeId = useAtomValue(themeIdAtom) as string;
  const setTheme = useSetAtom(setThemeAtom);

  // Compute effective base theme for Lexical and other components
  // that only understand built-in theme names
  const theme = getEffectiveBaseTheme(themeId) as ConfigTheme;

  // When theme atom changes, also update DOM
  // This handles programmatic theme changes from within React
  useEffect(() => {
    applyThemeToDOM(themeId as ThemeId);
  }, [themeId]);

  return { theme, themeId, setTheme };
}

/**
 * Hook to get just the current theme value.
 * Use this in components that only need to read the theme.
 */
export function useThemeValue(): ConfigTheme {
  return useAtomValue(themeIdAtom) as ConfigTheme;
}

/**
 * Get theme outside of React context.
 * Useful for services and utilities.
 */
export function getTheme(): ThemeId {
  return store.get(themeIdAtom);
}

/**
 * Check if a theme ID is an extension theme (format: extensionId:themeId).
 */
export function isExtensionTheme(themeId: string): boolean {
  return themeId.includes(':');
}

/**
 * Get all available themes (built-in + extension themes).
 */
export function getAllAvailableThemes(): Array<{
  id: string;
  name: string;
  isDark: boolean;
  isExtension: boolean;
}> {
  const builtInThemes = [
    { id: 'light', name: 'Light', isDark: false, isExtension: false },
    { id: 'dark', name: 'Dark', isDark: true, isExtension: false },
    { id: 'crystal-dark', name: 'Crystal Dark', isDark: true, isExtension: false },
  ];

  try {
    const loader = getExtensionLoader();
    const extensionThemes = loader.getThemes().map(t => ({
      id: t.id,
      name: t.name,
      isDark: t.isDark,
      isExtension: true,
    }));

    return [...builtInThemes, ...extensionThemes];
  } catch {
    // Extension system may not be initialized yet
    return builtInThemes;
  }
}

/**
 * Apply an extension theme by setting CSS variables on the document root.
 * Extension themes are layered on top of a base theme (light or dark).
 */
export function applyExtensionTheme(themeId: string): boolean {
  if (!isExtensionTheme(themeId)) {
    console.warn('[useTheme] Not an extension theme:', themeId);
    return false;
  }

  try {
    const loader = getExtensionLoader();
    const themes = loader.getThemes();
    const theme = themes.find(t => t.id === themeId);

    if (!theme) {
      console.error('[useTheme] Extension theme not found:', themeId);
      return false;
    }

    const root = document.documentElement;

    // First, apply the base theme (light or dark) for proper fallbacks
    const baseTheme = theme.isDark ? 'dark' : 'light';
    root.classList.remove('dark-theme', 'light-theme', 'crystal-dark-theme');
    root.classList.add(`${baseTheme}-theme`);
    root.setAttribute('data-theme', baseTheme);

    // Get base colors for fallbacks
    const baseColors = getBaseThemeColors(theme.isDark);

    // Derive missing colors from extension's colors for better consistency
    const extColors = theme.colors as Record<string, string>;
    const derivedColors: Record<string, string> = {};

    // Table colors: derive from extension's background colors if not specified
    if (!extColors['table-header'] && extColors['bg-secondary']) {
      derivedColors['table-header'] = extColors['bg-secondary'];
    }
    if (!extColors['table-cell'] && extColors['bg']) {
      derivedColors['table-cell'] = extColors['bg'];
    }
    if (!extColors['table-stripe'] && extColors['bg-tertiary']) {
      derivedColors['table-stripe'] = extColors['bg-tertiary'];
    }
    if (!extColors['table-border'] && extColors['border']) {
      derivedColors['table-border'] = extColors['border'];
    }

    // Code block colors
    if (!extColors['code-bg'] && extColors['bg-secondary']) {
      derivedColors['code-bg'] = extColors['bg-secondary'];
    }
    if (!extColors['code-text'] && extColors['text']) {
      derivedColors['code-text'] = extColors['text'];
    }
    if (!extColors['code-border'] && extColors['border']) {
      derivedColors['code-border'] = extColors['border'];
    }

    // Toolbar colors
    if (!extColors['toolbar-bg'] && extColors['bg']) {
      derivedColors['toolbar-bg'] = extColors['bg'];
    }
    if (!extColors['toolbar-border'] && extColors['border']) {
      derivedColors['toolbar-border'] = extColors['border'];
    }

    // Quote colors
    if (!extColors['quote-text'] && extColors['text-muted']) {
      derivedColors['quote-text'] = extColors['text-muted'];
    }
    if (!extColors['quote-border'] && extColors['border']) {
      derivedColors['quote-border'] = extColors['border'];
    }

    // Terminal colors: derive from extension's colors if not specified
    if (!extColors['terminal-bg'] && extColors['bg-secondary']) {
      derivedColors['terminal-bg'] = extColors['bg-secondary'];
    }
    if (!extColors['terminal-fg'] && extColors['text']) {
      derivedColors['terminal-fg'] = extColors['text'];
    }
    if (!extColors['terminal-cursor'] && extColors['primary']) {
      derivedColors['terminal-cursor'] = extColors['primary'];
    }
    if (!extColors['terminal-cursor-accent']) {
      derivedColors['terminal-cursor-accent'] =
        extColors['terminal-bg'] || extColors['bg-secondary'] || derivedColors['terminal-bg'];
    }
    if (!extColors['terminal-selection'] && extColors['bg-selected']) {
      derivedColors['terminal-selection'] = extColors['bg-selected'];
    }

    // Terminal ANSI colors: derive from status colors if not specified
    if (!extColors['terminal-ansi-red'] && extColors['error']) {
      derivedColors['terminal-ansi-red'] = extColors['error'];
    }
    if (!extColors['terminal-ansi-green'] && extColors['success']) {
      derivedColors['terminal-ansi-green'] = extColors['success'];
    }
    if (!extColors['terminal-ansi-yellow'] && extColors['warning']) {
      derivedColors['terminal-ansi-yellow'] = extColors['warning'];
    }
    if (!extColors['terminal-ansi-blue'] && extColors['info']) {
      derivedColors['terminal-ansi-blue'] = extColors['info'];
    }

    // Apply all theme colors as CSS variables
    // Start with base colors, then derived colors, then extension overrides
    const allColors = { ...baseColors, ...derivedColors, ...theme.colors };

    for (const [key, cssVar] of Object.entries(CSS_VAR_MAP)) {
      const colorKey = key as keyof ExtendedThemeColors;
      const value = allColors[colorKey];
      if (value) {
        root.style.setProperty(cssVar, value);
      }
    }

    // Mark as extension theme for cleanup
    root.setAttribute('data-extension-theme', themeId);
    currentExtensionThemeId = themeId;

    console.info(`[useTheme] Applied extension theme: ${theme.name} (${themeId})`);
    return true;
  } catch (error) {
    console.error('[useTheme] Failed to apply extension theme:', error);
    return false;
  }
}

/**
 * Clear any extension theme overrides, restoring the base theme.
 */
export function clearExtensionTheme(): void {
  const root = document.documentElement;

  // Remove extension theme marker
  root.removeAttribute('data-extension-theme');

  // Clear all --nim-* CSS variable overrides
  for (const cssVar of Object.values(CSS_VAR_MAP)) {
    root.style.removeProperty(cssVar);
  }

  currentExtensionThemeId = null;
}

/**
 * Get the currently applied extension theme ID, if any.
 */
export function getCurrentExtensionTheme(): string | null {
  return currentExtensionThemeId;
}
