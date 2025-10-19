/**
 * Register the AIChatIntegrationPlugin with the Electron app
 */

import { pluginRegistry, type PluginPackage } from 'rexical';
import { AIChatIntegrationPlugin } from '@nimbalyst/runtime/ai/plugins/AIChatIntegrationPlugin';

// Create plugin package for AI Chat Integration
const aiChatPluginPackage: PluginPackage = {
  name: 'AIChatIntegrationPlugin',
  Component: AIChatIntegrationPlugin,
  nodes: [],
  transformers: [],
  enabledByDefault: true
};

// Register the plugin
export function registerAIChatPlugin(): void {
  pluginRegistry.register(aiChatPluginPackage);
}
