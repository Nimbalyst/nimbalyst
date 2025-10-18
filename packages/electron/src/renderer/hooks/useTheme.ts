import { useEffect, useState } from 'react';
import type { ConfigTheme } from 'rexical';

/**
 * Custom hook for managing application theme
 *
 * Handles:
 * - Loading theme from localStorage and main process
 * - Applying theme classes to document root
 * - Syncing theme changes to localStorage
 * - Supporting auto, light, dark, and crystal-dark themes
 */
export function useTheme() {
  // Initialize theme from localStorage immediately
  const [theme, setTheme] = useState<ConfigTheme>(() => {
    const savedTheme = localStorage.getItem('theme');
    console.log('[useTheme] Initial theme from localStorage:', savedTheme);
    return (savedTheme as ConfigTheme) || 'auto';
  });

  // Sync theme with main process preference on mount
  useEffect(() => {
    if (!window.electronAPI?.getTheme) return;

    window.electronAPI
      .getTheme()
      .then(themeValue => {
        if (!themeValue) return;
        const resolvedTheme = (themeValue === 'system' ? 'auto' : themeValue) as ConfigTheme;
        setTheme(resolvedTheme);
      })
      .catch(error => {
        console.error('[useTheme] Failed to load theme from main process:', error);
      });
  }, []);

  // Apply theme to document root and save to localStorage
  useEffect(() => {
    const root = document.documentElement;

    if (theme === 'dark') {
      root.classList.add('dark-theme');
      root.classList.remove('light-theme', 'crystal-dark-theme');
      root.setAttribute('data-theme', 'dark');
    } else if (theme === 'light') {
      root.classList.add('light-theme');
      root.classList.remove('dark-theme', 'crystal-dark-theme');
      root.setAttribute('data-theme', 'light');
    } else if (theme === 'crystal-dark') {
      root.classList.add('crystal-dark-theme');
      root.classList.remove('light-theme', 'dark-theme');
      root.setAttribute('data-theme', 'crystal-dark');
    } else {
      // Auto theme - let CSS handle it with prefers-color-scheme
      root.classList.remove('dark-theme', 'light-theme', 'crystal-dark-theme');
      root.removeAttribute('data-theme');
    }

    // Save theme to localStorage
    localStorage.setItem('theme', theme);
  }, [theme]);

  return { theme, setTheme };
}
