/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type {JSX, ReactNode} from 'react';
import {createContext, useContext, useEffect, useState} from 'react';

export type Theme = 'light' | 'dark' | 'crystal-dark';
export type ThemeConfig = 'light' | 'dark' | 'crystal-dark' | 'auto';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: ReactNode;
  initialTheme?: ThemeConfig;
}

export function ThemeProvider({children, initialTheme = 'auto'}: ThemeProviderProps): JSX.Element {
  const [theme, setThemeState] = useState<Theme>(() => {
    // If a specific theme is configured, use it
    if (initialTheme === 'light' || initialTheme === 'dark' || initialTheme === 'crystal-dark') {
      return initialTheme;
    }
    
    // Check localStorage first, then system preference (for 'auto' mode)
    const savedTheme = localStorage.getItem('stravu-editor-theme') as Theme;
    if (savedTheme && (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'crystal-dark')) {
      return savedTheme;
    }
    
    // Check system preference
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    
    return 'light';
  });

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem('stravu-editor-theme', newTheme);
    // Also set on document for components rendered outside editor (like typeahead)
    document.documentElement.setAttribute('data-theme', newTheme);
  };

  const toggleTheme = () => {
    if (theme === 'light') {
      setTheme('dark');
    } else if (theme === 'dark') {
      setTheme('crystal-dark');
    } else {
      setTheme('light');
    }
  };

  // Apply theme on mount and when it changes (for components outside editor)
  // ONLY if initialTheme was NOT provided (meaning we're managing global theme, not a specific editor)
  useEffect(() => {
    // If initialTheme was explicitly provided, the parent is managing the document theme
    // Don't interfere with document-level theme management
    if (initialTheme && initialTheme !== 'auto') {
      return;
    }

    document.documentElement.setAttribute('data-theme', theme);

    // Add/remove dark-theme class for shared dark styling
    if (theme === 'dark' || theme === 'crystal-dark') {
      document.documentElement.classList.add('dark-theme');
    } else {
      document.documentElement.classList.remove('dark-theme');
    }
  }, [theme, initialTheme]);

  // Listen for system theme changes
  useEffect(() => {
    // Only listen for system changes if theme is set to 'auto'
    if (initialTheme !== 'auto') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    const handleChange = (e: MediaQueryListEvent) => {
      // Only update if no theme is saved in localStorage and we're in auto mode
      if (!localStorage.getItem('stravu-editor-theme')) {
        setTheme(e.matches ? 'dark' : 'light');
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [initialTheme]);

  return (
    <ThemeContext.Provider value={{theme, toggleTheme, setTheme}}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
