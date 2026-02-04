/**
 * Cross-platform path utilities for the renderer process.
 * Uses pathe library for consistent handling of Windows/Unix paths.
 */

import { basename, dirname, join, relative, normalize } from 'pathe';

/**
 * Extract the filename from a path (cross-platform)
 * @param filePath - Full file path
 * @returns Just the filename
 */
export function getFileName(filePath: string): string {
  if (!filePath) return '';
  return basename(filePath);
}

/**
 * Get the directory containing a file (cross-platform)
 * @param filePath - Full file path
 * @returns Parent directory path
 */
export function getDirName(filePath: string): string {
  if (!filePath) return '.';
  return dirname(filePath);
}

/**
 * Get the path relative to a base path (cross-platform)
 * @param from - Base path
 * @param to - Target path
 * @returns Relative path from base to target
 */
export function getRelativePath(from: string, to: string): string {
  if (!from || !to) return to || '';
  return relative(from, to);
}

/**
 * Get the directory path relative to workspace (without the filename)
 * Useful for displaying where a file lives within a project
 * @param filePath - Full file path
 * @param workspacePath - Workspace root path
 * @returns Directory path relative to workspace, normalized to forward slashes
 */
export function getRelativeDir(filePath: string, workspacePath: string): string {
  if (!filePath || !workspacePath) return '';
  const dir = dirname(filePath);
  return relative(workspacePath, dir);
}

/**
 * Normalize a path (resolves . and .., normalizes slashes)
 * @param filePath - Path to normalize
 * @returns Normalized path
 */
export function normalizePath(filePath: string): string {
  if (!filePath) return '';
  return normalize(filePath);
}

/**
 * Join path segments (cross-platform)
 * @param paths - Path segments to join
 * @returns Joined path
 */
export function joinPath(...paths: string[]): string {
  return join(...paths);
}

/**
 * Resolve a plan file path to an absolute path.
 * Handles cross-platform path separators and both relative and absolute paths.
 * @param planFilePath - The plan file path (relative like "plans/feature.md" or absolute)
 * @param basePath - The base path (workspace or worktree path) for resolving relative paths
 * @returns Absolute path to the plan file, or null if inputs are invalid
 */
export function resolvePlanFilePath(planFilePath: string | undefined, basePath: string | undefined): string | null {
  if (!planFilePath || !basePath) return null;

  // Normalize path separators for cross-platform compatibility
  const normalizedPath = normalize(planFilePath);

  // Check for absolute path (Unix: starts with /, Windows: starts with drive letter like C:)
  const isAbsolute = normalizedPath.startsWith('/') || /^[A-Za-z]:/.test(normalizedPath);

  return isAbsolute ? normalizedPath : join(basePath, normalizedPath);
}

/**
 * Extract the worktree or directory name from a path (cross-platform)
 * Handles both Unix (/) and Windows (\) path separators.
 * Useful when you need the final path segment from a worktree path or any directory path.
 * @param path - Full path (can be null or undefined)
 * @param defaultValue - Default value if path is empty or invalid (defaults to 'unknown')
 * @returns The final path segment, or the default value if path is empty
 */
export function getWorktreeNameFromPath(path: string | null | undefined, defaultValue = 'unknown'): string {
  if (!path) return defaultValue;
  // Handle both Unix (/) and Windows (\) path separators
  return path.split(/[\\/]/).pop() || defaultValue;
}

// Re-export pathe functions for direct use if needed
export { basename, dirname, join, relative, normalize } from 'pathe';
