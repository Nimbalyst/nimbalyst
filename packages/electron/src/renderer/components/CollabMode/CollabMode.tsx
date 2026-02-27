/**
 * CollabMode - Shared Documents mode.
 *
 * Top-level mode for browsing and editing collaborative documents
 * shared with the team. Layout: sidebar (doc list) + main area (collab tabs).
 *
 * Follows the same always-mounted, CSS-display-toggled pattern as
 * EditorMode, AgentMode, and TrackerMode.
 */

import React, { useCallback, useState, useEffect } from 'react';
import { useAtomValue } from 'jotai';
import { store } from '@nimbalyst/runtime/store';
import { CollabSidebar } from './CollabSidebar';
import { TabsProvider, useTabsActions, useTabs } from '../../contexts/TabsContext';
import { TabManager } from '../TabManager/TabManager';
import { TabContent } from '../TabContent/TabContent';
import { ChatSidebar } from '../ChatSidebar';
import { openCollabDocumentViaIPC } from '../../utils/collabDocumentOpener';
import { initSharedDocuments, destroyTeamSync, pendingCollabDocumentAtom, sharedDocumentsAtom, type SharedDocument } from '../../store/atoms/collabDocuments';
import { isCollabUri, parseCollabUri } from '../../utils/collabUri';
import { MaterialSymbol } from '@nimbalyst/runtime';

interface CollabModeProps {
  workspacePath: string;
  isActive: boolean;
  onFileOpen: (path: string) => void;
}

export const CollabMode: React.FC<CollabModeProps> = ({
  workspacePath,
  isActive,
  onFileOpen,
}) => {
  // Initialize shared documents sync from TeamRoom.
  // Retry when user activates collab mode, in case the initial attempt
  // failed (e.g., encryption key not yet available, admin hadn't shared keys).
  useEffect(() => {
    initSharedDocuments(workspacePath);
    return () => {
      destroyTeamSync();
    };
  }, [workspacePath]);

  useEffect(() => {
    if (isActive) {
      initSharedDocuments(workspacePath);
    }
  }, [isActive, workspacePath]);

  return (
    <TabsProvider workspacePath={workspacePath} disablePersistence>
      <CollabModeInner
        workspacePath={workspacePath}
        isActive={isActive}
        onFileOpen={onFileOpen}
      />
    </TabsProvider>
  );
};

// ---------------------------------------------------------------------------
// Persist open collab document IDs in workspace state so they survive refresh.
// ---------------------------------------------------------------------------

/** Save the list of open collab document IDs to workspace state. */
async function persistOpenCollabDocs(workspacePath: string, documentIds: string[]): Promise<void> {
  try {
    await window.electronAPI?.invoke?.('workspace:update-state', workspacePath, {
      openCollabDocumentIds: documentIds,
    });
  } catch (err) {
    console.warn('[CollabMode] Failed to persist open collab docs:', err);
  }
}

/** Load the list of open collab document IDs from workspace state. */
async function loadOpenCollabDocs(workspacePath: string): Promise<string[]> {
  try {
    const state = await window.electronAPI?.invoke?.('workspace:get-state', workspacePath);
    return state?.openCollabDocumentIds ?? [];
  } catch {
    return [];
  }
}

/**
 * Inner component that has access to TabsProvider context.
 */
const CollabModeInner: React.FC<CollabModeProps> = ({
  workspacePath,
  isActive,
  onFileOpen,
}) => {
  const tabsActions = useTabsActions();
  const { tabs, activeTabId } = useTabs();
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const pendingDoc = useAtomValue(pendingCollabDocumentAtom);
  const [restored, setRestored] = useState(false);

  const handleDocumentSelect = useCallback(async (doc: SharedDocument, initialContent?: string) => {
    setSelectedDocId(doc.documentId);

    // Check if already open as a tab
    const existingTab = tabs.find(
      t => t.filePath.includes(doc.documentId)
    );
    if (existingTab) {
      tabsActions.switchTab(existingTab.id);
      return;
    }

    // Open as collab tab
    await openCollabDocumentViaIPC({
      workspacePath,
      documentId: doc.documentId,
      title: doc.title,
      initialContent,
      addTab: tabsActions.addTab,
    });
  }, [workspacePath, tabs, tabsActions]);

  // Persist open document IDs whenever tabs change
  useEffect(() => {
    if (!restored) return; // Don't persist until we've finished restoring
    const docIds = tabs
      .filter(t => isCollabUri(t.filePath))
      .map(t => {
        try { return parseCollabUri(t.filePath).documentId; }
        catch { return null; }
      })
      .filter((id): id is string => id !== null);
    persistOpenCollabDocs(workspacePath, docIds);
  }, [tabs, workspacePath, restored]);

  // Restore previously open collab documents on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const savedDocIds = await loadOpenCollabDocs(workspacePath);
      if (cancelled || savedDocIds.length === 0) {
        setRestored(true);
        return;
      }

      // Open each saved document. We don't need to wait for sharedDocumentsAtom
      // because openCollabDocumentViaIPC resolves auth/keys via IPC directly.
      // Use the documentId as both documentId and title (title is only for display).
      for (const docId of savedDocIds) {
        if (cancelled) break;
        try {
          await openCollabDocumentViaIPC({
            workspacePath,
            documentId: docId,
            title: docId,
            addTab: tabsActions.addTab,
          });
        } catch (err) {
          console.warn('[CollabMode] Failed to restore collab document:', docId, err);
        }
      }
      setRestored(true);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath]); // Only run on mount (tabsActions is stable ref-based)

  // Auto-open a pending document (set by "Share to Team" action)
  useEffect(() => {
    if (!pendingDoc || !isActive) return;

    // Find the document in the shared documents atom
    const docs = store.get(sharedDocumentsAtom);
    const doc = docs.find(d => d.documentId === pendingDoc.documentId);
    if (doc) {
      // Clear the pending flag before opening to avoid re-triggering
      store.set(pendingCollabDocumentAtom, null);
      handleDocumentSelect(doc, pendingDoc.initialContent);
    }
  }, [pendingDoc, isActive, handleDocumentSelect]);

  const handleTabClose = useCallback((tabId: string) => {
    tabsActions.removeTab(tabId);
  }, [tabsActions]);

  const hasTabs = tabs.length > 0;

  return (
    <div className="collab-mode flex-1 flex flex-row overflow-hidden min-h-0">
      {/* Left: Document sidebar */}
      <CollabSidebar
        onDocumentSelect={handleDocumentSelect}
        selectedDocumentId={selectedDocId}
      />

      {/* Center: Tabs + editor */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        {hasTabs ? (
          <TabManager
            onTabClose={handleTabClose}
            onNewTab={() => {}}
            isActive={isActive}
          >
            <TabContent
              onTabClose={handleTabClose}
            />
          </TabManager>
        ) : (
          /* Empty state when no tabs open */
          <div className="flex-1 flex items-center justify-center text-nim-muted">
            <div className="text-center">
              <MaterialSymbol icon="cloud_sync" size={48} className="text-nim-faint mb-3" />
              <p className="text-base m-0">Select a shared document</p>
              <p className="text-sm text-nim-faint mt-1 m-0">
                Choose a document from the sidebar to start collaborating
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Right: AI Chat sidebar */}
      {hasTabs && (
        <div className="w-[350px] min-w-[280px] max-w-[500px] flex flex-col border-l border-nim overflow-hidden">
          <ChatSidebar
            workspacePath={workspacePath}
            onFileOpen={async (filePath) => onFileOpen(filePath)}
          />
        </div>
      )}
    </div>
  );
};
