/**
 * Core types for Nimbalyst theme system.
 *
 * Themes are separate from extensions - they provide styling only, no code.
 * This module defines the schema for theme.json manifests and theme metadata.
 */

/**
 * Available theme color keys that can be overridden.
 * These map to CSS variables (--nim-*) used throughout the UI.
 */
export type ThemeColorKey =
  // Background hierarchy
  | 'bg' | 'bg-secondary' | 'bg-tertiary' | 'bg-hover' | 'bg-selected' | 'bg-active'
  // Text variants
  | 'text' | 'text-muted' | 'text-faint' | 'text-disabled'
  // Borders
  | 'border' | 'border-focus'
  // Primary/brand colors
  | 'primary' | 'primary-hover'
  // Links
  | 'link' | 'link-hover'
  // Status colors
  | 'success' | 'warning' | 'error' | 'info';

/**
 * Theme color values.
 * All colors are optional - missing colors will fall back to base theme.
 */
export type ThemeColors = Partial<Record<ThemeColorKey, string>>;

/**
 * Theme manifest schema (theme.json).
 * This is the schema for standalone theme packages.
 */
export interface ThemeManifest {
  /** Unique theme identifier (e.g., 'solarized-dark') */
  id: string;

  /** Display name shown in UI */
  name: string;

  /** Semantic version */
  version: string;

  /** Theme author name or organization */
  author?: string;

  /** Brief description */
  description?: string;

  /** Whether this is a dark theme (determines base theme for fallbacks) */
  isDark: boolean;

  /**
   * Theme color overrides.
   * Only include colors you want to override from the base theme.
   * All color values must be valid hex codes or CSS color names.
   */
  colors: ThemeColors;

  /** Path to preview image (relative to theme.json) */
  preview?: string;

  /** Tags for discovery and filtering */
  tags?: string[];

  /** License identifier (SPDX) */
  license?: string;

  /** Homepage or repository URL */
  homepage?: string;
}

/**
 * Full theme object with metadata and resolved colors.
 * This is what's used at runtime after loading a theme.
 */
export interface Theme {
  /** Theme ID (unique across all themes) */
  id: string;

  /** Display name */
  name: string;

  /** Semantic version */
  version: string;

  /** Author */
  author?: string;

  /** Description */
  description?: string;

  /** Is dark theme */
  isDark: boolean;

  /** Resolved color values (merged with base theme) */
  colors: ThemeColors;

  /** Tags */
  tags?: string[];

  /** Preview image path (absolute) */
  previewPath?: string;

  /** Source of the theme */
  source: ThemeSource;
}

/**
 * Where the theme came from.
 */
export type ThemeSource =
  | { type: 'builtin' }                      // Built-in theme (light, dark, crystal-dark)
  | { type: 'user'; installPath: string }    // User-installed theme
  | { type: 'extension'; extensionId: string }; // Theme from extension (deprecated)

/**
 * Marketplace theme metadata.
 * Used for browsing and discovering themes before installation.
 */
export interface MarketplaceTheme {
  /** Theme ID */
  id: string;

  /** Display name */
  name: string;

  /** Author */
  author: string;

  /** Version */
  version: string;

  /** Description */
  description: string;

  /** Download count */
  downloads: number;

  /** Average rating (0-5) */
  rating: number;

  /** Tags */
  tags: string[];

  /** URL to preview image */
  preview: string;

  /** URL to download .nimtheme file */
  downloadUrl: string;

  /** Last update timestamp */
  lastUpdated: string;

  /** License */
  license?: string;

  /** Homepage URL */
  homepage?: string;
}

/**
 * Theme validation result.
 */
export interface ThemeValidationResult {
  /** Whether the theme is valid */
  valid: boolean;

  /** Validation errors (if any) */
  errors: string[];

  /** Validation warnings (non-fatal) */
  warnings: string[];
}

/**
 * Theme installation options.
 */
export interface ThemeInstallOptions {
  /** Path to .nimtheme file or directory */
  source: string;

  /** Whether to overwrite existing theme with same ID */
  overwrite?: boolean;
}

/**
 * Theme uninstall options.
 */
export interface ThemeUninstallOptions {
  /** Theme ID to uninstall */
  themeId: string;

  /** Whether to keep theme files (just disable) */
  keepFiles?: boolean;
}
