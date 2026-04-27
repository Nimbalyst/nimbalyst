/**
 * Central Theme Listener
 *
 * Subscribes to the `theme-change` IPC event ONCE and updates `themeIdAtom`
 * plus the DOM. Components read from the atom (or call applyThemeToDOM
 * directly) instead of subscribing to the IPC event themselves.
 *
 * Call initThemeListener() once at app startup.
 */

import { store, themeIdAtom, type ThemeId } from '@nimbalyst/runtime/store';
import { applyThemeToDOM } from '../../hooks/useTheme';

let initialized = false;

export function initThemeListener(): () => void {
  if (initialized) {
    return () => {};
  }
  initialized = true;

  const unsubscribe = window.electronAPI?.on?.('theme-change', (newTheme: string) => {
    const resolvedTheme = newTheme as ThemeId;
    store.set(themeIdAtom, resolvedTheme);
    void applyThemeToDOM(resolvedTheme);
  });

  return () => {
    initialized = false;
    if (typeof unsubscribe === 'function') {
      unsubscribe();
    }
  };
}
