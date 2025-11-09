/**
 * Tool Packages System
 *
 * Defines package bundles that group custom commands and tracker schemas
 * into cohesive feature sets for different user personas.
 */

/**
 * A custom command definition for Claude Code
 */
export interface CustomCommand {
  /** Command name (without leading slash) */
  name: string;
  /** Command description */
  description: string;
  /** Command content (markdown) */
  content: string;
}

/**
 * A tracker schema definition for the tracker system
 */
export interface TrackerSchema {
  /** Tracker type identifier */
  type: string;
  /** Display name (singular) */
  displayName: string;
  /** Display name (plural) */
  displayNamePlural: string;
  /** Material icon name */
  icon: string;
  /** Color hex code */
  color: string;
  /** Schema YAML content */
  yamlContent: string;
}

/**
 * Settings configuration for a package
 */
export interface PackageSettings {
  /** Default commands location (project or global) */
  commandsLocation?: 'project' | 'global';
  /** Other package-specific settings */
  [key: string]: any;
}

/**
 * Tool package definition
 */
export interface ToolPackage {
  /** Unique package identifier */
  id: string;
  /** Package display name */
  name: string;
  /** Package description */
  description: string;
  /** Material icon name */
  icon: string;
  /** Version string */
  version: string;
  /** Package author */
  author: string;
  /** Tags for categorization */
  tags: string[];
  /** Custom commands included in this package */
  customCommands: CustomCommand[];
  /** Tracker schemas included in this package */
  trackerSchemas: TrackerSchema[];
  /** Default settings for this package */
  settings?: PackageSettings;
  /** Dependencies on other packages */
  dependencies?: string[];
}

/**
 * Installed package state
 */
export interface InstalledPackage {
  /** Package ID */
  packageId: string;
  /** Installation timestamp */
  installedAt: string;
  /** Whether package is currently enabled */
  enabled: boolean;
  /** Customizations made to package contents */
  customizations?: {
    /** Disabled command names */
    disabledCommands?: string[];
    /** Disabled tracker types */
    disabledTrackers?: string[];
    /** Modified settings */
    settings?: Record<string, any>;
  };
}

/**
 * Package registry interface
 */
export interface PackageRegistry {
  /** All available packages */
  packages: ToolPackage[];
  /** Installed packages */
  installed: InstalledPackage[];
}
