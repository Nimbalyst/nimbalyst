import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { usePostHog } from 'posthog-js/react';
import PackageService from '../../services/PackageService';
import type { CustomCommand } from '../../../shared/types/toolPackages';
import './SlashCommandSuggestions.css';

interface CommandWithPackage {
  command: CustomCommand;
  packageId: string;
  packageName: string;
}

export interface SlashCommandSuggestionsProps {
  /** Session provider - only shows for claude-code */
  provider: string;
  /** Whether the session has any messages */
  hasMessages: boolean;
  /** Workspace path for loading commands */
  workspacePath: string;
  /** Session ID (unused but kept for consistency) */
  sessionId?: string;
  /** Callback when a command is selected */
  onCommandSelect: (command: string) => void;
}

/**
 * Shuffle array using Fisher-Yates algorithm
 */
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * SlashCommandSuggestions displays pill buttons for installed Nimbalyst tool packages
 * when a Claude Code session is empty.
 *
 * Only shows commands from packages installed via the Tool Packages screen.
 * Shows a random selection of up to 3 commands initially, with a "(+X)" pill
 * to expand and show all available commands.
 *
 * Clicking a pill populates the input with the slash command.
 */
export const SlashCommandSuggestions: React.FC<SlashCommandSuggestionsProps> = ({
  provider,
  hasMessages,
  workspacePath,
  onCommandSelect
}) => {
  const posthog = usePostHog();
  const [installedCommands, setInstalledCommands] = useState<CommandWithPackage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);

  // Only show for claude-code provider with empty session
  const shouldShow = provider === 'claude-code' && !hasMessages;

  // Fetch commands from installed tool packages
  useEffect(() => {
    if (!shouldShow || !workspacePath) {
      setIsLoading(false);
      return;
    }

    const fetchInstalledCommands = async () => {
      setIsLoading(true);
      try {
        // Set workspace path for PackageService
        PackageService.setWorkspacePath(workspacePath);

        // Get all packages with their installation status
        const packagesWithStatus = await PackageService.getAllPackagesWithStatus();

        // Collect commands from installed packages only
        const commands: CommandWithPackage[] = [];
        for (const { package: pkg, installed } of packagesWithStatus) {
          if (installed && pkg.customCommands.length > 0) {
            for (const cmd of pkg.customCommands) {
              commands.push({
                command: cmd,
                packageId: pkg.id,
                packageName: pkg.name
              });
            }
          }
        }

        setInstalledCommands(commands);
      } catch (error) {
        console.error('[SlashCommandSuggestions] Failed to load installed packages:', error);
        setInstalledCommands([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchInstalledCommands();
  }, [shouldShow, workspacePath]);

  // Shuffle commands once for consistent display (memoized to prevent re-shuffle on every render)
  const shuffledCommands = useMemo(() => {
    return shuffleArray(installedCommands);
  }, [installedCommands]);

  // Get commands to display based on expanded state
  const displayCommands = useMemo(() => {
    if (isExpanded || shuffledCommands.length <= 3) {
      return shuffledCommands;
    }
    return shuffledCommands.slice(0, 3);
  }, [shuffledCommands, isExpanded]);

  // Calculate how many additional commands are hidden
  const hiddenCount = shuffledCommands.length - 3;

  const handleCommandClick = useCallback((cmd: CommandWithPackage) => {
    // Track the suggestion click in analytics.
    // PRIVACY NOTE: It's safe to send commandName and packageId because this component
    // only displays commands from official Nimbalyst packages (defined in ALL_PACKAGES
    // in packages/electron/src/shared/toolPackages/index.ts). User-created custom
    // commands are never shown here. If that changes in the future, add filtering
    // to avoid sending potentially sensitive custom command names to analytics.
    posthog?.capture('slash_command_suggestion_clicked', {
      commandName: cmd.command.name,
      packageId: cmd.packageId,
    });

    onCommandSelect(`/${cmd.command.name} `);
  }, [onCommandSelect, posthog]);

  const handleExpandClick = useCallback(() => {
    setIsExpanded(true);
  }, []);

  // Don't render if not applicable or no installed commands
  if (!shouldShow || isLoading || displayCommands.length === 0) {
    return null;
  }

  return (
    <div className="slash-command-suggestions">
      <div className="slash-command-suggestions-label">
        Try a command:
      </div>
      <div className="slash-command-suggestions-pills">
        {displayCommands.map((cmd) => (
          <div key={cmd.command.name} className="slash-command-pill-wrapper">
            <button
              className="slash-command-pill"
              onClick={() => handleCommandClick(cmd)}
            >
              <span className="slash-command-pill-icon">/</span>
              <span className="slash-command-pill-name">{cmd.command.name}</span>
            </button>
            {cmd.command.description && (
              <div className="slash-command-tooltip" role="tooltip">
                {cmd.command.description}
              </div>
            )}
          </div>
        ))}
        {!isExpanded && hiddenCount > 0 && (
          <button
            className="slash-command-pill slash-command-expand-pill"
            onClick={handleExpandClick}
          >
            <span className="slash-command-pill-name">+{hiddenCount}</span>
          </button>
        )}
      </div>
    </div>
  );
};
