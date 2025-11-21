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

// Re-export pathe functions for direct use if needed
export { basename, dirname, join, relative, normalize } from 'pathe';
