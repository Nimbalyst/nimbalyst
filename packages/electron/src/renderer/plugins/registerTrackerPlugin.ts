/**
 * Register the unified TrackerPlugin with the plugin registry
 */

import { pluginRegistry } from 'rexical';
import { trackerPluginPackage, loadBuiltinTrackers, globalRegistry, parseTrackerYAML } from '@nimbalyst/runtime';
import { getDocumentService } from '../services/RendererDocumentService';
import * as path from 'path';

export async function registerTrackerPlugin(workspacePath?: string | null): Promise<void> {
  // console.log('[TrackerPlugin] registerTrackerPlugin called with workspacePath:', workspacePath);

  // Load built-in tracker models
  loadBuiltinTrackers();

  // Custom trackers will be loaded dynamically in App.tsx BEFORE plugin registration
  // This is just for backwards compatibility if called with workspacePath

  if (workspacePath && window.electronAPI?.readFileContent) {
    try {
      const trackersDir = `${workspacePath}/.nimbalyst/trackers`;
      console.log('[TrackerPlugin] Loading custom trackers from:', trackersDir);

      // List files in trackers directory
      const files = await window.electronAPI.getFolderContents(trackersDir);
      const yamlFiles = files.filter(f =>
        f.type === 'file' && (f.name.endsWith('.yaml') || f.name.endsWith('.yml'))
      );

      if (yamlFiles.length === 0) {
        console.log('[TrackerPlugin] No YAML tracker files found');
        return;
      }

      console.log(`[TrackerPlugin] Found ${yamlFiles.length} tracker files:`, yamlFiles.map(f => f.name));

      // Load each tracker file
      for (const file of yamlFiles) {
        try {
          const filePath = path.join(trackersDir, file.name);
          const result = await window.electronAPI.readFileContent(filePath);

          if (result && result.success) {
            const model = parseTrackerYAML(result.content);
            globalRegistry.register(model);
            console.log(`[TrackerPlugin] Registered custom tracker: ${model.type} (${model.displayName})`);
          }
        } catch (error) {
          console.error(`[TrackerPlugin] Failed to load ${file.name}:`, error);
        }
      }
    } catch (error) {
      console.error('[TrackerPlugin] Failed to load custom trackers:', error);
    }
  }

  // Register the unified tracker plugin
  pluginRegistry.register(trackerPluginPackage);

  // Expose globalRegistry on window so rexical package can access it
  // (rexical cannot import from @nimbalyst/runtime)
  (window as any).__trackerRegistry = globalRegistry;

  // Expose document service on window for TrackerBottomPanel and other components
  const documentService = getDocumentService();
  if (documentService) {
    (window as any).documentService = documentService;
  }
}
