/**
 * Register the unified TrackerPlugin with the plugin registry
 */

import { pluginRegistry } from '@nimbalyst/runtime';
import { trackerPluginPackage, loadBuiltinTrackers, globalRegistry, parseTrackerYAML } from '@nimbalyst/runtime';
import { getDocumentService } from '../services/RendererDocumentService';
import * as path from 'path';

export async function registerTrackerPlugin(workspacePath?: string | null): Promise<void> {
  // Try to fetch schemas from main-process TrackerSchemaService (authoritative source).
  // Falls back to local loading if the IPC API is not available.
  const api = (window as any).electronAPI;
  if (api?.trackerSchema?.getAll) {
    try {
      const schemas = await api.trackerSchema.getAll();
      if (schemas && schemas.length > 0) {
        for (const schema of schemas) {
          globalRegistry.register(schema);
        }
        // console.log(`[TrackerPlugin] Loaded ${schemas.length} schemas from main process`);

        // Subscribe to schema changes from main process
        api.trackerSchema.onChanged?.((updatedSchemas: any[]) => {
          for (const schema of updatedSchemas) {
            globalRegistry.register(schema);
          }
        });
      } else {
        // Main process had no schemas yet, fall back to local loading
        loadBuiltinTrackers();
      }
    } catch {
      // IPC failed, fall back to local loading
      loadBuiltinTrackers();
    }
  } else {
    // No IPC API available (e.g., mobile), load locally
    loadBuiltinTrackers();

    if (workspacePath && window.electronAPI?.readFileContent) {
      try {
        const trackersDir = `${workspacePath}/.nimbalyst/trackers`;
        const files = await window.electronAPI.getFolderContents(trackersDir);
        const yamlFiles = files.filter(f =>
          f.type === 'file' && (f.name.endsWith('.yaml') || f.name.endsWith('.yml'))
        );

        for (const file of yamlFiles) {
          try {
            const filePath = path.join(trackersDir, file.name);
            const result = await window.electronAPI.readFileContent(filePath);
            if (result && result.success) {
              const model = parseTrackerYAML(result.content);
              globalRegistry.register(model);
            }
          } catch (error) {
            console.error(`[TrackerPlugin] Failed to load ${file.name}:`, error);
          }
        }
      } catch (error) {
        console.error('[TrackerPlugin] Failed to load custom trackers:', error);
      }
    }
  }

  // Register the unified tracker plugin
  pluginRegistry.register(trackerPluginPackage);

  // Expose globalRegistry on window for cross-component access
  (window as any).__trackerRegistry = globalRegistry;

  // Expose document service on window for TrackerBottomPanel and other components
  const documentService = getDocumentService();
  if (documentService) {
    (window as any).documentService = documentService;
  }
}
