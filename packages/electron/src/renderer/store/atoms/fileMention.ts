/**
 * File Mention Atoms
 *
 * Provides Jotai-based state management for file mentions in AIInput.
 * Components subscribe directly to these atoms instead of receiving props.
 *
 * Uses the ripgrep-based QuickOpen file cache for searching, which covers
 * all workspace files without the document service's scan limit.
 *
 * This approach follows the React State Architecture Guidelines:
 * - No prop drilling through multiple component layers
 * - AIInput subscribes directly to atoms internally
 * - Workspace-scoped: all sessions in a workspace share the same file list
 */

import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import { getFileIcon } from '@nimbalyst/runtime';
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

interface FileSearchResult {
  path: string;
  isFileNameMatch: boolean;
  matches: unknown[];
  score: number;
}

// ============================================================
// Internal State
// ============================================================

// Track which workspaces have had their QuickOpen cache built
const cacheBuiltForWorkspace = new Set<string>();

// ============================================================
// Base Atoms
// ============================================================

/**
 * Loading state for file search
 */
export const documentsLoadingAtom = atomFamily((workspacePath: string) =>
  atom<boolean>(false)
);

/**
 * Search results from the ripgrep-based QuickOpen file search.
 * Stored as TypeaheadOption[] ready for display.
 */
export const fileMentionOptionsAtom = atomFamily((workspacePath: string) =>
  atom<TypeaheadOption[]>([])
);

// ============================================================
// Helpers
// ============================================================

/**
 * Get the filename from a path
 */
function getFileName(filePath: string): string {
  const parts = filePath.split('/');
  return parts[parts.length - 1] || filePath;
}

/**
 * Get relative path by stripping the workspace prefix.
 */
function getRelativePath(absolutePath: string, workspacePath: string): string {
  if (absolutePath.startsWith(workspacePath)) {
    return absolutePath.slice(workspacePath.length + 1);
  }
  return absolutePath;
}

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
 * Ensure the ripgrep-based QuickOpen cache is built for a workspace.
 */
async function ensureQuickOpenCache(workspacePath: string): Promise<void> {
  if (cacheBuiltForWorkspace.has(workspacePath)) return;

  const api = (window as any).electronAPI || (window as any).electron;
  if (!api?.buildQuickOpenCache) return;

  try {
    await api.buildQuickOpenCache(workspacePath);
    cacheBuiltForWorkspace.add(workspacePath);
  } catch (err) {
    console.error('[fileMention] Failed to build QuickOpen cache:', err);
  }
}

/**
 * Convert search results to TypeaheadOption format.
 */
function resultsToOptions(results: FileSearchResult[], workspacePath: string): TypeaheadOption[] {
  return results.map(result => {
    const relativePath = getRelativePath(result.path, workspacePath);
    const fileName = getFileName(relativePath);
    const dirPath = getDirectoryPath(relativePath);
    const truncatedPath = truncatePath(dirPath);

    return {
      id: relativePath,
      label: fileName,
      description: truncatedPath || undefined,
      icon: getFileIcon(fileName, 18),
      data: {
        id: relativePath,
        name: fileName,
        path: relativePath,
      }
    };
  });
}

// ============================================================
// Action Atoms
// ============================================================

/**
 * Search for files matching a query using the ripgrep-based QuickOpen cache.
 * Results are stored directly in fileMentionOptionsAtom.
 */
export const searchFileMentionAtom = atom(
  null,
  async (get, set, { workspacePath, query }: { workspacePath: string; query: string }) => {
    const api = (window as any).electronAPI || (window as any).electron;
    if (!api?.searchWorkspaceFileNames) return;

    // Empty query: clear results
    if (!query.trim()) {
      set(fileMentionOptionsAtom(workspacePath), []);
      return;
    }

    set(documentsLoadingAtom(workspacePath), true);

    try {
      // Ensure the cache is built (no-op if already done)
      await ensureQuickOpenCache(workspacePath);

      // Search using the ripgrep-based cache in the main process
      const results: FileSearchResult[] = await api.searchWorkspaceFileNames(workspacePath, query);

      if (Array.isArray(results)) {
        set(fileMentionOptionsAtom(workspacePath), resultsToOptions(results, workspacePath));
      }
    } catch (err) {
      console.error('[fileMention] Search failed:', err);
    } finally {
      set(documentsLoadingAtom(workspacePath), false);
    }
  }
);

/**
 * Handle file mention selection.
 * Returns the reference for the selected file.
 */
export const selectFileMentionAtom = atom(
  null,
  (get, set, option: TypeaheadOption): FileMentionReference | null => {
    const data = option.data as { id: string; name: string; path: string; workspace?: string } | null;
    if (!data) return null;

    return {
      documentId: data.id,
      name: data.name,
      path: data.path,
      workspace: data.workspace
    };
  }
);

/**
 * Clear file mention search state for a workspace.
 */
export const clearFileMentionSearchAtom = atom(
  null,
  (get, set, workspacePath: string) => {
    set(fileMentionOptionsAtom(workspacePath), []);
  }
);
