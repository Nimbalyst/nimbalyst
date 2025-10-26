/**
 * Register the unified TrackerPlugin with the plugin registry
 */

import { pluginRegistry } from 'rexical';
import { trackerPluginPackage, loadBuiltinTrackers } from '@nimbalyst/runtime';
import { getDocumentService } from '../services/RendererDocumentService';

export function registerTrackerPlugin(): void {
  // Load built-in tracker models
  loadBuiltinTrackers();

  // Register the unified tracker plugin
  pluginRegistry.register(trackerPluginPackage);

  // Expose document service on window for TrackerBottomPanel and other components
  const documentService = getDocumentService();
  if (documentService) {
    (window as any).documentService = documentService;
  }
}
