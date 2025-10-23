/**
 * TrackerPlugin - Unified tracker system for inline and full-document tracking
 *
 * This plugin provides:
 * - Full-document tracking via document headers (replaces PlanStatusPlugin/DecisionStatusPlugin)
 * - Inline tracker items using # syntax
 * - Data-model driven UI components
 * - Unified storage in JSONB
 */

import { useEffect } from 'react';
import { DocumentHeaderRegistry } from './documentHeader/DocumentHeaderRegistry';
import { TrackerDocumentHeader, shouldRenderTrackerHeader } from './documentHeader/TrackerDocumentHeader';

/**
 * TrackerPlugin component - registers document header providers
 */
export function TrackerPlugin() {
  useEffect(() => {
    // Register the tracker document header provider
    const unregister = DocumentHeaderRegistry.register({
      id: 'tracker-document-header',
      priority: 100, // High priority
      shouldRender: shouldRenderTrackerHeader,
      component: TrackerDocumentHeader,
    });

    // Cleanup on unmount
    return () => {
      unregister();
    };
  }, []);

  // This plugin doesn't render anything itself
  return null;
}

// Export document header system for external use
export { DocumentHeaderRegistry } from './documentHeader/DocumentHeaderRegistry';
export type { DocumentHeaderProvider, DocumentHeaderComponentProps } from './documentHeader/DocumentHeaderRegistry';
export { DocumentHeaderContainer } from './documentHeader/DocumentHeaderContainer';
export { TrackerDocumentHeader, shouldRenderTrackerHeader } from './documentHeader/TrackerDocumentHeader';

// Export data models
export { ModelLoader } from './models/ModelLoader';
export type { TrackerDataModel, FieldDefinition } from './models/TrackerDataModel';

// Export components
export { StatusBar } from './components/StatusBar';
