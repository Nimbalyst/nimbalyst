/**
 * IPC handlers for slash command discovery and management
 */

import { SlashCommandService, SlashCommand } from '../services/SlashCommandService';
import { safeHandle, safeOn } from '../utils/ipcRegistry';
import { getClaudePluginPaths, getExtensionPluginCommands } from './ExtensionHandlers';
import { syncProjectCommandsToMobile } from '../services/SyncManager';

// Cache services by workspace path
const servicesByWorkspace = new Map<string, SlashCommandService>();

/**
 * Get or create a service for a workspace
 */
function getService(workspacePath: string): SlashCommandService {
  let service = servicesByWorkspace.get(workspacePath);
  if (!service) {
    service = new SlashCommandService(workspacePath);
    servicesByWorkspace.set(workspacePath, service);
  }
  return service;
}

/**
 * Register all slash command IPC handlers
 */
export function registerSlashCommandHandlers() {
  // List all available slash commands (custom + SDK + extension plugins)
  safeHandle('slash-command:list', async (event, payload: { workspacePath: string; sdkCommands?: string[]; sdkSkills?: string[] }) => {
    try {
      const { workspacePath, sdkCommands = [], sdkSkills = [] } = payload;

      if (!workspacePath) {
        console.warn('[SlashCommandHandlers] No workspace path provided');
        return [];
      }

      const service = getService(workspacePath);
      const claudePluginPaths = await getClaudePluginPaths(workspacePath);
      const commands = await service.listCommands(
        sdkCommands,
        sdkSkills,
        claudePluginPaths.map(plugin => plugin.path)
      );

      // Also get extension plugin commands
      const extensionPluginCommands = await getExtensionPluginCommands();

      // Convert extension plugin commands to SlashCommand format
      const pluginSlashCommands: SlashCommand[] = extensionPluginCommands.map(cmd => ({
        name: `${cmd.pluginNamespace}:${cmd.commandName}`,
        description: cmd.description || `Execute ${cmd.commandName} command from ${cmd.extensionName}`,
        source: 'plugin' as const
      }));

      // Merge: built-in first, then project, then user, then plugins
      // Deduplicate by command name (first occurrence wins)
      const allCommands = [...commands, ...pluginSlashCommands];
      const seen = new Set<string>();
      const deduplicatedCommands = allCommands.filter(cmd => {
        if (seen.has(cmd.name)) {
          return false;
        }
        seen.add(cmd.name);
        return true;
      });

      // console.log(`[SlashCommandHandlers] Returning ${deduplicatedCommands.length} slash commands (deduped from ${allCommands.length}) for workspace: ${workspacePath}`);

      // Fire-and-forget: sync commands to mobile via index room
      syncProjectCommandsToMobile(workspacePath, deduplicatedCommands).catch(() => {
        // Silently ignore - sync is best-effort
      });

      return deduplicatedCommands;
    } catch (error) {
      console.error('[SlashCommandHandlers] Error listing slash commands:', error);
      return [];
    }
  });

  // Get a specific command
  safeHandle('slash-command:get', async (event, payload: { workspacePath: string; commandName: string; sdkCommands?: string[]; sdkSkills?: string[] }) => {
    try {
      const { workspacePath, commandName, sdkCommands = [], sdkSkills = [] } = payload;

      if (!workspacePath) {
        console.warn('[SlashCommandHandlers] No workspace path provided');
        return null;
      }

      const service = getService(workspacePath);
      const claudePluginPaths = await getClaudePluginPaths(workspacePath);
      const command = await service.getCommand(
        commandName,
        sdkCommands,
        sdkSkills,
        claudePluginPaths.map(plugin => plugin.path)
      );

      return command;
    } catch (error) {
      console.error('[SlashCommandHandlers] Error getting slash command:', error);
      return null;
    }
  });

  // Clear cache for a workspace
  safeHandle('slash-command:clearCache', async (event, workspacePath: string) => {
    try {
      if (!workspacePath) {
        console.warn('[SlashCommandHandlers] No workspace path provided');
        return { success: false };
      }

      const service = servicesByWorkspace.get(workspacePath);
      if (service) {
        service.clearCache();
        // console.log(`[SlashCommandHandlers] Cleared cache for workspace: ${workspacePath}`);
      }

      return { success: true };
    } catch (error) {
      console.error('[SlashCommandHandlers] Error clearing cache:', error);
      return { success: false };
    }
  });

  // console.log('[SlashCommandHandlers] Registered slash command IPC handlers');
}
