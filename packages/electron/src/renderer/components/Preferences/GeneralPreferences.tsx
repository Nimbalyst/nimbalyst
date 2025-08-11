import React, { useState, useEffect } from 'react';

export function GeneralPreferences() {
  const [theme, setTheme] = useState('system');

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const currentTheme = await window.electronAPI.getTheme();
      setTheme(currentTheme || 'system');
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const handleThemeChange = async (newTheme: string) => {
    setTheme(newTheme);
    await window.electronAPI.setTheme(newTheme);
  };

  const handleOpenDataFolder = async () => {
    if (window.electronAPI.openDataFolder) {
      await window.electronAPI.openDataFolder();
    }
  };

  return (
    <div className="preferences-section">
      <h3>General Settings</h3>
      
      <div className="preference-group">
        <label htmlFor="theme">Theme</label>
        <p className="preference-description">
          Choose your preferred color theme
        </p>
        <select 
          id="theme" 
          value={theme} 
          onChange={(e) => handleThemeChange(e.target.value)}
          className="preference-select"
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="crystal-dark">Crystal Dark</option>
        </select>
      </div>

      <div className="preference-group">
        <h4>Application Data</h4>
        <p className="preference-description">
          Access your history, sessions, and other application data
        </p>
        <button
          onClick={handleOpenDataFolder}
          className="preference-button-secondary"
          style={{ marginTop: '8px' }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ marginRight: '6px' }}>
            <path d="M2 3.5C2 2.67157 2.67157 2 3.5 2H6L7.5 4H12.5C13.3284 4 14 4.67157 14 5.5V12.5C14 13.3284 13.3284 14 12.5 14H3.5C2.67157 14 2 13.3284 2 12.5V3.5Z" stroke="currentColor" strokeWidth="1.5"/>
          </svg>
          Open Data Folder
        </button>
      </div>
    </div>
  );
}