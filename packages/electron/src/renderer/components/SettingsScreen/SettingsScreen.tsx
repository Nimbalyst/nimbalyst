import React, { useState, useEffect } from 'react';
import './SettingsScreen.css';
import OnboardingService from '../../services/OnboardingService';

export interface SettingsScreenProps {
  workspacePath: string;
  workspaceName: string;
  onClose: () => void;
  isFirstTime?: boolean;
}

interface SetupAction {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  action: () => Promise<void>;
}

const SettingsScreen: React.FC<SettingsScreenProps> = ({
  workspacePath,
  workspaceName,
  onClose,
  isFirstTime = false,
}) => {
  const [actions, setActions] = useState<SetupAction[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Helper functions
  const checkFileExists = async (relativePath: string): Promise<boolean> => {
    try {
      const fullPath = `${workspacePath}/${relativePath}`;
      const result = await window.electronAPI.readFileContent(fullPath);
      const exists = !!(result && result.content);
      console.log(`[SettingsScreen] File check for ${relativePath}:`, exists);
      return exists;
    } catch (err) {
      console.log(`[SettingsScreen] File check for ${relativePath}: false (error:`, err, ')');
      return false;
    }
  };

  const checkCLAUDEmdConfigured = async (): Promise<boolean> => {
    try {
      const claudeMdPath = `${workspacePath}/CLAUDE.md`;
      const result = await window.electronAPI.readFileContent(claudeMdPath);
      if (result && result.content) {
        return result.content.includes('## Nimbalyst Planning System');
      }
      return false;
    } catch {
      return false;
    }
  };

  // Check which actions are already completed
  const checkActionStatus = async () => {
    try {
      const planCommandExists = await checkFileExists('.claude/commands/plan.md');
      const trackCommandExists = await checkFileExists('.claude/commands/track.md');
      const trackBugCommandExists = await checkFileExists('.claude/commands/track-bug.md');
      const trackIdeaCommandExists = await checkFileExists('.claude/commands/track-idea.md');
      const claudeMdConfigured = await checkCLAUDEmdConfigured();
      const bugsTrackerExists = await checkFileExists('nimbalyst-local/tracker/bugs.md');
      const tasksTrackerExists = await checkFileExists('nimbalyst-local/tracker/tasks.md');
      const ideasTrackerExists = await checkFileExists('nimbalyst-local/tracker/ideas.md');
      const decisionsTrackerExists = await checkFileExists('nimbalyst-local/tracker/decisions.md');

      setActions([
        {
          id: 'plan-command',
          title: 'Install /plan command',
          description: 'Create plan documents with proper structure and frontmatter',
          completed: planCommandExists,
          action: async () => {
            await OnboardingService.installPlanCommand(workspacePath, 'nimbalyst-local/plans');
          },
        },
        {
          id: 'track-command',
          title: 'Install /track command',
          description: 'Create tracking items for bugs, tasks, and ideas',
          completed: trackCommandExists,
          action: async () => {
            await OnboardingService.installTrackCommand(workspacePath);
          },
        },
        {
          id: 'track-bug-command',
          title: 'Install /track-bug command',
          description: 'Quick bug tracking with context awareness',
          completed: trackBugCommandExists,
          action: async () => {
            await OnboardingService.installTrackBugCommand(workspacePath);
          },
        },
        {
          id: 'track-idea-command',
          title: 'Install /track-idea command',
          description: 'Quick idea tracking with context awareness',
          completed: trackIdeaCommandExists,
          action: async () => {
            await OnboardingService.installTrackIdeaCommand(workspacePath);
          },
        },
        {
          id: 'claude-md',
          title: 'Configure CLAUDE.md',
          description: 'Add Nimbalyst-specific instructions for Claude Code',
          completed: claudeMdConfigured,
          action: async () => {
            await OnboardingService.configureCLAUDEmd(workspacePath);
          },
        },
        {
          id: 'bugs-tracker',
          title: 'Create bugs tracker',
          description: 'Set up tracker document for bugs and issues',
          completed: bugsTrackerExists,
          action: async () => {
            await OnboardingService.createTrackerDocument(workspacePath, 'bugs');
          },
        },
        {
          id: 'tasks-tracker',
          title: 'Create tasks tracker',
          description: 'Set up tracker document for tasks and todos',
          completed: tasksTrackerExists,
          action: async () => {
            await OnboardingService.createTrackerDocument(workspacePath, 'tasks');
          },
        },
        {
          id: 'ideas-tracker',
          title: 'Create ideas tracker',
          description: 'Set up tracker document for feature ideas and improvements',
          completed: ideasTrackerExists,
          action: async () => {
            await OnboardingService.createTrackerDocument(workspacePath, 'ideas');
          },
        },
        {
          id: 'decisions-tracker',
          title: 'Create decisions tracker',
          description: 'Set up tracker document for architecture and design decisions',
          completed: decisionsTrackerExists,
          action: async () => {
            await OnboardingService.createTrackerDocument(workspacePath, 'decisions');
          },
        },
      ]);
    } catch (err) {
      console.error('Failed to check action status:', err);
    }
  };

  // Load action status on mount
  useEffect(() => {
    checkActionStatus();
  }, [workspacePath]);

  const handleRunAction = async (actionId: string) => {
    const action = actions.find(a => a.id === actionId);
    if (!action || action.completed) return;

    setError(null);
    setSuccess(null);
    setIsProcessing(true);

    try {
      await action.action();
      setSuccess(`${action.title} completed!`);

      // Longer delay to ensure file system has synced and IPC has completed
      await new Promise(resolve => setTimeout(resolve, 500));

      // Refresh action status
      await checkActionStatus();

      // Clear success message after 3 seconds (longer so user can see it)
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error(`Failed to execute action ${action.id}:`, err);
      setError(err instanceof Error ? err.message : `Failed to ${action.title}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleInstallAll = async () => {
    setError(null);
    setSuccess(null);
    setIsProcessing(true);

    try {
      // Ensure base directories exist
      await OnboardingService.ensurePlansDirectory(workspacePath, 'nimbalyst-local/plans');
      await OnboardingService.configureGitignore(workspacePath, 'nimbalyst-local');

      // Run all incomplete actions
      const incompleteActions = actions.filter(a => !a.completed);
      for (const action of incompleteActions) {
        try {
          await action.action();
        } catch (err) {
          console.error(`Failed to ${action.title}:`, err);
          // Continue with other actions even if one fails
        }
      }

      setSuccess('All setup actions completed!');

      // Refresh action status
      await checkActionStatus();

      // Clear success message after 2 seconds
      setTimeout(() => setSuccess(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to install all');
    } finally {
      setIsProcessing(false);
    }
  };

  const completedCount = actions.filter(a => a.completed).length;
  const totalCount = actions.length;

  return (
    <div className="settings-screen">
      <div className="settings-header">
        <h2>
          <span className="material-symbols-outlined">settings</span>
          Claude Code Setup
        </h2>
        <button className="settings-close" onClick={onClose} title="Close settings">
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>

      <div className="settings-content">
        <div className="settings-intro">
          <p>Configure your workspace to work seamlessly with Claude Code.</p>
          <div className="settings-progress">
            <span className="progress-text">{completedCount} of {totalCount} completed</span>
            {completedCount < totalCount && (
              <button
                className="install-all-button"
                onClick={handleInstallAll}
                disabled={isProcessing}
              >
                <span className="material-symbols-outlined">download</span>
                Install All
              </button>
            )}
          </div>
        </div>

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
            <span className="material-symbols-outlined">smart_toy</span>
            Claude Code Commands
          </h3>
          <p className="settings-help">
            Custom slash commands that teach Claude Code about Nimbalyst's planning system.
          </p>

          <div className="action-cards">
            {actions.slice(0, 5).map(action => (
              <div key={action.id} className={`action-card ${action.completed ? 'completed' : ''}`}>
                <div className="action-card-header">
                  <div className="action-checkbox">
                    <input
                      type="checkbox"
                      checked={action.completed}
                      readOnly
                    />
                  </div>
                  <div className="action-info">
                    <h4>{action.title}</h4>
                    <p>{action.description}</p>
                  </div>
                </div>
                {!action.completed && (
                  <button
                    className="action-install-button"
                    onClick={() => handleRunAction(action.id)}
                    disabled={isProcessing}
                  >
                    Install
                  </button>
                )}
                {action.completed && (
                  <div className="action-completed-badge">
                    <span className="material-symbols-outlined">check_circle</span>
                    Installed
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="settings-section">
          <h3>
            <span className="material-symbols-outlined">bookmark</span>
            Tracker Documents
          </h3>
          <p className="settings-help">
            Pre-configured tracker documents for organizing bugs, tasks, ideas, and decisions.
          </p>

          <div className="action-cards">
            {actions.slice(5).map(action => (
              <div key={action.id} className={`action-card ${action.completed ? 'completed' : ''}`}>
                <div className="action-card-header">
                  <div className="action-checkbox">
                    <input
                      type="checkbox"
                      checked={action.completed}
                      readOnly
                    />
                  </div>
                  <div className="action-info">
                    <h4>{action.title}</h4>
                    <p>{action.description}</p>
                  </div>
                </div>
                {!action.completed && (
                  <button
                    className="action-install-button"
                    onClick={() => handleRunAction(action.id)}
                    disabled={isProcessing}
                  >
                    Create
                  </button>
                )}
                {action.completed && (
                  <div className="action-completed-badge">
                    <span className="material-symbols-outlined">check_circle</span>
                    Created
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsScreen;
