import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import {
  getAllAvailableThemesAsync,
} from '../../hooks/useTheme';

type BuiltInTheme = 'light' | 'dark' | 'crystal-dark';

interface ThemeToggleButtonProps {
  className?: string;
}

export const ThemeToggleButton: React.FC<ThemeToggleButtonProps> = ({ className = '' }) => {
  const [currentTheme, setCurrentTheme] = useState<string>(() => {
    // Get initial theme from main process (synchronously)
    const mainProcessTheme = window.electronAPI?.getThemeSync?.() || 'light';
    return mainProcessTheme;
  });

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [availableThemes, setAvailableThemes] = useState<Array<{
    id: string;
    name: string;
    isDark: boolean;
  }>>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Load available themes
  useEffect(() => {
    const loadThemes = async () => {
      const themes = await getAllAvailableThemesAsync();
      setAvailableThemes(themes);
    };

    loadThemes();
  }, []);

  // Listen for theme changes from other sources (like the menu)
  useEffect(() => {
    if (!window.electronAPI?.on) return;

    const handleThemeChange = (newTheme: string) => {
      setCurrentTheme(newTheme);
    };

    window.electronAPI.on('theme-change', handleThemeChange);

    return () => {
      window.electronAPI.off?.('theme-change', handleThemeChange);
    };
  }, []);

  // Close menu when clicking outside
  useEffect(() => {
    if (!isMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMenuOpen]);

  const selectTheme = useCallback((themeId: string) => {
    setIsMenuOpen(false);

    // Update local state immediately for responsive UI
    setCurrentTheme(themeId);

    // Find the theme to get its isDark property
    const theme = availableThemes.find(t => t.id === themeId);
    const isDark = theme?.isDark ?? false;

    // Send theme change to main process for persistence and cross-window sync
    if (window.electronAPI?.send) {
      window.electronAPI.send('set-theme', themeId, isDark);
    }
  }, [availableThemes]);

  const getThemeIcon = (themeId: string, isDark: boolean): string => {
    switch (themeId) {
      case 'light':
        return 'light_mode';
      case 'dark':
        return 'dark_mode';
      case 'crystal-dark':
        return 'bedtime';
      default:
        return 'palette';
    }
  };

  const getCurrentThemeIcon = (): string => {
    const theme = availableThemes.find(t => t.id === currentTheme);
    if (theme) {
      return getThemeIcon(theme.id, theme.isDark);
    }
    // Fallback for built-in themes
    switch (currentTheme) {
      case 'light':
        return 'light_mode';
      case 'dark':
        return 'dark_mode';
      case 'crystal-dark':
        return 'bedtime';
      default:
        return 'light_mode';
    }
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        className={`theme-toggle-button nav-button relative w-9 h-9 flex items-center justify-center bg-transparent border-none rounded-md text-nim-muted cursor-pointer transition-all duration-150 p-0 hover:bg-nim-tertiary hover:text-nim active:scale-95 focus-visible:outline-2 focus-visible:outline-[var(--nim-primary)] focus-visible:outline-offset-2 ${className}`}
        onClick={() => setIsMenuOpen(!isMenuOpen)}
        title="Change theme"
        aria-label="Change theme"
        aria-expanded={isMenuOpen}
        aria-haspopup="menu"
      >
        <MaterialSymbol icon="palette" size={20} />
      </button>

      {isMenuOpen && (
        <div
          ref={menuRef}
          className="theme-menu absolute bottom-full left-0 mb-1 bg-nim-secondary border border-nim rounded-md p-1 min-w-[200px] shadow-lg z-[1000]"
          role="menu"
          aria-label="Theme selection"
        >
          {availableThemes.map(theme => (
            <button
              key={theme.id}
              className="theme-menu-item flex items-center gap-2 w-full py-2 px-3 border-none bg-transparent text-nim text-[13px] text-left cursor-pointer rounded transition-colors duration-100 hover:bg-nim-hover"
              onClick={() => selectTheme(theme.id)}
              role="menuitem"
            >
              <span className="theme-icon w-5 flex justify-center flex-shrink-0">
                <MaterialSymbol icon={getThemeIcon(theme.id, theme.isDark)} size={18} />
              </span>
              <span className="theme-name flex-1 whitespace-nowrap">{theme.name}</span>
              {currentTheme === theme.id && (
                <span className="theme-check w-4 flex justify-center flex-shrink-0">
                  <MaterialSymbol icon="check" size={16} />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
