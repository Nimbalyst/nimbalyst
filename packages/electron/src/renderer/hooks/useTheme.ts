import { useEffect } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import type { ConfigTheme } from 'rexical';
import { themeIdAtom, setThemeAtom, store, type ThemeId } from '@nimbalyst/runtime/store';
import { getBaseThemeColors, getTheme as getThemeFromRexical, type ExtendedThemeColors } from 'rexical';

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
  'purple': '--nim-purple',

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

/**
 * Initialize theme from main process and set up IPC listener.
 * Called once at app startup to sync the atom with main process state.
 */
export function initializeTheme(): void {
  // Get theme synchronously from main process
  const mainProcessTheme = window.electronAPI?.getThemeSync?.() || 'light';
  store.set(themeIdAtom, mainProcessTheme as ThemeId);

  // Apply the theme (handles both built-in and custom themes)
  void applyThemeToDOM(mainProcessTheme as ThemeId);

  // Listen for theme changes from the menu (Window > Theme) or other windows
  if (window.electronAPI?.on) {
    window.electronAPI.on('theme-change', (newTheme: string) => {
      const resolvedTheme = newTheme as ThemeId;

      // Update atom (this will re-render all subscribing components)
      store.set(themeIdAtom, resolvedTheme);

      // Update DOM immediately (handles both built-in and custom themes)
      void applyThemeToDOM(resolvedTheme);
    });
  }
}

/**
 * Apply theme to DOM (classList and data-theme attribute).
 * For custom themes, also applies CSS variables.
 */
async function applyThemeToDOM(theme: ThemeId): Promise<void> {
  const root = document.documentElement;

  // Determine if this is a built-in theme
  const builtInThemes = ['light', 'dark', 'crystal-dark'];
  const isBuiltIn = builtInThemes.includes(theme);

  // Set appropriate class for dark mode detection (used by Tailwind, icon filters, etc.)
  let isDark = false;
  if (theme === 'dark' || theme === 'crystal-dark') {
    isDark = true;
  }

  if (isBuiltIn) {
    // Built-in themes: use getBaseThemeColors to get full color definitions
    const colors = getBaseThemeColors(isDark);

    // Set class and data-theme
    const targetClass = isDark ? 'dark-theme' : 'light-theme';
    root.classList.remove('dark-theme', 'light-theme', 'crystal-dark-theme');
    root.classList.add(targetClass);
    root.setAttribute('data-theme', theme);

    // Apply colors as inline styles (single source of truth)
    for (const [key, cssVar] of Object.entries(CSS_VAR_MAP)) {
      const colorKey = key as keyof ExtendedThemeColors;
      const value = colors[colorKey];
      if (value) {
        root.style.setProperty(cssVar, value);
      }
    }
  } else {
    // Custom theme - fetch and apply colors
    try {
      const themeData = await window.electronAPI.invoke('theme:get', theme);
      isDark = themeData.isDark;

      // Set base class based on isDark (for Tailwind dark mode, icon filters, etc.)
      const baseClass = isDark ? 'dark-theme' : 'light-theme';
      root.classList.remove('dark-theme', 'light-theme', 'crystal-dark-theme');
      root.classList.add(baseClass);
      root.setAttribute('data-theme', theme);

      // Get base colors for fallbacks
      const baseColors = getBaseThemeColors(isDark);

      // Apply theme colors as CSS variables
      for (const [key, cssVar] of Object.entries(CSS_VAR_MAP)) {
        const colorKey = key as keyof ExtendedThemeColors;
        const themeColor = themeData.colors[colorKey];
        const baseColor = baseColors[colorKey];

        // Use theme color if provided, otherwise base color
        const value = themeColor || baseColor;
        if (value) {
          root.style.setProperty(cssVar, value);
        }
      }

      console.info(`[useTheme] Applied custom theme: ${themeData.name} (${theme})`);
    } catch (error) {
      console.error('[useTheme] Failed to load theme:', theme, error);
      // Fallback to light theme
      root.classList.remove('dark-theme', 'light-theme', 'crystal-dark-theme');
      root.classList.add('light-theme');
      root.setAttribute('data-theme', 'light');
      // Apply light theme colors
      const colors = getBaseThemeColors(false);
      for (const [key, cssVar] of Object.entries(CSS_VAR_MAP)) {
        const colorKey = key as keyof ExtendedThemeColors;
        const value = colors[colorKey];
        if (value) {
          root.style.setProperty(cssVar, value);
        }
      }
    }
  }
}

/**
 * Clear custom theme CSS variables.
 */
function clearCustomThemeVariables(): void {
  const root = document.documentElement;
  for (const cssVar of Object.values(CSS_VAR_MAP)) {
    root.style.removeProperty(cssVar);
  }
}

/**
 * Get the effective base theme for a theme ID.
 */
function getEffectiveBaseTheme(themeId: string): ConfigTheme {
  // All standalone themes are either light or dark based
  const darkThemes = ['dark', 'crystal-dark', 'solarized-dark', 'monokai'];

  if (darkThemes.includes(themeId)) {
    return 'dark';
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
    void applyThemeToDOM(themeId as ThemeId);
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
 * Get all available themes (built-in + user-installed).
 * Fetches from the theme system via IPC.
 */
export async function getAllAvailableThemesAsync(): Promise<Array<{
  id: string;
  name: string;
  isDark: boolean;
}>> {
  try {
    const themeManifests = await window.electronAPI.invoke('theme:list');

    return themeManifests.map((manifest: any) => ({
      id: manifest.id,
      name: manifest.name,
      isDark: manifest.isDark,
    }));
  } catch (error) {
    console.error('[useTheme] Failed to fetch themes:', error);
    // Fallback to built-in themes only
    return [
      { id: 'light', name: 'Light', isDark: false },
      { id: 'dark', name: 'Dark', isDark: true },
      { id: 'crystal-dark', name: 'Crystal Dark', isDark: true },
    ];
  }
}

