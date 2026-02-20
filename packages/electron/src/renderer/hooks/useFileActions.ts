/**
 * useFileActions - Shared hook for common file operations.
 *
 * Consolidates actions that appear across multiple context menus
 * (file tree, tab bar, editor header) into a single reusable hook.
 */

import { useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  hasExternalEditorAtom,
  externalEditorNameAtom,
  openInExternalEditorAtom,
  revealInFinderAtom,
  copyFilePathAtom,
} from '../store/atoms/appSettings';

/** File extensions that support sharing as rendered HTML links. */
const SHAREABLE_EXTENSIONS = new Set(['.md', '.markdown']);

function isShareableFile(fileName: string): boolean {
  const ext = fileName.lastIndexOf('.') >= 0
    ? fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
    : '';
  return SHAREABLE_EXTENSIONS.has(ext);
}

export interface FileActions {
  hasExternalEditor: boolean;
  externalEditorName: string | undefined;
  isShareable: boolean;

  openInDefaultApp: () => Promise<void>;
  openInExternalEditor: () => void;
  revealInFinder: () => void;
  copyFilePath: () => void;
  shareLink: () => Promise<void>;
}

export function useFileActions(filePath: string, fileName: string): FileActions {
  const hasExtEditor = useAtomValue(hasExternalEditorAtom);
  const extEditorName = useAtomValue(externalEditorNameAtom);
  const openInExtEditor = useSetAtom(openInExternalEditorAtom);
  const revealInFinderAction = useSetAtom(revealInFinderAtom);
  const copyFilePathAction = useSetAtom(copyFilePathAtom);

  const isShareable = isShareableFile(fileName);

  const openInDefaultApp = useCallback(async () => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      const result = await window.electronAPI.openInDefaultApp(filePath);
      if (!result.success) {
        console.error('Failed to open in default app:', result.error);
      }
    }
  }, [filePath]);

  const openInExternalEditor = useCallback(() => {
    openInExtEditor(filePath);
  }, [openInExtEditor, filePath]);

  const revealInFinder = useCallback(() => {
    revealInFinderAction(filePath);
  }, [revealInFinderAction, filePath]);

  const copyFilePath = useCallback(() => {
    copyFilePathAction(filePath);
  }, [copyFilePathAction, filePath]);

  const shareLink = useCallback(async () => {
    if (typeof window === 'undefined' || !window.electronAPI) return;

    try {
      const result = await window.electronAPI.shareFileAsLink({ filePath });
      if (result?.success) {
        const { errorNotificationService } = await import('../services/ErrorNotificationService');
        const expiryDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const expiryStr = expiryDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        errorNotificationService.showInfo(
          result.isUpdate ? 'Share link updated' : 'Share link copied',
          `Link copied to clipboard. Expires ${expiryStr}.`,
          { duration: 4000 }
        );
      } else {
        const { errorNotificationService } = await import('../services/ErrorNotificationService');
        errorNotificationService.showError(
          'Share failed',
          result?.error || 'Failed to share file',
          { duration: 5000 }
        );
      }
    } catch (error) {
      console.error('Failed to share file:', error);
      const { errorNotificationService } = await import('../services/ErrorNotificationService');
      errorNotificationService.showError(
        'Share failed',
        error instanceof Error ? error.message : 'An unexpected error occurred',
        { duration: 5000 }
      );
    }
  }, [filePath]);

  return {
    hasExternalEditor: hasExtEditor,
    externalEditorName: extEditorName,
    isShareable,
    openInDefaultApp,
    openInExternalEditor,
    revealInFinder,
    copyFilePath,
    shareLink,
  };
}
