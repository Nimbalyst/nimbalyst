import React, { useState, useEffect } from 'react';
import './GettingStartedPanel.css';

interface ClaudeCodeStatus {
  installed: boolean;
  loggedIn: boolean;
  version?: string;
  hasSession?: boolean;
  hasApiKey?: boolean;
}

interface GettingStartedPanelProps {
  onContinue?: () => void;
}

export function GettingStartedPanel({ onContinue }: GettingStartedPanelProps) {
  const [status, setStatus] = useState<ClaudeCodeStatus | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    checkStatus();
  }, []);

  const checkStatus = async () => {
    setIsChecking(true);
    try {
      const result = await window.electronAPI.invoke('claude-code:get-status');
      setStatus(result);
    } catch (error) {
      console.error('Failed to check Claude Code status:', error);
      setStatus({
        installed: false,
        loggedIn: false,
      });
    } finally {
      setIsChecking(false);
    }
  };

  const handleRefreshStatus = async () => {
    setIsChecking(true);
    try {
      const result = await window.electronAPI.invoke('claude-code:refresh-status');
      setStatus(result);
    } catch (error) {
      console.error('Failed to refresh Claude Code status:', error);
    } finally {
      setIsChecking(false);
    }
  };

  const handleOpenDocs = () => {
    window.electronAPI.invoke('open-external', 'https://docs.claude.com/en/docs/claude-code/quickstart');
  };

  const isReady = status?.installed && status?.loggedIn;

  return (
    <div className="getting-started-panel">
      <div className="getting-started-header">
        <h2>Getting Started with Nimbalyst</h2>
        <p className="getting-started-subtitle">
          Set up your AI coding assistant in minutes
        </p>
      </div>

      <div className="getting-started-section">
        <h3>Understanding Agents and Models</h3>
        <p className="section-description">
          Nimbalyst uses AI in two ways:
        </p>

        <div className="ai-types-grid">
          <div className="ai-type-card">
            <div className="ai-type-header">
              <span className="material-symbols-outlined ai-type-icon">smart_toy</span>
              <h4>Agents</h4>
            </div>
            <div className="ai-type-content">
              <p className="ai-type-name">Claude Code (agentic coding)</p>
              <ul className="ai-type-features">
                <li>Autonomous code editing</li>
                <li>Multi-file operations</li>
                <li>Plan-based development</li>
              </ul>
              <div className="ai-type-status supported">
                <span className="material-symbols-outlined">check_circle</span>
                <span>Currently supported</span>
              </div>
            </div>
          </div>

          <div className="ai-type-card">
            <div className="ai-type-header">
              <span className="material-symbols-outlined ai-type-icon">chat</span>
              <h4>Models</h4>
            </div>
            <div className="ai-type-content">
              <p className="ai-type-name">Direct AI chat</p>
              <ul className="ai-type-features">
                <li>Claude (Anthropic)</li>
                <li>OpenAI</li>
                <li>LM Studio</li>
              </ul>
              <div className="ai-type-status beta">
                <span className="material-symbols-outlined">science</span>
                <span>Beta</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="getting-started-section">
        <h3>Claude Code Status</h3>

        {isChecking ? (
          <div className="status-loading">
            <div className="loading-spinner"></div>
            <span>Checking installation...</span>
          </div>
        ) : status ? (
          <div className={`claude-code-status ${isReady ? 'ready' : 'not-ready'}`}>
            {isReady ? (
              <div className="status-success">
                <div className="status-icon-row">
                  <span className="material-symbols-outlined status-icon">check_circle</span>
                  <div>
                    <h4>Claude Code is ready!</h4>
                    <p>You can now use agentic coding features.</p>
                    {status.version && (
                      <p className="status-version">Version: {status.version}</p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="status-needs-setup">
                <div className="status-icon-row">
                  <span className="material-symbols-outlined status-icon warning">warning</span>
                  <div>
                    <h4>Claude Code setup needed</h4>
                  </div>
                </div>

                <div className="setup-steps">
                  {!status.installed ? (
                    <div className="setup-step">
                      <span className="material-symbols-outlined step-icon">error</span>
                      <div>
                        <h5>Claude Code CLI not detected</h5>
                        <p>The bundled Claude Agent SDK was not found. This should not happen in a normal installation.</p>
                      </div>
                    </div>
                  ) : !status.loggedIn ? (
                    <div className="setup-step">
                      <span className="material-symbols-outlined step-icon">info</span>
                      <div>
                        <h5>Login required</h5>
                        <p>To use agentic coding features:</p>
                        <ol className="setup-instructions">
                          <li>Log in with your Anthropic account</li>
                          <li>Choose between Claude Pro/Max subscription or API key</li>
                        </ol>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="status-actions">
                  <button className="primary-button" onClick={handleOpenDocs}>
                    <span className="material-symbols-outlined">open_in_new</span>
                    View Claude Code Documentation
                  </button>
                  <button className="secondary-button" onClick={handleRefreshStatus}>
                    <span className="material-symbols-outlined">refresh</span>
                    Check Again
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {isReady && onContinue && (
        <div className="getting-started-footer">
          <button className="continue-button" onClick={onContinue}>
            Continue to Settings
            <span className="material-symbols-outlined">arrow_forward</span>
          </button>
        </div>
      )}
    </div>
  );
}
