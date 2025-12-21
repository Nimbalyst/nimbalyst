/**
 * Dangerous Pattern Detection
 *
 * Loads and matches commands against YAML-defined patterns for
 * detecting dangerous, risky, or significant operations.
 */

import { parse as parseYaml } from 'yaml';

/**
 * Severity levels for command patterns
 */
export type PatternSeverity = 'safe' | 'significant' | 'risky' | 'destructive';

/**
 * Categories of commands
 */
export type PatternCategory = 'git' | 'filesystem' | 'npm' | 'system' | 'docker' | 'other';

/**
 * A single check pattern definition
 */
export interface CheckPattern {
  /** Unique identifier for the check */
  id: string;
  /** Regex pattern to match */
  pattern: string;
  /** Human-readable description of what this command does */
  description: string;
  /** Severity level */
  severity: PatternSeverity;
  /** Category of command */
  category: PatternCategory;
  /** Compiled regex (populated at load time) */
  regex?: RegExp;
}

/**
 * Result of matching a command against patterns
 */
export interface PatternMatch {
  /** The matched pattern */
  pattern: CheckPattern;
  /** Whether the pattern matched */
  matched: boolean;
  /** The matching portion of the command */
  matchedText?: string;
}

/**
 * Built-in check patterns (embedded for environments without file access)
 */
