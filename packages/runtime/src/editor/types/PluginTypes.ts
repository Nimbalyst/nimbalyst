/**
 * Plugin Package System for Nimbalyst
 *
 * This system allows plugins to be self-contained units that bring their own:
 * - React component (the actual plugin)
 * - Lexical nodes
 * - Markdown transformers
 * - Commands
 */

import type { Klass, LexicalCommand, LexicalNode } from 'lexical';
import type { Transformer } from '@lexical/markdown';
import type { ComponentType } from 'react';

export interface UserCommand {
  /** Display name for the command */
  title: string;

  /** Optional description */
  description?: string;

  /** Optional icon (emoji or icon name) */
  icon?: string;

  /** Keywords for searching */
  keywords?: string[];

  /** The command to execute */
  command: LexicalCommand<any>;

  /** Optional payload for the command */
  payload?: any;
}

/** Dynamic option for the component picker menu */
export interface DynamicMenuOption {
  id: string;
  label: string;
  icon?: string;
  description?: string;
  keywords?: string[];
  onSelect: () => void;
}

export interface PluginPackage<T = any> {
  /** Unique identifier for the plugin */
  name: string;

  /** The React component that implements the plugin logic */
  Component?: ComponentType<T>;

  /** Lexical nodes that this plugin requires/provides */
  nodes?: Array<Klass<LexicalNode>>;

  /** Markdown transformers for import/export */
  transformers?: Array<Transformer>;

  /** Commands exported by this plugin for external use */
  commands?: Record<string, LexicalCommand<any>>;

  /** User-facing commands for ComponentPicker */
  userCommands?: UserCommand[];

  /**
   * Function to provide dynamic menu options for the component picker.
   * Called when user types in the component picker to get filtered options.
   * @param queryString - The current search query
   * @returns Array of dynamic options, or a Promise that resolves to them
   */
  getDynamicOptions?: (queryString: string) => DynamicMenuOption[] | Promise<DynamicMenuOption[]>;

  /** Optional configuration passed to the plugin component */
  config?: T;

  /** Dependencies on other plugins (by name) */
  dependencies?: string[];

  /** Whether this plugin is enabled by default */
  enabledByDefault?: boolean;
}

