import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getDocumentService } from '../services/RendererDocumentService';
import type { Document } from '@nimbalyst/runtime';
import type { TypeaheadOption } from '../components/Typeahead/GenericTypeahead';

export interface FileMentionReference {
  documentId: string;
  name: string;
  path: string;
  workspace?: string;
}

interface UseFileMentionOptions {
  // Callback when a file is selected
  onInsertReference: (reference: FileMentionReference) => void;
}

interface UseFileMentionReturn {
  options: TypeaheadOption[];
  isLoading: boolean;
  handleSearch: (query: string) => void;
  handleSelect: (option: TypeaheadOption) => void;
}

export function useFileMention({
  onInsertReference
}: UseFileMentionOptions): UseFileMentionReturn {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const previousDocCountRef = useRef<number>(0);

  const documentService = useMemo(() => getDocumentService(), []);

  // Load initial documents
  useEffect(() => {
    let mounted = true;

    const loadDocuments = async () => {
      try {
        // console.log('[useFileMention] Loading documents...');
        // console.log('[useFileMention] window.electronAPI available:', !!window.electronAPI);
        setIsLoading(true);
        const docs = await documentService.listDocuments();
        // console.log('[useFileMention] Loaded documents:', docs.length, docs);

        // If no documents, check if we have a workspace
        if (docs.length === 0) {
          // console.warn('[useFileMention] No documents found. This could mean:');
          // console.warn('  1. No workspace is open');
          // console.warn('  2. DocumentService is not initialized for this window');
          // console.warn('  3. No markdown files exist in the workspace');

          // Try to get more info
          if (window.electronAPI) {
            try {
              const result = await window.electronAPI.invoke('document-service:list');
              // console.log('[useFileMention] Direct IPC call result:', result);
            } catch (ipcErr) {
              console.error('[useFileMention] Direct IPC call failed:', ipcErr);
            }
          }
        }

        if (mounted) {
          previousDocCountRef.current = docs.length;
          setDocuments(docs);
        }
      } catch (err) {
        console.error('[useFileMention] Failed to load documents:', err);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    loadDocuments();

    // Watch for document changes
    const unsubscribe = documentService.watchDocuments((docs) => {
      if (!mounted) return;

      // Only update if the count changed to avoid unnecessary re-renders
      if (docs.length !== previousDocCountRef.current) {
        // console.log('[useFileMention] Documents changed:', previousDocCountRef.current, '->', docs.length);
        previousDocCountRef.current = docs.length;
        setDocuments(docs);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [documentService]);

  // Handle search query changes
  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query);

    if (!query.trim()) {
      // Empty query - show all documents
      const docs = await documentService.listDocuments();
      setDocuments(docs);
      return;
    }

    try {
      // Search documents by query
      const results = await documentService.searchDocuments(query);
      setDocuments(results);
    } catch (err) {
      console.error('[useFileMention] Search failed:', err);
    }
  }, [documentService]);

  // Convert documents to typeahead options
  const options = useMemo<TypeaheadOption[]>(() => {
    const opts = documents.map(doc => ({
      id: doc.id,
      label: doc.path || doc.name,
      icon: 'description',
      data: doc
    }));
    // Only log on initial load or significant changes
    if (opts.length > 0 && documents.length > 0) {
      // console.log('[useFileMention] Generated options:', opts.length);
    }
    return opts;
  }, [documents]);

  // Handle option selection
  const handleSelect = useCallback((option: TypeaheadOption) => {
    const document = option.data as Document;
    if (!document) return;

    const reference: FileMentionReference = {
      documentId: document.id,
      name: document.name,
      path: document.path,
      workspace: document.workspace
    };

    onInsertReference(reference);
  }, [onInsertReference]);

  return {
    options,
    isLoading,
    handleSearch,
    handleSelect
  };
}
