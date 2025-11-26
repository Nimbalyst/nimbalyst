import React, { useState, useEffect } from 'react';
import './WelcomeModal.css';
import OnboardingService from '../../services/OnboardingService';

export interface WelcomeModalProps {
  workspacePath: string;
  workspaceName: string;
  onComplete: () => void;
  onSkip: () => void;
}

type Step = 'welcome' | 'plans-location' | 'claude-code' | 'first-plan' | 'plan-view' | 'complete';

const WelcomeModal: React.FC<WelcomeModalProps> = ({
  workspacePath,
  workspaceName,
  onComplete,
  onSkip,
}) => {
  // Skip rendering in Playwright tests
  const isPlaywright = window.PLAYWRIGHT || (window as any).PLAYWRIGHT;

  const [currentStep, setCurrentStep] = useState<Step>('welcome');
  const [plansLocation, setPlansLocation] = useState<'nimbalyst-local/plans' | 'plans' | 'custom'>('nimbalyst-local/plans');
  const [customPlansLocation, setCustomPlansLocation] = useState('');
  const [checkInPlans, setCheckInPlans] = useState(false);
  const [commandsLocation, setCommandsLocation] = useState<'project' | 'global'>('project');
  const [enableClaudeCode, setEnableClaudeCode] = useState(false);
  const [installPlanCommand, setInstallPlanCommand] = useState(true);
  const [installTrackCommand, setInstallTrackCommand] = useState(true);
  const [configureCLAUDEmd, setConfigureCLAUDEmd] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const steps: Step[] = ['welcome', 'plans-location', 'claude-code', 'first-plan', 'plan-view', 'complete'];
  const currentStepIndex = steps.indexOf(currentStep);
  const progress = ((currentStepIndex + 1) / steps.length) * 100;

  const handleNext = async () => {
    setError(null);

    // Handle step-specific actions
    if (currentStep === 'plans-location') {
      setIsProcessing(true);
      try {
        // Save plans location configuration
        const config = await OnboardingService.loadConfig(workspacePath);
        const finalLocation = plansLocation === 'custom' ? customPlansLocation : plansLocation;
        config.plansLocation = finalLocation;
        config.checkInPlans = checkInPlans;
        await OnboardingService.saveConfig(workspacePath, config);

        // Configure .gitignore if needed
        if (!checkInPlans) {
          await OnboardingService.configureGitignore(workspacePath);
        }

        // Create the plans directory
        await OnboardingService.ensurePlansDirectory(workspacePath, finalLocation);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to configure plans location');
        setIsProcessing(false);
        return;
      }
      setIsProcessing(false);
    }

    if (currentStep === 'claude-code' && enableClaudeCode) {
      setIsProcessing(true);
      try {
        // Update config with commands location first
        const config = await OnboardingService.loadConfig(workspacePath);
        config.commandsLocation = commandsLocation;
        config.claudeCodeIntegration.enabled = true;
        await OnboardingService.saveConfig(workspacePath, config);

        // Install selected components
        if (installPlanCommand) {
          await OnboardingService.installPlanCommand(workspacePath);
        }
        if (installTrackCommand) {
          await OnboardingService.installTrackCommand(workspacePath);
        }
        if (configureCLAUDEmd) {
          await OnboardingService.configureCLAUDEmd(workspacePath);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to configure Claude Code');
        setIsProcessing(false);
        return;
      }
      setIsProcessing(false);
    }

    // Move to next step
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < steps.length) {
      setCurrentStep(steps[nextIndex]);
    }
  };

  const handleBack = () => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(steps[prevIndex]);
    }
  };

  const handleSkip = async () => {
    try {
      await OnboardingService.completeOnboarding(workspacePath);
      onSkip();
    } catch (err) {
      console.error('Failed to save onboarding state:', err);
      onSkip();
    }
  };

  const handleComplete = async () => {
    setIsProcessing(true);
    try {
      await OnboardingService.completeOnboarding(workspacePath);
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete onboarding');
    }
    setIsProcessing(false);
  };

  const handleCreateExamplePlan = async () => {
    setIsProcessing(true);
    try {
      const planPath = await OnboardingService.createExamplePlan(workspacePath);
      // Signal to open the plan (we'll implement this in the parent)
      window.electronAPI.send('open-file', planPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create example plan');
    }
    setIsProcessing(false);
  };

  // Don't render in Playwright tests
  if (isPlaywright) {
    return null;
  }

  return (
    <div className="welcome-modal-overlay">
      <div className="welcome-modal">
        {/* Progress Bar */}
        <div className="welcome-modal-progress">
          <div className="welcome-modal-progress-bar" style={{ width: `${progress}%` }} />
        </div>

        {/* Header */}
        <div className="welcome-modal-header">
          <h2>
            {currentStep === 'welcome' && 'Welcome to Nimbalyst'}
            {currentStep === 'plans-location' && 'Configure Plans Location'}
            {currentStep === 'claude-code' && 'Configure Claude Code Integration'}
            {currentStep === 'first-plan' && 'Create Your First Plan'}
            {currentStep === 'plan-view' && 'Explore the Plan View'}
            {currentStep === 'complete' && 'All Set!'}
          </h2>
          <button className="welcome-modal-close" onClick={handleSkip} title="Skip onboarding">
            ×
          </button>
        </div>

        {/* Content */}
        <div className="welcome-modal-content">
          {error && (
            <div className="welcome-modal-error">
              <strong>Error:</strong> {error}
            </div>
          )}

          {currentStep === 'welcome' && (
            <div className="welcome-step">
              <h3>Welcome to {workspaceName}</h3>
              <p>
                Nimbalyst is a powerful editor with integrated planning, tracking, and AI features.
                This quick setup will help you get started.
              </p>
              <div className="welcome-features">
                <div className="welcome-feature">
                  <strong>Planning System</strong>
                  <p>Organize features, bugs, and tasks with structured markdown plans</p>
                </div>
                <div className="welcome-feature">
                  <strong>AI Integration</strong>
                  <p>Work with Claude Code and other AI assistants for enhanced productivity</p>
                </div>
                <div className="welcome-feature">
                  <strong>Progress Tracking</strong>
                  <p>Visual plan view to monitor status and progress across all work items</p>
                </div>
              </div>
            </div>
          )}

          {currentStep === 'plans-location' && (
            <div className="plans-location-step">
              <p className="step-description">
                Where would you like to store your plan documents?
              </p>

              <div className="plan-location-options">
                <label className="plan-location-option">
                  <input
                    type="radio"
                    name="plansLocation"
                    value="nimbalyst-local/plans"
                    checked={plansLocation === 'nimbalyst-local/plans'}
                    onChange={(e) => {
                      setPlansLocation('nimbalyst-local/plans');
                      setCheckInPlans(false);
                    }}
                  />
                  <div className="plan-location-content">
                    <strong>nimbalyst-local/plans</strong> (Recommended)
                    <p>Private plans not checked into version control. Best for personal planning.</p>
                  </div>
                </label>

                <label className="plan-location-option">
                  <input
                    type="radio"
                    name="plansLocation"
                    value="plans"
                    checked={plansLocation === 'plans'}
                    onChange={(e) => {
                      setPlansLocation('plans');
                      setCheckInPlans(true);
                    }}
                  />
                  <div className="plan-location-content">
                    <strong>plans/</strong>
                    <p>Shared plans checked into version control. Best for team collaboration.</p>
                  </div>
                </label>

                <label className="plan-location-option">
                  <input
                    type="radio"
                    name="plansLocation"
                    value="custom"
                    checked={plansLocation === 'custom'}
                    onChange={(e) => setPlansLocation('custom')}
                  />
                  <div className="plan-location-content">
                    <strong>Custom location</strong>
                    <p>Specify your own directory path</p>
                  </div>
                </label>

                {plansLocation === 'custom' && (
                  <div className="custom-location-input">
                    <input
                      type="text"
                      placeholder="e.g., docs/plans or .local/plans"
                      value={customPlansLocation}
                      onChange={(e) => setCustomPlansLocation(e.target.value)}
                    />
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={checkInPlans}
                        onChange={(e) => setCheckInPlans(e.target.checked)}
                      />
                      <span>Check into version control</span>
                    </label>
                  </div>
                )}
              </div>

              <div className="plan-location-info">
                <p><strong>What happens:</strong></p>
                <ul>
                  <li>Plans directory will be created at the specified location</li>
                  {!checkInPlans && (
                    <li>The directory will be added to <code>.gitignore</code> (not checked in)</li>
                  )}
                  {checkInPlans && (
                    <li>Plans will be included in your repository (team collaboration)</li>
                  )}
                </ul>
              </div>
            </div>
          )}

          {currentStep === 'claude-code' && (
            <div className="claude-code-step">
              <p className="step-description">
                Configure Claude Code to understand Nimbalyst's extended markdown features for
                plans and tracking.
              </p>

              <div className="claude-code-option">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={enableClaudeCode}
                    onChange={(e) => setEnableClaudeCode(e.target.checked)}
                  />
                  <span>Enable Claude Code integration</span>
                </label>
              </div>

              {enableClaudeCode && (
                <div className="claude-code-options">
                  <p className="options-intro">Where should commands be installed?</p>

                  <div className="commands-location-options">
                    <label className="plan-location-option">
                      <input
                        type="radio"
                        name="commandsLocation"
                        value="project"
                        checked={commandsLocation === 'project'}
                        onChange={(e) => setCommandsLocation('project')}
                      />
                      <div className="plan-location-content">
                        <strong>Project (.claude/)</strong> (Recommended)
                        <p>Commands stored in project directory, can be checked into version control for team sharing</p>
                      </div>
                    </label>

                    <label className="plan-location-option">
                      <input
                        type="radio"
                        name="commandsLocation"
                        value="global"
                        checked={commandsLocation === 'global'}
                        onChange={(e) => setCommandsLocation('global')}
                      />
                      <div className="plan-location-content">
                        <strong>Global (~/.claude/)</strong>
                        <p>Commands stored in home directory, shared across all projects</p>
                      </div>
                    </label>
                  </div>

                  <p className="options-intro" style={{ marginTop: '1.5rem' }}>Select components to install:</p>

                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={installPlanCommand}
                      onChange={(e) => setInstallPlanCommand(e.target.checked)}
                    />
                    <span>
                      <strong>/plan command</strong> - Create plan documents with proper structure
                    </span>
                  </label>

                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={installTrackCommand}
                      onChange={(e) => setInstallTrackCommand(e.target.checked)}
                    />
                    <span>
                      <strong>/track command</strong> - Create tracking items (bugs, tasks, ideas)
                    </span>
                  </label>

                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={configureCLAUDEmd}
                      onChange={(e) => setConfigureCLAUDEmd(e.target.checked)}
                    />
                    <span>
                      <strong>CLAUDE.md</strong> - Add Nimbalyst-specific instructions
                    </span>
                  </label>

                  <div className="config-info">
                    <p>
                      <strong>What gets installed:</strong>
                    </p>
                    <ul>
                      <li>
                        <code>{commandsLocation === 'project' ? '.claude' : '~/.claude'}/commands/plan.md</code> - Custom slash command
                      </li>
                      <li>
                        <code>{commandsLocation === 'project' ? '.claude' : '~/.claude'}/commands/track.md</code> - Tracking command
                      </li>
                      <li>
                        <code>CLAUDE.md</code> - Planning system documentation
                      </li>
                    </ul>
                  </div>
                </div>
              )}

              {!enableClaudeCode && (
                <div className="skip-info">
                  <p>You can enable Claude Code integration later from project settings.</p>
                </div>
              )}
            </div>
          )}

          {currentStep === 'first-plan' && (
            <div className="first-plan-step">
              <p className="step-description">
                Let's create your first plan document to get familiar with the system.
              </p>

              <div className="plan-options">
                <button className="plan-option-button" onClick={handleCreateExamplePlan}>
                  <div className="plan-option-content">
                    <strong>Create Example Plan</strong>
                    <p>Start with a pre-filled example that shows the plan structure</p>
                  </div>
                </button>

                {enableClaudeCode && (
                  <div className="plan-option-button" onClick={() => {}}>
                    <div className="plan-option-content">
                      <strong>Use Claude Code</strong>
                      <p>
                        Type <code>/plan [your idea]</code> in the AI chat to create a custom plan
                      </p>
                    </div>
                  </div>
                )}

                <div className="plan-option-info">
                  Plans are stored in the <code>plans/</code> directory as markdown files with
                  frontmatter metadata.
                </div>
              </div>
            </div>
          )}

          {currentStep === 'plan-view' && (
            <div className="plan-view-step">
              <p className="step-description">
                The plan view helps you track all your plans, their status, and progress.
              </p>

              <div className="plan-view-features">
                <div className="plan-view-feature">
                  <strong>Status Overview</strong>
                  <p>See all plans grouped by status (draft, in-progress, completed, etc.)</p>
                </div>
                <div className="plan-view-feature">
                  <strong>Filter & Sort</strong>
                  <p>Filter by type, priority, or tags. Sort by date, progress, or priority.</p>
                </div>
                <div className="plan-view-feature">
                  <strong>Progress Tracking</strong>
                  <p>Visual progress bars show completion percentage for each plan</p>
                </div>
              </div>

              <div className="plan-view-access">
                <p>
                  <strong>Access the plan view:</strong>
                </p>
                <ul>
                  <li>View menu → Plans</li>
                  <li>Keyboard shortcut (if configured)</li>
                  <li>Click the plans icon in the sidebar</li>
                </ul>
              </div>
            </div>
          )}

          {currentStep === 'complete' && (
            <div className="complete-step">
              <h3>You're all set!</h3>
              <p>Your workspace is configured and ready to use.</p>

              <div className="next-steps">
                <h4>Next steps:</h4>
                <ul>
                  <li>Explore your example plan document</li>
                  <li>Create your first real plan with {enableClaudeCode ? '/plan' : 'File → New Plan'}</li>
                  <li>Check out the plan view to see all your plans</li>
                  <li>Start organizing your work with the tracking system</li>
                </ul>
              </div>

              <div className="help-links">
                <p>
                  <strong>Need help?</strong>
                </p>
                <p>Access documentation from the Help menu or visit the Nimbalyst website.</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="welcome-modal-footer">
          <div className="welcome-modal-footer-left">
            <button
              className="welcome-modal-button secondary"
              onClick={handleSkip}
              disabled={isProcessing}
            >
              Skip Setup
            </button>
          </div>
          <div className="welcome-modal-footer-right">
            {currentStepIndex > 0 && (
              <button
                className="welcome-modal-button secondary"
                onClick={handleBack}
                disabled={isProcessing}
              >
                Back
              </button>
            )}
            {currentStep !== 'complete' ? (
              <button
                className="welcome-modal-button primary"
                onClick={handleNext}
                disabled={isProcessing}
              >
                {isProcessing ? 'Processing...' : 'Next'}
              </button>
            ) : (
              <button
                className="welcome-modal-button primary"
                onClick={handleComplete}
                disabled={isProcessing}
              >
                {isProcessing ? 'Finishing...' : 'Get Started'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default WelcomeModal;
