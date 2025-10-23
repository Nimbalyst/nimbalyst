/**
 * Register the unified Tracker Plugin
 * This initializes the document header system and loads tracker data models
 */

import {
  ModelLoader,
  DocumentHeaderRegistry,
  TrackerDocumentHeader,
  shouldRenderTrackerHeader
} from '@nimbalyst/runtime/plugins/TrackerPlugin';

export function registerTrackerPlugin() {
  // Initialize the ModelLoader singleton to load built-in trackers
  ModelLoader.getInstance();

  // Register the tracker document header provider
  DocumentHeaderRegistry.register({
    id: 'tracker-document-header',
    priority: 100, // High priority
    shouldRender: shouldRenderTrackerHeader,
    component: TrackerDocumentHeader,
  });

  console.log('[TrackerPlugin] Registered and initialized');
}
