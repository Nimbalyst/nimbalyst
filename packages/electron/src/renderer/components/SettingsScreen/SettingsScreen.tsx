import React, { useState, useEffect } from 'react';
import './SettingsScreen.css';
import OnboardingService from '../../services/OnboardingService';

export interface SettingsScreenProps {
  workspacePath: string;
  workspaceName: string;
  onClose: () => void;
  isFirstTime?: boolean;
}

const SettingsScreen: React.FC<SettingsScreenProps> = ({
  workspacePath,
  workspaceName,
  onClose,
  isFirstTime = false,
}) => {
  const [plansDirectory, setPlansDirectory] = useState('nimbalyst-local');
  const [enableClaudeCode, setEnableClaudeCode] = useState(false);
  const [installPlanCommand, setInstallPlanCommand] = useState(true);
  const [installTrackCommand, setInstallTrackCommand] = useState(true);
  const [configureCLAUDEmd, setConfigureCLAUDEmd] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Load existing config on mount
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const config = await OnboardingService.loadConfig(workspacePath);

        // Extract directory name from plansLocation (e.g., "nimbalyst-local/plans" -> "nimbalyst-local")
        if (config.plansLocation) {
          const parts = config.plansLocation.split('/');
          setPlansDirectory(parts[0] || 'nimbalyst-local');
        }

        setEnableClaudeCode(config.claudeCodeIntegration.enabled);
      } catch (err) {
        console.error('Failed to load config:', err);
      }
    };

    loadConfig();
  }, [workspacePath]);

  const handleSave = async () => {
    setError(null);
    setSuccess(null);
    setIsProcessing(true);

    try {
      const config = await OnboardingService.loadConfig(workspacePath);

      // Update plans location
      const plansLocation = `${plansDirectory}/plans`;
      config.plansLocation = plansLocation;
      config.checkInPlans = false; // Always gitignored

      // Configure .gitignore
      await OnboardingService.configureGitignore(workspacePath, plansDirectory);

      // Create plans directory
      await OnboardingService.ensurePlansDirectory(workspacePath, plansLocation);

      // Configure Claude Code if enabled
      if (enableClaudeCode) {
        if (installPlanCommand) {
          await OnboardingService.installPlanCommand(workspacePath, plansLocation);
        }
        if (installTrackCommand) {
          await OnboardingService.installTrackCommand(workspacePath);
        }
        if (configureCLAUDEmd) {
          await OnboardingService.configureCLAUDEmd(workspacePath);
        }

        config.claudeCodeIntegration.enabled = true;
        config.claudeCodeIntegration.planCommandInstalled = installPlanCommand;
        config.claudeCodeIntegration.trackCommandInstalled = installTrackCommand;
        config.claudeCodeIntegration.claudeMdConfigured = configureCLAUDEmd;
      } else {
        config.claudeCodeIntegration.enabled = false;
      }

      // Mark onboarding as completed if first time
      if (isFirstTime) {
        config.onboardingCompleted = true;
      }

      // Save config
      await OnboardingService.saveConfig(workspacePath, config);

      setSuccess('Settings saved successfully!');

      // Close after a brief delay
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCreateExamplePlan = async () => {
    setIsProcessing(true);
    setError(null);

    try {
      const planPath = await OnboardingService.createExamplePlan(workspacePath);
      window.electronAPI.send('open-file', planPath);
      setSuccess('Example plan created!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create example plan');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="settings-screen">
      <div className="settings-header">
        <h2>
          <span className="material-symbols-outlined">settings</span>
          Project Settings
        </h2>
        <button className="settings-close" onClick={onClose} title="Close settings">
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>

      <div className="settings-content">
        {isFirstTime && (
          <div className="settings-welcome">
            <h3>Welcome to {workspaceName}!</h3>
            <p>Configure your project below to get started with Preditor's planning and tracking features.</p>
          </div>
        )}

        {error && (
          <div className="settings-message error">
            <span className="material-symbols-outlined">error</span>
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="settings-message success">
            <span className="material-symbols-outlined">check_circle</span>
            <span>{success}</span>
          </div>
        )}

        <div className="settings-section">
          <h3>
            <span className="material-symbols-outlined">folder</span>
            Plans Directory
          </h3>
          <div className="settings-field">
            <input
              type="text"
              value={plansDirectory}
              onChange={(e) => setPlansDirectory(e.target.value)}
              placeholder="nimbalyst-local"
              className="settings-input"
            />
            <p className="settings-help">
              Plans will be stored in <code>{plansDirectory}/plans</code> and added to .gitignore.
              You can move plans later if you want to check them into version control.
            </p>
          </div>
        </div>

        <div className="settings-section">
          <h3>
            <span className="material-symbols-outlined">smart_toy</span>
            Claude Code Integration
          </h3>
          <p className="settings-help">
            Configure Claude Code to understand Preditor's extended markdown features for plans and tracking.
          </p>

          <div className="settings-field">
            <label className="settings-checkbox-with-description">
              <div className="checkbox-row">
                <input
                  type="checkbox"
                  checked={enableClaudeCode}
                  onChange={(e) => setEnableClaudeCode(e.target.checked)}
                />
                <span className="checkbox-label">Enable Claude Code integration</span>
              </div>
            </label>

            {enableClaudeCode && (
              <div className="settings-subsection">
                <label className="settings-checkbox-with-description">
                  <div className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={installPlanCommand}
                      onChange={(e) => setInstallPlanCommand(e.target.checked)}
                    />
                    <div className="checkbox-content">
                      <span className="checkbox-label">Install /plan command</span>
                      <span className="checkbox-description">Create plan documents with proper structure</span>
                    </div>
                  </div>
                </label>

                <label className="settings-checkbox-with-description">
                  <div className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={installTrackCommand}
                      onChange={(e) => setInstallTrackCommand(e.target.checked)}
                    />
                    <div className="checkbox-content">
                      <span className="checkbox-label">Install /track command</span>
                      <span className="checkbox-description">Create tracking items (bugs, tasks, ideas)</span>
                    </div>
                  </div>
                </label>

                <label className="settings-checkbox-with-description">
                  <div className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={configureCLAUDEmd}
                      onChange={(e) => setConfigureCLAUDEmd(e.target.checked)}
                    />
                    <div className="checkbox-content">
                      <span className="checkbox-label">Configure CLAUDE.md</span>
                      <span className="checkbox-description">Add Preditor-specific instructions</span>
                    </div>
                  </div>
                </label>
              </div>
            )}
          </div>
        </div>

        {isFirstTime && (
          <div className="settings-section">
            <h3>
              <span className="material-symbols-outlined">description</span>
              Quick Start
            </h3>
            <button
              className="settings-button secondary"
              onClick={handleCreateExamplePlan}
              disabled={isProcessing}
            >
              <span className="material-symbols-outlined">add_circle</span>
              Create Example Plan
            </button>
            <p className="settings-help">
              Create a sample plan to see how the planning system works.
            </p>
          </div>
        )}
      </div>

      <div className="settings-footer">
        <button
          className="settings-button secondary"
          onClick={onClose}
          disabled={isProcessing}
        >
          Cancel
        </button>
        <button
          className="settings-button primary"
          onClick={handleSave}
          disabled={isProcessing}
        >
          {isProcessing ? 'Saving...' : isFirstTime ? 'Get Started' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
};

export default SettingsScreen;
