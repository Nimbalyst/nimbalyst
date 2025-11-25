import React, { useState, useEffect } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';

import './ThemeToggleButton.css';

type Theme = 'light' | 'dark' | 'crystal-dark';

interface ThemeToggleButtonProps {
  className?: string;
}

export const ThemeToggleButton: React.FC<ThemeToggleButtonProps> = ({ className = '' }) => {
  const [currentTheme, setCurrentTheme] = useState<Theme>(() => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'crystal-dark') {
      return savedTheme;
    }
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  });

  // Listen for theme changes from other sources (like the menu)
  useEffect(() => {
    if (!window.electronAPI?.on) return;

    const handleThemeChange = (newTheme: string) => {
      const normalizedTheme = (newTheme === 'system' ? 'auto' : newTheme) as Theme | 'auto';
      if (normalizedTheme === 'light' || normalizedTheme === 'dark' || normalizedTheme === 'crystal-dark') {
        setCurrentTheme(normalizedTheme);
      }
    };

    window.electronAPI.on('theme-change', handleThemeChange);

    return () => {
      window.electronAPI.off?.('theme-change', handleThemeChange);
    };
  }, []);

  const cycleTheme = () => {
    const themeOrder: Theme[] = ['light', 'dark', 'crystal-dark'];
    const currentIndex = themeOrder.indexOf(currentTheme);
    const nextTheme = themeOrder[(currentIndex + 1) % themeOrder.length];

    // Update local state
    setCurrentTheme(nextTheme);

    // Trigger the IPC event that the rest of the app listens to
    if (window.electronAPI?.send) {
      window.electronAPI.send('set-theme', nextTheme);
    }
  };

  const getThemeIcon = (): string => {
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

  const getThemeLabel = (): string => {
    switch (currentTheme) {
      case 'light':
        return 'Switch to Dark';
      case 'dark':
        return 'Switch to Crystal Dark';
      case 'crystal-dark':
        return 'Switch to Light';
      default:
        return 'Toggle Theme';
    }
  };

  return (
    <button
      className={`theme-toggle-button nav-button ${className}`}
      onClick={cycleTheme}
      title={getThemeLabel()}
      aria-label={getThemeLabel()}
    >
      <MaterialSymbol icon={getThemeIcon()} size={20} />
    </button>
  );
};
