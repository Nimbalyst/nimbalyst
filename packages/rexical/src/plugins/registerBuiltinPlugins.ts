/**
 * Registration of built-in plugins and their transformers.
 * These plugins are always available and automatically registered.
 */

import { pluginRegistry } from './PluginRegistry';
import type { PluginPackage } from '../types/PluginTypes';

// Import transformers from each plugin
import { TABLE_TRANSFORMER } from './TablePlugin/TableTransformer';
import { IMAGE_TRANSFORMER } from './ImagesPlugin/ImageTransformer';
import { EMOJI_TRANSFORMER } from './EmojisPlugin/EmojiTransformer';
import { COLLAPSIBLE_TRANSFORMER } from './CollapsiblePlugin/CollapsibleTransformer';
import { BOARD_TABLE_TRANSFORMER } from './KanbanBoardPlugin/BoardTableTransformer';
import { ExcalidrawTransform } from './ExcalidrawPlugin/ExcalidrawNode/excalidrawTransform';
import { MERMAID_TRANSFORMER } from './MermaidPlugin/MermaidTransformer';
import MermaidPlugin, { INSERT_MERMAID_COMMAND } from './MermaidPlugin';
import { MermaidNode } from './MermaidPlugin/MermaidNode';

// Note: Nodes are already registered via EditorNodes.ts,
// so we don't need to import them here.
// We're only registering the transformers.

/**
 * Register all built-in plugins with the registry.
 * This should be called once during application initialization.
 */
export function registerBuiltinPlugins(): void {
  // Table Plugin
  const tablePlugin: PluginPackage = {
    name: 'TablePlugin',
    Component: () => null, // Table plugin is handled by TablePlugin component
    // Nodes are registered via EditorNodes.ts
    transformers: [TABLE_TRANSFORMER],
    enabledByDefault: true,
  };
  pluginRegistry.register(tablePlugin);

  // Images Plugin
  const imagesPlugin: PluginPackage = {
    name: 'ImagesPlugin',
    Component: () => null, // Images plugin is handled by ImagesPlugin component
    // Nodes are registered via EditorNodes.ts
    transformers: [IMAGE_TRANSFORMER],
    enabledByDefault: true,
  };
  pluginRegistry.register(imagesPlugin);

  // Emoji Plugin
  const emojiPlugin: PluginPackage = {
    name: 'EmojiPlugin',
    // Nodes are registered via EditorNodes.ts
    transformers: [EMOJI_TRANSFORMER],
    enabledByDefault: true,
  };
  pluginRegistry.register(emojiPlugin);

  // Collapsible Plugin
  const collapsiblePlugin: PluginPackage = {
    name: 'CollapsiblePlugin',
    // Nodes are registered via EditorNodes.ts
    transformers: [COLLAPSIBLE_TRANSFORMER],
    enabledByDefault: true,
  };
  pluginRegistry.register(collapsiblePlugin);

  // Kanban Board Plugin
  const kanbanPlugin: PluginPackage = {
    name: 'KanbanBoardPlugin',
    // Nodes are registered via EditorNodes.ts
    transformers: [BOARD_TABLE_TRANSFORMER],
    enabledByDefault: true,
  };
  pluginRegistry.register(kanbanPlugin);

  // Excalidraw Plugin
  const excalidrawPlugin: PluginPackage = {
    name: 'ExcalidrawPlugin',
    // Nodes are registered via EditorNodes.ts
    transformers: [ExcalidrawTransform],
    enabledByDefault: true,
  };
  pluginRegistry.register(excalidrawPlugin);

  // Mermaid Plugin
  const mermaidPlugin: PluginPackage = {
    name: 'MermaidPlugin',
    Component: MermaidPlugin,
    nodes: [MermaidNode],
    transformers: [MERMAID_TRANSFORMER],
    userCommands: [
      {
        title: 'Mermaid Diagram',
        description: 'Insert a Mermaid diagram for flowcharts, sequence diagrams, and more',
        icon: 'account_tree',
        keywords: ['mermaid', 'diagram', 'flowchart', 'sequence', 'chart', 'graph', 'uml'],
        command: INSERT_MERMAID_COMMAND,
      },
    ],
    enabledByDefault: true,
  };
  pluginRegistry.register(mermaidPlugin);
}