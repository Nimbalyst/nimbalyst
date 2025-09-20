/**
 * Register the PlanStatusPlugin from runtime
 */

import { pluginRegistry } from 'rexical';
import { planStatusPluginPackage } from '@stravu/runtime';

// Register the plugin
export function registerPlanStatusPlugin(): void {
  pluginRegistry.register(planStatusPluginPackage);
}