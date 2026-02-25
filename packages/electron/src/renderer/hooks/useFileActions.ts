/**
 * useFileActions - Shared hook for common file operations.
 *
 * Consolidates actions that appear across multiple context menus
 * (file tree, tab bar, editor header) into a single reusable hook.
 */

import { useCallback, useState } from 'react';
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
  openShareDialog: () => void;
  shareDialogOpen: boolean;
  closeShareDialog: () => void;
  /** File path for ShareDialog */
  shareFilePath: string;
  /** File name for ShareDialog title */
  shareFileName: string;
}

export function useFileActions(filePath: string, fileName: string): FileActions {
  const hasExtEditor = useAtomValue(hasExternalEditorAtom);
  const extEditorName = useAtomValue(externalEditorNameAtom);
  const openInExtEditor = useSetAtom(openInExternalEditorAtom);
  const revealInFinderAction = useSetAtom(revealInFinderAtom);
  const copyFilePathAction = useSetAtom(copyFilePathAtom);

  const isShareable = isShareableFile(fileName);

  const [shareDialogOpen, setShareDialogOpen] = useState(false);

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

  const openShareDialog = useCallback(() => {
    setShareDialogOpen(true);
  }, []);

  const closeShareDialog = useCallback(() => {
    setShareDialogOpen(false);
  }, []);

  return {
    hasExternalEditor: hasExtEditor,
    externalEditorName: extEditorName,
    isShareable,
    openInDefaultApp,
    openInExternalEditor,
    revealInFinder,
    copyFilePath,
    openShareDialog,
    shareDialogOpen,
    closeShareDialog,
    shareFilePath: filePath,
    shareFileName: fileName,
  };
}
