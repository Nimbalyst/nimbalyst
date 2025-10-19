/**
 * Register the DecisionStatusPlugin with the Electron-specific document service
 */

import { pluginRegistry } from 'rexical';
import { decisionStatusPluginPackage } from '@nimbalyst/runtime';
import { getDocumentService } from '../services/RendererDocumentService';

// Make document service and workspacePath globally available for the DecisionTableComponent
declare global {
  interface Window {
    documentService: any;
    workspacePath?: string | null;
  }
}

// Register the plugin and expose document service
export function registerDecisionStatusPlugin(): void {
  // Get the document service instance
  const documentService = getDocumentService();

  // Make it available globally for the DecisionTableComponent
  if (typeof window !== 'undefined') {
    window.documentService = documentService;
  }

  // Register the plugin
  pluginRegistry.register(decisionStatusPluginPackage);
}
