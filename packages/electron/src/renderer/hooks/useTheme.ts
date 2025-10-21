import { useEffect, useState } from 'react';
import type { ConfigTheme } from 'rexical';

/**
 * Custom hook for managing application theme
 *
 * IMPORTANT: This hook does NOT re-apply the theme on mount to prevent flash.
 * The initial theme is applied synchronously in index.html before React loads.
 * This hook only:
 * 1. Reads the initial theme that was already applied
 * 2. Listens for theme-change events from the menu
 * 3. Updates both DOM and state when theme changes
 */
export function useTheme() {
  // Initialize theme from what index.html already applied
  const [theme, setTheme] = useState<ConfigTheme>(() => {
    const savedTheme = localStorage.getItem('theme') as ConfigTheme;
    return savedTheme || 'auto';
  });

  // Listen for theme changes from the menu (Window > Theme)
  useEffect(() => {
    if (!window.electronAPI?.on) return;

    const handleThemeChange = (newTheme: string) => {
      // Normalize 'system' to 'auto'
      const normalizedTheme = (newTheme === 'system' ? 'auto' : newTheme) as ConfigTheme;

      // Update state (this will re-render the editor with new theme)
      setTheme(normalizedTheme);

      // Update DOM immediately (same logic as index.html)
      const root = document.documentElement;
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

      let targetClass = '';
      let targetDataTheme = '';

      if (normalizedTheme === 'dark') {
        targetClass = 'dark-theme';
        targetDataTheme = 'dark';
      } else if (normalizedTheme === 'light') {
        targetClass = 'light-theme';
        targetDataTheme = 'light';
      } else if (normalizedTheme === 'crystal-dark') {
        targetClass = 'crystal-dark-theme';
        targetDataTheme = 'crystal-dark';
      } else {
        // Auto theme
        targetClass = prefersDark ? 'dark-theme' : 'light-theme';
        targetDataTheme = prefersDark ? 'dark' : 'light';
      }

      root.classList.remove('dark-theme', 'light-theme', 'crystal-dark-theme');
      root.classList.add(targetClass);
      root.setAttribute('data-theme', targetDataTheme);

      // Save to localStorage
      localStorage.setItem('theme', normalizedTheme);
    };

    window.electronAPI.on('theme-change', handleThemeChange);

    return () => {
      window.electronAPI.off?.('theme-change', handleThemeChange);
    };
  }, []);

  return { theme, setTheme };
}
