/**
 * Register the PlanStatusPlugin with the Electron-specific document service
 */

import { pluginRegistry } from 'rexical';
import { planStatusPluginPackage } from '@stravu/runtime';
import { getDocumentService } from '../services/RendererDocumentService';

// Make document service globally available for the PlanTableComponent
declare global {
  interface Window {
    documentService: any;
  }
}

// Register the plugin and expose document service
export function registerPlanStatusPlugin(): void {
  // Get the document service instance
  const documentService = getDocumentService();

  // Make it available globally for the PlanTableComponent
  if (typeof window !== 'undefined') {
    window.documentService = documentService;
    // console.log('[registerPlanStatusPlugin] Document service exposed to window:', documentService);
    // console.log('[registerPlanStatusPlugin] Has listDocumentMetadata method:', !!documentService.listDocumentMetadata);
  }

  // Register the plugin
  pluginRegistry.register(planStatusPluginPackage);
  // console.log('[registerPlanStatusPlugin] Plugin registered');
}
