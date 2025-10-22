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
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const lastFetchTimeRef = useRef<number>(0);
  const CACHE_DURATION_MS = 5000; // 5 second cache

  const documentService = useMemo(() => getDocumentService(), []);

  // Load documents with cache
  const loadDocuments = useCallback(async () => {
    const now = Date.now();
    const timeSinceLastFetch = now - lastFetchTimeRef.current;

    // Skip fetch if cache is still valid
    if (timeSinceLastFetch < CACHE_DURATION_MS && documents.length > 0) {
      return documents;
    }

    try {
      setIsLoading(true);
      const docs = await documentService.listDocuments();
      setDocuments(docs);
      lastFetchTimeRef.current = now;
      return docs;
    } catch (err) {
      console.error('[useFileMention] Failed to load documents:', err);
      return documents;
    } finally {
      setIsLoading(false);
    }
  }, [documentService, documents]);

  // Handle search query changes
  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query);

    if (!query.trim()) {
      // Empty query - load all documents (with cache)
      await loadDocuments();
      return;
    }

    try {
      // Search documents by query
      const results = await documentService.searchDocuments(query);
      setDocuments(results);
    } catch (err) {
      console.error('[useFileMention] Search failed:', err);
    }
  }, [documentService, loadDocuments]);

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
