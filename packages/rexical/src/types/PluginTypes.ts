/**
 * Plugin Package System for Stravu Editor
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

  /** Optional configuration passed to the plugin component */
  config?: T;

  /** Dependencies on other plugins (by name) */
  dependencies?: string[];

  /** Whether this plugin is enabled by default */
  enabledByDefault?: boolean;
}

