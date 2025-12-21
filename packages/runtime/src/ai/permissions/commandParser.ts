/**
 * Command Parser for Agentic Tool Permissions
 *
 * Parses bash commands into structured patterns that can be evaluated
 * against permission rules.
 *
 * Uses shell-quote for robust shell command parsing.
 */

import { parse as shellParse, ParseEntry } from 'shell-quote';

export interface ParsedAction {
  /** The pattern identifier, e.g., 'git:push', 'bash:ls', 'npm:run:build' */
  pattern: string;
  /** Human-readable display name */
  displayName: string;
  /** The original command segment */
  command: string;
  /** Whether this is a known destructive operation */
  isDestructive: boolean;
  /** Paths referenced in the command (for directory scoping) */
  referencedPaths: string[];
  /** Whether this command has output redirection */
  hasRedirection: boolean;
}

export interface ParsedCommand {
  /** The original full command string */
  original: string;
  /** Parsed actions from the command */
  actions: ParsedAction[];
}

/**
 * Commands that are known to be read-only and safe to auto-allow
 * (when operating within the workspace directory)
 */
export const READ_ONLY_COMMANDS = new Set([
  // File system reads
  'ls',
  'cat',
  'head',
  'tail',
  'less',
  'more',
  'find',
  'grep',
  'rg',
  'ag',
  'wc',
  'file',
  'stat',
  'du',
  'df',
  'tree',
  'pwd',
  'which',
  'whereis',
  'type',
  'realpath',
  'dirname',
  'basename',

  // Also read-only when not writing
  'echo', // Only if not redirecting
]);

/**
 * Git subcommands that are read-only
 */
export const GIT_READ_ONLY_SUBCOMMANDS = new Set([
  'status',
  'log',
  'diff',
  'show',
  'branch', // listing only, -d/-D are destructive
  'tag', // listing only, -d is destructive
  'remote', // listing only
  'stash', // 'stash list' is read-only
  'blame',
  'shortlog',
  'describe',
  'rev-parse',
  'ls-files',
  'ls-tree',
  'cat-file',
  'config', // reading config (--get, --list)
]);

/**
 * Git subcommands that are destructive
 */
export const GIT_DESTRUCTIVE_SUBCOMMANDS = new Map<string, string[]>([
  ['reset', ['--hard']],
  ['push', ['--force', '-f', '--force-with-lease']],
  ['clean', ['-f', '-fd', '-fx']],
  ['checkout', []], // Can lose uncommitted changes
  ['rebase', []],
  ['cherry-pick', []],
]);

/**
 * Known destructive commands
 */
export const DESTRUCTIVE_COMMANDS = new Set([
  'rm',
  'rmdir',
  'mv', // Can overwrite
  'cp', // Can overwrite with -f
]);

/**
 * Shell operators that indicate command boundaries
 */
type ShellOperator = { op: string };

function isOperator(entry: ParseEntry): entry is ShellOperator {
  return typeof entry === 'object' && entry !== null && 'op' in entry;
}

function isString(entry: ParseEntry): entry is string {
  return typeof entry === 'string';
}

/**
 * Quote an argument if it contains spaces or special characters
 */
