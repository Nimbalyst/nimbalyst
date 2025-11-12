/**
 * Monaco Theme Mapper
 *
 * Maps Nimbalyst's theme system to Monaco Editor themes.
 * Converts our theme names to Monaco's built-in theme IDs.
 */

import type { Theme as ConfigTheme } from 'rexical';

/**
 * Map Nimbalyst theme to Monaco editor theme
 *
 * Monaco provides these built-in themes:
 * - 'vs' - Light theme
 * - 'vs-dark' - Dark theme
 * - 'hc-black' - High contrast dark theme
 * - 'hc-light' - High contrast light theme
 *
 * We use 'vs' for light and 'vs-dark' for our dark variants.
 * In the future, we can define custom themes using monaco.editor.defineTheme()
 */
export function getMonacoTheme(nimbalystTheme: ConfigTheme): string {
  switch (nimbalystTheme) {
    case 'light':
      return 'vs';

    case 'dark':
    case 'crystal-dark':
      // Both dark variants use vs-dark for now
      // TODO: Create custom Monaco theme to match crystal-dark exactly
      return 'vs-dark';

    case 'auto':
      // Auto theme should check system preference
      // For now, default to light (TabEditor should resolve 'auto' before passing to Monaco)
      return 'vs';

    default:
      return 'vs';
  }
}

/**
 * Check if theme should be considered "dark" for UI purposes
 */
export function isDarkTheme(theme: ConfigTheme): boolean {
  return theme === 'dark' || theme === 'crystal-dark';
}
