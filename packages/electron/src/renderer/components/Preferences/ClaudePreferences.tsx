import React, { useState, useEffect } from 'react';
import { aiApi } from '../../services/aiApi';

export function ClaudePreferences() {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState('claude-3-5-sonnet-20241022');
  const [maxTokens, setMaxTokens] = useState(4000);
  const [temperature, setTemperature] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [isTestingKey, setIsTestingKey] = useState(false);
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; display_name: string }>>([
    { id: 'claude-3-5-sonnet-20241022', display_name: 'Claude 3.5 Sonnet' },
    { id: 'claude-3-5-haiku-20241022', display_name: 'Claude 3.5 Haiku' }
  ]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const settings = await window.electronAPI.getClaudeSettings();
      if (settings) {
        setApiKey(settings.apiKey || '');
        setModel(settings.model || 'claude-3-5-sonnet-20241022');
        setMaxTokens(settings.maxTokens || 4000);
        setTemperature(settings.temperature || 0);
        
        // If we have an API key, try to fetch available models
        if (settings.apiKey) {
          loadAvailableModels();
        }
      }
    } catch (error) {
      console.error('Failed to load Claude settings:', error);
    }
  };

  const loadAvailableModels = async () => {
    if (!window.electronAPI.getClaudeModels) return;
    
    setIsLoadingModels(true);
    try {
      const response = await window.electronAPI.getClaudeModels();
      if (response.models && response.models.length > 0) {
        setAvailableModels(response.models);
      }
    } catch (error) {
      console.error('Failed to load available models:', error);
    } finally {
      setIsLoadingModels(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage('');

    try {
      // Validate API key format
      if (apiKey && !apiKey.startsWith('sk-ant-')) {
        setSaveMessage('Invalid API key format. Should start with sk-ant-');
        setIsSaving(false);
        return;
      }

      // Save settings via IPC
      await window.electronAPI.saveClaudeSettings({
        apiKey,
        model,
        maxTokens,
        temperature
      });

      // Initialize Claude with new settings
      if (apiKey) {
        await aiApi.initialize(apiKey);
        // Reload available models with new API key
        loadAvailableModels();
      }

      setSaveMessage('Settings saved successfully!');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (error: any) {
      setSaveMessage(`Failed to save: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestKey = async () => {
    if (!apiKey) {
      setSaveMessage('Please enter an API key first');
      return;
    }

    setIsTestingKey(true);
    setSaveMessage('');

    try {
      // Test the API key by initializing and sending a simple message
      await aiApi.initialize(apiKey);
      const response = await window.electronAPI.testClaudeConnection();
      
      if (response.success) {
        setSaveMessage('✓ API key is valid and working!');
      } else {
        setSaveMessage('API key test failed: ' + response.error);
      }
    } catch (error: any) {
      setSaveMessage(`Connection test failed: ${error.message}`);
    } finally {
      setIsTestingKey(false);
    }
  };

  const maskApiKey = (key: string) => {
    if (!key) return '';
    if (key.length <= 20) return key;
    return `${key.substring(0, 10)}...${key.substring(key.length - 4)}`;
  };

  return (
    <div className="preferences-section">
      <h3>Claude AI Configuration</h3>
      
      <div className="preference-group">
        <label htmlFor="claude-api-key">API Key</label>
        <p className="preference-description">
          Get your API key from the{' '}
          <a 
            href="https://console.anthropic.com/account/keys" 
            target="_blank" 
            rel="noopener noreferrer"
            className="preference-link"
          >
            Anthropic Console
          </a>
        </p>
        
        <div className="api-key-input-wrapper">
          <input
            id="claude-api-key"
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-ant-api03-..."
            className="preference-input api-key-input"
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="preference-button-secondary"
            title={showKey ? 'Hide API key' : 'Show API key'}
          >
            {showKey ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M10.73 5.27a3 3 0 1 0-4.46 4.46L2 14l2 2 4.27-4.27a3 3 0 0 0 4.46-4.46" stroke="currentColor" strokeWidth="1.5"/>
                <line x1="1" y1="1" x2="15" y2="15" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M8 1C3 1 0 8 0 8s3 7 8 7 8-7 8-7-3-7-8-7Z" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
            )}
          </button>
          <button
            onClick={handleTestKey}
            disabled={!apiKey || isTestingKey}
            className="preference-button-secondary"
            title="Test API key"
          >
            {isTestingKey ? 'Testing...' : 'Test'}
          </button>
        </div>
      </div>

      <div className="preference-group">
        <label htmlFor="claude-model">Model</label>
        <p className="preference-description">
          Choose the Claude model to use for responses
        </p>
        <select 
          id="claude-model" 
          value={model} 
          onChange={(e) => setModel(e.target.value)}
          className="preference-select"
          disabled={isLoadingModels}
        >
          {isLoadingModels ? (
            <option>Loading models...</option>
          ) : (
            availableModels.map(m => (
              <option key={m.id} value={m.id}>
                {m.display_name}
              </option>
            ))
          )}
        </select>
        {apiKey && (
          <button
            onClick={loadAvailableModels}
            disabled={isLoadingModels}
            className="preference-button-secondary"
            style={{ marginTop: '8px' }}
            title="Refresh available models"
          >
            {isLoadingModels ? 'Loading...' : 'Refresh Models'}
          </button>
        )}
      </div>

      <div className="preference-group">
        <label htmlFor="claude-max-tokens">Max Response Length</label>
        <p className="preference-description">
          Maximum number of tokens in Claude's response (100-8000)
        </p>
        <div className="preference-slider-group">
          <input
            id="claude-max-tokens"
            type="range"
            min="100"
            max="8000"
            step="100"
            value={maxTokens}
            onChange={(e) => setMaxTokens(parseInt(e.target.value))}
            className="preference-slider"
          />
          <input
            type="number"
            min="100"
            max="8000"
            step="100"
            value={maxTokens}
            onChange={(e) => setMaxTokens(parseInt(e.target.value) || 4000)}
            className="preference-input-small"
          />
        </div>
      </div>

      <div className="preference-group">
        <label htmlFor="claude-temperature">Creativity</label>
        <p className="preference-description">
          Higher values make responses more creative but less focused (0-1)
        </p>
        <div className="preference-slider-group">
          <input
            id="claude-temperature"
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={temperature}
            onChange={(e) => setTemperature(parseFloat(e.target.value))}
            className="preference-slider"
          />
          <input
            type="number"
            min="0"
            max="1"
            step="0.1"
            value={temperature}
            onChange={(e) => setTemperature(parseFloat(e.target.value) || 0)}
            className="preference-input-small"
          />
        </div>
      </div>

      <div className="preference-group">
        <h4>Usage & Limits</h4>
        <p className="preference-description">
          Monitor your API usage and costs in the{' '}
          <a 
            href="https://console.anthropic.com/settings/usage" 
            target="_blank" 
            rel="noopener noreferrer"
            className="preference-link"
          >
            Anthropic Console
          </a>
        </p>
      </div>

      {saveMessage && (
        <div className={`preference-message ${saveMessage.includes('✓') || saveMessage.includes('success') ? 'success' : 'error'}`}>
          {saveMessage}
        </div>
      )}

      <div className="preference-actions">
        <button 
          onClick={handleSave} 
          disabled={isSaving}
          className="preference-button-primary"
        >
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}