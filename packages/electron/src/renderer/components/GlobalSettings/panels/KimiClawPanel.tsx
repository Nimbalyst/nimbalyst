import React, { useState, useCallback } from 'react';
import { ProviderConfig } from '../../Settings/SettingsView';
import { SettingsToggle } from '../SettingsToggle';
import { MaterialSymbol } from '@nimbalyst/runtime';

interface KimiClawPanelProps {
  config: ProviderConfig;
  apiKeys: Record<string, string>;
  availableModels: any[];
  loading: boolean;
  onToggle: (enabled: boolean) => void;
  onApiKeyChange: (key: string, value: string) => void;
  onModelToggle: (modelId: string, enabled: boolean) => void;
  onSelectAllModels: (selectAll: boolean) => void;
  onTestConnection: () => Promise<void>;
  onConfigChange: (updates: Partial<ProviderConfig>) => void;
}

type AuthMethod = 'cookie' | 'bearer';
type DefaultMode = 'crew' | 'classic';

interface KimiClawConfig {
  endpointUrl: string;
  authMethod: AuthMethod;
  username: string;
  password: string;
  bearerToken: string;
  defaultMode: DefaultMode;
  maxAgents: number;
  maxSteps: number;
  maxParallel: number | null;
  verboseLogging: boolean;
}

function parseKimiClawConfig(config: ProviderConfig): KimiClawConfig {
  return {
    endpointUrl: (config.endpointUrl as string) || 'http://127.0.0.1:9643',
    authMethod: (config.authMethod as AuthMethod) || 'cookie',
    username: (config.username as string) || 'admin',
    password: (config.password as string) || 'admin',
    bearerToken: (config.bearerToken as string) || '',
    defaultMode: (config.defaultMode as DefaultMode) || 'crew',
    maxAgents: (config.maxAgents as number) || 4,
    maxSteps: (config.maxSteps as number) || 12,
    maxParallel: (config.maxParallel as number | null) ?? null,
    verboseLogging: (config.verboseLogging as boolean) || false,
  };
}

