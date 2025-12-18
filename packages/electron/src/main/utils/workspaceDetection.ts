import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
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

/**
 * Checks if a workspace directory is a Nimbalyst extension project.
 * An extension project is identified by having a manifest.json with an 'id' field
 * that looks like an extension ID (contains a dot, e.g., 'com.example.my-extension').
 *
 * @param workspacePath - Absolute path to the workspace directory
 * @returns true if the workspace appears to be an extension project
 */
export function isExtensionProject(workspacePath: string): boolean {
  if (!workspacePath) {
    return false;
  }

  const manifestPath = path.join(workspacePath, 'manifest.json');

  try {
    if (!fs.existsSync(manifestPath)) {
      return false;
    }

    const manifestContent = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestContent);

    // Check for extension-like manifest structure:
    // - Has an 'id' field with a dot (like 'com.example.extension')
    // - Has a 'name' field
    // - Has 'contributions' or 'main' field (extension entry point indicators)
    if (
      manifest.id &&
      typeof manifest.id === 'string' &&
      manifest.id.includes('.') &&
      manifest.name &&
      (manifest.contributions || manifest.main)
    ) {
      return true;
    }
  } catch (error) {
    // Invalid JSON or read error - not an extension project
  }

  return false;
}

/**
 * Gets the path to the Extension SDK documentation.
 * In development, this is the source folder. In production, it's bundled in resources.
 *
 * @returns The path to the SDK docs, or null if not found
 */
export function getExtensionSDKDocsPath(): string | null {
  // In development: use the source folder
  // __dirname is packages/electron/out/main when running from built code
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    // Go up to packages/electron, then to packages/extension-sdk-docs
    const devPath = path.join(__dirname, '..', '..', '..', 'extension-sdk-docs');
    if (fs.existsSync(devPath)) {
      return devPath;
    }
  }

  // In production: use bundled resources
  const resourcesPath = path.join(process.resourcesPath, 'extension-sdk-docs');
  if (fs.existsSync(resourcesPath)) {
    return resourcesPath;
  }

  return null;
}

/**
 * Gets additional directories that should be accessible to Claude for the given workspace.
 * Currently, this adds the Extension SDK documentation when working on an extension project.
 *
 * @param workspacePath - The current workspace path
 * @returns Array of additional directory paths Claude should have access to
 */
export function getAdditionalDirectoriesForWorkspace(workspacePath: string): string[] {
  const additionalDirs: string[] = [];

  // If this is an extension project, add the SDK docs
  if (isExtensionProject(workspacePath)) {
    const sdkDocsPath = getExtensionSDKDocsPath();
    if (sdkDocsPath) {
      additionalDirs.push(sdkDocsPath);
    }
  }

  return additionalDirs;
}
