import React from 'react';
import { ProviderConfig, Model } from '../../Settings/SettingsView';

interface OpenAICodexPanelProps {
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

export function OpenAICodexPanel({
  config,
  apiKeys,
  onToggle,
  onApiKeyChange,
  onTestConnection,
}: OpenAICodexPanelProps) {
  return (
    <div className="provider-panel flex flex-col">
      <div className="provider-panel-header mb-6 pb-4 border-b border-[var(--nim-border)]">
        <h3 className="provider-panel-title text-xl font-semibold leading-tight mb-2 text-[var(--nim-text)]">OpenAI Codex</h3>
        <p className="provider-panel-description text-sm leading-relaxed text-[var(--nim-text-muted)]">
          Advanced code generation and completion powered by OpenAI Codex models.
          Provides intelligent code suggestions and automated programming assistance.
        </p>
      </div>

      <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)]">
        <h4 className="provider-panel-section-title text-base font-semibold mb-3 text-[var(--nim-text)]">Prerequisites</h4>
        <p className="text-[13px] text-[var(--nim-text-muted)] mb-2 leading-relaxed">
          Before enabling OpenAI Codex, you need to install the Codex CLI and log in with your OpenAI account.
        </p>
        <p className="text-[13px] text-[var(--nim-text-muted)] leading-relaxed">
          See the{' '}
          <a
            href="https://github.com/openai/codex"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--nim-primary)] hover:underline"
          >
            OpenAI Codex setup instructions
          </a>
          {' '}for installation and authentication steps.
        </p>
      </div>

      <div className="provider-enable flex items-center justify-between gap-4 py-4 mb-4 border-b border-[var(--nim-border)]">
        <span className="provider-enable-label text-sm font-medium text-[var(--nim-text)]">Enable OpenAI Codex</span>
        <label className="provider-toggle relative inline-block w-11 h-6 cursor-pointer">
          <input
            type="checkbox"
            checked={config.enabled || false}
            onChange={(e) => onToggle(e.target.checked)}
            className="opacity-0 w-0 h-0 absolute"
          />
          <span className="provider-toggle-slider absolute cursor-pointer inset-0 rounded-full transition-all bg-[var(--nim-bg-tertiary)]"></span>
        </label>
      </div>

      {config.enabled && (
        <>
          <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
            <h4 className="provider-panel-section-title text-base font-semibold mb-3 text-[var(--nim-text)]">API Configuration</h4>
            <div className="api-key-section mt-4">
              <p className="text-[13px] text-[var(--nim-text-muted)] mb-3">
                OpenAI Codex uses the same API key as OpenAI (GPT models)
              </p>
              <div className="api-key-row flex gap-2 items-center">
                <input
                  type="password"
                  value={apiKeys.openai || ''}
                  onChange={(e) => onApiKeyChange('openai', e.target.value)}
                  onFocus={(e) => e.target.select()}
                  placeholder="sk-..."
                  className="api-key-input flex-1 py-2 px-3 rounded-md bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] text-[var(--nim-text)] outline-none font-mono focus:border-[var(--nim-primary)]"
                />
                <button
                  className={`test-button inline-flex items-center justify-center py-2 px-4 rounded-md text-sm font-medium whitespace-nowrap cursor-pointer transition-all bg-[var(--nim-bg-tertiary)] text-[var(--nim-text)] border border-[var(--nim-border)] hover:bg-[var(--nim-bg-hover)] hover:border-[var(--nim-primary)] ${
                    config.testStatus === 'testing' ? 'opacity-60 cursor-wait' : ''
                  } ${config.testStatus === 'success' ? 'text-[var(--nim-success)] border-[var(--nim-success)]' : ''} ${
                    config.testStatus === 'error' ? 'text-[var(--nim-error)] border-[var(--nim-error)]' : ''
                  }`}
                  onClick={onTestConnection}
                  disabled={config.testStatus === 'testing'}
                >
                  {config.testStatus === 'testing' ? 'Testing...' :
                   config.testStatus === 'success' ? '✓ Connected' :
                   config.testStatus === 'error' ? '✗ Failed' : 'Test'}
                </button>
              </div>
              {config.testMessage && config.testStatus === 'error' && (
                <div className="test-error text-xs mt-2 text-[var(--nim-error)]">{config.testMessage}</div>
              )}
            </div>
          </div>

          <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
            <h4 className="provider-panel-section-title text-base font-semibold mb-3 text-[var(--nim-text)]">Codex Configuration</h4>
            <div className="cli-config-section">
              <p className="text-[13px] text-[var(--nim-text-muted)] mb-3">
                Model selection is handled automatically. No additional configuration required.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
