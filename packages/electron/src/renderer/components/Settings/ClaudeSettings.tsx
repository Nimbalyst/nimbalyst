import React, { useState, useEffect } from 'react';
import { claudeApi } from '../../services/claudeApi';

interface ClaudeSettingsProps {
  onClose?: () => void;
}

export function ClaudeSettings({ onClose }: ClaudeSettingsProps) {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  useEffect(() => {
    // Load existing API key (masked)
    const loadSettings = async () => {
      try {
        // In a real implementation, we'd fetch the masked key from the backend
        const storedKey = localStorage.getItem('claude_api_key_mask');
        if (storedKey) {
          setApiKey(storedKey);
        }
      } catch (error) {
        console.error('Failed to load settings:', error);
      }
    };
    
    loadSettings();
  }, []);

  const handleSave = async () => {
    if (!apiKey || !apiKey.startsWith('sk-ant-')) {
      setSaveMessage('Please enter a valid Anthropic API key');
      return;
    }

    setIsSaving(true);
    setSaveMessage('');

    try {
      await claudeApi.initialize(apiKey);
      
      // Store masked version in localStorage for display
      const maskedKey = apiKey.substring(0, 10) + '...' + apiKey.substring(apiKey.length - 4);
      localStorage.setItem('claude_api_key_mask', maskedKey);
      
      setSaveMessage('API key saved successfully!');
      setTimeout(() => {
        if (onClose) onClose();
      }, 1500);
    } catch (error: any) {
      setSaveMessage(`Failed to save: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="claude-settings">
      <h2>Claude AI Settings</h2>
      
      <div className="settings-section">
        <label htmlFor="api-key">API Key</label>
        <p className="settings-hint">
          Get your API key from{' '}
          <a 
            href="https://console.anthropic.com/account/keys" 
            target="_blank" 
            rel="noopener noreferrer"
          >
            Anthropic Console
          </a>
        </p>
        
        <div className="api-key-input-group">
          <input
            id="api-key"
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-ant-api03-..."
            className="settings-input"
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="toggle-visibility-btn"
          >
            {showKey ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      <div className="settings-section">
        <h3>Model Settings</h3>
        <label htmlFor="model">Model</label>
        <select id="model" className="settings-select" defaultValue="claude-3-5-sonnet-20241022">
          <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet (Latest)</option>
          <option value="claude-3-opus-20240229">Claude 3 Opus</option>
          <option value="claude-3-sonnet-20240229">Claude 3 Sonnet</option>
          <option value="claude-3-haiku-20240307">Claude 3 Haiku</option>
        </select>
        
        <label htmlFor="max-tokens">Max Tokens</label>
        <input
          id="max-tokens"
          type="number"
          defaultValue="4000"
          min="100"
          max="8000"
          className="settings-input"
        />
      </div>

      {saveMessage && (
        <div className={`settings-message ${saveMessage.includes('success') ? 'success' : 'error'}`}>
          {saveMessage}
        </div>
      )}

      <div className="settings-actions">
        <button onClick={handleSave} disabled={isSaving} className="save-btn">
          {isSaving ? 'Saving...' : 'Save Settings'}
        </button>
        {onClose && (
          <button onClick={onClose} className="cancel-btn">
            Cancel
          </button>
        )}
      </div>

      <style jsx>{`
        .claude-settings {
          padding: 20px;
          max-width: 600px;
          margin: 0 auto;
        }

        .claude-settings h2 {
          margin-bottom: 20px;
          color: var(--text-primary);
        }

        .settings-section {
          margin-bottom: 24px;
        }

        .settings-section h3 {
          margin-bottom: 12px;
          color: var(--text-primary);
          font-size: 16px;
        }

        .settings-section label {
          display: block;
          margin-bottom: 6px;
          color: var(--text-secondary);
          font-size: 13px;
          font-weight: 500;
        }

        .settings-hint {
          margin-bottom: 8px;
          color: var(--text-tertiary);
          font-size: 12px;
        }

        .settings-hint a {
          color: var(--primary-color);
          text-decoration: none;
        }

        .settings-hint a:hover {
          text-decoration: underline;
        }

        .api-key-input-group {
          display: flex;
          gap: 8px;
        }

        .settings-input,
        .settings-select {
          width: 100%;
          padding: 8px 12px;
          background: var(--background-primary);
          border: 1px solid var(--border-color);
          border-radius: 6px;
          color: var(--text-primary);
          font-size: 13px;
          font-family: inherit;
        }

        .settings-input:focus,
        .settings-select:focus {
          outline: none;
          border-color: var(--primary-color);
        }

        .toggle-visibility-btn {
          padding: 8px 16px;
          background: var(--background-secondary);
          border: 1px solid var(--border-color);
          border-radius: 6px;
          color: var(--text-primary);
          font-size: 12px;
          cursor: pointer;
          white-space: nowrap;
        }

        .toggle-visibility-btn:hover {
          background: var(--background-tertiary);
        }

        .settings-message {
          padding: 12px;
          border-radius: 6px;
          margin-bottom: 16px;
          font-size: 13px;
        }

        .settings-message.success {
          background: rgba(34, 197, 94, 0.1);
          color: #22c55e;
          border: 1px solid rgba(34, 197, 94, 0.2);
        }

        .settings-message.error {
          background: rgba(239, 68, 68, 0.1);
          color: #ef4444;
          border: 1px solid rgba(239, 68, 68, 0.2);
        }

        .settings-actions {
          display: flex;
          gap: 12px;
          justify-content: flex-end;
        }

        .save-btn,
        .cancel-btn {
          padding: 8px 20px;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .save-btn {
          background: var(--primary-color);
          color: white;
          border: none;
        }

        .save-btn:hover:not(:disabled) {
          background: var(--primary-color-hover);
        }

        .save-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .cancel-btn {
          background: transparent;
          color: var(--text-secondary);
          border: 1px solid var(--border-color);
        }

        .cancel-btn:hover {
          background: var(--background-secondary);
        }
      `}</style>
    </div>
  );
}