/**
 * CommonFileActions - Shared menu items for file operations.
 *
 * Renders the common file action items (Open in Default App, Open in External Editor,
 * Show in Finder, Copy Path, Share Link, Share to Team) used across multiple context menus:
 * - FileContextMenu (file tree right-click)
 * - TabBar context menu (tab right-click)
 * - UnifiedEditorHeaderBar (header actions dropdown)
 *
 * Each consumer provides CSS classes to match their own styling.
 */

import React, { useCallback } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import { store } from '@nimbalyst/runtime/store';
import { useFileActions } from '../hooks/useFileActions';
import { registerDocumentInIndex, pendingCollabDocumentAtom } from '../store/atoms/collabDocuments';
import { setWindowModeAtom } from '../store/atoms/windowMode';

interface CommonFileActionsProps {
  filePath: string;
  fileName: string;
  onClose: () => void;
  /** CSS class for each menu item row */
  menuItemClass: string;
  /** CSS class for separator divs */
  separatorClass: string;
  /** Icon size in px (default 18) */
  iconSize?: number;
  /** Whether to show icons (default true) */
  showIcons?: boolean;
  /** Render items as <button> elements instead of <div> (default false) */
  useButtons?: boolean;
}

export function CommonFileActions({
  filePath,
  fileName,
  onClose,
  menuItemClass,
  separatorClass,
  iconSize = 18,
  showIcons = true,
  useButtons = false,
}: CommonFileActionsProps) {
  const actions = useFileActions(filePath, fileName);
  const handleShareToTeam = useCallback(async () => {
    // Read file content to seed the collaborative document on first share
    let initialContent: string | undefined;
    try {
      if (window.electronAPI?.invoke) {
        const result = await window.electronAPI.invoke('read-file-content', filePath);
        if (result?.success && result?.content) {
          initialContent = result.content;
        }
      }
    } catch (err) {
      console.warn('Failed to read file content for share:', err);
    }

    // Register in the doc index (optimistic local update is synchronous,
    // server registration happens in background)
    registerDocumentInIndex(fileName, fileName, 'markdown').catch(error => {
      console.error('Failed to register document in index:', error);
    });

    // Set the pending document so CollabMode auto-opens it (with content for seeding)
    store.set(pendingCollabDocumentAtom, { documentId: fileName, initialContent });

    // Switch to collab mode immediately
    store.set(setWindowModeAtom, 'collab');

    import('../services/ErrorNotificationService').then(({ errorNotificationService }) => {
      errorNotificationService.showInfo(
        'Shared to team',
        `"${fileName}" is now a collaborative document.`,
        { duration: 4000 }
      );
    });
  }, [filePath, fileName]);

  const Item = useButtons ? 'button' : 'div';

  return (
    <>
      {/* Open in Default App */}
      <Item
        className={menuItemClass}
        onClick={() => { actions.openInDefaultApp(); onClose(); }}
      >
        {showIcons && <MaterialSymbol icon="launch" size={iconSize} />}
        <span>Open in Default App</span>
      </Item>

      {/* Open in External Editor (conditional) */}
      {actions.hasExternalEditor && (
        <Item
          className={menuItemClass}
          onClick={() => { actions.openInExternalEditor(); onClose(); }}
        >
          {showIcons && <MaterialSymbol icon="open_in_new" size={iconSize} />}
          <span>Open in {actions.externalEditorName}</span>
        </Item>
      )}

      {/* Show in Finder */}
      <Item
        className={menuItemClass}
        onClick={() => { actions.revealInFinder(); onClose(); }}
      >
        {showIcons && <MaterialSymbol icon="folder_open" size={iconSize} />}
        <span>Show in Finder</span>
      </Item>

      {/* Copy Path */}
      <Item
        className={menuItemClass}
        onClick={() => { actions.copyFilePath(); onClose(); }}
      >
        {showIcons && <MaterialSymbol icon="content_copy" size={iconSize} />}
        <span>Copy Path</span>
      </Item>

      {/* Share Link (conditional on file type) */}
      {actions.isShareable && (
        <Item
          className={menuItemClass}
          onClick={() => { actions.shareLink(); onClose(); }}
        >
          {showIcons && <MaterialSymbol icon="share" size={iconSize} />}
          <span>Share Link</span>
        </Item>
      )}

      {/* Share to Team (collaborative editing - conditional on file type) */}
      {actions.isShareable && (
        <Item
          className={menuItemClass}
          onClick={() => { handleShareToTeam(); onClose(); }}
        >
          {showIcons && <MaterialSymbol icon="group" size={iconSize} />}
          <span>Share to Team</span>
        </Item>
      )}
    </>
  );
}
