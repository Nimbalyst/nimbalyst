import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getSelection,
  $isRangeSelection,
  TextNode,
  $createTextNode
} from 'lexical';
import { $createDocumentReferenceNode } from './DocumentLinkNode';
import { DocumentService } from '../../core/DocumentService';

import './DocumentLinkPlugin.css';

interface DocumentLinkPluginProps {
  documentService: DocumentService;
  TypeaheadMenuPlugin: React.ComponentType<any>;
  // Precomputed trigger function (created via useBasicTypeaheadTriggerMatch in the host)
  triggerFn: any;
  // Optional anchor element to render the menu within
  anchorElem?: HTMLElement | null;
}

export function DocumentLinkPlugin({
  documentService,
  TypeaheadMenuPlugin,
  triggerFn,
  anchorElem,
}: DocumentLinkPluginProps): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const [queryString, setQueryString] = useState<string>('');
  const [documents, setDocuments] = useState<any[]>([]);
  const menuOpenRef = useRef(false);
  const pendingDocsRef = useRef<any[] | null>(null);

  // Load documents when component mounts
  useEffect(() => {
    documentService.listDocuments().then(setDocuments);

    // Watch for document changes, but avoid updating while the menu is open
    const unsubscribe = documentService.watchDocuments((docs) => {
      if (menuOpenRef.current) {
        pendingDocsRef.current = docs;
      } else {
        setDocuments(docs);
      }
    });
    return unsubscribe;
  }, [documentService]);

  // triggerFn is provided by the host; ensure stable reference via useMemo
  const resolvedTriggerFn = useMemo(() => triggerFn, [triggerFn]);

  // Generate document options based on search query
  const options = useMemo(() => {
    const searchPromise = queryString
      ? documentService.searchDocuments(queryString)
      : Promise.resolve(documents);

    // Since TypeaheadMenuPlugin expects synchronous options, we need to handle this differently
    // For now, we'll use the cached documents and filter them locally
    const filteredDocs = queryString
      ? documents.filter(doc =>
          doc.name.toLowerCase().includes(queryString.toLowerCase()) ||
          doc.path.toLowerCase().includes(queryString.toLowerCase())
        )
      : documents;

    return filteredDocs.map(doc => ({
      id: `doc-${doc.id}`,
      label: doc.name,
      // Only show project-relative folder path (no filename) if available
      description: doc.workspace || undefined,
      icon: '📄',
      section: doc.workspace || 'Documents',
      keywords: [doc.name, doc.workspace, doc.path].filter(Boolean) as string[]
    }));
  }, [queryString, documents, documentService]);

  const handleQueryChange = useCallback((query: string | null) => {
    setQueryString(query || '');
  }, []);

  const handleSelectOption = useCallback((
    option: any,
    _textNode: TextNode | null,
    closeMenu: () => void,
    _matchingString: string
  ) => {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;

      const docId = option.id.replace('doc-', '');
      const doc = documents.find(d => d.id === docId);
      if (!doc) return;

      const replacementNode = $createDocumentReferenceNode(
        doc.id,
        doc.name,
        doc.path,
        doc.workspace
      );

      // Typeahead has already removed the trigger text; just insert at caret
      selection.insertNodes([replacementNode]);

      // Add a trailing space and place cursor after it
      const spaceNode = $createTextNode(' ');
      replacementNode.insertAfter(spaceNode);
      spaceNode.select();
    });

    closeMenu();
  }, [editor, documents]);

  return (
    <TypeaheadMenuPlugin
      options={options}
      triggerFn={resolvedTriggerFn}
      onQueryChange={handleQueryChange}
      onSelectOption={handleSelectOption}
      anchorElem={anchorElem}
      onOpen={() => { menuOpenRef.current = true; }}
      onClose={() => {
        menuOpenRef.current = false;
        if (pendingDocsRef.current) {
          setDocuments(pendingDocsRef.current);
          pendingDocsRef.current = null;
        }
      }}
    />
  );
}
