/**
 * Parser for Claude Code slash command markdown files
 * Parses markdown files with YAML frontmatter from .claude/commands/ directories
 */

import * as fs from 'fs';
import * as yaml from 'js-yaml';
import path from "path";

export interface SlashCommandHandoff {
  label: string;
  agent: string;
  prompt?: string;
  send?: boolean;
}

export interface SlashCommand {
  name: string;                  // Command name (without "/")
  description?: string;          // Description from frontmatter or default
  argumentHint?: string;         // Argument hint from frontmatter (e.g., "[issue-number] [priority]")
  agentName?: string;            // Agent name from frontmatter (for agent-type commands)
  handoffs?: SlashCommandHandoff[]; // Workflow handoffs to other commands
  tools?: string[];              // External tool dependencies (e.g., MCP tools)
  source: 'builtin' | 'project' | 'user';
  filePath?: string;             // For custom commands
  allowedTools?: string[];       // From frontmatter
  content?: string;              // Command content/template
}

interface CommandFrontmatter {
  description?: string;
  'argument-hint'?: string;
  'allowed-tools'?: string | string[];
  name?: string;                   // Agent name
  handoffs?: SlashCommandHandoff[]; // Workflow handoffs
  tools?: string[];                // External tool dependencies
  [key: string]: any;
}

/**
 * Parse a command markdown file with YAML frontmatter
 * @param filePath Path to the command file
 * @param source Source of the command (project or user)
 * @param relativePath Optional relative path from commands root for namespaced commands
 * @returns Parsed command or null if parsing fails
 */
export function parseCommandFile(
  filePath: string,
  source: 'project' | 'user',
  relativePath?: string
): SlashCommand | null {
  try {
    // Read file content
    const content = fs.readFileSync(filePath, 'utf-8');

    // Extract command name from relative path or filename
    let commandName: string;
    if (relativePath) {
      // Build namespaced name from relative path: "BMad/agents/bmad-master.md" → "BMad:agents:bmad-master"
      commandName = relativePath
        .replace(/\.md$/, '')           // Remove .md extension
        .replace(/\\/g, '/')            // Normalize Windows paths to forward slashes
        .replace(/\//g, ':')            // Replace path separators with colons
        .trim();
    } else {
      // Fall back to just the filename (backward compatibility)
      commandName = path.basename(filePath, '.md').trim();
    }

    if (!commandName) {
      console.warn(`[CommandFileParser] Could not extract command name from: ${filePath}`);
      return null;
    }

    // Parse frontmatter and content
    const { frontmatter, body } = parseFrontmatter(content);

    // Parse allowed-tools field (can be comma-separated string or array)
    let allowedTools: string[] | undefined;
    if (frontmatter['allowed-tools']) {
      if (typeof frontmatter['allowed-tools'] === 'string') {
        allowedTools = frontmatter['allowed-tools']
          .split(',')
          .map(tool => tool.trim())
          .filter(Boolean);
      } else if (Array.isArray(frontmatter['allowed-tools'])) {
        allowedTools = frontmatter['allowed-tools']
          .map(tool => String(tool).trim())
          .filter(Boolean);
      }
    }

    return {
      name: commandName,
      description: frontmatter.description,
      argumentHint: frontmatter['argument-hint'],
      agentName: frontmatter.name,
      handoffs: frontmatter.handoffs,
      tools: frontmatter.tools,
      source,
      filePath,
      allowedTools,
      content: body.trim()
    };
  } catch (error) {
    console.error(`[CommandFileParser] Error parsing command file ${filePath}:`, error);
    return null;
  }
}

/**
 * Parse YAML frontmatter from markdown content
 * @param content Markdown content with optional frontmatter
 * @returns Parsed frontmatter and body content
 */
function parseFrontmatter(content: string): { frontmatter: CommandFrontmatter; body: string } {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    // No frontmatter, return entire content as body
    return {
      frontmatter: {},
      body: content
    };
  }

  try {
    const frontmatterYaml = match[1];
    const body = match[2];
    const frontmatter = yaml.load(frontmatterYaml) as CommandFrontmatter || {};

    return {
      frontmatter,
      body
    };
  } catch (error) {
    console.error('[CommandFileParser] Error parsing YAML frontmatter:', error);
    // Return content as body if frontmatter parsing fails
    return {
      frontmatter: {},
      body: content
    };
  }
}

/**
 * Validate command file structure
 * @param command Parsed command
 * @returns True if command is valid
 */
export function validateCommand(command: SlashCommand): boolean {
  // Must have a name
  if (!command.name || command.name.trim().length === 0) {
    return false;
  }

  // Command name should not contain special characters (allow colons for namespacing, periods for packages like speckit)
  if (!/^[a-zA-Z0-9-_:.]+$/.test(command.name)) {
    console.warn(`[CommandFileParser] Invalid command name: ${command.name}`);
    return false;
  }

  return true;
}
