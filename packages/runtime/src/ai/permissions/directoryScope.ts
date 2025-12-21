/**
 * Directory Scope Checking for Agentic Tool Permissions
 *
 * Ensures that agent commands can only access files within the trusted workspace directory.
 */

import * as path from 'path';

export interface PathCheckResult {
  /** Whether the path is allowed (within workspace) */
  allowed: boolean;
  /** The resolved absolute path */
  resolvedPath: string;
  /** If not allowed, the reason why */
  reason?: 'outside_workspace' | 'symlink_escape' | 'invalid_path';
}

/**
 * Normalize a path by resolving . and .. segments without following symlinks
 * This is a pure path manipulation - doesn't check if path exists
 */
export function normalizePath(inputPath: string): string {
  // Handle empty path
  if (!inputPath) {
    return '';
  }

  // Use path.normalize to handle . and ..
  return path.normalize(inputPath);
}

/**
 * Resolve a potentially relative path against a base directory
 */
export function resolvePath(inputPath: string, basePath: string): string {
  if (!inputPath) {
    return basePath;
  }

  // If already absolute, just normalize
  if (path.isAbsolute(inputPath)) {
    return normalizePath(inputPath);
  }

  // Resolve relative to base
  return normalizePath(path.join(basePath, inputPath));
}

/**
 * Check if a path is within a given directory
 */
export function isPathWithinDirectory(
  inputPath: string,
  directoryPath: string,
  basePath?: string
): boolean {
  if (!inputPath || !directoryPath) {
    return false;
  }

  const normalizedDirectory = normalizePath(directoryPath);
  const resolvedPath = basePath ? resolvePath(inputPath, basePath) : normalizePath(inputPath);

  // Check if path starts with directory (is within it)
  return resolvedPath.startsWith(normalizedDirectory + '/') || resolvedPath === normalizedDirectory;
}

/**
 * Check if a path is within the workspace directory or any additional directories
 *
 * This uses pure path manipulation - doesn't follow symlinks or check if files exist.
 * For symlink safety, use isPathWithinWorkspaceStrict which actually resolves symlinks.
 */
