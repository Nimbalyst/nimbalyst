import React, { useState, useEffect } from 'react';

export function EditorPreferences() {
  const [fontSize, setFontSize] = useState(14);
  const [fontFamily, setFontFamily] = useState('system');
  const [tabSize, setTabSize] = useState(2);
  const [wordWrap, setWordWrap] = useState(true);
  const [highlightActiveLine, setHighlightActiveLine] = useState(true);
  const [showInvisibles, setShowInvisibles] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const settings = await window.electronAPI.getEditorSettings();
      if (settings) {
        setFontSize(settings.fontSize ?? 14);
        setFontFamily(settings.fontFamily ?? 'system');
        setTabSize(settings.tabSize ?? 2);
        setWordWrap(settings.wordWrap ?? true);
        setHighlightActiveLine(settings.highlightActiveLine ?? true);
        setShowInvisibles(settings.showInvisibles ?? false);
      }
    } catch (error) {
      console.error('Failed to load editor settings:', error);
    }
  };

  const handleSave = async () => {
    try {
      await window.electronAPI.saveEditorSettings({
        fontSize,
        fontFamily,
        tabSize,
        wordWrap,
        highlightActiveLine,
        showInvisibles
      });
    } catch (error) {
      console.error('Failed to save editor settings:', error);
    }
  };

  return (
    <div className="preferences-section">
      <h3>Editor Settings</h3>
      
      <div className="preference-group">
        <label htmlFor="font-size">Font Size</label>
        <p className="preference-description">
          Editor font size in pixels
        </p>
        <div className="preference-slider-group">
          <input
            id="font-size"
            type="range"
            min="10"
            max="24"
            value={fontSize}
            onChange={(e) => {
              setFontSize(parseInt(e.target.value));
              handleSave();
            }}
            className="preference-slider"
          />
          <span className="preference-slider-value">{fontSize}px</span>
        </div>
      </div>

      <div className="preference-group">
        <label htmlFor="font-family">Font Family</label>
        <p className="preference-description">
          Choose your preferred editor font
        </p>
        <select 
          id="font-family" 
          value={fontFamily} 
          onChange={(e) => {
            setFontFamily(e.target.value);
            handleSave();
          }}
          className="preference-select"
        >
          <option value="system">System Default</option>
          <option value="sf-mono">SF Mono</option>
          <option value="monaco">Monaco</option>
          <option value="menlo">Menlo</option>
          <option value="consolas">Consolas</option>
          <option value="courier">Courier New</option>
        </select>
      </div>

      <div className="preference-group">
        <label htmlFor="tab-size">Tab Size</label>
        <p className="preference-description">
          Number of spaces for tab indentation
        </p>
        <select 
          id="tab-size" 
          value={tabSize} 
          onChange={(e) => {
            setTabSize(parseInt(e.target.value));
            handleSave();
          }}
          className="preference-select"
        >
          <option value="2">2 spaces</option>
          <option value="4">4 spaces</option>
          <option value="8">8 spaces</option>
        </select>
      </div>

      <div className="preference-group">
        <label className="preference-checkbox-label">
          <input
            type="checkbox"
            checked={wordWrap}
            onChange={(e) => {
              setWordWrap(e.target.checked);
              handleSave();
            }}
            className="preference-checkbox"
          />
          <span>Word wrap</span>
        </label>
        <p className="preference-description">
          Wrap long lines to fit the editor width
        </p>
      </div>

      <div className="preference-group">
        <label className="preference-checkbox-label">
          <input
            type="checkbox"
            checked={highlightActiveLine}
            onChange={(e) => {
              setHighlightActiveLine(e.target.checked);
              handleSave();
            }}
            className="preference-checkbox"
          />
          <span>Highlight active line</span>
        </label>
        <p className="preference-description">
          Highlight the line where the cursor is positioned
        </p>
      </div>

      <div className="preference-group">
        <label className="preference-checkbox-label">
          <input
            type="checkbox"
            checked={showInvisibles}
            onChange={(e) => {
              setShowInvisibles(e.target.checked);
              handleSave();
            }}
            className="preference-checkbox"
          />
          <span>Show invisible characters</span>
        </label>
        <p className="preference-description">
          Display spaces, tabs, and line breaks
        </p>
      </div>
    </div>
  );
}