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
  // Simple state that just tracks what the parent tells us
  const [theme, setThemeState] = useState<Theme>(() => {
    // Parent explicitly set a theme
    if (initialTheme === 'light' || initialTheme === 'dark' || initialTheme === 'crystal-dark') {
      return initialTheme;
    }
    // Fallback for 'auto' or undefined
    return 'light';
  });

  // Update theme when initialTheme prop changes (parent controls theme)
  useEffect(() => {
    if (initialTheme === 'light' || initialTheme === 'dark' || initialTheme === 'crystal-dark') {
      setThemeState(initialTheme);
    }
  }, [initialTheme]);

  // These are no-op - parent controls theme
  const setTheme = (newTheme: Theme) => {
    // Theme is controlled by parent, but update state for legacy code
    setThemeState(newTheme);
  };

  const toggleTheme = () => {
    // No-op - theme switching happens at app level, not within editor
  };

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
