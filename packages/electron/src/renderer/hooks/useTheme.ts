import { useEffect, useState } from 'react';
import type { ConfigTheme } from 'rexical';

/**
 * Custom hook for managing application theme
 *
 * IMPORTANT: This hook does NOT re-apply the theme on mount to prevent flash.
 * The initial theme is applied synchronously in index.html before React loads.
 * This hook only:
 * 1. Reads the initial theme from main process (NOT localStorage)
 * 2. Listens for theme-change events from the menu
 * 3. Updates both DOM and state when theme changes
 *
 * CRITICAL: We do NOT use localStorage for theme - main process store is the ONLY source of truth
 */
export function useTheme() {
  // Initialize theme from what index.html already applied (from main process)
  const [theme, setTheme] = useState<ConfigTheme>(() => {
    // Get theme synchronously from main process - already resolved to 'light'/'dark'/'crystal-dark'
    const mainProcessTheme = window.electronAPI?.getThemeSync?.() || 'light';
    return mainProcessTheme as ConfigTheme;
  });

  // Listen for theme changes from the menu (Window > Theme)
  useEffect(() => {
    if (!window.electronAPI?.on) return;

    const handleThemeChange = (newTheme: string) => {
      // The theme from main process is already resolved (system -> light/dark)
      const resolvedTheme = newTheme as ConfigTheme;

      console.log('[useTheme] Theme change event:', newTheme);

      // Update state (this will re-render the editor with new theme)
      setTheme(resolvedTheme);

      // Update DOM immediately (same logic as index.html)
      const root = document.documentElement;

      let targetClass = '';
      let targetDataTheme = '';

      if (resolvedTheme === 'dark') {
        targetClass = 'dark-theme';
        targetDataTheme = 'dark';
      } else if (resolvedTheme === 'light') {
        targetClass = 'light-theme';
        targetDataTheme = 'light';
      } else if (resolvedTheme === 'crystal-dark') {
        targetClass = 'crystal-dark-theme';
        targetDataTheme = 'crystal-dark';
      } else {
        // Shouldn't happen - fallback to light
        console.warn('[useTheme] Unexpected theme:', resolvedTheme);
        targetClass = 'light-theme';
        targetDataTheme = 'light';
      }

      root.classList.remove('dark-theme', 'light-theme', 'crystal-dark-theme');
      root.classList.add(targetClass);
      root.setAttribute('data-theme', targetDataTheme);

      console.log('[useTheme] Applied DOM update:', targetClass, targetDataTheme);

      // DO NOT save to localStorage - main process store is the only source of truth
    };

    window.electronAPI.on('theme-change', handleThemeChange);

    return () => {
      window.electronAPI.off?.('theme-change', handleThemeChange);
    };
  }, []);

  return { theme, setTheme };
}