function quoteArgIfNeeded(arg: string): string {
  // If the argument contains spaces or shell special characters, quote it
  if (/[\s"'\\$`!]/.test(arg)) {
    // Use double quotes and escape any double quotes inside
    return `"${arg.replace(/"/g, '\\"')}"`;
  }
  return arg;
}

/**
 * Split a command string by shell operators using shell-quote
 * Returns individual command segments separated by &&, ||, ;, |
 */
export function splitCompoundCommand(command: string): string[] {
  if (!command.trim()) {
    return [];
  }

  const parsed = shellParse(command);
  const commands: string[] = [];
  let currentArgs: string[] = [];

  for (const entry of parsed) {
    if (isOperator(entry)) {
      // Operators: &&, ||, ;, |, >, >>, etc.
      const op = entry.op;

      if (['&&', '||', ';', '|'].includes(op)) {
        // Command boundary - save current command
        if (currentArgs.length > 0) {
          commands.push(currentArgs.map(quoteArgIfNeeded).join(' '));
          currentArgs = [];
        }
      } else if (op === 'glob') {
        // Glob pattern - keep as is
        currentArgs.push('*');
      } else {
        // Redirection operators (>, >>, <, etc.) - include in current command
        currentArgs.push(op);
      }
    } else if (isString(entry)) {
      currentArgs.push(entry);
    }
    // Skip other types (comments, etc.)
  }

  // Don't forget the last command
  if (currentArgs.length > 0) {
    commands.push(currentArgs.map(quoteArgIfNeeded).join(' '));
  }

  return commands;
}

/**
 * Parse a command string into tokens using shell-quote
 */
export function parseTokens(command: string): string[] {
  const parsed = shellParse(command);
  const tokens: string[] = [];

  for (const entry of parsed) {
    if (isString(entry)) {
      tokens.push(entry);
    } else if (isOperator(entry)) {
      tokens.push(entry.op);
    }
  }

  return tokens;
}

/**
 * Check if command has output redirection using shell-quote
 */
export function hasWriteRedirection(command: string): boolean {
  const parsed = shellParse(command);

  for (const entry of parsed) {
    if (isOperator(entry)) {
      const op = entry.op;
      // Check for output redirection operators
      if (op === '>' || op === '>>' || op === '2>' || op === '2>>' || op === '&>' || op === '>&') {
        return true;
      }
    }
  }

  return false;
}

/**
 * Extract the base command from tokens (first non-prefix word)
 */
export function extractBaseCommand(command: string): string {
  const prefixes = ['sudo', 'env', 'nice', 'nohup', 'time'];
  const tokens = parseTokens(command);

  let idx = 0;

  // Skip prefixes
  while (idx < tokens.length && prefixes.includes(tokens[idx])) {
    idx++;
    // Skip env VAR=value patterns
    while (idx < tokens.length && tokens[idx].includes('=') && !tokens[idx].startsWith('-')) {
      idx++;
    }
  }

  return tokens[idx] || '';
}

/**
 * Extract paths from a command using shell-quote for proper parsing
 */
export function extractPaths(command: string): string[] {
  const tokens = parseTokens(command);
  const paths: string[] = [];

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];

    // Skip flags
    if (token.startsWith('-')) continue;

    // Skip URLs
    if (token.includes('://')) continue;

    // Skip shell operators
    if (['&&', '||', ';', '|', '>', '>>', '<', '2>', '&>'].includes(token)) continue;

    // Skip environment variable assignments
    if (token.includes('=') && !token.startsWith('/') && !token.startsWith('.')) continue;

    // If it looks like a path or filename
    if (
      token.startsWith('/') ||
      token.startsWith('./') ||
      token.startsWith('../') ||
      token.includes('/') ||
      token.includes('.') ||
      /^[a-zA-Z0-9_-]+$/.test(token)
    ) {
      if (!paths.includes(token)) {
        paths.push(token);
      }
    }
  }

  return paths;
}

/**
 * Parse a git command into a pattern
 */
