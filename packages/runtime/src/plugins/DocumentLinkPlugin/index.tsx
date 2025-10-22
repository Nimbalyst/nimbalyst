import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getSelection,
  $isRangeSelection,
  TextNode,
  $createTextNode,
  isDOMNode
} from 'lexical';
import { $createDocumentReferenceNode } from './DocumentLinkNode';
import { DocumentService } from '../../core/DocumentService';
import documentLinkStyles from './DocumentLinkPlugin.css?inline';
import { TypeaheadMenuOption } from "rexical";

const DOCUMENT_REFERENCE_STYLE_ID = 'document-reference-styles';

function ensureDocumentReferenceStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(DOCUMENT_REFERENCE_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = DOCUMENT_REFERENCE_STYLE_ID;
  style.textContent = documentLinkStyles;
  document.head.appendChild(style);
}

ensureDocumentReferenceStyles();

function getDocumentReferenceElement(target: Node): Element | null {
  const targetElement =
    typeof Element !== 'undefined' && target instanceof Element
      ? target
      : target.parentElement;

  return targetElement?.closest('.document-reference') ?? null;
}

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
  const lastFetchTimeRef = useRef<number>(0);
  const CACHE_DURATION_MS = 5000; // 5 second cache

  useEffect(() => {
    const handleDocumentReferenceClick = (event: MouseEvent, allowButton: (button: number) => boolean) => {
      if (event.defaultPrevented || !allowButton(event.button)) {
        return;
      }

      const target = event.target;
      if (!isDOMNode(target)) {
        return;
      }

      const referenceElement = getDocumentReferenceElement(target);
      if (!referenceElement) {
        return;
      }

      const documentId = referenceElement.getAttribute('data-document-id');
      const documentPath = referenceElement.getAttribute('data-path') || undefined;
      const documentName = referenceElement.getAttribute('data-name') || referenceElement.textContent || undefined;
      if (!documentId && !documentPath) {
        return;
      }

      const selectionPreventsNavigation = editor
        .getEditorState()
        .read(() => {
          const selection = $getSelection();
          return $isRangeSelection(selection) && !selection.isCollapsed();
        });

      if (selectionPreventsNavigation) {
        event.preventDefault();
        return;
      }

      event.preventDefault();
      try {
        if (documentId) {
          console.log('[DocumentLinkPlugin] Opening document reference', documentId);
        } else if (documentPath) {
          console.log('[DocumentLinkPlugin] Opening document reference by path', documentPath);
        }
      } catch {}

      void documentService
        .openDocument(documentId ?? '', { path: documentPath, name: documentName })
        .catch(error => {
          console.error('Failed to open document reference', error);
        });
    };

    const onClick = (event: MouseEvent) => handleDocumentReferenceClick(event, (button) => button === 0);
    const onAuxClick = (event: MouseEvent) => handleDocumentReferenceClick(event, (button) => button === 1);

    return editor.registerRootListener((rootElement, prevRootElement) => {
      if (prevRootElement) {
        prevRootElement.removeEventListener('click', onClick, true);
        prevRootElement.removeEventListener('auxclick', onAuxClick, true);
      }
      if (rootElement) {
        rootElement.addEventListener('click', onClick, true);
        rootElement.addEventListener('auxclick', onAuxClick, true);
        return () => {
          rootElement.removeEventListener('click', onClick, true);
          rootElement.removeEventListener('auxclick', onAuxClick, true);
        };
      }
    });
  }, [editor, documentService]);

  // Load documents only when menu opens, with cache
  const loadDocuments = useCallback(async () => {
    const now = Date.now();
    const timeSinceLastFetch = now - lastFetchTimeRef.current;

    // Skip fetch if cache is still valid
    if (timeSinceLastFetch < CACHE_DURATION_MS && documents.length > 0) {
      return;
    }

    const docs = await documentService.listDocuments();
    setDocuments(docs);
    lastFetchTimeRef.current = now;
  }, [documentService, documents.length]);

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
      // Only show workspace-relative folder path (no filename) if available
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
    option: TypeaheadMenuOption,
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
      onOpen={() => {
        menuOpenRef.current = true;
        loadDocuments();
      }}
      onClose={() => {
        menuOpenRef.current = false;
      }}
    />
  );
}
