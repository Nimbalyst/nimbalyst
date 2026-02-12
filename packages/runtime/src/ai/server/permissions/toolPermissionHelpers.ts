/**
 * Shared utilities for tool permission handling
 *
 * These functions are used by both ClaudeCodeProvider and ToolPermissionService
 * to generate tool descriptions and patterns for permission requests.
 */

import { hasShellChainingOperators } from './BashCommandAnalyzer';

/**
 * Build a human-readable description of a tool call for permission UI
 *
 * @param toolName - Name of the tool being called
 * @param input - Tool input parameters
 * @returns Human-readable description string
 */
export function buildToolDescription(toolName: string, input: any): string {
  switch (toolName) {
    case 'Read':
      return input?.file_path ? `read ${input.file_path}` : '';
    case 'Write':
      return input?.file_path ? `write ${input.file_path}` : '';
    case 'Edit':
      return input?.file_path ? `edit ${input.file_path}` : '';
    case 'MultiEdit':
      return input?.edits?.length ? `multi-edit ${input.edits.length} files` : '';
    case 'Glob':
      return input?.pattern ? `glob ${input.pattern}` : '';
    case 'Grep':
      return input?.pattern ? `grep ${input.pattern}` : '';
    case 'Task':
      return input?.description || input?.prompt?.slice(0, 50) || 'spawn task';
    case 'WebFetch':
      return input?.url ? `fetch ${input.url}` : '';
    case 'WebSearch':
      return input?.query ? `search "${input.query}"` : '';
    case 'TodoWrite':
      return 'update todos';
    case 'KillShell':
      return input?.shell_id ? `kill shell ${input.shell_id}` : '';
    case 'MCPSearch':
      return input?.query ? `search MCP tools: ${input.query}` : '';
    default:
      // For MCP tools (mcp__*) and other unknown tools, create a generic description
      if (toolName.startsWith('mcp__')) {
        const parts = toolName.split('__');
        const serverName = parts[1] || 'unknown';
        const mcpToolName = parts[2] || 'unknown';
        return `${serverName}:${mcpToolName}`;
      }
      // For completely unknown tools, just return the tool name
      return toolName;
  }
}

/**
 * Generate a tool pattern for Claude Code's allowedTools format.
 * These patterns are written to .claude/settings.local.json when user approves with "Always".
 *
 * Pattern strategy:
 * - git: include subcommand for granularity (git diff, git commit, etc.)
 * - npm/npx: include subcommand (npm run, npm test, npx vitest, etc.)
 * - everything else: just base command (ls, cat, grep, etc.)
 *
 * We never include paths/filenames - patterns match any invocation of the command.
 *
 * @param toolName - Name of the tool being called
 * @param input - Tool input parameters
 * @returns Permission pattern string
 */
export function generateToolPattern(toolName: string, input: any): string {
  switch (toolName) {
    case 'Bash': {
      const command = (input?.command as string) || '';

      // Detect compound commands - these should not be cached
      // because approving "git add" shouldn't auto-approve "git add && git commit"
      // Use quote-aware detection to avoid false positives on heredocs/quoted strings
      if (hasShellChainingOperators(command)) {
        // Return a unique pattern that won't match future commands
        return `Bash:compound:${Date.now()}`;
      }

      const words = command.trim().split(/\s+/);

      if (words.length === 0 || !words[0]) {
        return 'Bash';
      }

      const baseCommand = words[0];

      // For git, find the subcommand (skip flags like -C, --no-pager)
      // "git -C /path diff" -> "Bash(git diff:*)"
      // "git commit -m 'msg'" -> "Bash(git commit:*)"
      if (baseCommand === 'git') {
        for (let i = 1; i < words.length; i++) {
          const word = words[i];
          if (word.startsWith('-')) {
            // Skip flags that take arguments
            if (['-C', '-c', '--git-dir', '--work-tree'].includes(word)) {
              i++;
            }
            continue;
          }
          // First non-flag is the subcommand
          return `Bash(git ${word}:*)`;
        }
        return `Bash(git:*)`;
      }

      // For npm/npx, find the subcommand (skip flags like --prefix)
      if (baseCommand === 'npm' || baseCommand === 'npx') {
        for (let i = 1; i < words.length; i++) {
          const word = words[i];
          if (word.startsWith('-')) {
            if (['--prefix', '-w', '--workspace'].includes(word)) {
              i++;
            }
            continue;
          }
          return `Bash(${baseCommand} ${word}:*)`;
        }
        return `Bash(${baseCommand}:*)`;
      }

      // For everything else, just the base command
      // "ls -la /some/path" -> "Bash(ls:*)"
      // "cat /etc/passwd" -> "Bash(cat:*)"
      return `Bash(${baseCommand}:*)`;
    }

    case 'WebFetch': {
      // Extract domain for pattern matching
      const url = (input?.url as string) || '';
      try {
        const parsedUrl = new URL(url);
        return `WebFetch(domain:${parsedUrl.hostname})`;
      } catch {
        return 'WebFetch';
      }
    }

    case 'WebSearch':
      return 'WebSearch';

    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'Glob':
    case 'Grep':
    case 'LS':
    case 'TodoRead':
    case 'TodoWrite':
    case 'Task':
    case 'NotebookRead':
    case 'NotebookEdit':
    case 'ExitPlanMode':
      return toolName;

    default:
      // MCP tools: mcp__server__tool - use as-is
      if (toolName.startsWith('mcp__')) {
        return toolName;
      }
      return toolName;
  }
}
