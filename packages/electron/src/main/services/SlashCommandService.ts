/**
 * Service for discovering and managing Claude Code slash commands
 * Scans .claude/commands/ directories for custom commands
 */

import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { parseCommandFile, SlashCommand, validateCommand } from './CommandFileParser';

export class SlashCommandService {
  private workspacePath: string;
  private commandsCache: SlashCommand[] | null = null;
  private cacheTime: number = 0;
  private readonly CACHE_TTL = 5000; // 5 seconds

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  /**
   * Get the known built-in Claude Code commands
   * These are used as a fallback when the SDK hasn't initialized yet
   */
  private getKnownBuiltinCommands(): string[] {
    return [
      'compact',
      'clear',
      'context',
      'cost',
      'init',
      'output-style:new',
      'pr-comments',
      'release-notes',
      'todos',
      'review',
      'security-review'
    ];
  }

  /**
   * List all available slash commands from all sources
   * @param sdkCommands Built-in commands from Claude Code SDK
   * @returns Combined list of all commands
   */
  async listCommands(sdkCommands: string[] = []): Promise<SlashCommand[]> {
    // Check cache
    const now = Date.now();
    if (this.commandsCache && (now - this.cacheTime) < this.CACHE_TTL) {
      // Use SDK commands if provided, otherwise use known built-ins as fallback
      const commandsToMerge = sdkCommands.length > 0 ? sdkCommands : this.getKnownBuiltinCommands();
      return this.mergeWithSdkCommands(this.commandsCache, commandsToMerge);
    }

    console.log('[SlashCommandService] Scanning for custom slash commands...');

    const commands: SlashCommand[] = [];

    // Scan project commands
    const projectCommands = await this.scanCommandsDirectory(
      path.join(this.workspacePath, '.claude', 'commands'),
      'project'
    );
    commands.push(...projectCommands);
    console.log(`[SlashCommandService] Found ${projectCommands.length} project commands`);

    // Scan user commands
    const userCommandsPath = path.join(homedir(), '.claude', 'commands');
    const userCommands = await this.scanCommandsDirectory(userCommandsPath, 'user');
    commands.push(...userCommands);
    console.log(`[SlashCommandService] Found ${userCommands.length} user commands`);

    // Update cache
    this.commandsCache = commands;
    this.cacheTime = now;

    // Use SDK commands if provided, otherwise use known built-ins as fallback
    const commandsToMerge = sdkCommands.length > 0 ? sdkCommands : this.getKnownBuiltinCommands();
    console.log(`[SlashCommandService] Using ${commandsToMerge.length} built-in commands (${sdkCommands.length > 0 ? 'from SDK' : 'hardcoded fallback'})`);

    return this.mergeWithSdkCommands(commands, commandsToMerge);
  }

  /**
   * Merge custom commands with built-in SDK commands
   * @param customCommands Custom commands from files
   * @param sdkCommands Built-in commands from SDK
   * @returns Combined list with built-in commands first
   */
  private mergeWithSdkCommands(customCommands: SlashCommand[], sdkCommands: string[]): SlashCommand[] {
    // Convert SDK command names to SlashCommand objects
    const builtinCommands: SlashCommand[] = sdkCommands.map(name => ({
      name,
      description: this.getBuiltinCommandDescription(name),
      source: 'builtin' as const
    }));

    // Combine: built-in first, then project, then user
    const allCommands = [
      ...builtinCommands,
      ...customCommands
    ];

    // Remove duplicates (built-in takes precedence)
    const seen = new Set<string>();
    return allCommands.filter(cmd => {
      if (seen.has(cmd.name)) {
        console.warn(`[SlashCommandService] Duplicate command ignored: ${cmd.name} (source: ${cmd.source})`);
        return false;
      }
      seen.add(cmd.name);
      return true;
    });
  }

  /**
   * Get description for built-in commands
   * @param name Command name
   * @returns Description string
   */
  private getBuiltinCommandDescription(name: string): string {
    const descriptions: Record<string, string> = {
      'compact': 'Reduces conversation history by summarizing older messages',
      'clear': 'Starts a fresh conversation by clearing previous history',
      'context': 'Show context information about the current session',
      'cost': 'Display token usage and cost information for the session',
      'init': 'Initialize or reinitialize the Claude Code session',
      'output-style:new': 'Create a new custom output style configuration',
      'pr-comments': 'Generate pull request comments for code changes',
      'release-notes': 'Generate release notes from recent changes',
      'todos': 'Extract and manage TODO items from the codebase',
      'review': 'Perform code review on recent changes',
      'security-review': 'Conduct security analysis of the codebase'
    };
    return descriptions[name] || `Execute ${name} command`;
  }

  /**
   * Scan a directory for command files
   * @param dirPath Path to commands directory
   * @param source Source type (project or user)
   * @returns List of parsed commands
   */
  private async scanCommandsDirectory(dirPath: string, source: 'project' | 'user'): Promise<SlashCommand[]> {
    const commands: SlashCommand[] = [];

    try {
      // Check if directory exists
      if (!fs.existsSync(dirPath)) {
        console.log(`[SlashCommandService] Commands directory does not exist: ${dirPath}`);
        return commands;
      }

      const files = fs.readdirSync(dirPath);

      for (const file of files) {
        // Only process markdown files
        if (!file.endsWith('.md')) {
          continue;
        }

        const filePath = path.join(dirPath, file);

        try {
          const command = parseCommandFile(filePath, source);

          if (command && validateCommand(command)) {
            commands.push(command);
            console.log(`[SlashCommandService] Loaded command: ${command.name} from ${source}`);
          } else {
            console.warn(`[SlashCommandService] Invalid command file: ${filePath}`);
          }
        } catch (error) {
          console.error(`[SlashCommandService] Error parsing command file ${filePath}:`, error);
        }
      }
    } catch (error) {
      console.error(`[SlashCommandService] Error scanning directory ${dirPath}:`, error);
    }

    return commands;
  }

  /**
   * Clear the commands cache
   */
  clearCache(): void {
    this.commandsCache = null;
    this.cacheTime = 0;
  }

  /**
   * Get a specific command by name
   * @param name Command name (without "/")
   * @param sdkCommands Built-in commands from SDK
   * @returns Command or null if not found
   */
  async getCommand(name: string, sdkCommands: string[] = []): Promise<SlashCommand | null> {
    const commands = await this.listCommands(sdkCommands);
    return commands.find(cmd => cmd.name === name) || null;
  }
}
