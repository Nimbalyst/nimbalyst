import { useEffect } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import type { ConfigTheme } from 'rexical';
import { themeIdAtom, setThemeAtom, store, type ThemeId } from '@nimbalyst/runtime/store';

/**
 * Initialize theme from main process and set up IPC listener.
 * Called once at app startup to sync the atom with main process state.
 */
export function initializeTheme(): void {
  // Get theme synchronously from main process
  const mainProcessTheme = window.electronAPI?.getThemeSync?.() || 'light';
  store.set(themeIdAtom, mainProcessTheme as ThemeId);

  // Listen for theme changes from the menu (Window > Theme)
  if (window.electronAPI?.on) {
    window.electronAPI.on('theme-change', (newTheme: string) => {
      const resolvedTheme = newTheme as ThemeId;

      // Update atom (this will re-render all subscribing components)
      store.set(themeIdAtom, resolvedTheme);

      // Update DOM immediately (same logic as index.html)
      applyThemeToDOM(resolvedTheme);
    });
  }
}

/**
 * Apply theme to DOM (classList and data-theme attribute).
 * This is the same logic as in index.html for consistency.
 */
function applyThemeToDOM(theme: ThemeId): void {
  const root = document.documentElement;

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
 * Custom hook for managing application theme.
 *
 * IMPORTANT: This hook does NOT re-apply the theme on mount to prevent flash.
 * The initial theme is applied synchronously in index.html before React loads.
 * This hook only:
 * 1. Reads theme from the Jotai atom
 * 2. Provides setTheme for programmatic changes
 *
 * Theme changes from menu are handled by initializeTheme() which runs once.
 */
export function useTheme() {
  const theme = useAtomValue(themeIdAtom) as ConfigTheme;
  const setTheme = useSetAtom(setThemeAtom);

  // When theme atom changes, also update DOM
  // This handles programmatic theme changes from within React
  useEffect(() => {
    applyThemeToDOM(theme as ThemeId);
  }, [theme]);

  return { theme, setTheme };
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
