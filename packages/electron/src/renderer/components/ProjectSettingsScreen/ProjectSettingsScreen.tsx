import React, { useState, useEffect } from 'react';
import './ProjectSettingsScreen.css';
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

const ProjectSettingsScreen: React.FC<SettingsScreenProps> = ({
  workspacePath,
  workspaceName,
  onClose,
  isFirstTime = false,
}) => {
  const [actions, setActions] = useState<SetupAction[]>([]);
  const [commandsLocation, setCommandsLocation] = useState<'project' | 'global'>('project');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [hoveredActionId, setHoveredActionId] = useState<string | null>(null);

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
      const claudeMdConfigured = await checkCLAUDEmdConfigured();
      const bugsTrackerExists = await checkFileExists('nimbalyst-local/tracker/bugs.md');
      const tasksTrackerExists = await checkFileExists('nimbalyst-local/tracker/tasks.md');
      const ideasTrackerExists = await checkFileExists('nimbalyst-local/tracker/ideas.md');
      const decisionsTrackerExists = await checkFileExists('nimbalyst-local/tracker/decisions.md');

      setActions([
        {
          id: 'plan-command',
          title: '/plan command',
          description: 'Create and track plans across your project',
          completed: planCommandExists,
          action: async () => {
            await OnboardingService.installPlanCommand(workspacePath, 'nimbalyst-local/plans');
          },
        },
        {
          id: 'track-command',
          title: '/track command',
          description: 'Create tracking items for bugs, tasks, and ideas',
          completed: trackCommandExists,
          action: async () => {
            await OnboardingService.installTrackCommand(workspacePath);
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
          title: 'Bugs',
          description: 'Track bugs and issues',
          completed: bugsTrackerExists,
          action: async () => {
            await OnboardingService.createTrackerDocument(workspacePath, 'bugs');
          },
        },
        {
          id: 'tasks-tracker',
          title: 'Tasks',
          description: 'Track tasks and todos',
          completed: tasksTrackerExists,
          action: async () => {
            await OnboardingService.createTrackerDocument(workspacePath, 'tasks');
          },
        },
        {
          id: 'ideas-tracker',
          title: 'Ideas',
          description: 'Track feature ideas',
          completed: ideasTrackerExists,
          action: async () => {
            await OnboardingService.createTrackerDocument(workspacePath, 'ideas');
          },
        },
        {
          id: 'decisions-tracker',
          title: 'Decisions',
          description: 'Track architecture decisions',
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

  // Load action status and commands location on mount
  useEffect(() => {
    const loadSettings = async () => {
      await checkActionStatus();

      // Load commands location from config
      try {
        const config = await OnboardingService.loadConfig(workspacePath);
        setCommandsLocation(config.commandsLocation || 'project');
      } catch (err) {
        console.error('Failed to load commands location:', err);
      }
    };

    loadSettings();
  }, [workspacePath]);

  const handleChangeCommandsLocation = async (newLocation: 'project' | 'global') => {
    setError(null);
    setSuccess(null);
    setIsProcessing(true);

    try {
      const config = await OnboardingService.loadConfig(workspacePath);
      config.commandsLocation = newLocation;
      await OnboardingService.saveConfig(workspacePath, config);
      setCommandsLocation(newLocation);
      setSuccess(`Commands location changed to ${newLocation === 'project' ? 'project (.claude/)' : 'global (~/.claude/)'}`);

      // Refresh action status
      await checkActionStatus();

      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('Failed to change commands location:', err);
      setError(err instanceof Error ? err.message : 'Failed to change commands location');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRunAction = async (actionId: string) => {
    const action = actions.find(a => a.id === actionId);
    if (!action) return;

    setError(null);
    setSuccess(null);
    setIsProcessing(true);

    const wasCompleted = action.completed;

    try {
      await action.action();
      const verb = wasCompleted ? 'reinstalled' : 'completed';
      setSuccess(`${action.title} ${verb}!`);

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
          Claude Code Setup for {workspaceName}
        </h2>
        <div className="settings-header-actions">
          <button className="button-get-started" onClick={onClose}>
            Get Started
          </button>
          <button className="settings-close" onClick={onClose} title="Close settings">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>

      <div className="settings-content">
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
          <div className="section-header-row">
            <div>
              <h3>Commands Location</h3>
              <p className="settings-help">Install for this project or your user directory</p>
            </div>
            <div className="header-actions">
              <div className="location-tabs">
                <button
                  className={`location-tab ${commandsLocation === 'project' ? 'active' : ''}`}
                  onClick={() => handleChangeCommandsLocation('project')}
                  disabled={isProcessing}
                >
                  Project
                </button>
                <button
                  className={`location-tab ${commandsLocation === 'global' ? 'active' : ''}`}
                  onClick={() => handleChangeCommandsLocation('global')}
                  disabled={isProcessing}
                >
                  Global
                </button>
              </div>
              {completedCount < totalCount && (
                <button
                  className="install-all-button"
                  onClick={handleInstallAll}
                  disabled={isProcessing}
                >
                  Install All
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="settings-section">
          <h3>Claude Code Commands</h3>

          <div className="action-cards">
            {actions.slice(0, 3).map(action => (
              <div
                key={action.id}
                className={`action-card ${action.completed ? 'completed' : ''}`}
                onMouseEnter={() => setHoveredActionId(action.id)}
                onMouseLeave={() => setHoveredActionId(null)}
              >
                <div className="action-info">
                  <h4>{action.title}</h4>
                  <p>{action.description}</p>
                </div>
                {!action.completed ? (
                  <button
                    className="action-install-button"
                    onClick={() => handleRunAction(action.id)}
                    disabled={isProcessing}
                  >
                    Install
                  </button>
                ) : hoveredActionId === action.id ? (
                  <button
                    className="action-reinstall-button"
                    onClick={() => handleRunAction(action.id)}
                    disabled={isProcessing}
                  >
                    Reinstall
                  </button>
                ) : (
                  <span className="action-status">Installed</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="settings-section">
          <h3>Tracker Documents</h3>
          <p className="settings-help">Select which types of items you want to track</p>

          <div className="action-cards">
            {actions.slice(3).map(action => (
              <div
                key={action.id}
                className={`action-card ${action.completed ? 'completed' : ''}`}
                onMouseEnter={() => setHoveredActionId(action.id)}
                onMouseLeave={() => setHoveredActionId(null)}
              >
                <div className="action-info">
                  <h4>{action.title}</h4>
                  <p>{action.description}</p>
                </div>
                {!action.completed ? (
                  <button
                    className="action-install-button"
                    onClick={() => handleRunAction(action.id)}
                    disabled={isProcessing}
                  >
                    Create
                  </button>
                ) : hoveredActionId === action.id ? (
                  <button
                    className="action-reinstall-button"
                    onClick={() => handleRunAction(action.id)}
                    disabled={isProcessing}
                  >
                    Recreate
                  </button>
                ) : (
                  <span className="action-status">Created</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProjectSettingsScreen;
