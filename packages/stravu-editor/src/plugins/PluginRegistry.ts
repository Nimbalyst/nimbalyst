/**
 * Simple Plugin Registry - if it's registered, it's enabled
 */

import type { Klass, LexicalNode } from 'lexical';
import type { Transformer } from '@lexical/markdown';
import type { PluginPackage, UserCommand } from '../types/PluginTypes';

class PluginRegistryImpl {
  private plugins = new Map<string, PluginPackage>();

  register(plugin: PluginPackage): void {
    if (this.plugins.has(plugin.name)) {
      console.warn(`Plugin "${plugin.name}" is already registered. Overwriting.`);
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

  getAllTransformers(): Array<Transformer> {
    const transformers: Array<Transformer> = [];
    
    for (const plugin of this.plugins.values()) {
      if (plugin.transformers) {
        transformers.push(...plugin.transformers);
      }
    }
    
    return transformers;
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
}

// Singleton instance
export const pluginRegistry = new PluginRegistryImpl();
