/**
 * Extension Platform Service Interface
 *
 * Defines platform-specific operations needed by the extension system.
 * Each platform (Electron, Capacitor) provides its own implementation.
 *
 * This abstraction allows the extension loader to work identically
 * across platforms while delegating platform-specific concerns
 * (file paths, module loading, etc.) to the platform implementation.
 */

import type { ExtensionModule } from './types';

/**
 * Platform-specific service for extension operations
 */
export interface ExtensionPlatformService {
  /**
   * Get the directory where user extensions are installed.
   * e.g., ~/Library/Application Support/@nimbalyst/extensions/ on macOS
   */
  getExtensionsDirectory(): Promise<string>;

  /**
   * List all subdirectories in a directory.
   * Used to discover extensions in the extensions directory.
   * @param dirPath - Absolute path to the directory
   * @returns Array of subdirectory names (not full paths)
   */
  listDirectories(dirPath: string): Promise<string[]>;

  /**
   * Read a file as text.
   * @param filePath - Absolute path to the file
   * @returns File contents as string
   */
  readFile(filePath: string): Promise<string>;

  /**
   * Write content to a file.
   * @param filePath - Absolute path to the file
   * @param content - Content to write
   */
  writeFile(filePath: string, content: string): Promise<void>;

  /**
   * Check if a file exists.
   * @param filePath - Absolute path to the file
   */
  fileExists(filePath: string): Promise<boolean>;

  /**
   * Load a JavaScript module from the given path.
   * Handles platform-specific module loading (file:// URLs, etc.)
   * @param modulePath - Absolute path to the JS file
   * @returns The loaded module
   */
  loadModule(modulePath: string): Promise<ExtensionModule>;

  /**
   * Inject CSS styles into the document.
   * @param css - CSS content to inject
   * @returns A function to remove the injected styles
   */
  injectStyles(css: string): () => void;

  /**
   * Resolve a relative path from an extension's root.
   * @param extensionPath - Absolute path to the extension root
   * @param relativePath - Relative path from extension root
   * @returns Absolute path
   */
  resolvePath(extensionPath: string, relativePath: string): string;

  /**
   * Get files matching a glob pattern in a directory.
   * @param dirPath - Base directory for the search
   * @param pattern - Glob pattern (e.g., "*.datamodel")
   * @returns Array of absolute file paths
   */
  findFiles(dirPath: string, pattern: string): Promise<string[]>;
}

// ============================================================================
// Global Service Instance
// ============================================================================

let extensionPlatformService: ExtensionPlatformService | null = null;

/**
 * Set the platform-specific ExtensionPlatformService implementation.
 * Should be called once during app initialization by the platform layer.
 */
export function setExtensionPlatformService(
  service: ExtensionPlatformService
): void {
  extensionPlatformService = service;
}

/**
 * Get the current ExtensionPlatformService implementation.
 * Throws if the service hasn't been initialized.
 */
export function getExtensionPlatformService(): ExtensionPlatformService {
  if (!extensionPlatformService) {
    throw new Error(
      'ExtensionPlatformService not initialized. Call setExtensionPlatformService first.'
    );
  }
  return extensionPlatformService;
}

/**
 * Check if the ExtensionPlatformService has been initialized.
 */
export function hasExtensionPlatformService(): boolean {
  return extensionPlatformService !== null;
}
