/**
 * Register the ItemTrackerPlugin
 */

import { pluginRegistry } from 'rexical';
import { itemTrackerPluginPackage } from '@nimbalyst/runtime';

// Register the plugin
export function registerItemTrackerPlugin(): void {
  pluginRegistry.register(itemTrackerPluginPackage);
}
