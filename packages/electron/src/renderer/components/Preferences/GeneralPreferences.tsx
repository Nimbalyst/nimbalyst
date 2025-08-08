import React, { useState, useEffect } from 'react';

export function GeneralPreferences() {
  const [theme, setTheme] = useState('system');
  const [autoSave, setAutoSave] = useState(true);
  const [autoSaveInterval, setAutoSaveInterval] = useState(60);
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const [showWordCount, setShowWordCount] = useState(true);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const currentTheme = await window.electronAPI.getTheme();
      setTheme(currentTheme || 'system');
      
      // Load other settings from store
      const settings = await window.electronAPI.getGeneralSettings();
      if (settings) {
        setAutoSave(settings.autoSave ?? true);
        setAutoSaveInterval(settings.autoSaveInterval ?? 60);
        setShowLineNumbers(settings.showLineNumbers ?? true);
        setShowWordCount(settings.showWordCount ?? true);
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const handleThemeChange = async (newTheme: string) => {
    setTheme(newTheme);
    await window.electronAPI.setTheme(newTheme);
  };

  const handleSave = async () => {
    try {
      await window.electronAPI.saveGeneralSettings({
        autoSave,
        autoSaveInterval,
        showLineNumbers,
        showWordCount
      });
    } catch (error) {
      console.error('Failed to save settings:', error);
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
        <label className="preference-checkbox-label">
          <input
            type="checkbox"
            checked={autoSave}
            onChange={(e) => {
              setAutoSave(e.target.checked);
              handleSave();
            }}
            className="preference-checkbox"
          />
          <span>Enable auto-save</span>
        </label>
        <p className="preference-description">
          Automatically save changes to your documents
        </p>
        
        {autoSave && (
          <div className="preference-subgroup">
            <label htmlFor="autosave-interval">Auto-save interval (seconds)</label>
            <input
              id="autosave-interval"
              type="number"
              min="10"
              max="300"
              value={autoSaveInterval}
              onChange={(e) => {
                setAutoSaveInterval(parseInt(e.target.value) || 60);
                handleSave();
              }}
              className="preference-input-small"
            />
          </div>
        )}
      </div>

      <div className="preference-group">
        <label className="preference-checkbox-label">
          <input
            type="checkbox"
            checked={showLineNumbers}
            onChange={(e) => {
              setShowLineNumbers(e.target.checked);
              handleSave();
            }}
            className="preference-checkbox"
          />
          <span>Show line numbers</span>
        </label>
        <p className="preference-description">
          Display line numbers in the editor
        </p>
      </div>

      <div className="preference-group">
        <label className="preference-checkbox-label">
          <input
            type="checkbox"
            checked={showWordCount}
            onChange={(e) => {
              setShowWordCount(e.target.checked);
              handleSave();
            }}
            className="preference-checkbox"
          />
          <span>Show word count</span>
        </label>
        <p className="preference-description">
          Display word and character count in the status bar
        </p>
      </div>
    </div>
  );
}