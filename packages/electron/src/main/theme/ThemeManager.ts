import { BrowserWindow, nativeTheme } from 'electron';
import { getTheme } from '../utils/store';
import { updateAboutWindowTheme } from '../window/AboutWindow';
import { updateAIModelsWindowTheme } from '../window/AIModelsWindow';

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
    let titleBarColor = titleBarColors.light;
    let backgroundColor = '#ffffff';

    if (currentTheme === 'crystal-dark') {
        titleBarColor = titleBarColors.crystalDark;
        backgroundColor = '#1F2837';
    } else if (isDarkTheme) {
        titleBarColor = titleBarColors.dark;
        backgroundColor = '#1a1a1a';
    }

    // Update all windows
    BrowserWindow.getAllWindows().forEach(window => {
        // Update background color
        window.setBackgroundColor(backgroundColor);

        // Update title bar overlay on Windows/Linux
        if (process.platform !== 'darwin' && window.setTitleBarOverlay) {
            window.setTitleBarOverlay(titleBarColor);
        }
    });

    // Update About window if it exists
    updateAboutWindowTheme();

    // Update AI Models window if it exists
    updateAIModelsWindowTheme();
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
export function getBackgroundColor() {
    const currentTheme = getTheme();
    const systemDarkMode = nativeTheme.shouldUseDarkColors;
    const isDarkTheme = currentTheme === 'dark' ||
                      currentTheme === 'crystal-dark' ||
                      (currentTheme === 'system' && systemDarkMode);

    if (currentTheme === 'crystal-dark') {
        return '#1F2837';
    } else if (isDarkTheme) {
        return '#1a1a1a';
    } else {
        return '#ffffff';
    }
}