export function KimiClawPanel({
  config,
  onToggle,
  onTestConnection,
  onConfigChange,
}: KimiClawPanelProps) {
  const kc = parseKimiClawConfig(config);
  const [healthStatus, setHealthStatus] = useState<'idle' | 'checking' | 'success' | 'error'>(
    (config.testStatus as 'idle' | 'checking' | 'success' | 'error') || 'idle'
  );
  const [tokenGenStatus, setTokenGenStatus] = useState<'idle' | 'generating' | 'success' | 'error'>('idle');
  const [tokenGenMessage, setTokenGenMessage] = useState('');

  const handleConfigUpdate = useCallback(
    (updates: Partial<KimiClawConfig>) => {
      onConfigChange(updates as Partial<ProviderConfig>);
    },
    [onConfigChange]
  );

  const handleHealthCheck = async () => {
    setHealthStatus('checking');
    try {
      await onTestConnection();
      setHealthStatus('success');
    } catch {
      setHealthStatus('error');
    }
  };

  const handleGenerateToken = async () => {
    setTokenGenStatus('generating');
    try {
      // Step 1: Login
      const loginRes = await fetch(`${kc.endpointUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: kc.username, password: kc.password }),
      });
      if (!loginRes.ok) {
        setTokenGenStatus('error');
        setTokenGenMessage('Login failed');
        return;
      }
      // Step 2: Generate token
      const tokenRes = await fetch(`${kc.endpointUrl}/api/tokens`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: loginRes.headers.get('set-cookie') || '',
        },
        body: JSON.stringify({ name: 'nimbalyst-desktop' }),
      });
      if (!tokenRes.ok) {
        setTokenGenStatus('error');
        setTokenGenMessage('Token generation failed');
        return;
      }
      const tokenData = await tokenRes.json();
      const token = tokenData?.token?.key || tokenData?.value || '';
      if (token) {
        handleConfigUpdate({ bearerToken: token, authMethod: 'bearer' });
        setTokenGenStatus('success');
        setTokenGenMessage('Token generated');
      } else {
        setTokenGenStatus('error');
        setTokenGenMessage('No token returned');
      }
    } catch (err) {
      setTokenGenStatus('error');
      setTokenGenMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const healthText = healthStatus === 'success' ? 'Healthy' : healthStatus === 'error' ? 'Unreachable' : 'Health Check';

  return (
    <div className="provider-panel flex flex-col">
      {/* Header */}
      <div className="provider-panel-header mb-6 pb-4 border-b border-[var(--nim-border)]">
        <h3 className="text-xl font-semibold mb-2 text-[var(--nim-text)]">KimiClaw</h3>
        <p className="text-sm text-[var(--nim-text-muted)]">
          Local multi-agent orchestration via KimiClawSwarm (KCS) at 127.0.0.1:9643.
          Each message dispatches a swarm of sub-agents. Swarms are fire-and-forget;
          conversation continuity is auto-stitched across turns.
        </p>
      </div>

      {/* Enable Toggle */}
      <SettingsToggle
        variant="enable"
        name="Enable KimiClaw"
        description="Enable KimiClaw agent provider"
        checked={config.enabled}
        onChange={onToggle}
      />

      {config.enabled && (
        <>
          {/* Connection */}
          <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)]">
            <h4 className="text-base font-semibold mb-3 text-[var(--nim-text)]">Connection</h4>
            <div className="flex flex-col gap-1.5 mb-4">
              <label className="text-sm font-medium text-[var(--nim-text)]">Endpoint URL</label>
              <input
                type="text"
                value={kc.endpointUrl}
                onChange={(e) => handleConfigUpdate({ endpointUrl: e.target.value })}
                className="py-2 px-3 rounded-md bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] text-[var(--nim-text)] font-mono text-sm focus:border-[var(--nim-primary)] outline-none"
              />
              <p className="text-xs text-[var(--nim-text-muted)]">Default: http://127.0.0.1:9643</p>
            </div>
            <button
              className={`inline-flex items-center py-2 px-4 rounded-md text-sm font-medium border transition-all
                ${healthStatus === 'success' ? 'border-[var(--nim-success)] text-[var(--nim-success)]' : ''}
                ${healthStatus === 'error' ? 'border-[var(--nim-error)] text-[var(--nim-error)]' : ''}
                ${healthStatus === 'idle' || healthStatus === 'checking' ? 'border-[var(--nim-border)] text-[var(--nim-text)]' : ''}
              `}
              onClick={handleHealthCheck}
              disabled={healthStatus === 'checking'}
            >
              {healthStatus === 'checking' ? 'Checking...' : healthText}
            </button>
          </div>

          {/* Authentication */}
          <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)]">
            <h4 className="text-base font-semibold mb-3 text-[var(--nim-text)]">Authentication</h4>
            <div className="flex gap-6 mb-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="kc-auth" value="cookie" checked={kc.authMethod === 'cookie'}
                  onChange={() => handleConfigUpdate({ authMethod: 'cookie' })} className="accent-[var(--nim-primary)]" />
                <span className="text-sm text-[var(--nim-text)]">Cookie session</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="kc-auth" value="bearer" checked={kc.authMethod === 'bearer'}
                  onChange={() => handleConfigUpdate({ authMethod: 'bearer' })} className="accent-[var(--nim-primary)]" />
                <span className="text-sm text-[var(--nim-text)]">Bearer token</span>
              </label>
            </div>

            {kc.authMethod === 'cookie' && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-[var(--nim-text)]">Username</label>
                  <input type="text" value={kc.username}
                    onChange={(e) => handleConfigUpdate({ username: e.target.value })}
                    className="py-2 px-3 rounded-md bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] text-[var(--nim-text)] text-sm focus:border-[var(--nim-primary)] outline-none" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-[var(--nim-text)]">Password</label>
                  <input type="password" value={kc.password}
                    onChange={(e) => handleConfigUpdate({ password: e.target.value })}
                    className="py-2 px-3 rounded-md bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] text-[var(--nim-text)] text-sm focus:border-[var(--nim-primary)] outline-none" />
                </div>
              </div>
            )}

            {kc.authMethod === 'bearer' && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-[var(--nim-text)]">Bearer Token</label>
                  <input type="password" value={kc.bearerToken}
                    onChange={(e) => handleConfigUpdate({ bearerToken: e.target.value })}
                    className="py-2 px-3 rounded-md bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] text-[var(--nim-text)] text-sm focus:border-[var(--nim-primary)] outline-none" />
                </div>
                <button
                  className="inline-flex items-center py-2 px-4 rounded-md text-sm font-medium border border-[var(--nim-border)] text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)] transition-all"
                  onClick={handleGenerateToken}
                  disabled={tokenGenStatus === 'generating'}
                >
                  <MaterialSymbol icon="key" size={16} className="mr-1.5" />
                  {tokenGenStatus === 'generating' ? 'Generating...' : 'Generate Bearer Token'}
                </button>
                {tokenGenMessage && (
                  <span className={`text-xs ${tokenGenStatus === 'success' ? 'text-[var(--nim-success)]' : 'text-[var(--nim-error)]'}`}>
                    {tokenGenMessage}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Swarm Defaults */}
          <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)]">
            <h4 className="text-base font-semibold mb-3 text-[var(--nim-text)]">Swarm Defaults</h4>
            <div className="flex flex-col gap-1.5 mb-4">
              <label className="text-sm font-medium text-[var(--nim-text)]">Default mode</label>
              <select value={kc.defaultMode}
                onChange={(e) => handleConfigUpdate({ defaultMode: e.target.value as DefaultMode })}
                className="py-2 px-3 rounded-md bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] text-[var(--nim-text)] text-sm focus:border-[var(--nim-primary)] outline-none">
                <option value="crew">Crew (persona)</option>
                <option value="classic">Classic</option>
              </select>
            </div>
            <div className="flex gap-4">
              <div className="flex flex-col gap-1.5 flex-1">
                <label className="text-sm font-medium text-[var(--nim-text)]">Max agents</label>
                <input type="number" min={1} max={32} value={kc.maxAgents}
                  onChange={(e) => handleConfigUpdate({ maxAgents: parseInt(e.target.value, 10) })}
                  className="py-2 px-3 rounded-md bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] text-[var(--nim-text)] text-sm focus:border-[var(--nim-primary)] outline-none" />
              </div>
              <div className="flex flex-col gap-1.5 flex-1">
                <label className="text-sm font-medium text-[var(--nim-text)]">Max steps</label>
                <input type="number" min={1} max={100} value={kc.maxSteps}
                  onChange={(e) => handleConfigUpdate({ maxSteps: parseInt(e.target.value, 10) })}
                  className="py-2 px-3 rounded-md bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] text-[var(--nim-text)] text-sm focus:border-[var(--nim-primary)] outline-none" />
              </div>
              <div className="flex flex-col gap-1.5 flex-1">
                <label className="text-sm font-medium text-[var(--nim-text)]">Max parallel</label>
                <input type="number" min={1} max={32}
                  value={kc.maxParallel ?? ''}
                  placeholder="Default"
                  onChange={(e) => handleConfigUpdate({ maxParallel: e.target.value ? parseInt(e.target.value, 10) : null })}
                  className="py-2 px-3 rounded-md bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] text-[var(--nim-text)] text-sm focus:border-[var(--nim-primary)] outline-none" />
              </div>
            </div>
          </div>

          {/* Verbose Logging */}
          <div className="provider-panel-section py-4">
            <SettingsToggle
              variant="standard"
              name="Verbose swarm logging"
              description="Render every raw SSE event in the transcript (for debugging cascade tier transitions)"
              checked={kc.verboseLogging}
              onChange={(checked) => handleConfigUpdate({ verboseLogging: checked })}
            />
          </div>

          {/* Lumpy streaming notice */}
          <div className="mt-4 p-3 rounded-md bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)]">
            <div className="flex items-start gap-2">
              <MaterialSymbol icon="info" size={16} className="text-[var(--nim-text-muted)] mt-0.5 shrink-0" />
              <div className="text-xs text-[var(--nim-text-muted)]">
                <strong>Streaming:</strong> KCS emits full agent outputs, not individual tokens.
                You will see progress placeholders followed by content blobs.
                This is an architectural limitation of KCS — smooth token streaming
                would require KCS-side changes.
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
