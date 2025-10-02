/**
 * Register the AIChatIntegrationPlugin with the Electron app
 */

import { pluginRegistry, type PluginPackage } from 'rexical';
import { AIChatIntegrationPlugin } from '@stravu/runtime';

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
