import * as path from 'path';
import { getRecentItems } from './store';

/**
 * Detects which known workspace (if any) contains the given file path.
 * Checks recent workspaces and returns the workspace path if the file
 * is located within any known workspace directory.
 *
 * @param filePath - Absolute path to the file
 * @returns The workspace path if found, null otherwise
 */
export function detectFileWorkspace(filePath: string): string | null {
  if (!filePath || !path.isAbsolute(filePath)) {
    return null;
  }

  const recentWorkspaces = getRecentItems('workspaces');

  // Normalize the file path for comparison
  const normalizedFilePath = path.normalize(filePath);

  for (const workspace of recentWorkspaces) {
    const normalizedWorkspacePath = path.normalize(workspace.path);

    // Check if file is inside this workspace
    // Use path.sep to ensure we match complete directory names
    if (
      normalizedFilePath.startsWith(normalizedWorkspacePath + path.sep) ||
      normalizedFilePath === normalizedWorkspacePath
    ) {
      return workspace.path;
    }
  }

  return null;
}

/**
 * Finds the closest parent directory that could be a workspace root.
 * Looks for common project indicators like .git, package.json, etc.
 *
 * @param filePath - Absolute path to the file
 * @returns Suggested workspace path or the file's directory
 */
export function suggestWorkspaceForFile(filePath: string): string {
  const fs = require('fs');

  let currentDir = path.dirname(filePath);
  const root = path.parse(currentDir).root;

  // Walk up the directory tree looking for project indicators
  while (currentDir !== root) {
    // Check for common project root indicators
    const indicators = ['.git', 'package.json', '.vscode', '.idea', 'Cargo.toml', 'go.mod'];

    for (const indicator of indicators) {
      const indicatorPath = path.join(currentDir, indicator);
      try {
        if (fs.existsSync(indicatorPath)) {
          return currentDir;
        }
      } catch (err) {
        // Ignore errors checking for indicators
      }
    }

    // Move up one directory
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break; // Reached root
    }
    currentDir = parentDir;
  }

  // If no project root found, use the file's directory
  return path.dirname(filePath);
}
