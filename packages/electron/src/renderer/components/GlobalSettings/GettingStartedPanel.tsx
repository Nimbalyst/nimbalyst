import React from 'react';
import './GettingStartedPanel.css';

interface ClaudeCodeStatus {
  installed: boolean;
  loggedIn: boolean;
  version?: string;
  hasSession?: boolean;
  hasApiKey?: boolean;
}

export function GettingStartedPanel() {
  // const [status, setStatus] = useState<ClaudeCodeStatus | null>(null);
  // const [isChecking, setIsChecking] = useState(false);

  // useEffect(() => {
  //   checkStatus();
  // }, []);

  // const checkStatus = async () => {
  //   setIsChecking(true);
  //   try {
  //     // const result = await window.electronAPI.invoke('claude-code:get-status');
  //     // setStatus(result);
  //   } catch (error) {
  //     console.error('Failed to check Claude Code status:', error);
  //     setStatus({
  //       installed: false,
  //       loggedIn: false,
  //     });
  //   } finally {
  //     setIsChecking(false);
  //   }
  // };

  // const handleRefreshStatus = async () => {
  //   setIsChecking(true);
  //   try {
  //     const result = await window.electronAPI.invoke('claude-code:refresh-status');
  //     setStatus(result);
  //   } catch (error) {
  //     console.error('Failed to refresh Claude Code status:', error);
  //   } finally {
  //     setIsChecking(false);
  //   }
  // };

  // const handleOpenDocs = () => {
  //   window.electronAPI.invoke('open-external', 'https://docs.claude.com/en/docs/claude-code/quickstart#native-install');
  // };

  // const handleGetStarted = () => {
  //   // Close the AI Models window - user is ready to start
  //   window.close();
  // };

  // const isReady = status?.installed && status?.loggedIn;

  return (
    <div className="getting-started-panel">
      <div className="getting-started-header">
        <h2>Getting Started with Nimbalyst</h2>
        <h3 className="section-description">
          Nimbalyst uses AI in two ways:
        </h3>
      </div>

      <div className="getting-started-section">

        <div className="ai-types-grid">
          <div className="ai-type-card">
            <div className="ai-type-header">
              <span className="material-symbols-outlined ai-type-icon">smart_toy</span>
              <h4>Agents</h4>
            </div>
            <div className="ai-type-content">
              <p className="ai-type-name">Claude Code (agentic coding and more)</p>
              <ul className="ai-type-features">
                <li>Agentic project research</li>
                <li>Multi-file read and write</li>
                <li>Plan-based development</li>
                <li>Documentation writing</li>
                <li>Autonomous code editing</li>
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
                <li>Edit a single document with AI</li>
                <li>Diverse model options</li>
                <li><ul>
                  <li>Claude</li>
                  <li>OpenAI GPT</li>
                  <li>local models with LMStudio</li>
                </ul>
                </li>
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
        <h3>Here are the steps to configure Nimbalyst for AI</h3>

        <div className="setup-steps-list">
          <div className="setup-step-item">
            <div className="step-number">1</div>
            <div className="step-content">
              <h4>Claude Code must be installed and Authenticated</h4>
              <p>Click on Claude Code section to the left for details</p>
            </div>
          </div>

          <div className="setup-step-item">
            <div className="step-number">2</div>
            <div className="step-content">
              <h4>Configure AI Model Integration (optional)</h4>
              <p>On the left, click on whichever additional models you wish to configure</p>
            </div>
          </div>

          <div className="setup-step-item">
            <div className="step-number">3</div>
            <div className="step-content">
              <h4>Configure CLAUDE.md and Claude commands for each project (optional)</h4>
              <p>You will be prompted to do this when you open each project for the first time</p>
            </div>
          </div>
        </div>
      </div>

      {/* <div className="getting-started-section">
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
                <div className="status-actions">
                  <button className="primary-button" onClick={handleGetStarted}>
                    <span className="material-symbols-outlined">rocket_launch</span>
                    Get Started
                  </button>
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
                        <h5>Claude Code CLI not installed</h5>
                        <p>To use agentic coding features, install Claude Code CLI and log in with your Anthropic account.</p>
                      </div>
                    </div>
                  ) : !status.loggedIn ? (
                    <div className="setup-step">
                      <span className="material-symbols-outlined step-icon">info</span>
                      <div>
                        <h5>Login required</h5>
                        <p>Claude Code is installed but you need to log in with your Anthropic account.</p>
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
      </div> */}
    </div>
  );
}