export function parseGitCommand(command: string): ParsedAction {
  const tokens = parseTokens(command);
  const gitIdx = tokens.findIndex((t) => t === 'git');
  const subcommand = tokens[gitIdx + 1] || 'unknown';
  const flags = tokens.slice(gitIdx + 2).filter((t) => t.startsWith('-'));

  // Check for destructive patterns
  let isDestructive = false;
  const destructiveFlags = GIT_DESTRUCTIVE_SUBCOMMANDS.get(subcommand);
  if (destructiveFlags !== undefined) {
    if (destructiveFlags.length === 0) {
      // The subcommand itself is potentially destructive
      isDestructive = true;
    } else {
      // Check if any destructive flags are present
      isDestructive = flags.some((f) => destructiveFlags.includes(f));
    }
  }

  // Special case: git branch -d/-D is destructive
  if (subcommand === 'branch' && flags.some((f) => f === '-d' || f === '-D')) {
    isDestructive = true;
  }

  // Special case: git tag -d is destructive
  if (subcommand === 'tag' && flags.includes('-d')) {
    isDestructive = true;
  }

  // Build pattern
  let pattern = `git:${subcommand}`;
  if (subcommand === 'reset') {
    if (flags.includes('--hard')) {
      pattern = 'git:reset-hard';
    } else if (flags.includes('--soft')) {
      pattern = 'git:reset-soft';
    }
    // Default reset (mixed) is just 'git:reset'
  }
  if (subcommand === 'push' && flags.some((f) => f === '--force' || f === '-f' || f === '--force-with-lease')) {
    pattern = 'git:push-force';
  }

  // Build display name
  let displayName = `Git ${subcommand}`;
  if (isDestructive) {
    displayName += ' (destructive)';
  }

  return {
    pattern,
    displayName,
    command,
    isDestructive,
    referencedPaths: extractPaths(command),
    hasRedirection: hasWriteRedirection(command),
  };
}

/**
 * Parse an npm/yarn/pnpm command into a pattern
 */
export function parsePackageManagerCommand(command: string): ParsedAction {
  const tokens = parseTokens(command);
  const pmIdx = tokens.findIndex((t) => ['npm', 'yarn', 'pnpm', 'npx'].includes(t));
  const pm = tokens[pmIdx];
  const subcommand = tokens[pmIdx + 1] || 'unknown';

  let pattern: string;
  let displayName: string;
  let isDestructive = false;

  if (subcommand === 'run' || subcommand === 'run-script') {
    const scriptName = tokens[pmIdx + 2] || 'unknown';
    pattern = `npm:run:${scriptName}`;
    displayName = `npm run ${scriptName}`;
  } else if (subcommand === 'publish') {
    pattern = 'npm:publish';
    displayName = 'npm publish';
    isDestructive = true; // Publishing is a significant action
  } else if (subcommand === 'install' || subcommand === 'i' || subcommand === 'add') {
    pattern = 'npm:install';
    displayName = 'npm install';
  } else if (subcommand === 'uninstall' || subcommand === 'remove' || subcommand === 'rm') {
    pattern = 'npm:uninstall';
    displayName = 'npm uninstall';
  } else if (['list', 'ls', 'outdated', 'view', 'info', 'search'].includes(subcommand)) {
    pattern = `npm:${subcommand}`;
    displayName = `npm ${subcommand}`;
  } else if (pm === 'npx') {
    const pkg = subcommand;
    pattern = `npx:${pkg}`;
    displayName = `npx ${pkg}`;
  } else {
    pattern = `npm:${subcommand}`;
    displayName = `npm ${subcommand}`;
  }

  return {
    pattern,
    displayName,
    command,
    isDestructive,
    referencedPaths: extractPaths(command),
    hasRedirection: hasWriteRedirection(command),
  };
}

/**
 * Parse a generic bash command into a pattern
 */
