import { BrowserWindow, nativeTheme } from 'electron';
import { getTheme, getThemeIsDark } from '../utils/store';

/**
 * Check if a theme ID is an extension theme (format: extensionId:themeId).
 */
function isExtensionTheme(themeId: string): boolean {
  return themeId.includes(':');
}

/**
 * Determine if the current theme is dark.
 * For extension themes, uses the stored isDark value.
 * For built-in themes, uses hardcoded values.
 */
function isCurrentThemeDark(currentTheme: string): boolean {
    // Built-in dark themes
    if (currentTheme === 'dark' || currentTheme === 'crystal-dark') {
        return true;
    }
    // Built-in light themes
    if (currentTheme === 'light') {
        return false;
    }
    // System theme - check OS preference
    if (currentTheme === 'system') {
        return nativeTheme.shouldUseDarkColors;
    }
    // Extension themes - use stored isDark value (defaults to false if not set)
    if (isExtensionTheme(currentTheme)) {
        return getThemeIsDark() ?? false;
    }
    // Unknown theme - default to light
    return false;
}

// Function to update native theme
export function updateNativeTheme() {
    const currentTheme = getTheme();

    // Map to system/dark/light for nativeTheme
    let desired: 'system' | 'dark' | 'light';
    if (currentTheme === 'system') {
        desired = 'system';
    } else if (isCurrentThemeDark(currentTheme)) {
        desired = 'dark';
    } else {
        desired = 'light';
    }

    // Only set when it actually changes to avoid spurious 'updated' events
    if (nativeTheme.themeSource !== desired) {
        nativeTheme.themeSource = desired;
    }
}

// Function to update window title bar colors based on theme
export function updateWindowTitleBars() {
    const currentTheme = getTheme();
    const isDarkTheme = isCurrentThemeDark(currentTheme);

    // Do NOT touch nativeTheme.themeSource here to avoid triggering
    // nativeTheme 'updated' recursively. Only adjust window visuals.

    // Define title bar colors for each theme
    const titleBarColors = {
        dark: { color: '#1a1a1a', symbolColor: '#ffffff' },
        crystalDark: { color: '#1F2837', symbolColor: '#F3F4F6' },
        light: { color: '#ffffff', symbolColor: '#374151' }
    };

    // Select appropriate colors based on theme
    // IMPORTANT: Background colors MUST match CSS theme files exactly to prevent flash
    let titleBarColor = titleBarColors.light;
    let backgroundColor = '#ffffff'; // Matches --nim-bg in light theme

    if (currentTheme === 'crystal-dark') {
        titleBarColor = titleBarColors.crystalDark;
        backgroundColor = '#0f172a'; // Matches --nim-bg in crystal-dark theme
    } else if (isDarkTheme) {
        titleBarColor = titleBarColors.dark;
        backgroundColor = '#2d2d2d'; // Matches --nim-bg in dark theme
    }

    // Update all windows
    BrowserWindow.getAllWindows().forEach(window => {
        // Update background color
        window.setBackgroundColor(backgroundColor);

        // Update title bar overlay on Windows/Linux
        if (process.platform !== 'darwin' && window.setTitleBarOverlay) {
          try {
            window.setTitleBarOverlay(titleBarColor);
          } catch (error) {
            console.error('Error setting title bar overlay:', error);
          }
        }

        // Send theme-change event to all windows
        // Each window's renderer listens to this and updates its own UI
        window.webContents.send('theme-change', currentTheme);
    });
}

// Get title bar colors for current theme
export function getTitleBarColors() {
    const currentTheme = getTheme();
    const isDarkTheme = isCurrentThemeDark(currentTheme);

    const titleBarColors = {
        dark: { color: '#1a1a1a', symbolColor: '#ffffff' },
        crystalDark: { color: '#1F2837', symbolColor: '#F3F4F6' },
        light: { color: '#ffffff', symbolColor: '#374151' }
    };

    if (currentTheme === 'crystal-dark') {
        return titleBarColors.crystalDark;
    } else if (isDarkTheme) {
        return titleBarColors.dark;
    } else {
        return titleBarColors.light;
    }
}

// Get background color for current theme
// IMPORTANT: These colors MUST match the CSS theme files exactly to prevent flash
export function getBackgroundColor() {
    const currentTheme = getTheme();
    const isDarkTheme = isCurrentThemeDark(currentTheme);

    if (currentTheme === 'crystal-dark') {
        return '#0f172a'; // Matches --nim-bg in crystal-dark theme
    } else if (isDarkTheme) {
        return '#2d2d2d'; // Matches --nim-bg in dark theme
    } else {
        return '#ffffff'; // Matches --nim-bg in light theme
    }
}
