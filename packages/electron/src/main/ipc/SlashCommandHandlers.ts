/**
 * IPC handlers for slash command discovery and management
 */

import { ipcMain } from 'electron';
import { SlashCommandService } from '../services/SlashCommandService';

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
  // List all available slash commands (custom + SDK)
  ipcMain.handle('slash-command:list', async (event, payload: { workspacePath: string; sdkCommands?: string[] }) => {
    try {
      const { workspacePath, sdkCommands = [] } = payload;

      if (!workspacePath) {
        console.warn('[SlashCommandHandlers] No workspace path provided');
        return [];
      }

      const service = getService(workspacePath);
      const commands = await service.listCommands(sdkCommands);

      // console.log(`[SlashCommandHandlers] Returning ${commands.length} slash commands for workspace: ${workspacePath}`);
      return commands;
    } catch (error) {
      console.error('[SlashCommandHandlers] Error listing slash commands:', error);
      return [];
    }
  });

  // Get a specific command
  ipcMain.handle('slash-command:get', async (event, payload: { workspacePath: string; commandName: string; sdkCommands?: string[] }) => {
    try {
      const { workspacePath, commandName, sdkCommands = [] } = payload;

      if (!workspacePath) {
        console.warn('[SlashCommandHandlers] No workspace path provided');
        return null;
      }

      const service = getService(workspacePath);
      const command = await service.getCommand(commandName, sdkCommands);

      return command;
    } catch (error) {
      console.error('[SlashCommandHandlers] Error getting slash command:', error);
      return null;
    }
  });

  // Clear cache for a workspace
  ipcMain.handle('slash-command:clearCache', async (event, workspacePath: string) => {
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
