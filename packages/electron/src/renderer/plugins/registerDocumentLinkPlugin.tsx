/**
 * Register the DocumentLinkPlugin with the Electron-specific document service
 */

import React, { useMemo } from 'react';
import { pluginRegistry, type PluginPackage } from 'rexical';
import {
  DocumentLinkPlugin,
  DocumentReferenceNode,
  DocumentReferenceTransformer
} from '@nimbalyst/runtime';
import { ElectronRendererDocumentService } from '../services/ElectronDocumentService';
import { TypeaheadMenuPlugin, useAnchorElem } from 'rexical';

// Create the document service instance
const documentService = new ElectronRendererDocumentService();

// Custom trigger function that allows dots in filenames
// Based on createBasicTriggerFunction but excludes dots from punctuation
function createDocumentLinkTrigger(trigger: string, { minLength = 0, maxLength = 75 }) {
  // Punctuation WITHOUT dots - allows filenames like "test.md"
  const PUNCTUATION_NO_DOT = String.raw`\,\+\*\?\$\|#{}\(\)\^\-\[\]\\\/!%'"~=<>_:;`;

  return (text: string) => {
    const validChars = '[^' + trigger + PUNCTUATION_NO_DOT + '\\s]';
    const regex = new RegExp(
      '(^|\\s|\\()(' +
        '[' +
        trigger +
        ']' +
        '((?:' +
        validChars +
        '){0,' +
        maxLength +
        '})' +
        ')$',
    );
    const match = regex.exec(text);
    if (match !== null) {
      const maybeLeadingWhitespace = match[1];
      const matchingString = match[3];
      if (matchingString.length >= minLength) {
        return {
          leadOffset: match.index + maybeLeadingWhitespace.length,
          matchingString,
          replaceableString: match[2],
        };
      }
    }
    return null;
  };
}

// Create a wrapper component that properly uses the hook
function DocumentLinkPluginWrapper() {
  // Create the trigger function that allows dots in filenames
  const triggerFn = useMemo(() => createDocumentLinkTrigger('@', { minLength: 0, maxLength: 75 }), []);
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