const BUILTIN_PATTERNS: CheckPattern[] = [
  // Git - Destructive
  { id: 'git:reset-hard', pattern: 'git\\s+reset\\s+--hard', description: 'Hard reset will permanently discard uncommitted changes', severity: 'destructive', category: 'git' },
  { id: 'git:force-push', pattern: 'git\\s+push\\s+(-f|--force|--force-with-lease)', description: 'Force push will overwrite remote history', severity: 'destructive', category: 'git' },
  { id: 'git:clean-force', pattern: 'git\\s+clean\\s+(-f|-fd|-fx)', description: 'Will remove all untracked files and directories', severity: 'destructive', category: 'git' },
  { id: 'git:branch-force-delete', pattern: 'git\\s+branch\\s+(-D|--delete\\s+--force)', description: 'Force delete a branch even if not fully merged', severity: 'destructive', category: 'git' },
  { id: 'git:filter-branch', pattern: 'git\\s+filter-branch', description: 'Rewrite git history - can be dangerous if used incorrectly', severity: 'destructive', category: 'git' },
  { id: 'git:stash-clear', pattern: 'git\\s+stash\\s+clear', description: 'Delete all stash entries', severity: 'destructive', category: 'git' },

  // Git - Risky
  { id: 'git:rebase', pattern: 'git\\s+rebase', description: 'Rebase rewrites commit history', severity: 'risky', category: 'git' },
  { id: 'git:cherry-pick', pattern: 'git\\s+cherry-pick', description: 'Apply changes from existing commits to current branch', severity: 'risky', category: 'git' },
  { id: 'git:stash-drop', pattern: 'git\\s+stash\\s+drop', description: 'Delete a stash entry', severity: 'risky', category: 'git' },

  // Filesystem - Destructive
  { id: 'fs:rm-rf', pattern: 'rm\\s+(-rf|-fr|-r\\s+-f|-f\\s+-r)', description: 'Recursive forced delete', severity: 'destructive', category: 'filesystem' },
  { id: 'fs:rm-recursive', pattern: 'rm\\s+(-r|-R|--recursive)', description: 'Recursive delete', severity: 'destructive', category: 'filesystem' },
  { id: 'fs:dd', pattern: 'dd\\s+', description: 'Direct disk write - can destroy data', severity: 'destructive', category: 'filesystem' },
  { id: 'fs:mkfs', pattern: 'mkfs', description: 'Format filesystem - destroys all data', severity: 'destructive', category: 'filesystem' },
  { id: 'fs:find-delete', pattern: 'find\\s+.*-delete', description: 'Find and delete files', severity: 'destructive', category: 'filesystem' },
  { id: 'fs:shred', pattern: 'shred\\s+', description: 'Securely delete files (unrecoverable)', severity: 'destructive', category: 'filesystem' },

  // Filesystem - Risky
  { id: 'fs:rm', pattern: 'rm\\s+', description: 'Delete files', severity: 'risky', category: 'filesystem' },
  { id: 'fs:mv', pattern: 'mv\\s+', description: 'Move/rename files (can overwrite)', severity: 'risky', category: 'filesystem' },
  { id: 'fs:chmod-recursive', pattern: 'chmod\\s+(-R|--recursive)', description: 'Recursive permission change', severity: 'risky', category: 'filesystem' },

  // NPM - Destructive
  { id: 'npm:publish', pattern: 'npm\\s+publish', description: 'Publish package to npm registry', severity: 'destructive', category: 'npm' },
  { id: 'npm:unpublish', pattern: 'npm\\s+unpublish', description: 'Remove package from npm registry', severity: 'destructive', category: 'npm' },

  // NPM - Significant
  { id: 'npm:install', pattern: 'npm\\s+(install|i)(\\s|$)', description: 'Install dependencies', severity: 'significant', category: 'npm' },
  { id: 'npm:run', pattern: 'npm\\s+run', description: 'Run npm script', severity: 'significant', category: 'npm' },
  { id: 'npx:execute', pattern: 'npx\\s+', description: 'Execute npm package', severity: 'significant', category: 'npm' },

  // System - Destructive
  { id: 'system:reboot', pattern: 'reboot(\\s|$)', description: 'Reboot the system', severity: 'destructive', category: 'system' },
  { id: 'system:shutdown', pattern: 'shutdown(\\s|$)', description: 'Shutdown the system', severity: 'destructive', category: 'system' },
  { id: 'system:crontab-remove', pattern: 'crontab\\s+-r', description: 'Remove all cron jobs', severity: 'destructive', category: 'system' },
  { id: 'system:curl-pipe-bash', pattern: 'curl.*\\|.*(bash|sh)', description: 'Download and execute script', severity: 'destructive', category: 'system' },
  { id: 'system:fork-bomb', pattern: ':\\(\\)\\{\\s*:\\|:&\\s*\\};:', description: 'Fork bomb - will crash the system', severity: 'destructive', category: 'system' },

  // System - Risky
  { id: 'system:kill-9', pattern: 'kill\\s+-9', description: 'Force kill process', severity: 'risky', category: 'system' },
  { id: 'system:killall', pattern: 'killall\\s+', description: 'Kill processes by name', severity: 'risky', category: 'system' },
  { id: 'system:sudo-su', pattern: 'sudo\\s+su', description: 'Switch to root user', severity: 'risky', category: 'system' },

  // Docker - Destructive
  { id: 'docker:system-prune', pattern: 'docker\\s+system\\s+prune', description: 'Remove unused Docker data', severity: 'destructive', category: 'docker' },
  { id: 'docker:volume-prune', pattern: 'docker\\s+volume\\s+prune', description: 'Remove unused volumes', severity: 'destructive', category: 'docker' },
  { id: 'docker:compose-down-volumes', pattern: 'docker(-|\\s)compose\\s+down\\s+(-v|--volumes)', description: 'Stop containers and remove volumes', severity: 'destructive', category: 'docker' },

  // Docker - Risky
  { id: 'docker:rm', pattern: 'docker\\s+rm\\s+', description: 'Remove container', severity: 'risky', category: 'docker' },
  { id: 'docker:rmi', pattern: 'docker\\s+rmi\\s+', description: 'Remove image', severity: 'risky', category: 'docker' },
];

/**
 * Pattern registry that holds all loaded patterns
 */
class PatternRegistry {
  private patterns: CheckPattern[] = [];
  private compiledPatterns: Map<string, RegExp> = new Map();

  constructor() {
    this.loadBuiltinPatterns();
  }

  /**
   * Load built-in patterns
   */
  private loadBuiltinPatterns(): void {
    for (const pattern of BUILTIN_PATTERNS) {
      this.addPattern(pattern);
    }
  }

  /**
   * Add a pattern to the registry
   */
  addPattern(pattern: CheckPattern): void {
    // Compile the regex
    try {
      const regex = new RegExp(pattern.pattern, 'i');
      this.compiledPatterns.set(pattern.id, regex);
      this.patterns.push({ ...pattern, regex });
    } catch (e) {
      console.warn(`Failed to compile pattern ${pattern.id}: ${e}`);
    }
  }