export function isPathWithinWorkspace(
  inputPath: string,
  workspacePath: string,
  additionalDirectories?: Array<{ path: string; canWrite: boolean }>
): boolean {
  if (!inputPath || !workspacePath) {
    return false;
  }

  const normalizedWorkspace = normalizePath(workspacePath);
  const resolvedPath = resolvePath(inputPath, workspacePath);

  // Check if within workspace
  if (resolvedPath.startsWith(normalizedWorkspace + '/') || resolvedPath === normalizedWorkspace) {
    return true;
  }

  // Check if within any additional directories
  if (additionalDirectories) {
    for (const dir of additionalDirectories) {
      if (isPathWithinDirectory(resolvedPath, dir.path)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check a path and return detailed result
 */
export function checkPath(
  inputPath: string,
  workspacePath: string
): PathCheckResult {
  if (!inputPath) {
    return {
      allowed: false,
      resolvedPath: '',
      reason: 'invalid_path',
    };
  }

  const resolvedPath = resolvePath(inputPath, workspacePath);

  if (!isPathWithinWorkspace(inputPath, workspacePath)) {
    return {
      allowed: false,
      resolvedPath,
      reason: 'outside_workspace',
    };
  }

  return {
    allowed: true,
    resolvedPath,
  };
}

/**
 * Check multiple paths and return results for each
 */
export function checkPaths(
  paths: string[],
  workspacePath: string
): Map<string, PathCheckResult> {
  const results = new Map<string, PathCheckResult>();

  for (const inputPath of paths) {
    results.set(inputPath, checkPath(inputPath, workspacePath));
  }

  return results;
}

/**
 * Check if all paths in a list are within the workspace
 */
export function allPathsWithinWorkspace(
  paths: string[],
  workspacePath: string
): boolean {
  return paths.every((p) => isPathWithinWorkspace(p, workspacePath));
}

/**
 * Get paths that are outside the workspace
 */
export function getOutsidePaths(
  paths: string[],
  workspacePath: string
): string[] {
  return paths.filter((p) => !isPathWithinWorkspace(p, workspacePath));
}

/**
 * Common sensitive paths that should always be flagged
 * These are paths that could contain secrets or system configuration
 */
export const SENSITIVE_PATH_PATTERNS = [
  // SSH keys
  /\.ssh\//,
  /\.ssh$/,

  // AWS credentials
  /\.aws\//,
  /\.aws$/,

  // GPG keys
  /\.gnupg\//,
  /\.gnupg$/,

  // Environment files (often contain secrets)
  /\.env$/,
  /\.env\./,

  // Password/credential files
  /password/i,
  /credential/i,
  /secret/i,

  // System directories
  /^\/etc\//,
  /^\/var\/log\//,

  // Home directory config
  /^\~\//,
  /^\/Users\/[^/]+\/\./,
  /^\/home\/[^/]+\/\./,
];

/**
 * Check if a path matches any sensitive patterns
 */
export function isSensitivePath(inputPath: string): boolean {
  const normalizedPath = normalizePath(inputPath);
  return SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(normalizedPath));
}

/**
 * Check paths for sensitive patterns
 */
export function getSensitivePaths(paths: string[]): string[] {
  return paths.filter((p) => isSensitivePath(p));
}

/**
 * Comprehensive path check that considers both workspace scope and sensitivity
 */
export interface ComprehensivePathCheck {
  /** Original path */
  path: string;
  /** Resolved absolute path */
  resolvedPath: string;
  /** Whether path is within workspace */
  withinWorkspace: boolean;
  /** Whether path matches sensitive patterns */
  isSensitive: boolean;
  /** Whether the path should be allowed */
  allowed: boolean;
  /** Reasons why access might be restricted */
  warnings: string[];
}

export function comprehensivePathCheck(
  inputPath: string,
  workspacePath: string
): ComprehensivePathCheck {
  const resolvedPath = resolvePath(inputPath, workspacePath);
  const withinWorkspace = isPathWithinWorkspace(inputPath, workspacePath);
  const sensitive = isSensitivePath(inputPath) || isSensitivePath(resolvedPath);

  const warnings: string[] = [];

  if (!withinWorkspace) {
    warnings.push('Path is outside the workspace directory');
  }

  if (sensitive) {
    warnings.push('Path may contain sensitive data');
  }

  // Allowed if within workspace and not sensitive
  // Sensitive paths within workspace still need extra caution
  const allowed = withinWorkspace && !sensitive;

  return {
    path: inputPath,
    resolvedPath,
    withinWorkspace,
    isSensitive: sensitive,
    allowed,
    warnings,
  };
}

/**
 * Check all paths from a parsed command
 */
export function checkCommandPaths(
  paths: string[],
  workspacePath: string,
  additionalDirectories?: Array<{ path: string; canWrite: boolean }>
): {
  allAllowed: boolean;
  outsidePaths: string[];
  sensitivePaths: string[];
  checks: ComprehensivePathCheck[];
} {
  const checks = paths.map((p) => {
    const check = comprehensivePathCheck(p, workspacePath);

    // If path is outside workspace, check if it's within an additional directory
    if (!check.withinWorkspace && additionalDirectories) {
      for (const dir of additionalDirectories) {
        if (isPathWithinDirectory(check.path, dir.path)) {
          // Path is within an additional directory - update the check
          check.withinWorkspace = true;
          check.allowed = !check.isSensitive;
          check.warnings = check.warnings.filter(w => !w.includes('outside the workspace'));
          break;
        }
      }
    }

    return check;
  });

  return {
    allAllowed: checks.every((c) => c.allowed),
    outsidePaths: checks.filter((c) => !c.withinWorkspace).map((c) => c.path),
    sensitivePaths: checks.filter((c) => c.isSensitive).map((c) => c.path),
    checks,
  };
}
