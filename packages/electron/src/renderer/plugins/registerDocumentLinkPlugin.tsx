/**
 * Register the DocumentLinkPlugin with the Electron-specific document service
 */

import React from 'react';
import { pluginRegistry, type PluginPackage } from 'rexical';
import {
  DocumentLinkPlugin,
  DocumentReferenceNode,
  DocumentReferenceTransformer
} from '@stravu/runtime';
import { ElectronRendererDocumentService } from '../services/ElectronDocumentService';
import { TypeaheadMenuPlugin, useAnchorElem } from 'rexical';
import { useBasicTypeaheadTriggerMatch } from '@lexical/react/LexicalTypeaheadMenuPlugin';

// Create the document service instance
const documentService = new ElectronRendererDocumentService();

// Create a wrapper component that properly uses the hook
function DocumentLinkPluginWrapper() {
  // Create the trigger function via the hook at the top level
  const triggerFn = useBasicTypeaheadTriggerMatch('[', { minLength: 0, maxLength: 75 });
  const anchorElem = useAnchorElem();

  return (
    <DocumentLinkPlugin
      documentService={documentService}
      TypeaheadMenuPlugin={TypeaheadMenuPlugin as any}
      triggerFn={triggerFn}
      anchorElem={anchorElem || undefined}
    />
  );
}

// Create plugin package with the document service configured
const documentLinkPluginPackage: PluginPackage = {
  name: 'DocumentLinkPlugin',
  Component: DocumentLinkPluginWrapper,
  nodes: [DocumentReferenceNode],
  transformers: [DocumentReferenceTransformer],
  enabledByDefault: true
};

// Register the plugin
export function registerDocumentLinkPlugin(): void {
  pluginRegistry.register(documentLinkPluginPackage);
}