  /**
   * Load patterns from YAML content
   */
  loadFromYaml(yamlContent: string): void {
    try {
      const patterns = parseYaml(yamlContent) as CheckPattern[];
      if (Array.isArray(patterns)) {
        for (const pattern of patterns) {
          if (pattern.id && pattern.pattern) {
            this.addPattern(pattern);
          }
        }
      }
    } catch (e) {
      console.warn(`Failed to parse YAML patterns: ${e}`);
    }
  }

  /**
   * Get all patterns
   */
  getAllPatterns(): CheckPattern[] {
    return [...this.patterns];
  }

  /**
   * Get patterns by category
   */
  getPatternsByCategory(category: PatternCategory): CheckPattern[] {
    return this.patterns.filter((p) => p.category === category);
  }

  /**
   * Get patterns by severity
   */
  getPatternsBySeverity(severity: PatternSeverity): CheckPattern[] {
    return this.patterns.filter((p) => p.severity === severity);
  }

  /**
   * Match a command against all patterns
   */
  matchCommand(command: string): PatternMatch[] {
    const matches: PatternMatch[] = [];

    for (const pattern of this.patterns) {
      const regex = this.compiledPatterns.get(pattern.id);
      if (regex) {
        const match = command.match(regex);
        if (match) {
          matches.push({
            pattern,
            matched: true,
            matchedText: match[0],
          });
        }
      }
    }

    return matches;
  }

  /**
   * Check if a command matches any destructive patterns
   */
  isDestructive(command: string): boolean {
    const matches = this.matchCommand(command);
    return matches.some((m) => m.pattern.severity === 'destructive');
  }

  /**
   * Check if a command matches any risky or destructive patterns
   */
  isRisky(command: string): boolean {
    const matches = this.matchCommand(command);
    return matches.some((m) => m.pattern.severity === 'risky' || m.pattern.severity === 'destructive');
  }

  /**
   * Get the highest severity level matched by a command
   */
  getHighestSeverity(command: string): PatternSeverity | null {
    const matches = this.matchCommand(command);
    if (matches.length === 0) return null;

    const severityOrder: PatternSeverity[] = ['safe', 'significant', 'risky', 'destructive'];
    let highest: PatternSeverity = 'safe';

    for (const match of matches) {
      if (severityOrder.indexOf(match.pattern.severity) > severityOrder.indexOf(highest)) {
        highest = match.pattern.severity;
      }
    }

    return highest;
  }

  /**
   * Get a human-readable warning for a command
   */
  getWarnings(command: string): string[] {
    const matches = this.matchCommand(command);
    return matches
      .filter((m) => m.pattern.severity === 'risky' || m.pattern.severity === 'destructive')
      .map((m) => m.pattern.description);
  }
}

// Global singleton instance
let globalRegistry: PatternRegistry | null = null;

/**
 * Get the global pattern registry
 */
export function getPatternRegistry(): PatternRegistry {
  if (!globalRegistry) {
    globalRegistry = new PatternRegistry();
  }
  return globalRegistry;
}

/**
 * Convenience function to check if a command is destructive
 */
export function isDestructiveCommand(command: string): boolean {
  return getPatternRegistry().isDestructive(command);
}

/**
 * Convenience function to check if a command is risky
 */
export function isRiskyCommand(command: string): boolean {
  return getPatternRegistry().isRisky(command);
}

/**
 * Convenience function to get warnings for a command
 */
export function getCommandWarnings(command: string): string[] {
  return getPatternRegistry().getWarnings(command);
}

/**
 * Convenience function to get the highest severity of a command
 */
export function getCommandSeverity(command: string): PatternSeverity | null {
  return getPatternRegistry().getHighestSeverity(command);
}

/**
 * Convenience function to match a command against patterns
 */
export function matchCommandPatterns(command: string): PatternMatch[] {
  return getPatternRegistry().matchCommand(command);
}

/**
 * Load additional patterns from YAML
 */
export function loadPatternsFromYaml(yamlContent: string): void {
  getPatternRegistry().loadFromYaml(yamlContent);
}

// Export the PatternRegistry class for direct use
export { PatternRegistry };
