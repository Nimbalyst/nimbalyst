import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getDocumentService } from '../services/RendererDocumentService';
import type { Document } from '@nimbalyst/runtime';
import { getFileIcon } from '@nimbalyst/runtime';
import type { TypeaheadOption } from '../components/Typeahead/GenericTypeahead';


const shortenPath = (fullPath: string, maxLength = 80): string => {
  if (!fullPath) return '';
  if (fullPath.length <= maxLength) return fullPath;
  const keep = Math.floor((maxLength - 3) / 2);
  return `${fullPath.slice(0, keep)}...${fullPath.slice(fullPath.length - keep)}`;
};

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
      // Debug logging - comment out for production
      // console.log('[useFileMention] Using cached documents:', documents.length);
      return documents;
    }

    try {
      setIsLoading(true);
      // Debug logging - comment out for production
      // console.log('[useFileMention] Loading documents from service...');
      const docs = await documentService.listDocuments();
      // console.log('[useFileMention] Loaded documents:', docs.length);
      // if (docs.length > 0 && docs.length <= 20) {
      //   console.log('[useFileMention] Document list:', docs.map(d => `${d.name} (${d.type})`));
      // }
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
    // Debug logging - comment out for production
    // console.log('[useFileMention] handleSearch called with query:', query);
    setSearchQuery(query);

    if (!query.trim()) {
      // Empty query - load all documents (with cache)
      // Debug logging - comment out for production
      // console.log('[useFileMention] Empty query, loading all documents');
      await loadDocuments();
      // console.log('[useFileMention] After loadDocuments, documents.length:', documents.length);
      return;
    }

    try {
      // Search documents by query
      // Debug logging - comment out for production
      // console.log('[useFileMention] Searching documents with query:', query);
      const results = await documentService.searchDocuments(query);
      // console.log('[useFileMention] Search results:', results.length);
      setDocuments(results);
    } catch (err) {
      console.error('[useFileMention] Search failed:', err);
    }
  }, [documentService, loadDocuments, documents.length]);


  // Convert documents to typeahead options
  const options = useMemo<TypeaheadOption[]>(() => {
    // Debug logging - comment out for production
    // console.log('[useFileMention] Converting documents to options, documents.length:', documents.length);
    const opts = documents.map(doc => {
      const fullPath = doc.path || doc.name;
      // Use shortenPath with 80 character max to show beginning and end
      const displayLabel = shortenPath(fullPath, 80);

      return {
        id: doc.id,
        label: displayLabel,
        icon: getFileIcon(doc.name, 18),
        data: doc
      };
    });
    // console.log('[useFileMention] Generated options:', opts.length);
    // if (opts.length > 0 && opts.length <= 10) {
    //   console.log('[useFileMention] Sample options:', opts.slice(0, 5).map(o => o.label));
    // }
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
