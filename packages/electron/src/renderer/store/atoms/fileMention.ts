/**
 * File Mention Atoms
 *
 * Provides Jotai-based state management for file mentions in AIInput.
 * Components subscribe directly to these atoms instead of receiving props.
 *
 * This approach follows the React State Architecture Guidelines:
 * - No prop drilling through multiple component layers
 * - AIInput subscribes directly to atoms internally
 * - Workspace-scoped: all sessions in a workspace share the same file list
 */

import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import { getDocumentService } from '../../services/RendererDocumentService';
import { fuzzyFilterDocuments, getFileIcon, type Document } from '@nimbalyst/runtime';
import type { TypeaheadOption } from '../../components/Typeahead/GenericTypeahead';

// ============================================================
// Types
// ============================================================

export interface FileMentionReference {
  documentId: string;
  name: string;
  path: string;
  workspace?: string;
}

// ============================================================
// Internal State
// ============================================================

// Cache for document lists per workspace
const documentCache = new Map<string, {
  documents: Document[];
  timestamp: number;
}>();

const CACHE_DURATION_MS = 5000; // 5 second cache

// ============================================================
// Base Atoms
// ============================================================

/**
 * All documents for a workspace (cached).
 * Used internally for filtering.
 */
export const workspaceDocumentsAtom = atomFamily((workspacePath: string) =>
  atom<Document[]>([])
);

/**
 * Loading state for document fetching
 */
export const documentsLoadingAtom = atomFamily((workspacePath: string) =>
  atom<boolean>(false)
);

/**
 * Current search query for file mentions.
 * Workspace-scoped since we search the same file set.
 */
export const fileMentionQueryAtom = atomFamily((workspacePath: string) =>
  atom<string>('')
);

// ============================================================
// Derived Atoms
// ============================================================

/**
 * Truncate a path for display, keeping the most relevant parts visible.
 */
function truncatePath(path: string, maxLength: number = 40): string {
  if (!path || path.length <= maxLength) return path;

  const parts = path.split('/');
  if (parts.length <= 2) return path;

  // Always keep the last 2-3 parts (closest to the file)
  const keepParts = parts.slice(-3);
  const truncated = '...' + keepParts.join('/');

  if (truncated.length <= maxLength) return truncated;

  // If still too long, keep fewer parts
  const fewerParts = parts.slice(-2);
  return '...' + fewerParts.join('/');
}

/**
 * Get the directory path (without filename) from a full path
 */
function getDirectoryPath(fullPath: string): string {
  const parts = fullPath.split('/');
  if (parts.length <= 1) return '';
  return parts.slice(0, -1).join('/');
}

/**
 * File mention options derived from documents and search query.
 * Filtered using fuzzy matching for CamelCase support.
 */
export const fileMentionOptionsAtom = atomFamily((workspacePath: string) =>
  atom<TypeaheadOption[]>((get) => {
    const documents = get(workspaceDocumentsAtom(workspacePath));
    const query = get(fileMentionQueryAtom(workspacePath));

    // Use fuzzy filtering with CamelCase support
    const filtered = fuzzyFilterDocuments(documents, query, 50);

    return filtered.map(({ item: doc }) => {
      const isDirectory = doc.type === 'directory';
      const dirPath = getDirectoryPath(doc.path);
      const truncatedPath = truncatePath(dirPath);

      return {
        id: doc.id,
        label: isDirectory ? doc.name + '/' : doc.name,
        description: truncatedPath || undefined,
        icon: isDirectory ? 'folder' : getFileIcon(doc.name, 18),
        data: doc
      };
    });
  })
);

// ============================================================
// Action Atoms
// ============================================================

/**
 * Load documents for a workspace (with caching).
 * Call this when AIInput mounts or when user starts typing @.
 */
export const loadDocumentsAtom = atom(
  null,
  async (get, set, workspacePath: string) => {
    // Check cache
    const cached = documentCache.get(workspacePath);
    const now = Date.now();

    if (cached && (now - cached.timestamp) < CACHE_DURATION_MS) {
      // Cache hit - update atom if needed
      const currentDocs = get(workspaceDocumentsAtom(workspacePath));
      if (currentDocs.length === 0) {
        set(workspaceDocumentsAtom(workspacePath), cached.documents);
      }
      return;
    }

    // Cache miss - fetch documents
    set(documentsLoadingAtom(workspacePath), true);

    try {
      const documentService = getDocumentService();
      const docs = await documentService.listDocuments();

      // Update cache
      documentCache.set(workspacePath, {
        documents: docs,
        timestamp: now
      });

      // Update atom
      set(workspaceDocumentsAtom(workspacePath), docs);
    } catch (err) {
      console.error('[fileMention] Failed to load documents:', err);
    } finally {
      set(documentsLoadingAtom(workspacePath), false);
    }
  }
);

/**
 * Search for files matching a query.
 * Updates the search query and ensures documents are loaded.
 */
export const searchFileMentionAtom = atom(
  null,
  async (get, set, { workspacePath, query }: { workspacePath: string; query: string }) => {
    // Update the query immediately
    set(fileMentionQueryAtom(workspacePath), query);

    // Ensure documents are loaded
    await set(loadDocumentsAtom, workspacePath);
  }
);

/**
 * Handle file mention selection.
 * Returns the reference for the selected file.
 */
export const selectFileMentionAtom = atom(
  null,
  (get, set, option: TypeaheadOption): FileMentionReference | null => {
    const document = option.data as Document;
    if (!document) return null;

    return {
      documentId: document.id,
      name: document.name,
      path: document.path,
      workspace: document.workspace
    };
  }
);

/**
 * Clear file mention search state for a workspace.
 */
export const clearFileMentionSearchAtom = atom(
  null,
  (get, set, workspacePath: string) => {
    set(fileMentionQueryAtom(workspacePath), '');
  }
);
