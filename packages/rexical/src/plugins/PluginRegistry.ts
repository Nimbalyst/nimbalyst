/**
 * Simple Plugin Registry - if it's registered, it's enabled
 *
 * IMPORTANT: This registry only tracks PLUGIN-specific resources.
 * For transformers, use getEditorTransformers() from markdown/index.ts
 * which includes both plugin AND core transformers (lists, bold, italic, etc.)
 */

import type { Klass, LexicalNode } from 'lexical';
import type { Transformer } from '@lexical/markdown';
import type { PluginPackage, UserCommand, DynamicMenuOption } from '../types/PluginTypes';

class PluginRegistryImpl {
  private plugins = new Map<string, PluginPackage>();

  register(plugin: PluginPackage): void {
    if (this.plugins.has(plugin.name)) {
      // console.warn(`Plugin "${plugin.name}" is already registered. Overwriting.`);
    }
    this.plugins.set(plugin.name, plugin);
  }

  getAll(): PluginPackage[] {
    return Array.from(this.plugins.values());
  }

  get(name: string): PluginPackage | undefined {
    return this.plugins.get(name);
  }

  getAllNodes(): Array<Klass<LexicalNode>> {
    const nodes: Array<Klass<LexicalNode>> = [];
    const seen = new Set<Klass<LexicalNode>>();

    for (const plugin of this.plugins.values()) {
      if (plugin.nodes) {
        for (const node of plugin.nodes) {
          if (!seen.has(node)) {
            seen.add(node);
            nodes.push(node);
          }
        }
      }
    }

    return nodes;
  }

  /**
   * Get transformers from registered plugins only.
   * IMPORTANT: This does NOT include core transformers (lists, bold, italic, etc.)
   * Use getEditorTransformers() from markdown/index.ts for the complete set.
   *
   * @deprecated Prefer using getEditorTransformers() which includes both plugin and core transformers
   */
  getPluginTransformers(): Array<Transformer> {
    const transformers: Array<Transformer> = [];

    for (const plugin of this.plugins.values()) {
      if (plugin.transformers) {
        transformers.push(...plugin.transformers);
      }
    }

    return transformers;
  }

  /**
   * @deprecated Use getPluginTransformers() for clarity, or better yet use getEditorTransformers()
   */
  getAllTransformers(): Array<Transformer> {
    return this.getPluginTransformers();
  }

  getAllUserCommands(): Array<UserCommand> {
    const commands: Array<UserCommand> = [];

    for (const plugin of this.plugins.values()) {
      if (plugin.userCommands) {
        commands.push(...plugin.userCommands);
      }
    }

    return commands;
  }

  /**
   * Get dynamic menu options from all plugins that provide them.
   * @param queryString - The current search query
   * @returns Promise that resolves to array of dynamic options from all plugins
   */
  async getDynamicOptions(queryString: string): Promise<DynamicMenuOption[]> {
    const allOptions: DynamicMenuOption[] = [];

    for (const plugin of this.plugins.values()) {
      if (plugin.getDynamicOptions) {
        try {
          const options = await plugin.getDynamicOptions(queryString);
          allOptions.push(...options);
        } catch (error) {
          console.error(`[PluginRegistry] Error getting dynamic options from ${plugin.name}:`, error);
        }
      }
    }

    return allOptions;
  }
}

// Singleton instance
export const pluginRegistry = new PluginRegistryImpl();
