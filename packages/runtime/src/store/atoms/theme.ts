/**
 * Theme Atoms
 *
 * Global theme state that all themed components can subscribe to.
 * Platform-specific code (Electron IPC, Capacitor) updates this atom,
 * and all subscribing components re-render.
 *
 * Key principle: Theme is one of the few cases where widespread re-rendering
 * is expected and correct - every themed component needs to repaint.
 * The atom approach gives components control over their own subscriptions,
 * unlike prop drilling where the parent decides what to re-render.
 */

import { atom } from 'jotai';

/**
 * Available theme identifiers.
 */
export type ThemeId = 'light' | 'dark' | 'crystal-dark';

/**
 * Theme color values for use in components.
 */
export interface ThemeColors {
  background: string;
  foreground: string;
  accent: string;
  border: string;
  // Editor-specific
  editorBackground: string;
  editorForeground: string;
  // Syntax highlighting (subset)
  syntaxKeyword: string;
  syntaxString: string;
  syntaxComment: string;
  syntaxVariable: string;
}

/**
 * Full theme object with metadata and colors.
 */
export interface Theme {
  id: ThemeId;
  name: string;
  isDark: boolean;
  colors: ThemeColors;
}

/**
 * Default themes.
 * These can be extended with custom themes in the future.
 */
const themes: Record<ThemeId, Theme> = {
  light: {
    id: 'light',
    name: 'Light',
    isDark: false,
    colors: {
      background: '#ffffff',
      foreground: '#1e1e1e',
      accent: '#007acc',
      border: '#e5e5e5',
      editorBackground: '#ffffff',
      editorForeground: '#1e1e1e',
      syntaxKeyword: '#0000ff',
      syntaxString: '#a31515',
      syntaxComment: '#008000',
      syntaxVariable: '#001080',
    },
  },
  dark: {
    id: 'dark',
    name: 'Dark',
    isDark: true,
    colors: {
      background: '#1e1e1e',
      foreground: '#d4d4d4',
      accent: '#0e639c',
      border: '#3c3c3c',
      editorBackground: '#1e1e1e',
      editorForeground: '#d4d4d4',
      syntaxKeyword: '#569cd6',
      syntaxString: '#ce9178',
      syntaxComment: '#6a9955',
      syntaxVariable: '#9cdcfe',
    },
  },
  'crystal-dark': {
    id: 'crystal-dark',
    name: 'Crystal Dark',
    isDark: true,
    colors: {
      background: '#0d1117',
      foreground: '#c9d1d9',
      accent: '#58a6ff',
      border: '#30363d',
      editorBackground: '#0d1117',
      editorForeground: '#c9d1d9',
      syntaxKeyword: '#ff7b72',
      syntaxString: '#a5d6ff',
      syntaxComment: '#8b949e',
      syntaxVariable: '#ffa657',
    },
  },
};

/**
 * Current theme ID atom.
 * Components subscribe to this to react to theme changes.
 */
export const themeIdAtom = atom<ThemeId>('dark');

/**
 * Derived: full theme object.
 * Use this when you need more than just the theme ID.
 */
export const themeAtom = atom((get) => {
  const id = get(themeIdAtom);
  return themes[id];
});

/**
 * Derived: is current theme dark?
 * Useful for components that only care about light vs dark.
 */
export const isDarkThemeAtom = atom((get) => {
  const theme = get(themeAtom);
  return theme.isDark;
});

/**
 * Derived: theme colors only.
 * Use when you just need colors and don't care about other theme metadata.
 */
export const themeColorsAtom = atom((get) => {
  const theme = get(themeAtom);
  return theme.colors;
});

/**
 * Action: set theme.
 * Called by platform-specific code when theme changes.
 */
export const setThemeAtom = atom(null, (_get, set, themeId: ThemeId) => {
  set(themeIdAtom, themeId);
});

/**
 * Get the theme object by ID.
 * Useful outside of React context.
 */
export function getThemeById(id: ThemeId): Theme {
  return themes[id];
}

/**
 * Register custom theme.
 * Allows extensions to add their own themes.
 */
export function registerCustomTheme(theme: Theme): void {
  themes[theme.id] = theme;
}
