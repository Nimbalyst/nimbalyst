/**
 * Service for discovering and managing Claude Code slash commands
 * Scans .claude/commands/ and .claude/skills/ directories for custom entries
 */

import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { parseCommandFile, parseSkillFile, SlashCommand, validateCommand } from './CommandFileParser';

// Re-export SlashCommand type for use by handlers
export type { SlashCommand };

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
  async listCommands(sdkCommands: string[] = [], sdkSkills: string[] = [], pluginPaths: string[] = []): Promise<SlashCommand[]> {
    // Check cache
    const now = Date.now();
    if (this.commandsCache && (now - this.cacheTime) < this.CACHE_TTL) {
      return this.mergeWithSdkEntries(this.commandsCache, sdkCommands, sdkSkills);
    }

    // console.log('[SlashCommandService] Scanning for custom slash commands...');

    const commands: SlashCommand[] = [];

    // Scan project commands
    const projectCommands = await this.scanCommandsDirectory(
      path.join(this.workspacePath, '.claude', 'commands'),
      'project'
    );
    commands.push(...projectCommands);

    const projectSkills = await this.scanSkillsDirectory(
      path.join(this.workspacePath, '.claude', 'skills'),
      'project'
    );
    commands.push(...projectSkills);

    // Scan user commands
    const userCommandsPath = path.join(homedir(), '.claude', 'commands');
    const userCommands = await this.scanCommandsDirectory(userCommandsPath, 'user');
    commands.push(...userCommands);

    const userSkillsPath = path.join(homedir(), '.claude', 'skills');
    const userSkills = await this.scanSkillsDirectory(userSkillsPath, 'user');
    commands.push(...userSkills);

    const pluginSkillRoots = pluginPaths.length > 0
      ? pluginPaths
      : [path.join(homedir(), '.claude', 'plugins')];
    const pluginSkills = await this.scanPluginSkillsDirectories(pluginSkillRoots);
    commands.push(...pluginSkills);

    // Update cache
    this.commandsCache = commands;
    this.cacheTime = now;

    return this.mergeWithSdkEntries(commands, sdkCommands, sdkSkills);
  }

  /**
   * Merge scanned commands/skills with SDK-discovered entries.
   * SDK skills cover plugin-provided skills that are not present in local
   * .claude/skills directories, while scanned entries preserve descriptions and
   * user/project source metadata for local skills.
   */
  private mergeWithSdkEntries(
    customCommands: SlashCommand[],
    sdkCommands: string[],
    sdkSkills: string[]
  ): SlashCommand[] {
    const builtinCommandNames = sdkCommands.length > 0 ? sdkCommands : this.getKnownBuiltinCommands();

    const builtinCommands: SlashCommand[] = builtinCommandNames.map(name => ({
      name,
      description: this.getBuiltinCommandDescription(name),
      source: 'builtin' as const,
      kind: 'command' as const,
    }));

    const userVisibleCustomEntries = customCommands.filter(cmd => cmd.userInvocable !== false);
    const userVisibleNames = new Set(userVisibleCustomEntries.map(cmd => cmd.name));
    const sdkSkillEntries: SlashCommand[] = sdkSkills
      .filter(name => !userVisibleNames.has(name))
      .map(name => ({
        name,
        description: `Invoke the ${name} Claude skill`,
        source: 'plugin' as const,
        kind: 'skill' as const,
      }));

    const allCommands = [
      ...builtinCommands,
      ...userVisibleCustomEntries,
      ...sdkSkillEntries,
    ];

    // Remove duplicates while preserving the earliest source in the merged list.
    const seen = new Set<string>();
    return allCommands.filter(cmd => {
      if (seen.has(cmd.name)) {
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
      'clear': 'Start a new conversation session (in agent mode, stays attached to current workstream/worktree)',
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
   * Scan a directory for command files (recursively)
   * @param dirPath Path to commands directory
   * @param source Source type (project or user)
   * @returns List of parsed commands
   */
  private async scanCommandsDirectory(dirPath: string, source: 'project' | 'user'): Promise<SlashCommand[]> {
    const commands: SlashCommand[] = [];

    try {
      // Check if directory exists
      if (!fs.existsSync(dirPath)) {
        // console.log(`[SlashCommandService] Commands directory does not exist: ${dirPath}`);
        return commands;
      }

      // Recursively scan directory
      this.scanDirectoryRecursive(dirPath, dirPath, source, commands);
    } catch (error) {
      console.error(`[SlashCommandService] Error scanning directory ${dirPath}:`, error);
    }

    return commands;
  }

  /**
   * Scan a skills directory for `skills/<name>/SKILL.md` files.
   */
  private async scanSkillsDirectory(dirPath: string, source: 'project' | 'user'): Promise<SlashCommand[]> {
    const commands: SlashCommand[] = [];

    try {
      if (!fs.existsSync(dirPath)) {
        return commands;
      }

      this.scanSkillsRecursive(dirPath, dirPath, source, commands);
    } catch (error) {
      console.error(`[SlashCommandService] Error scanning skills directory ${dirPath}:`, error);
    }

    return commands;
  }

  /**
   * Scan installed Claude plugins for bundled skills so they are available in
   * typeahead before the SDK session finishes initializing.
   */
  private async scanPluginSkillsDirectories(dirPaths: string[]): Promise<SlashCommand[]> {
    const commands: SlashCommand[] = [];

    for (const dirPath of dirPaths) {
      try {
        if (!fs.existsSync(dirPath)) {
          continue;
        }

        this.scanPluginSkillsRecursive(dirPath, commands);
      } catch (error) {
        console.error(`[SlashCommandService] Error scanning plugin skills directory ${dirPath}:`, error);
      }
    }

    return commands;
  }

  /**
   * Recursively scan a directory for command files
   * @param currentPath Current directory being scanned
   * @param rootPath Root commands directory (for computing relative paths)
   * @param source Source type (project or user)
   * @param commands Array to collect commands
   */
  private scanDirectoryRecursive(
    currentPath: string,
    rootPath: string,
    source: 'project' | 'user',
    commands: SlashCommand[]
  ): void {
    try {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          // Recursively scan subdirectories
          this.scanDirectoryRecursive(fullPath, rootPath, source, commands);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          // Process markdown files
          try {
            // Compute relative path from root for namespacing
            const relativePath = path.relative(rootPath, fullPath);
            const command = parseCommandFile(fullPath, source, relativePath);

            if (command && validateCommand(command)) {
              commands.push(command);
              // console.log(`[SlashCommandService] Loaded command: ${command.name} from ${source}`);
            } else {
              console.warn(`[SlashCommandService] Invalid command file: ${fullPath}`);
            }
          } catch (error) {
            console.error(`[SlashCommandService] Error parsing command file ${fullPath}:`, error);
          }
        }
      }
    } catch (error) {
      console.error(`[SlashCommandService] Error reading directory ${currentPath}:`, error);
    }
  }

  private scanSkillsRecursive(
    currentPath: string,
    rootPath: string,
    source: 'project' | 'user',
    commands: SlashCommand[]
  ): void {
    try {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          this.scanSkillsRecursive(fullPath, rootPath, source, commands);
        } else if (entry.isFile() && entry.name === 'SKILL.md') {
          try {
            const relativePath = path.relative(rootPath, fullPath);
            const command = parseSkillFile(fullPath, source, relativePath);

            if (command && validateCommand(command)) {
              commands.push(command);
            } else {
              console.warn(`[SlashCommandService] Invalid skill file: ${fullPath}`);
            }
          } catch (error) {
            console.error(`[SlashCommandService] Error parsing skill file ${fullPath}:`, error);
          }
        }
      }
    } catch (error) {
      console.error(`[SlashCommandService] Error reading skills directory ${currentPath}:`, error);
    }
  }

  private scanPluginSkillsRecursive(currentPath: string, commands: SlashCommand[]): void {
    try {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          this.scanPluginSkillsRecursive(fullPath, commands);
          continue;
        }

        if (!entry.isFile() || entry.name !== 'SKILL.md') {
          continue;
        }

        const skillsRootMarker = `${path.sep}skills${path.sep}`;
        const markerIndex = fullPath.lastIndexOf(skillsRootMarker);
        if (markerIndex === -1) {
          continue;
        }

        const relativePath = fullPath.slice(markerIndex + skillsRootMarker.length);
        try {
          const command = parseSkillFile(fullPath, 'plugin', relativePath);
          if (command && validateCommand(command) && command.userInvocable !== false) {
            commands.push(command);
          }
        } catch (error) {
          console.error(`[SlashCommandService] Error parsing plugin skill file ${fullPath}:`, error);
        }
      }
    } catch (error) {
      console.error(`[SlashCommandService] Error reading plugin skills directory ${currentPath}:`, error);
    }
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
  async getCommand(name: string, sdkCommands: string[] = [], sdkSkills: string[] = [], pluginPaths: string[] = []): Promise<SlashCommand | null> {
    const commands = await this.listCommands(sdkCommands, sdkSkills, pluginPaths);
    return commands.find(cmd => cmd.name === name) || null;
  }
}
