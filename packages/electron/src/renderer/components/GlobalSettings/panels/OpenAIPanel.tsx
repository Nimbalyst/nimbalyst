import React from 'react';
import { ProviderConfig, Model } from '../../Settings/SettingsView';

interface OpenAIPanelProps {
  config: ProviderConfig;
  apiKeys: Record<string, string>;
  availableModels: Model[];
  loading: boolean;
  onToggle: (enabled: boolean) => void;
  onApiKeyChange: (key: string, value: string) => void;
  onModelToggle: (modelId: string, enabled: boolean) => void;
  onSelectAllModels: (selectAll: boolean) => void;
  onTestConnection: () => Promise<void>;
  onConfigChange: (updates: Partial<ProviderConfig>) => void;
}

export function OpenAIPanel({
  config,
  apiKeys,
  availableModels,
  loading,
  onToggle,
  onApiKeyChange,
  onModelToggle,
  onSelectAllModels,
  onTestConnection,
  onConfigChange
}: OpenAIPanelProps) {
  return (
    <div className="provider-panel">
      <div className="provider-panel-header">
        <h3 className="provider-panel-title">OpenAI</h3>
        <p className="provider-panel-description">
          Access to GPT-4, GPT-3.5, and other OpenAI models.
          Requires an OpenAI API key from platform.openai.com.
        </p>
      </div>

      <div className="provider-enable">
        <span className="provider-enable-label">Enable OpenAI</span>
        <label className="provider-toggle">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => onToggle(e.target.checked)}
          />
          <span className="provider-toggle-slider"></span>
        </label>
      </div>

      {config.enabled && (
        <>
          <div className="provider-panel-section">
            <h4 className="provider-panel-section-title">API Configuration</h4>
            <div className="api-key-section">
              <div className="api-key-row">
                <input
                  type="password"
                  value={apiKeys.openai || ''}
                  onChange={(e) => onApiKeyChange('openai', e.target.value)}
                  onFocus={(e) => e.target.select()}
                  placeholder="sk-..."
                  className="api-key-input"
                />
                <button
                  className={`test-button ${config.testStatus}`}
                  onClick={onTestConnection}
                  disabled={config.testStatus === 'testing'}
                >
                  {config.testStatus === 'testing' ? 'Testing...' :
                   config.testStatus === 'success' ? '✓ Connected' :
                   config.testStatus === 'error' ? '✗ Failed' : 'Test'}
                </button>
              </div>
              {config.testMessage && config.testStatus === 'error' && (
                <div className="test-error">{config.testMessage}</div>
              )}
            </div>
          </div>

          <div className="provider-panel-section">
            <h4 className="provider-panel-section-title">Available Models</h4>
            {loading && (
              <div className="models-loading">Loading models...</div>
            )}

            {!loading && availableModels.length > 0 && (
              <div className="models-section">
                <div className="models-header">
                  <span>Select models to enable:</span>
                  <div className="models-actions">
                    <button
                      className="models-action-btn"
                      onClick={() => onSelectAllModels(true)}
                    >
                      Select All
                    </button>
                    <button
                      className="models-action-btn"
                      onClick={() => onSelectAllModels(false)}
                    >
                      Deselect All
                    </button>
                  </div>
                </div>
                <div className="models-grid">
                  {availableModels.map(model => (
                    <label key={model.id} className="model-checkbox">
                      <input
                        type="checkbox"
                        checked={config.models?.includes(model.id) ?? false}
                        onChange={(e) => onModelToggle(model.id, e.target.checked)}
                      />
                      <span>{model.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {!loading && availableModels.length === 0 && apiKeys.openai && (
              <div className="models-loading">No models available. Check your API key and connection.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
