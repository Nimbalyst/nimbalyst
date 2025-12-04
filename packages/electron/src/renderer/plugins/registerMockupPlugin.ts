/**
 * Register the MockupPlugin with its Electron-specific platform service.
 *
 * This sets up the MockupPlatformService implementation that provides
 * the Electron-specific functionality for capturing screenshots and
 * opening mockups, and registers the plugin with the plugin registry.
 */

import {
  setMockupPlatformService,
  MockupPlugin,
  MockupNode,
  MOCKUP_TRANSFORMER,
  INSERT_MOCKUP_COMMAND,
} from '@nimbalyst/runtime';
import { pluginRegistry, type PluginPackage } from 'rexical';
import { MockupPlatformServiceImpl } from '../services/MockupPlatformServiceImpl';
import { showMockupPickerMenu } from '../components/MockupPickerMenu';

/**
 * Register the MockupPlugin with its platform service and the plugin registry.
 * Should be called once during app initialization.
 */
export function registerMockupPlugin(): void {
  // Set up the platform service
  const service = MockupPlatformServiceImpl.getInstance();

  // Override showMockupPicker to use our typeahead picker
  service.showMockupPicker = showMockupPickerMenu;

  setMockupPlatformService(service);

  // Register the plugin with the plugin registry
  const mockupPlugin: PluginPackage = {
    name: 'MockupPlugin',
    Component: MockupPlugin,
    nodes: [MockupNode],
    transformers: [MOCKUP_TRANSFORMER],
    userCommands: [
      {
        title: 'Mockup',
        description: 'Insert a mockup',
        icon: 'design_services',
        keywords: ['mockup', 'design', 'prototype', 'ui', 'layout'],
        command: INSERT_MOCKUP_COMMAND,
        // When called without payload, the plugin calls showMockupPicker which opens the picker menu
      },
    ],
    enabledByDefault: true,
  };
  pluginRegistry.register(mockupPlugin);
}
