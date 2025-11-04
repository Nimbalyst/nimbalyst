import { BrowserWindow, nativeTheme } from 'electron';
import { getTheme } from '../utils/store';

// Function to update native theme
export function updateNativeTheme() {
    const currentTheme = getTheme();
    const desired: 'system' | 'dark' | 'light' =
        currentTheme === 'system' ? 'system' :
        (currentTheme === 'dark' || currentTheme === 'crystal-dark') ? 'dark' : 'light';

    // Only set when it actually changes to avoid spurious 'updated' events
    if (nativeTheme.themeSource !== desired) {
        nativeTheme.themeSource = desired;
    }
}

// Function to update window title bar colors based on theme
export function updateWindowTitleBars() {
    const currentTheme = getTheme();
    const systemDarkMode = nativeTheme.shouldUseDarkColors;
    const isDarkTheme = currentTheme === 'dark' ||
                      currentTheme === 'crystal-dark' ||
                      (currentTheme === 'system' && systemDarkMode);

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
    let backgroundColor = '#ffffff'; // Matches --surface-primary in PlaygroundEditorTheme.css

    if (currentTheme === 'crystal-dark') {
        titleBarColor = titleBarColors.crystalDark;
        backgroundColor = '#0f172a'; // Matches --surface-primary in CrystalDarkTheme.css
    } else if (isDarkTheme) {
        titleBarColor = titleBarColors.dark;
        backgroundColor = '#2d2d2d'; // Matches --surface-primary in DarkEditorTheme.css
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
    const systemDarkMode = nativeTheme.shouldUseDarkColors;
    const isDarkTheme = currentTheme === 'dark' ||
                      currentTheme === 'crystal-dark' ||
                      (currentTheme === 'system' && systemDarkMode);

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
    const systemDarkMode = nativeTheme.shouldUseDarkColors;
    const isDarkTheme = currentTheme === 'dark' ||
                      (currentTheme === 'system' && systemDarkMode);

    if (currentTheme === 'crystal-dark') {
        return '#0f172a'; // Matches --surface-primary in CrystalDarkTheme.css
    } else if (isDarkTheme) {
        return '#2d2d2d'; // Matches --surface-primary in DarkEditorTheme.css
    } else {
        return '#ffffff'; // Matches --surface-primary in PlaygroundEditorTheme.css
    }
}