export function parseBashCommand(command: string): ParsedAction {
  const baseCmd = extractBaseCommand(command);
  const paths = extractPaths(command);
  const hasRedirect = hasWriteRedirection(command);
  const tokens = parseTokens(command);

  // Check for rm with recursive/force flags
  if (baseCmd === 'rm') {
    const hasRecursive = tokens.some((t) => t === '-r' || t === '-R' || t === '--recursive' || /^-[a-zA-Z]*r[a-zA-Z]*$/.test(t));
    const hasForce = tokens.some((t) => t === '-f' || t === '--force' || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(t));

    if (hasRecursive && hasForce) {
      return {
        pattern: 'bash:rm-rf',
        displayName: 'Recursive delete (destructive)',
        command,
        isDestructive: true,
        referencedPaths: paths,
        hasRedirection: hasRedirect,
      };
    }
    if (hasRecursive) {
      return {
        pattern: 'bash:rm-r',
        displayName: 'Recursive delete',
        command,
        isDestructive: true,
        referencedPaths: paths,
        hasRedirection: hasRedirect,
      };
    }

    return {
      pattern: 'bash:rm',
      displayName: 'Delete files',
      command,
      isDestructive: true,
      referencedPaths: paths,
      hasRedirection: hasRedirect,
    };
  }

  // Check for read-only commands
  if (READ_ONLY_COMMANDS.has(baseCmd)) {
    // echo with redirection is a write
    if (baseCmd === 'echo' && hasRedirect) {
      return {
        pattern: 'bash:echo-write',
        displayName: 'Write via echo',
        command,
        isDestructive: false,
        referencedPaths: paths,
        hasRedirection: hasRedirect,
      };
    }

    return {
      pattern: `bash:${baseCmd}`,
      displayName: baseCmd,
      command,
      isDestructive: false,
      referencedPaths: paths,
      hasRedirection: hasRedirect,
    };
  }

  // Check for other destructive commands
  if (DESTRUCTIVE_COMMANDS.has(baseCmd)) {
    return {
      pattern: `bash:${baseCmd}`,
      displayName: baseCmd,
      command,
      isDestructive: true,
      referencedPaths: paths,
      hasRedirection: hasRedirect,
    };
  }

  // Commands with write redirection
  if (hasRedirect) {
    return {
      pattern: `bash:${baseCmd}-write`,
      displayName: `${baseCmd} (with file write)`,
      command,
      isDestructive: false,
      referencedPaths: paths,
      hasRedirection: hasRedirect,
    };
  }

  // Default: unknown command
  return {
    pattern: `bash:${baseCmd}`,
    displayName: baseCmd,
    command,
    isDestructive: false,
    referencedPaths: paths,
    hasRedirection: hasRedirect,
  };
}

/**
 * Parse a single command segment into a ParsedAction
 */
export function parseCommandSegment(command: string): ParsedAction {
  const trimmed = command.trim();
  const baseCmd = extractBaseCommand(trimmed);

  // Git commands
  if (baseCmd === 'git') {
    return parseGitCommand(trimmed);
  }

  // Package manager commands
  if (['npm', 'yarn', 'pnpm', 'npx'].includes(baseCmd)) {
    return parsePackageManagerCommand(trimmed);
  }

  // Default bash command parsing
  return parseBashCommand(trimmed);
}

/**
 * Parse a full command string (may contain compound commands)
 */
export function parseCommand(command: string): ParsedCommand {
  const segments = splitCompoundCommand(command);
  const actions = segments.map((segment) => parseCommandSegment(segment));

  return {
    original: command,
    actions,
  };
}

/**
 * Check if a parsed action matches a pattern (supports wildcards)
 */
export function matchesPattern(action: ParsedAction, pattern: string): boolean {
  // Exact match
  if (action.pattern === pattern) {
    return true;
  }

  // Wildcard matching (e.g., 'git:*' matches 'git:push')
  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -1); // Remove the '*'
    return action.pattern.startsWith(prefix);
  }

  return false;
}

/**
 * Check if an action is in the read-only allowlist
 */
export function isReadOnlyAllowed(action: ParsedAction): boolean {
  // Git read-only commands
  if (action.pattern.startsWith('git:')) {
    const subcommand = action.pattern.replace('git:', '');
    if (GIT_READ_ONLY_SUBCOMMANDS.has(subcommand)) {
      // Make sure it's not a destructive variant
      return !action.isDestructive;
    }
  }

  // Bash read-only commands
  if (action.pattern.startsWith('bash:')) {
    const cmd = action.pattern.replace('bash:', '');
    // Check base command (handle patterns like 'bash:ls', 'bash:cat')
    if (READ_ONLY_COMMANDS.has(cmd)) {
      return true;
    }
  }

  // npm read-only commands
  if (action.pattern.startsWith('npm:')) {
    const subcommand = action.pattern.replace('npm:', '');
    if (['list', 'ls', 'outdated', 'view', 'info', 'search'].includes(subcommand)) {
      return true;
    }
  }

  return false;
}
